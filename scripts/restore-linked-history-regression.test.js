import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { prepareLinkedRestoreRows } from '../src/finance-tools.js'
import { restoreAtomic } from '../functions/api/restore-atomic.js'
import { isCardBilledEntry, cardBilledAmount } from '../src/card-billing.js'
import { postScheduledRecurring } from '../functions/api/recurring-auto.js'

class D1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  }
  prepare(sql) {
    const db = this.sqlite
    const statement = db.prepare(sql)
    const query = {args:[],bind(...args) {this.args=args;return this}}
    query.first = async () => statement.get(...query.args) || null
    query.all = async () => ({results:statement.all(...query.args)})
    query.run = async () => {
      const result = statement.run(...query.args)
      return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}
    }
    return query
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const result=[]
      for(const statement of statements) result.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return result
    } catch(e) {
      this.sqlite.exec('ROLLBACK')
      throw e
    }
  }
  close() {this.sqlite.close()}
}
const makeArchive = () => {
  const plan = {
    id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',name:'テスト家賃',amount:9000,day:7,
    category:'住居',paymentSource:'現金',startMonth:'2026-11',
    enabled:true,postingMode:'auto',autoFromMonth:'2026-11',
    scheduleType:'monthly',weekday:0
  }
  const entries=[
    {id:11,date:'2026-11-06',time:'10:00',amount:900,type:'income',category:'ポイント還元',
      merchant:'還元',payment_source:'ポイント還元',transfer_target:'prepaid:Suica',
      client_request_id:'income_reward_11',backupIndex:0},
    {id:12,date:'2026-11-06',time:'10:00',amount:900,type:'transfer',
      category:'投資・資産移動',merchant:'Suicaチャージ',payment_source:'ポイント還元',
      transfer_target:'prepaid:Suica',transfer_date:'2026-11-06',
      client_request_id:'point_charge_income_reward_11',backupIndex:1},
    {id:13,date:'2026-11-06',time:'11:00',amount:180,type:'income',category:'ポイント還元',
      merchant:'カード還元',payment_source:'楽天カード',transfer_target:'credit:楽天カード',
      client_request_id:'income_reward_13',backupIndex:2},
    {id:14,date:'2026-11-07',time:'',amount:9000,type:'expense',category:'住居',
      merchant:'テスト家賃',payment_source:'現金',
      client_request_id:'recurring_aaaaaaaabbbbccccddddeeeeeeeeeeee_202611',backupIndex:3}
  ]
  return {format:'kakeibo-ledger-backup',version:4,entries,plans:[plan],
    paymentSources:[
      {name:'Suica',source_type:'prepaid',opening_balance:0,opening_date:'2026-11-06',opening_entry_id:0},
      {name:'楽天カード',source_type:'standard'},
      {name:'ポイント還元',source_type:'standard'},
      {name:'現金',source_type:'standard'}
    ]}
}

test('restored points keep card offsets and the child charge keeps its real parent link',async()=>{
  const archive=makeArchive()
  const rebuilt=await prepareLinkedRestoreRows(archive.entries,archive.entries,[],archive.plans)
  assert.equal(rebuilt[0].clientRequestId.startsWith('restore_'),true)
  assert.equal(rebuilt[1].clientRequestId,'point_charge_'+rebuilt[0].clientRequestId)
  assert.equal(rebuilt[3].clientRequestId,archive.entries[3].client_request_id)
  const db=new D1()
  try{
    const payload={...archive,entries:rebuilt,
      prepaidRestoreInProgress:true,
      prepaidFinalize:[{name:'Suica',openingBalance:900}]}
    assert.equal((await restoreAtomic(db,payload)).created,4)
    assert.equal((await restoreAtomic(db,payload)).created,0,'retries must not double-credit balances')
    const income=db.sqlite.prepare("SELECT * FROM entries WHERE merchant='還元'").get()
    const child=db.sqlite.prepare("SELECT * FROM entries WHERE merchant='Suicaチャージ'").get()
    const credit=db.sqlite.prepare("SELECT * FROM entries WHERE merchant='カード還元'").get()
    assert.equal(income.transfer_target,'prepaid:Suica')
    assert.equal(child.client_request_id,'point_charge_'+income.client_request_id)
    assert.equal(child.amount,income.amount)
    assert.equal(child.transfer_target,income.transfer_target)
    assert.equal(credit.transfer_target,'credit:楽天カード')
    assert.equal(isCardBilledEntry(credit,{start:'2026-11-01',end:'2026-11-30'},'楽天カード'),true)
    assert.equal(cardBilledAmount(credit),-180)
    const recurring=db.sqlite.prepare("SELECT * FROM entries WHERE merchant='テスト家賃'").get()
    assert.equal(recurring.client_request_id,archive.entries[3].client_request_id)
    const cron=await postScheduledRecurring(db,{today:'2026-11-07'})
    assert.equal(cron.created,0,'restored auto-post must never be recreated by the same-day cron')
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM entries WHERE merchant='テスト家賃'").get().n,1)
  }finally{db.close()}
})

test('a partial point-income restore is rejected before the first database write',async()=>{
  const archive=makeArchive()
  await assert.rejects(
    prepareLinkedRestoreRows([archive.entries[0]],archive.entries,[],archive.plans),
    /セットで復元/)
  await assert.rejects(
    prepareLinkedRestoreRows([archive.entries[1]],archive.entries,[],archive.plans),
    /元となるポイント還元収入/)
})

test('restarting a partially restored archive reattaches the charge to its existing parent',async()=>{
  const archive=makeArchive()
  const parent=archive.entries[0]
  const existing={...parent,id:91,client_request_id:'restore_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}
  const charge=await prepareLinkedRestoreRows([archive.entries[1]],archive.entries,[existing],archive.plans)
  assert.equal(charge[0].clientRequestId,'point_charge_'+existing.client_request_id)
})

test('archived cards remain viewable, while archived sources stay unavailable for new entries',()=>{
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const prepaid=readFileSync(new URL('../functions/api/prepaid-assets.js',import.meta.url),'utf8')
  assert.match(app,/paymentSourceMeta\.value\[cardName\]\?\.source_type !== 'prepaid'/)
  assert.match(app,/paymentSourceMeta\.value\[name\]\?\.source_type !== 'standard'/)
  assert.match(app,/cards\.filter\(x=>!x\.is_archived\)/)
  assert.match(prepaid,/ORDER BY p\.is_archived,p\.sort_order,p\.name/)
})
