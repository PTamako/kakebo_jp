// Real in-memory SQLite checks: unlike the API's lightweight mock these execute
// the exact SQL used by D1. No production DB or Cloudflare account is accessed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { onRequest } from '../functions/api/[[path]].js'
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

test('actual SQLite: restoring a snapshot only fills an entirely blank SBI row',async()=>{
  const {db,call}=await createClient()
  try {
    let restored=await call('investments/restore-empty','POST',{platform:'sbi',currentValue:70000,pnl:2000})
    assert.equal(restored.status,200)
    assert.equal(restored.body.restored,true)
    restored=await call('investments/restore-empty','POST',{platform:'sbi',currentValue:90000,pnl:10000})
    assert.equal(restored.body.restored,false)
    const rows=(await call('investments')).body
    assert.equal(rows.find(x=>x.platform==='sbi').current_value,70000)
    assert.equal(rows.find(x=>x.platform==='sbi').pnl,2000)
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
    // Built-in icon IDs are now preseeded from D1 metadata; testing an
    // unknown category proves restore-missing remains insert-only.
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
    await call('investments') // establish the SBI snapshot
    const result=await call('backup-snapshot')
    assert.equal(result.status,200)
    assert.equal(result.body.format,'kakeibo-ledger-backup')
    assert.equal(result.body.version,3)
    assert.equal(result.body.entries.length,1)
    assert.equal(result.body.entries[0].amount,321)
    assert.ok(Array.isArray(result.body.paymentSources))
    assert.ok(Array.isArray(result.body.plans))
    assert.ok(Array.isArray(result.body.investments))
  }finally{db.close()}
})


test('actual SQLite: Other payment source persists at 99999 and new cards sort above it',async()=>{
  const {db,call}=await createClient()
  try {
    // Simulate an old installation where その他 was inserted between real cards.
    db.db.prepare("INSERT INTO payment_sources(name,sort_order) VALUES('既存カード',0),('その他',1)").run()
    const before= db.db.prepare("SELECT sort_order FROM payment_sources WHERE name='その他'").get()
    assert.equal(before.sort_order,1)
    let sources=await call('payment-sources')
    assert.equal(sources.status,200)
    assert.equal(sources.body.at(-1).name,'その他')
    assert.equal(db.db.prepare("SELECT sort_order FROM payment_sources WHERE name='その他'").get().sort_order,99999)
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
    assert.equal(backup.paymentSources.at(-1).sort_order,99999)
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
    const sbiBefore=db.db.prepare("SELECT current_value,pnl FROM investment_snapshots WHERE platform='sbi'").get()
    const cleanup=readFileSync(new URL('../migrations/0005_cleanup_legacy_rule_and_category_tables.sql',import.meta.url),'utf8')
    db.db.exec(cleanup)
    assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('custom_rules','merchant_payment_rules','category_sort_order','category_icons')").get().n,0)
    assert.deepEqual({...db.db.prepare("SELECT category,payment_source FROM merchant_rules WHERE keyword='移行済の店'").get()},{category:'宠物',payment_source:'現金'})
    assert.deepEqual({...db.db.prepare("SELECT sort_order,icon FROM category_source WHERE category='移行済カテゴリ'").get()},{sort_order:23,icon:'books'})
    assert.equal(db.db.prepare("SELECT amount FROM entries WHERE merchant='テスト費用'").get().amount,before)
    assert.deepEqual(db.db.prepare("SELECT current_value,pnl FROM investment_snapshots WHERE platform='sbi'").get(),sbiBefore)
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
