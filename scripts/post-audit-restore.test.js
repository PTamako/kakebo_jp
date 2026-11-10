import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {restoreAtomic} from '../functions/api/restore-atomic.js'
import {handlePrepaid} from '../functions/api/prepaid-assets.js'
import {matchesPrepaidHistoryEntry} from '../src/prepaid-history.js'
import {chunkRestoreSettings,isFuturePrepaidMovement,prepaidRestoreBalances} from '../src/finance-tools.js'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
class MemoryD1 {
  constructor(){
    this.sqlite=new DatabaseSync(':memory:')
    this.sqlite.exec(read('schema.sql'))
  }
  prepare(sql){
    const db=this.sqlite
    const item={args:[],bind(...params){this.args=params;return this}}
    item.first=async()=>db.prepare(sql).get(...item.args)||null
    item.all=async()=>({results:db.prepare(sql).all(...item.args)})
    item.run=async()=>{
      const result=db.prepare(sql).run(...item.args)
      return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)},success:true}
    }
    return item
  }
  async batch(statements){
    this.sqlite.exec('BEGIN IMMEDIATE')
    try{
      const results=[]
      for(const statement of statements)results.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return results
    }catch(e){
      this.sqlite.exec('ROLLBACK')
      throw e
    }
  }
  close(){this.sqlite.close()}
}
const emptyArchive=()=>({format:'kakeibo-ledger-backup',version:4,entries:[]})
const dayOffset=days=>new Date(Date.now()+9*3600000+days*86400000).toISOString().slice(0,10)
const id=n=>'restore_'+n.toString(16).padStart(32,'0')

test('large archives split ALL settings into ordered, bounded D1 transactions without losing category display rank',async()=>{
  const rows=Array.from({length:540},(_,i)=>({
    category:'分類'+String(i).padStart(4,'0'),
    display_name:'表示'+String(i).padStart(4,'0'),
    sort_order:1000+i,icon:'food'
  }))
  const archive={...emptyArchive(),categories:rows.map(r=>r.category),categoryMetadata:rows,
    categoryIcons:Object.fromEntries(rows.slice(0,25).map(r=>[r.category,'food'])),
    customRules:[{keyword:'個人設定のスーパー',category:rows[0].category}]}
  const batches=chunkRestoreSettings(archive,80)
  assert.ok(batches.length>10)
  assert.ok(batches.every(b=>
    Object.entries(b).reduce((n,[key,value])=>n+(key==='categoryIcons'?Object.keys(value).length:value.length),0)<=80))
  assert.deepEqual(batches.flatMap(b=>b.categories||[]),archive.categories)
  assert.deepEqual(batches.flatMap(b=>b.categoryMetadata||[]),archive.categoryMetadata)
  assert.deepEqual(batches.flatMap(b=>b.customRules||[]),archive.customRules)
  const db=new MemoryD1()
  try{
    db.sqlite.prepare("INSERT INTO category_source(category,sort_order,icon,display_name) VALUES('分類0000',1,'star','既存優先')").run()
    for(const batch of batches){
      const result=await restoreAtomic(db,{...emptyArchive(),...batch,prepaidRestoreInProgress:true})
      assert.equal(result.ok,true)
    }
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM category_source WHERE category LIKE '分類%'").get().n,540)
    const first=db.sqlite.prepare("SELECT sort_order,icon,display_name FROM category_source WHERE category='分類0000'").get()
    assert.equal(first.sort_order,1)
    assert.equal(first.display_name,'既存優先')
    const last=db.sqlite.prepare("SELECT sort_order,icon,display_name FROM category_source WHERE category='分類0539'").get()
    assert.deepEqual({...last},{sort_order:1539,icon:'food',display_name:'表示0539'})
    assert.equal(db.sqlite.prepare("SELECT category FROM merchant_rules WHERE keyword='個人設定のスーパー'").get().category,'分類0000')
  }finally{db.close()}
})

test('scheduled prepaid debit booked before rebase stays pending and becomes visible on its effective date',async()=>{
  const yesterday=dayOffset(-1),today=dayOffset(0),tomorrow=dayOffset(1)
  const card={name:'Suica',source_type:'prepaid',opening_balance:5000,opening_date:dayOffset(-7),opening_entry_id:0}
  const charged={id:1,date:yesterday,type:'transfer',amount:700,payment_source:'現金',
    transfer_target:'prepaid:Suica',transfer_date:yesterday,clientRequestId:id(1)}
  const deferred={id:2,date:yesterday,type:'transfer',amount:400,payment_source:'Suica',
    transfer_target:'sbi',transfer_date:tomorrow,clientRequestId:id(2)}
  const futureSpend={id:3,date:tomorrow,type:'expense',amount:100,payment_source:'Suica',clientRequestId:id(3)}
  const archive={...emptyArchive(),paymentSources:[card],entries:[charged,deferred,futureSpend]}
  assert.equal(prepaidRestoreBalances(archive,today)[0].openingBalance,5700)
  assert.equal(isFuturePrepaidMovement(deferred,['Suica'],today),true)
  assert.equal(isFuturePrepaidMovement(futureSpend,['Suica'],today),true)
  assert.equal(isFuturePrepaidMovement(charged,['Suica'],today),false)
  const db=new MemoryD1()
  try{
    const stage=await restoreAtomic(db,{...emptyArchive(),paymentSources:[card],entries:[charged],
      prepaidRestoreInProgress:true})
    assert.equal(stage.created,1)
    assert.equal(db.sqlite.prepare("SELECT opening_date FROM payment_sources WHERE name='Suica'").get().opening_date,'__restore_pending__')
    const finalized={...emptyArchive(),deferredPrepaidEntries:[deferred,futureSpend],
      prepaidFinalize:[{name:'Suica',openingBalance:5700}],prepaidRestoreInProgress:true}
    const committed=await restoreAtomic(db,finalized)
    assert.equal(committed.created,2)
    assert.equal((await restoreAtomic(db,finalized)).created,0,'retry never inserts duplicate future movements')
    const anchor=db.sqlite.prepare("SELECT opening_date,opening_entry_id FROM payment_sources WHERE name='Suica'").get()
    assert.equal(anchor.opening_date,today)
    const pending=db.sqlite.prepare("SELECT id,date,transfer_date FROM entries WHERE client_request_id=?").get(id(2))
    assert.ok(pending.id>anchor.opening_entry_id,'scheduled debit must be after restored anchor')
    const response=await handlePrepaid({db,request:new Request('https://test.invalid/api/prepaid-assets'),method:'GET',sub:''})
    assert.equal(response.status,200)
    const result=await response.json()
    assert.equal(result.cards[0].balance,5700)
    const filter={card:'Suica',kind:'usage',openingDate:anchor.opening_date,openingEntryId:anchor.opening_entry_id}
    assert.equal(matchesPrepaidHistoryEntry({...pending,type:'transfer',payment_source:'Suica',transfer_target:'sbi'},filter,today),false)
    assert.equal(matchesPrepaidHistoryEntry({...pending,type:'transfer',payment_source:'Suica',transfer_target:'sbi'},filter,tomorrow),true)
    // The balance predicate must use the transfer effective date (not only its
    // booking date) to pass the new opening-date boundary.
    const due=db.sqlite.prepare("SELECT SUM(amount) total FROM entries WHERE type='transfer' AND payment_source='Suica' AND id>?1 AND (date>=?2 OR COALESCE(transfer_date,date)>=?2) AND date<=?3 AND COALESCE(transfer_date,date)<=?3")
      .get(anchor.opening_entry_id,anchor.opening_date,tomorrow)
    assert.equal(due.total,400)
  }finally{db.close()}
})

test('a failing future debit rolls back the prepaid finalization and deferred entries together',async()=>{
  const db=new MemoryD1()
  try{
    db.sqlite.prepare("INSERT INTO payment_sources(name,source_type,opening_date,opening_balance,opening_entry_id) VALUES('Suica','prepaid','__restore_pending__',0,0)").run()
    db.sqlite.exec("CREATE TRIGGER break_future BEFORE INSERT ON entries WHEN NEW.merchant='FAIL' BEGIN SELECT RAISE(ABORT,'rejected'); END")
    const future={id:4,date:dayOffset(1),type:'expense',amount:50,merchant:'FAIL',
      payment_source:'Suica',clientRequestId:id(4)}
    await assert.rejects(()=>restoreAtomic(db,{...emptyArchive(),deferredPrepaidEntries:[future],
      prepaidFinalize:[{name:'Suica',openingBalance:300}],prepaidRestoreInProgress:true}))
    assert.equal(db.sqlite.prepare("SELECT opening_date FROM payment_sources WHERE name='Suica'").get().opening_date,'__restore_pending__')
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM entries").get().n,0)
  }finally{db.close()}
})

test('wallet navigation, Japanese labels and minimum calendar legibility survive the audit',()=>{
  const app=read('src/App.vue'),assets=read('src/pages/AssetsPage.vue'),manager=read('src/FinanceTools.vue')
  const wallet=read('src/PrepaidAssets.vue'),css=read('src/mobile-ui.css'),html=read('index.html')
  assert.match(app,/cardSettingsRequest\.value\+\+/)
  assert.match(assets,/openCardSettingsFromWallet\(\)/)
  assert.match(manager,/managementTab\.value='cards';cardMode\.value='add'/)
  assert.match(read('src/MobileCardEditorSheet.vue'),/期首残高は「残高」で設定できます/)
  assert.doesNotMatch(manager,/期首残高は「資産」で設定できます/)
  assert.match(wallet,/利用・振替履歴/)
  assert.match(css,/font-size: clamp\(11px, 2\.9vw, 12px\)/)
  assert.match(html,/maximum-scale=1, user-scalable=no/)
  assert.match(read('README.md'),/バックアップは \*\*v4\*\*/)
})
