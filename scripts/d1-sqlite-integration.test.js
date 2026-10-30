// Real in-memory SQLite checks: unlike the API's lightweight mock these execute
// the exact SQL used by D1. No production DB or Cloudflare account is accessed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { onRequest } from '../functions/api/[[path]].js'
import { prepaidRestoreBalances } from '../src/finance-tools.js'
const approvedPost = (plan, month = '2026-10') => ({
  planId:plan.id,month,
  expected:{name:plan.name,amount:plan.amount,day:plan.day,category:plan.category,
    paymentSource:plan.paymentSource || '',startMonth:plan.startMonth,
    date:month+'-'+String(Math.min(plan.day,new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate())).padStart(2,'0')}
})

import { aiQuotaState, reserveAiAttempt } from '../functions/api/ai-quota.js'

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:')
    this.db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
    // Standard category names exist only in this disposable in-memory SQLite DB.
    // Production D1 is already migrated; schema.sql intentionally has no data inserts.
    this.db.exec("INSERT INTO category_source(category,sort_order) VALUES ('餐饮',0),('饮食料品',1),('日用品',2),('交通',3),('购物',4),('居住',5),('医疗',6),('娱乐',7),('宠物',8),('其他',99999),('其他收入',99999)")
  }
  prepare(sql) {
    const db = this.db
    const stmt = { args: [], bind(...args) { this.args = args; return this } }
    stmt.first = async () => db.prepare(sql).get(...stmt.args) || null
    stmt.all = async () => ({results:db.prepare(sql).all(...stmt.args)})
    stmt.run = async () => {
      // D1 batch() returns result rows for SELECT statements too.
      if(/^\s*SELECT\b/i.test(sql))return {results:db.prepare(sql).all(...stmt.args),success:true}
      const result = db.prepare(sql).run(...stmt.args)
      return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}
    }
    return stmt
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const results=[]
      for(const stmt of statements)results.push(await stmt.run())
      this.db.exec('COMMIT')
      return results
    } catch(e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
  close(){this.db.close()}
}

async function createClient() {
  const db=new SqliteD1()
  const env={DB:db,AUTH_TOKEN:'local-test-only'}
  const request=async(path,method='GET',body,session='')=>{
    const response=await onRequest({
      request:new Request('https://local.test/api/'+path,{method,headers:{
        'content-type':'application/json','x-session':session
      },body:body===undefined?undefined:JSON.stringify(body)}),
      env,params:{path:path.split('?')[0].split('/')}
    })
    return {status:response.status,body:await response.json()}
  }
  const login=await request('auth/login','POST',{code:'local-test-only'})
  assert.equal(login.status,200)
  const session=login.body.session
  return {db,call:(path,method='GET',body)=>request(path,method,body,session)}
}

test('actual SQLite: ledger years include dates outside hard-coded range',async()=>{
  const {db,call}=await createClient()
  try {
    for(const [date,amount] of [['2017-12-31',100],['2030-01-02',250]]) {
      const result=await call('entries','POST',{date,amount,type:'expense'})
      assert.equal(result.status,200)
    }
    const years=await call('entry-years')
    assert.equal(years.status,200)
    assert.deepEqual(years.body,[{year:'2017',count:1},{year:'2030',count:1}])
    assert.equal((await call('entries?year=2017&offset=0')).body.length,1)
  }finally{db.close()}
})

test('actual SQLite: manual and old automated recurring conflicts, idempotency and plan ID updates',async()=>{
  const {db,call}=await createClient()
  try {
    const makePlan=(id)=>({id,name:'家賃',amount:102000,day:25,category:'居住',paymentSource:'現金',startMonth:'2026-10',enabled:true})
    const first=makePlan('11111111-2222-3333-4444-555555555555')
    const second=makePlan('22222222-3333-4444-5555-666666666666')
    assert.equal((await call('recurring-plans','POST',first)).status,200)
    assert.equal((await call('recurring-plans','POST',second)).status,200)
    assert.equal((await call('entries','POST',{date:'2026-10-25',amount:102000,type:'expense',merchant:'家賃',paymentSource:'現金'})).status,200)
    const conflict=await call('recurring-post','POST',approvedPost(first))
    assert.equal(conflict.status,200)
    assert.equal(conflict.body.conflict,true)
    const monthly=await call('entries?month=2026-10&offset=0')
    assert.equal(monthly.body.length,1)
    db.db.prepare('DELETE FROM entries WHERE id=?').run(monthly.body[0].id)
    const created=await call('recurring-post','POST',approvedPost(first))
    assert.equal(created.status,200)
    assert.equal(created.body.created,true)
    const repeated=await call('recurring-post','POST',approvedPost(first))
    assert.equal(repeated.body.duplicate,true)
    const independent=await call('recurring-post','POST',approvedPost(second))
    assert.equal(independent.body.conflict,true, 'an identical plan with a new ID cannot create a duplicate expense')
    assert.equal((await call('entries?month=2026-10&offset=0')).body.length,1)
    const edited=await call('recurring-plans/'+first.id,'PUT',{...first,amount:103000,enabled:false})
    assert.equal(edited.status,200)
    const savedPlans=(await call('recurring-plans')).body
    assert.equal(savedPlans.find(p=>p.id===first.id).amount,103000)
    assert.equal(savedPlans.find(p=>p.id===first.id).enabled,false)
    assert.equal((await call('entries?month=2026-10&offset=0')).body.length,1)
  }finally{db.close()}
})

test('actual SQLite: deprecated snapshot APIs return 410 with no legacy table access',async()=>{
  const {db,call}=await createClient()
  try{
    assert.equal((await call('investments')).status,410)
    assert.equal((await call('investments/restore-empty','POST',{platform:'sbi',currentValue:70000,pnl:2000})).status,410)
    assert.equal((await call('investments','PUT',{platform:'sbi',currentValue:70000,pnl:2000})).status,410)
  }finally{db.close()}
})

test('actual SQLite: a card referenced by active recurring plan cannot be removed',async()=>{
  const {db,call}=await createClient()
  try {
    assert.equal((await call('payment-sources','POST',{name:'楽天カード'})).status,200)
    const plan={id:'55555555-2222-3333-4444-555555555555',name:'光熱費',amount:4000,day:20,category:'居住',paymentSource:'楽天カード',startMonth:'2026-10',enabled:true}
    assert.equal((await call('recurring-plans','POST',plan)).status,200)
    const removal=await call('payment-sources/remove','POST',{name:'楽天カード'})
    assert.equal(removal.status,409)
    assert.ok((await call('payment-sources')).body.some(x=>x.name==='楽天カード'))
  }finally{db.close()}
})

test('actual SQLite: AI daily quota is atomic and fail-closed without any billing logic',async()=>{
  const db=new SqliteD1()
  try {
    const env={AI_OCR_DAILY_LIMIT:'2'}
    let quota=await aiQuotaState(db,env)
    assert.equal(quota.remaining,2)
    assert.equal((await reserveAiAttempt(db,env)).allowed,true)
    assert.equal((await reserveAiAttempt(db,env)).allowed,true)
    assert.equal((await reserveAiAttempt(db,env)).allowed,false)
    quota=await aiQuotaState(db,env)
    assert.equal(quota.remaining,0)
    assert.equal((await reserveAiAttempt(db,{AI_OCR_DAILY_LIMIT:'0'})).allowed,false)
    // Raising the default to 20 keeps today's usage instead of resetting it.
    const normal=await aiQuotaState(db,{})
    assert.equal(normal.limit,20)
    assert.equal(normal.remaining,18)
    for(let i=0;i<18;i++)assert.equal((await reserveAiAttempt(db,{})).allowed,true)
    assert.equal((await reserveAiAttempt(db,{})).allowed,false)
    assert.equal((await aiQuotaState(db,{})).remaining,0)
  }finally{db.close()}
})

test('Pages previews reject ledger mutations before touching the D1 binding',async()=>{
  const response=await onRequest({
    request:new Request('https://mybranch.kakeibo-f17.pages.dev/api/entries',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({date:'2026-10-29',amount:100,type:'expense'})}),
    env:{AUTH_TOKEN:'readonly-test-only',DB:null},params:{path:['entries']}
  })
  assert.equal(response.status,503)
  assert.equal((await response.json()).code,'preview_db_not_verified')
})

test('manual priority: editing a ¥101,500 planned debit to ¥98,000 is never overwritten',async()=>{
  const {db,call}=await createClient()
  try{
    const plan={id:'99999999-2222-3333-4444-555555555555',name:'家賃',amount:101500,day:25,
      category:'居住',paymentSource:'現金',startMonth:'2026-10',enabled:true}
    assert.equal((await call('recurring-plans','POST',plan)).status,200)
    const first=await call('recurring-post','POST',approvedPost(plan))
    assert.equal(first.body.created,true)
    const entry=(await call('entries?month=2026-10')).body[0]
    assert.equal(entry.amount,101500)
    const edited=await call('entries/'+entry.id,'PUT',{...entry,date:'2026-10-25',
      amount:98000,type:'expense',category:'居住',merchant:'家賃',paymentSource:'現金'})
    assert.equal(edited.status,200)
    const again=await call('recurring-post','POST',approvedPost(plan))
    assert.equal(again.body.duplicate,true)
    let rows=(await call('entries?month=2026-10')).body
    assert.equal(rows.length,1)
    assert.equal(rows[0].amount,98000)
    // A manually entered amount in a month without the original request ID takes priority too.
    const alternate={...plan,id:'88888888-2222-3333-4444-555555555555'}
    assert.equal((await call('recurring-plans','POST',alternate)).status,200)
    const dup=await call('recurring-post','POST',approvedPost(alternate))
    assert.equal(dup.body.conflict,true)
    rows=(await call('entries?month=2026-10')).body
    assert.equal(rows.length,1)
    assert.equal(rows[0].amount,98000)
  } finally{db.close()}
})

test('stale recurring confirmation is rejected instead of recording another device new amount',async()=>{
  const {db,call}=await createClient()
  try{
    const original={id:'77777777-2222-3333-4444-555555555555',name:'家賃',amount:101500,
      day:25,category:'居住',paymentSource:'現金',startMonth:'2026-10',enabled:true}
    assert.equal((await call('recurring-plans','POST',original)).status,200)
    assert.equal((await call('recurring-plans/'+original.id,'PUT',{...original,amount:120000})).status,200)
    const stale=await call('recurring-post','POST',approvedPost(original))
    assert.equal(stale.status,409)
    assert.equal(stale.body.code,'plan_changed')
    assert.equal((await call('entries?month=2026-10')).body.length,0)
    assert.equal((await call('recurring-post','POST',{planId:original.id,month:'2026-10'})).status,409)
  }finally{db.close()}
})

test('verified isolated Pages preview still rejects financial mutation',async()=>{
  const response=await onRequest({
    request:new Request('https://testbuild.kakeibo-f17.pages.dev/api/entries',{
      method:'POST',headers:{'content-type':'application/json'},body:'{}'}),
    env:{AUTH_TOKEN:'test-only',
      DB:{prepare(){return{first:async()=>({value:'11111111-2222-3333-4444-555555555555'})}}},
      PREVIEW_D1_ISOLATED:'true',
      PREVIEW_D1_ID:'11111111-2222-3333-4444-555555555555',
      PRODUCTION_D1_ID:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'},params:{path:['entries']}
  })
  assert.equal(response.status,403)
  assert.equal((await response.json()).code,'preview_read_only')
})

test('actual SQLite: restore insert-only cannot overwrite newer card bills and category rules',async()=>{
  const {db,call}=await createClient()
  try {
    assert.equal((await call('payment-sources','POST',{name:'カードA'})).status,200)
    // A blank test D1 has no "現金" row unless the fixture registers it.
    // The initial POST below must succeed for PUT insert-only semantics to be tested.
    assert.equal((await call('payment-sources','POST',{name:'現金'})).status,200)
    assert.equal((await call('payment-sources/restore-missing','POST',{name:'カードB',closingDay:10})).body.created,true)
    assert.equal((await call('payment-sources/restore-missing','POST',{name:'カードB',closingDay:27})).body.created,false)
    assert.equal((await call('payment-sources')).body.find(x=>x.name==='カードB').closing_day,10)
    assert.equal((await call('payment-sources/default','POST',{name:'カードA'})).status,200)
    assert.equal((await call('payment-sources/restore-default','POST',{name:'カードB'})).body.restored,false)
    assert.equal((await call('payment-sources')).body.find(x=>x.name==='カードA').is_default,1)
    await call('rules','POST',{keyword:'テストスーパー',category:'饮食料品'})
    const category=await call('custom-rules','POST',{keyword:'テストスーパー',category:'购物'})
    assert.equal(category.status,200)
    const stored=(await call('custom-rules')).body.find(row=>row.keyword==='テストスーパー')
    assert.equal(stored.category,'饮食料品')

    assert.equal((await call('merchant-payment-rules','POST',{keyword:'テスト店',paymentSource:'現金'})).status,200)
    assert.equal((await call('merchant-payment-rules')).body.find(row=>row.keyword==='テスト店').payment_source,'現金')
    const payment=await call('merchant-payment-rules','PUT',{keyword:'テスト店',paymentSource:'カードA'})
    assert.equal(payment.status,200)
    assert.equal((await call('merchant-payment-rules')).body.find(row=>row.keyword==='テスト店').payment_source,'現金')

    const bill={name:'カードA',month:'2026-10',start:'2026-09-01',end:'2026-09-30',total:9000,count:3}
    assert.equal((await call('card-bills','PUT',bill)).status,200)
    assert.equal((await call('card-bills','POST',{...bill,total:99999})).status,200)
    assert.equal((await call('card-bills')).body.find(row=>row.name==='カードA').total,9000)
    assert.equal((await call('card-bills','PUT',{...bill,total:12345})).status,200)
    assert.equal((await call('card-bills')).body.find(row=>row.name==='カードA').total,12345)
  }finally{db.close()}
})

test('actual request gate: custom-domain preview cannot read/write production D1 even with missing DB binding',async()=>{
  const response=await onRequest({
    request:new Request('https://staging.example.net/api/entries?month=2026-10'),
    env:{AUTH_TOKEN:'test-token',DB:null,APP_ENV:'preview'},
    params:{path:['entries']}
  })
  assert.equal(response.status,503)
  assert.equal((await response.json()).code,'preview_db_not_verified')
})

test('D1 atomic restore rolls back all inserted settings and entries after SQL failure',async()=>{
  const {db,call}=await createClient()
  const backup={format:'kakeibo-ledger-backup',version:3,
    entries:[
      {date:'2026-10-03',amount:450,type:'expense',category:'饮食料品',merchant:'OK',clientRequestId:'restore_'+ 'a'.repeat(32)},
      {date:'2026-10-04',amount:500,type:'expense',category:'饮食料品',merchant:'BAD',clientRequestId:'restore_'+ 'b'.repeat(32)}
    ],paymentSources:[{name:'安全テストカード',closing_day:15}],customRules:[{keyword:'個人試験店',category:'宠物'}],
    categoryIcons:{'饮食料品':'food'}
  }
  try{
    db.db.exec("CREATE TRIGGER test_atomic_abort BEFORE INSERT ON entries WHEN NEW.merchant='BAD' BEGIN SELECT RAISE(ABORT,'intentional rollback'); END")
    const response=await call('restore-atomic','POST',backup)
    assert.equal(response.status,500)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries").get().n,0)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM merchant_rules WHERE keyword='個人試験店'").get().n,0)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM payment_sources WHERE name='安全テストカード'").get().n,0)
    db.db.exec('DROP TRIGGER test_atomic_abort')
    const result=await call('restore-atomic','POST',backup)
    assert.equal(result.status,200)
    assert.equal(result.body.created,2)
    assert.equal((await call('restore-atomic','POST',backup)).body.created,0)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries").get().n,2)
    assert.equal(db.db.prepare("SELECT category FROM merchant_rules WHERE keyword='個人試験店'").get().category,'宠物')
    assert.equal(db.db.prepare("SELECT closing_day FROM payment_sources WHERE name='安全テストカード'").get().closing_day,15)
    assert.equal(db.db.prepare("SELECT icon FROM category_source WHERE category='饮食料品'").get().icon,'food')
  }finally{db.close()}
})

test('merged merchant preferences preserve same-keyword category and card settings through edits',async()=>{
  const {db,call}=await createClient()
  try {
    await call('payment-sources','POST',{name:'カードA'})
    await call('payment-sources','POST',{name:'カードB'})
    assert.equal((await call('rules','POST',{keyword:'併用テスト店',category:'饮食料品'})).status,200)
    assert.equal((await call('merchant-payment-rules','POST',{keyword:'併用テスト店',paymentSource:'カードA'})).status,200)
    assert.deepEqual({...db.db.prepare("SELECT category,payment_source FROM merchant_rules WHERE keyword='併用テスト店'").get()},{category:'饮食料品',payment_source:'カードA'})
    assert.equal((await call('merchant-payment-rules','POST',{keyword:'併用テスト店',paymentSource:'カードB'})).status,200)
    assert.equal(db.db.prepare("SELECT payment_source FROM merchant_rules WHERE keyword='併用テスト店'").get().payment_source,'カードB')
    assert.equal((await call('custom-rules?keyword='+encodeURIComponent('併用テスト店'),'DELETE')).status,200)
    assert.deepEqual({...db.db.prepare("SELECT category,payment_source FROM merchant_rules WHERE keyword='併用テスト店'").get()},{category:null,payment_source:'カードB'})
  }finally{db.close()}
})

test('legacy rule tables are never re-imported after migration is complete',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.exec("CREATE TABLE custom_rules(keyword TEXT PRIMARY KEY,category TEXT NOT NULL)")
    db.db.exec("CREATE TABLE merchant_payment_rules(keyword TEXT PRIMARY KEY,payment_source TEXT NOT NULL)")
    db.db.exec("INSERT INTO custom_rules VALUES('旧商家','宠物')")
    db.db.exec("INSERT INTO merchant_payment_rules VALUES('旧商家','現金')")
    assert.equal((await call('custom-rules')).status,200)
    assert.equal((await call('merchant-payment-rules')).status,200)
    assert.equal((await call('rules')).status,200)
    assert.equal((await call('backup-snapshot')).status,200)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM merchant_rules WHERE keyword='旧商家'").get().n,0)
    assert.equal((await call('payment-sources','POST',{name:'現金'})).status,200)
    assert.equal((await call('rules','POST',{keyword:'現在商家',category:'购物'})).status,200)
    assert.equal((await call('merchant-payment-rules','POST',{keyword:'現在商家',paymentSource:'現金'})).status,200)
    db.db.exec('DROP TABLE custom_rules;DROP TABLE merchant_payment_rules;')
    assert.deepEqual({...db.db.prepare("SELECT category,payment_source FROM merchant_rules WHERE keyword='現在商家'").get()},{category:'购物',payment_source:'現金'})
    assert.equal((await call('custom-rules')).body.some(row=>row.keyword==='旧商家'),false)
  }finally{db.close()}
})
test('same-day same-merchant payment is warned regardless of a five-minute time change',async()=>{
  const {db,call}=await createClient()
  try {
    const base={date:'2026-10-29',time:'18:30',amount:850,merchant:'ローソン',category:'饮食料品',type:'expense',paymentSource:'現金',duplicatePolicy:'check'}
    assert.equal((await call('entries','POST',{...base,clientRequestId:'time-first-001'})).status,200)
    const again=await call('entries','POST',{...base,time:'18:35',clientRequestId:'time-second-002'})
    assert.equal(again.status,409)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE merchant='ローソン'").get().n,1)
    assert.equal((await call('entries','POST',{...base,time:'18:35',allowDuplicate:true,clientRequestId:'time-second-003'})).status,200)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE merchant='ローソン'").get().n,2)
    // A purchase much later in the day is legitimate and needs no duplicate override.
    assert.equal((await call('entries','POST',{...base,time:'19:10',clientRequestId:'time-later-004'})).status,200)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE merchant='ローソン'").get().n,3)
    // An untimed imported entry is still suspicious against an existing timed payment.
    assert.equal((await call('entries','POST',{...base,time:'',clientRequestId:'time-unknown-005'})).status,409)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE merchant='ローソン'").get().n,3)
    assert.equal((await call('entries','POST',{...base,time:'99:99',clientRequestId:'time-invalid-001'})).status,400)
  }finally{db.close()}
})

test('D1 server prevents a second concurrent import without user approval',async()=>{
  const {db,call}=await createClient()
  try{
    const row={date:'2026-10-29',time:'11:30',amount:1900,merchant:'テスト店',category:'日用品',type:'expense',paymentSource:'現金',duplicatePolicy:'check'}
    assert.equal((await call('entries','POST',{...row,clientRequestId:'dupe_check_one'})).status,200)
    const blocked=await call('entries','POST',{...row,clientRequestId:'dupe_check_two'})
    assert.equal(blocked.status,409)
    assert.equal(blocked.body.code,'duplicate_candidate')
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,1)
    const permitted=await call('entries','POST',{...row,clientRequestId:'dupe_check_two',allowDuplicate:true})
    assert.equal(permitted.status,200)
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,2)
    const retried=await call('entries','POST',{...row,clientRequestId:'dupe_check_two'})
    assert.equal(retried.status,200)
    assert.equal(retried.body.duplicate,true)
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,2)
  }finally{db.close()}
})

test('D1 restore of a missing category icon does not overwrite a user icon',async()=>{
  const {db,call}=await createClient()
  try{
    const path='category-icons/restore-missing'
    // The production D1 was migrated already. Seed a representative existing
    // icon explicitly in the test fixture, not through an API read.
    db.db.prepare("UPDATE category_source SET icon='home' WHERE category='居住'").run()
    // Unknown categories still use insert-only restore semantics.
    assert.equal((await call(path,'POST',{category:'テスト分類',icon:'home'})).body.created,true)
    assert.equal((await call(path,'POST',{category:'テスト分類',icon:'water'})).body.created,false)
    const icons=(await call('category-icons')).body
    assert.equal(icons['テスト分類'],'home')
    assert.equal(icons['居住'],'home')
  }finally{db.close()}
})

test('actual SQLite: card bill totals use latest D1 ledger even after another device writes',async()=>{
  const {db,call}=await createClient()
  try{
    const source='検証カード'
    assert.equal((await call('entries','POST',{date:'2026-10-01',amount:1000,type:'expense',merchant:'店A',paymentSource:source})).status,200)
    assert.equal((await call('entries','POST',{date:'2026-10-02',amount:500,type:'expense',merchant:'店B',paymentSource:source})).status,200)
    assert.equal((await call('entries','POST',{date:'2026-10-02',amount:900,type:'income',category:'工资'})).status,200)
    const bill=await call('card-bills/recalculate','POST',{name:source,month:'2026-10',start:'2026-10-01',end:'2026-10-31',total:1})
    assert.equal(bill.status,200)
    assert.equal(bill.body.total,1500)
    assert.equal(bill.body.count,2)
    assert.equal((await call('card-bills')).body.find(x=>x.name===source).total,1500)
  }finally{db.close()}
})

test('actual SQLite: backup snapshot reads the same consistent entries and settings',async()=>{
  const {db,call}=await createClient()
  try{
    assert.equal((await call('entries','POST',{date:'2026-10-03',amount:321,type:'expense',merchant:'検証店舗'})).status,200)
    const result=await call('backup-snapshot')
    assert.equal(result.status,200)
    assert.equal(result.body.format,'kakeibo-ledger-backup')
    assert.equal(result.body.version,4)
    assert.equal(result.body.entries.length,1)
    assert.equal(result.body.entries[0].amount,321)
    assert.ok(Array.isArray(result.body.paymentSources))
    assert.ok(Array.isArray(result.body.plans))
    assert.equal(Object.hasOwn(result.body,'investments'),false)
  }finally{db.close()}
})


test('actual SQLite: Other display order is stable without rewriting migrated card ranks',async()=>{
  const {db,call}=await createClient()
  try {
    // Read requests must not rewrite an existing persisted card rank.
    db.db.prepare("INSERT INTO payment_sources(name,sort_order) VALUES('既存カード',0),('その他',1)").run()
    const before= db.db.prepare("SELECT sort_order FROM payment_sources WHERE name='その他'").get()
    assert.equal(before.sort_order,1)
    let sources=await call('payment-sources')
    assert.equal(sources.status,200)
    assert.equal(sources.body.at(-1).name,'その他')
    assert.equal(db.db.prepare("SELECT sort_order FROM payment_sources WHERE name='その他'").get().sort_order,1)
    for(const name of ['新規カードA','新規カードB']){
      assert.equal((await call('payment-sources','POST',{name})).status,200)
      assert.ok(db.db.prepare('SELECT sort_order FROM payment_sources WHERE name=?').get(name).sort_order<99999)
    }
    assert.equal((await call('payment-sources/restore-missing','POST',{name:'復元カード',closingDay:26})).body.created,true)
    assert.ok(db.db.prepare("SELECT sort_order FROM payment_sources WHERE name='復元カード'").get().sort_order<99999)
    sources=await call('payment-sources')
    assert.deepEqual(sources.body.map(x=>x.name),['既存カード','新規カードA','新規カードB','復元カード','その他'])
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries").get().n,0)
    const backup=(await call('backup-snapshot')).body
    assert.equal(backup.paymentSources.at(-1).name,'その他')
    assert.equal(backup.paymentSources.at(-1).sort_order,1)
  }finally{db.close()}
})

test('categories use migrated category_source ranks without recreating old category rows',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.prepare("INSERT INTO rules(keyword,category) VALUES('__category__:旧分類','旧分類')").run()
    db.db.prepare("INSERT INTO category_source(category,sort_order,icon,display_name) VALUES('旧分類',18,'books','旧分類')").run()
    const countBefore=db.db.prepare("SELECT COUNT(*) AS n FROM category_source").get().n
    let res=await call('categories')
    assert.equal(res.status,200)
    assert.equal(res.body.at(-1),'其他')
    assert.ok(res.body.indexOf('旧分類')<res.body.indexOf('其他'))
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM category_source").get().n,countBefore)
    assert.equal((await call('categories','POST',{name:'新分類',icon:'books'})).status,200)
    res=await call('categories')
    assert.equal(res.body.at(-1),'其他')
    assert.ok(res.body.indexOf('旧分類')<res.body.indexOf('新分類'))
    assert.equal(db.db.prepare("SELECT sort_order FROM category_source WHERE category='新分類'").get().sort_order,19)
    assert.equal((await call('category-icons')).body['新分類'],'books')
    assert.equal((await call('categories','POST',{name:'その他',icon:'other'})).status,409)
  }finally{db.close()}
})
test('categories and payment reads never silently rewrite persisted ranks',async()=>{
  const {db,call}=await createClient()
  try{
    await call('entries','POST',{date:'2026-10-29',amount:888,type:'expense',category:'其他',merchant:'既存明細'})
    db.db.prepare("INSERT INTO payment_sources(name,sort_order) VALUES('その他',3),('追加カード',4)").run()
    db.db.prepare("UPDATE category_source SET sort_order=10 WHERE category='其他'").run()
    assert.equal((await call('categories')).status,200)
    assert.equal((await call('payment-sources')).status,200)
    assert.equal((await call('categories')).body.at(-1),'其他')
    assert.equal((await call('payment-sources')).body.at(-1).name,'その他')
    assert.equal(db.db.prepare("SELECT sort_order FROM payment_sources WHERE name='その他'").get().sort_order,3)
    assert.equal(db.db.prepare("SELECT sort_order FROM category_source WHERE category='其他'").get().sort_order,10)
    assert.equal(db.db.prepare("SELECT amount FROM entries WHERE merchant='既存明細'").get().amount,888)
  }finally{db.close()}
})
test('old category icon and rank tables never feed into current D1 data',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.exec("CREATE TABLE category_sort_order(category TEXT PRIMARY KEY,sort_order INTEGER NOT NULL)")
    db.db.exec("CREATE TABLE category_icons(category TEXT PRIMARY KEY,icon TEXT NOT NULL)")
    db.db.exec("INSERT INTO category_sort_order VALUES('旧分類',18)")
    db.db.exec("INSERT INTO category_icons VALUES('旧分類','books')")
    assert.equal((await call('categories')).status,200)
    assert.equal((await call('category-icons')).status,200)
    assert.equal((await call('category-source')).status,200)
    assert.equal(db.db.prepare("SELECT category FROM category_source WHERE category='旧分類'").get(),undefined)
    assert.equal((await call('category-icons')).body['旧分類'],undefined)
    assert.equal(db.db.prepare("SELECT version FROM schema_migrations WHERE version='category-source-v1'").get(),undefined)
    db.db.exec("DROP TABLE category_sort_order;DROP TABLE category_icons;")
    assert.equal((await call('categories')).status,200)
    assert.equal((await call('backup-snapshot')).status,200)
  }finally{db.close()}
})
test('manual-only legacy cleanup succeeds after both migrations and leaves ledger and SBI unchanged',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.exec("CREATE TABLE custom_rules(keyword TEXT PRIMARY KEY,category TEXT NOT NULL); CREATE TABLE merchant_payment_rules(keyword TEXT PRIMARY KEY,payment_source TEXT NOT NULL);")
    db.db.exec("CREATE TABLE category_sort_order(category TEXT PRIMARY KEY,sort_order INTEGER NOT NULL); CREATE TABLE category_icons(category TEXT PRIMARY KEY,icon TEXT NOT NULL);")
    db.db.exec("INSERT INTO custom_rules VALUES('移行済の店','宠物'); INSERT INTO merchant_payment_rules VALUES('移行済の店','現金');")
    db.db.exec("INSERT INTO category_sort_order VALUES('移行済カテゴリ',23); INSERT INTO category_icons VALUES('移行済カテゴリ','books');")
    db.db.exec("INSERT INTO rules(keyword,category) VALUES('__category__:移行済カテゴリ','移行済カテゴリ')")
    db.db.exec("INSERT INTO merchant_rules(keyword,category,payment_source) VALUES('移行済の店','宠物','現金')")
    db.db.exec("INSERT INTO category_source(category,sort_order,icon,display_name) VALUES('移行済カテゴリ',23,'books','移行済カテゴリ')")
    db.db.exec("INSERT INTO schema_migrations(version,description) VALUES('unified-merchant-rules-v1','manual migration confirmed'),('category-source-v1','manual migration confirmed')")

    assert.equal((await call('entries','POST',{date:'2026-10-29',amount:1234,merchant:'テスト費用',type:'expense'})).status,200)
    assert.equal((await call('backup-snapshot')).status,200)
    const before=db.db.prepare("SELECT amount FROM entries WHERE merchant='テスト費用'").get().amount
    const holdingsBefore=db.db.prepare('SELECT COUNT(*) AS n FROM investment_holdings').get()
    const cleanup=readFileSync(new URL('../migrations/0005_cleanup_legacy_rule_and_category_tables.sql',import.meta.url),'utf8')
    db.db.exec(cleanup)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('custom_rules','merchant_payment_rules','category_sort_order','category_icons')").get().n,0)
    assert.deepEqual({...db.db.prepare("SELECT category,payment_source FROM merchant_rules WHERE keyword='移行済の店'").get()},{category:'宠物',payment_source:'現金'})
    assert.deepEqual({...db.db.prepare("SELECT sort_order,icon FROM category_source WHERE category='移行済カテゴリ'").get()},{sort_order:23,icon:'books'})
    assert.equal(db.db.prepare("SELECT amount FROM entries WHERE merchant='テスト費用'").get().amount,before)
    assert.deepEqual(db.db.prepare('SELECT COUNT(*) AS n FROM investment_holdings').get(),holdingsBefore)
    assert.equal((await call('custom-rules')).status,200)
    assert.equal((await call('category-icons')).body['移行済カテゴリ'],'books')
  }finally{db.close()}
})

test('manual-only cleanup refuses to delete an unmigrated historical category icon',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.exec("CREATE TABLE custom_rules(keyword TEXT PRIMARY KEY,category TEXT NOT NULL); CREATE TABLE merchant_payment_rules(keyword TEXT PRIMARY KEY,payment_source TEXT NOT NULL);")
    db.db.exec("CREATE TABLE category_sort_order(category TEXT PRIMARY KEY,sort_order INTEGER NOT NULL); CREATE TABLE category_icons(category TEXT PRIMARY KEY,icon TEXT NOT NULL);")
    assert.equal((await call('backup-snapshot')).status,200)
    db.db.exec("INSERT INTO category_icons VALUES('未移行のアイコン','pet')")
    const cleanup=readFileSync(new URL('../migrations/0005_cleanup_legacy_rule_and_category_tables.sql',import.meta.url),'utf8')
    assert.throws(()=>db.db.exec(cleanup),/CHECK constraint failed/)
    assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='category_icons'").get().name,'category_icons')
    assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='custom_rules'").get().name,'custom_rules')
  }finally{db.close()}
})

test('category_source returns migrated Japanese names and icons without inserting defaults',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.exec("UPDATE category_source SET display_name='外食',icon='dining' WHERE category='餐饮'")
    db.db.exec("INSERT INTO category_source(category,sort_order,icon,display_name) VALUES('工资',10,'salary','給与') ON CONFLICT(category) DO UPDATE SET display_name='給与',icon='salary'")
    db.db.exec("UPDATE category_source SET display_name='その他',icon='other' WHERE category='其他'")
    const before=db.db.prepare("SELECT COUNT(*) AS n FROM category_source").get().n
    const response=await call('category-source')
    assert.equal(response.status,200)
    const rows=new Map(response.body.map(row=>[row.category,row]))
    assert.deepEqual({label:rows.get('餐饮')?.display_name,icon:rows.get('餐饮')?.icon},{label:'外食',icon:'dining'})
    assert.deepEqual({label:rows.get('工资')?.display_name,icon:rows.get('工资')?.icon},{label:'給与',icon:'salary'})
    assert.deepEqual({label:rows.get('其他')?.display_name,rank:rows.get('其他')?.sort_order},{label:'その他',rank:99999})
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM category_source").get().n,before)
    assert.equal((await call('categories','POST',{name:'試験用分類',icon:'books'})).status,200)
    const added=(await call('category-source')).body.find(row=>row.category==='試験用分類')
    assert.equal(added.display_name,'試験用分類')
    assert.equal(added.icon,'books')
    assert.equal(db.db.prepare("SELECT version FROM schema_migrations WHERE version='category-presentation-v1'").get(),undefined)
  }finally{db.close()}
})
test('missing previously migrated schema fails without automatic ALTER TABLE or backfill',async()=>{
  const {db,call}=await createClient()
  try {
    db.db.exec("ALTER TABLE category_source DROP COLUMN display_name")
    const before=db.db.prepare("PRAGMA table_info(category_source)").all().map(c=>c.name)
    const response=await call('category-source')
    assert.equal(response.status,500)
    const after=db.db.prepare("PRAGMA table_info(category_source)").all().map(c=>c.name)
    assert.deepEqual(after,before)
    assert.equal(after.includes('display_name'),false)
  }finally{db.close()}
})

test('actual SQLite: Suica and PASMO prepaid balances are ledger-derived, and opening edits never insert transactions',async()=>{
  const {db,call}=await createClient()
  try{
    const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
    const add=await call('payment-sources','POST',{name:'Suica',sourceType:'prepaid'})
    assert.equal(add.status,200)
    assert.equal((await call('payment-sources','POST',{name:'PASMO',sourceType:'prepaid'})).status,200)
    const cards=(await call('payment-sources')).body
    assert.equal(cards.find(x=>x.name==='Suica').source_type,'prepaid')
    assert.equal(cards.find(x=>x.name==='PASMO').source_type,'prepaid')
    assert.equal((await call('prepaid-assets/opening','POST',{name:'Suica',openingBalance:1000})).status,200)
    assert.equal((await call('prepaid-assets/opening','POST',{name:'PASMO',openingBalance:500})).status,200)
    const before=db.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n
    assert.equal(before,0)
    const topup=await call('entries','POST',{date:today,time:'10:00',amount:3000,type:'transfer',merchant:'Suica チャージ',transferTarget:'prepaid:Suica',transferDate:today,paymentSource:'三井住友カード',clientRequestId:'prepaid_suica_topup_1'})
    assert.equal(topup.status,200,JSON.stringify(topup.body))
    const spend=await call('entries','POST',{date:today,time:'11:00',amount:220,type:'expense',merchant:'電車',paymentSource:'Suica',clientRequestId:'prepaid_suica_spend_1'})
    assert.equal(spend.status,200,JSON.stringify(spend.body))
    const state=await call('prepaid-assets')
    assert.equal(state.status,200,JSON.stringify(state.body))
    const suica=state.body.cards.find(x=>x.name==='Suica')
    assert.equal(suica.opening_balance,1000)
    assert.equal(suica.charged,3000)
    assert.equal(suica.spent,220)
    assert.equal(suica.balance,3780)
    assert.equal(state.body.cards.find(x=>x.name==='PASMO').balance,500)
    assert.equal(db.db.prepare("SELECT type,transfer_target,transfer_applied FROM entries WHERE merchant='Suica チャージ'").get().transfer_applied,0)
    assert.equal(state.body.cards.length,2)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE transfer_target='prepaid:Suica'").get().n,1)
    assert.equal((await call('prepaid-assets/opening','POST',{name:'Suica',openingBalance:1200})).status,200)
    assert.equal((await call('prepaid-assets')).body.cards.find(x=>x.name==='Suica').balance,3980)
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,2)
    assert.equal((await call('entries','POST',{date:today,amount:999,type:'transfer',transferTarget:'prepaid:NotRegistered'})).status,400)
    assert.equal((await call('payment-sources/type','POST',{name:'Suica',sourceType:'standard'})).status,409)
    const renamed=await call('payment-sources/rename','POST',{oldName:'Suica',newName:'Suica 交通'})
    assert.equal(renamed.status,200,JSON.stringify(renamed.body))
    const postRename=(await call('prepaid-assets')).body.cards.find(x=>x.name==='Suica 交通')
    assert.equal(postRename.balance,3980)
    assert.equal(db.db.prepare("SELECT transfer_target FROM entries WHERE merchant='Suica チャージ'").get().transfer_target,'prepaid:Suica 交通')
    const archive=await call('backup-snapshot')
    assert.equal(archive.status,200)
    assert.equal(Object.hasOwn(archive.body,'investments'),false)
    assert.equal(archive.body.paymentSources.find(x=>x.name==='Suica 交通').opening_balance,1200)
  }finally{db.close()}
})

test('actual SQLite: backup restores prepaid current balance once, without replaying existing charges twice',async()=>{
  const source=await createClient(),target=await createClient()
  try{
    const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
    await source.call('payment-sources','POST',{name:'Suica',sourceType:'prepaid'})
    await source.call('prepaid-assets/opening','POST',{name:'Suica',openingBalance:900})
    await source.call('entries','POST',{date:today,amount:2500,type:'transfer',merchant:'Suica チャージ',transferTarget:'prepaid:Suica',transferDate:today})
    await source.call('entries','POST',{date:today,amount:180,type:'expense',merchant:'鉄道',paymentSource:'Suica'})
    const archive=(await source.call('backup-snapshot')).body
    const baseline=prepaidRestoreBalances(archive)
    assert.deepEqual(baseline,[{name:'Suica',openingBalance:3220}])
    const input={...archive,prepaidRestoreInProgress:true,prepaidFinalize:baseline,
      entries:archive.entries.map((e,i)=>({...e,clientRequestId:'restore_'+String(i+1).padStart(32,'0')}))}
    const applied=await target.call('restore-atomic','POST',input)
    assert.equal(applied.status,200,JSON.stringify(applied.body))
    assert.equal(applied.body.created,2)
    const restored=(await target.call('prepaid-assets')).body.cards.find(x=>x.name==='Suica')
    assert.equal(restored.balance,3220)
    assert.equal(restored.charged,0)
    assert.equal(restored.spent,0)
    assert.equal((await target.call('restore-atomic','POST',input)).body.created,0)
    assert.equal((await target.call('prepaid-assets')).body.cards.find(x=>x.name==='Suica').balance,3220)
  }finally{source.db.close();target.db.close()}
})

test('rules GET returns migrated D1 rows only and never restores missing default records',async()=>{
  const {db,call}=await createClient()
  try{
    db.db.exec('DELETE FROM merchant_rules')
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM merchant_rules').get().n,0)
    const first=await call('rules')
    assert.equal(first.status,200)
    assert.deepEqual(first.body,[],'empty migrated table must not be repopulated from app defaults')
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM merchant_rules').get().n,0)
    db.db.prepare('INSERT INTO merchant_rules(keyword,category) VALUES(?1,?2)').run('登録済みの店','饮食料品')
    const second=await call('rules')
    assert.equal(second.status,200)
    assert.deepEqual(second.body,[{keyword:'登録済みの店',category:'饮食料品',is_custom:true}])
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM merchant_rules').get().n,1)
  }finally{db.close()}
})
