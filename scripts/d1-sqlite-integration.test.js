// Real in-memory SQLite checks: unlike the API's lightweight mock these execute
// the exact SQL used by D1. No production DB or Cloudflare account is accessed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { onRequest } from '../functions/api/[[path]].js'
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
    const conflict=await call('recurring-post','POST',{planId:first.id,month:'2026-10'})
    assert.equal(conflict.status,200)
    assert.equal(conflict.body.conflict,true)
    const monthly=await call('entries?month=2026-10&offset=0')
    assert.equal(monthly.body.length,1)
    db.db.prepare('DELETE FROM entries WHERE id=?').run(monthly.body[0].id)
    const created=await call('recurring-post','POST',{planId:first.id,month:'2026-10'})
    assert.equal(created.status,200)
    assert.equal(created.body.created,true)
    const repeated=await call('recurring-post','POST',{planId:first.id,month:'2026-10'})
    assert.equal(repeated.body.duplicate,true)
    const independent=await call('recurring-post','POST',{planId:second.id,month:'2026-10'})
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
  }finally{db.close()}
})

test('Pages previews reject ledger mutations before touching the D1 binding',async()=>{
  const response=await onRequest({
    request:new Request('https://mybranch.kakeibo-f17.pages.dev/api/entries',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({date:'2026-10-29',amount:100,type:'expense'})}),
    env:{AUTH_TOKEN:'readonly-test-only',DB:null},params:{path:['entries']}
  })
  assert.equal(response.status,403)
  assert.equal((await response.json()).code,'preview_read_only')
})
