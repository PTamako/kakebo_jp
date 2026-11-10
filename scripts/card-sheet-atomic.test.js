import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {onRequest} from '../functions/api/[[path]].js'

const token='f'.repeat(64)
function testDb(){
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec("CREATE TABLE device_sessions(token_hash TEXT PRIMARY KEY,expires_at INTEGER);"+
    "CREATE TABLE payment_sources(name TEXT PRIMARY KEY,sort_order INTEGER DEFAULT 0,"+
      "is_default INTEGER DEFAULT 0,closing_day INTEGER,source_type TEXT DEFAULT 'standard',"+
      "stat_group TEXT DEFAULT 'card',opening_balance INTEGER DEFAULT 0,opening_date TEXT DEFAULT '',"+
      "opening_entry_id INTEGER DEFAULT 0,is_archived INTEGER DEFAULT 0);"+
    "CREATE TABLE entries(id INTEGER PRIMARY KEY,type TEXT,amount INTEGER,merchant TEXT,client_request_id TEXT,"+
      "payment_source TEXT,transfer_target TEXT);"+
    "CREATE TABLE merchant_rules(keyword TEXT PRIMARY KEY,payment_source TEXT);"+
    "CREATE TABLE recurring_plans(id INTEGER PRIMARY KEY,payment_source TEXT);"+
    "CREATE TABLE card_bills(payment_source TEXT,bill_month TEXT,PRIMARY KEY(payment_source,bill_month));")
  const obj={
    prepare(sql){
      const stmt=sqlite.prepare(sql)
      const bound=(args=[])=>({
        first:async()=>stmt.get(...args)??null,
        all:async()=>({results:stmt.all(...args)}),
        run:async()=>({meta:{changes:stmt.run(...args).changes}})
      })
      return {...bound(),bind:(...args)=>bound(args)}
    },
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE')
      try{
        const output=[]
        for(const statement of statements)output.push(await statement.run())
        sqlite.exec('COMMIT')
        return output
      }catch(e){sqlite.exec('ROLLBACK');throw e}
    }
  }
  return {sqlite,db:obj}
}
async function authorize(sqlite){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
  const hash=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('')
  sqlite.prepare('INSERT INTO device_sessions VALUES(?,?)').run(hash,Date.now()+3600_000)
}
const original={sourceType:'standard',statGroup:'card',closingDay:10,isArchived:0}
async function edit(db,body){
  const req=new Request('https://kakeibo-f17.pages.dev/api/payment-sources/update',{
    method:'POST',headers:{'content-type':'application/json','x-session':token},
    body:JSON.stringify(body)
  })
  const resp=await onRequest({request:req,env:{AUTH_TOKEN:'test-only',DB:db},params:{path:['payment-sources','update']}})
  return {status:resp.status,body:await resp.json()}
}
const draft=(extra={})=>({
  oldName:'旧カード',name:'新カード',sourceType:'standard',statGroup:'points',closingDay:15,
  expected:original,...extra
})
function seed(sqlite){
  sqlite.exec("INSERT INTO payment_sources(name,source_type,stat_group,closing_day,is_default) VALUES ('旧カード','standard','card',10,1);"+
    "INSERT INTO entries(id,type,amount,merchant,payment_source) VALUES (1,'expense',500,'買い物','旧カード');"+
    "INSERT INTO entries(id,type,amount,merchant,payment_source,transfer_target) VALUES (2,'transfer',300,'送金','旧カード','credit:旧カード');"+
    "INSERT INTO entries(id,type,amount,merchant,payment_source,transfer_target,client_request_id) VALUES (3,'transfer',80,'旧カードチャージ','旧カード','prepaid:旧カード','point_charge_demo');"+
    "INSERT INTO merchant_rules VALUES ('テスト商店','旧カード');"+
    "INSERT INTO recurring_plans VALUES (1,'旧カード');"+
    "INSERT INTO card_bills VALUES ('旧カード','2026-10');")
}

test('one card Save atomically reassigns ledger, transfer targets, rules, plans, bills and metadata',async()=>{
  const {db,sqlite}=testDb()
  try{
    await authorize(sqlite);seed(sqlite)
    const result=await edit(db,draft())
    assert.equal(result.status,200,JSON.stringify(result))
    assert.equal(result.body.ok,true)
    assert.deepEqual(sqlite.prepare('SELECT name,source_type,stat_group,closing_day,is_default FROM payment_sources').get(),
      {name:'新カード',source_type:'standard',stat_group:'points',closing_day:15,is_default:1})
    assert.deepEqual(sqlite.prepare('SELECT DISTINCT payment_source FROM entries').all(),[{payment_source:'新カード'}])
    assert.equal(sqlite.prepare('SELECT transfer_target FROM entries WHERE id=2').get().transfer_target,'credit:新カード')
    const topup=sqlite.prepare('SELECT transfer_target,merchant FROM entries WHERE id=3').get()
    assert.equal(topup.transfer_target,'prepaid:新カード')
    assert.equal(topup.merchant,'新カードチャージ')
    for(const table of ['merchant_rules','recurring_plans','card_bills'])
      assert.equal(sqlite.prepare('SELECT payment_source FROM '+table).get().payment_source,'新カード')
  }finally{sqlite.close()}
})

test('stale card editor refuses a save without relabelling any linked entries',async()=>{
  const {db,sqlite}=testDb()
  try{
    await authorize(sqlite);seed(sqlite)
    const result=await edit(db,draft({expected:{...original,closingDay:18}}))
    assert.equal(result.status,409)
    assert.equal(sqlite.prepare('SELECT name FROM payment_sources').get().name,'旧カード')
    assert.equal(sqlite.prepare('SELECT payment_source FROM entries WHERE id=1').get().payment_source,'旧カード')
    assert.equal(sqlite.prepare('SELECT payment_source FROM card_bills').get().payment_source,'旧カード')
  }finally{sqlite.close()}
})

test('name collision preserves historical references and saved card bills',async()=>{
  const {db,sqlite}=testDb()
  try{
    await authorize(sqlite);seed(sqlite)
    sqlite.exec("INSERT INTO payment_sources(name,source_type,stat_group) VALUES('新カード','standard','card');")
    const result=await edit(db,draft())
    assert.equal(result.status,409)
    assert.equal(sqlite.prepare('SELECT payment_source FROM card_bills').get().payment_source,'旧カード')
    assert.equal(sqlite.prepare('SELECT payment_source FROM merchant_rules').get().payment_source,'旧カード')
  }finally{sqlite.close()}
})

test('prepaid card with charge history cannot be converted and renamed together',async()=>{
  const {db,sqlite}=testDb()
  try{
    await authorize(sqlite);seed(sqlite)
    sqlite.exec("UPDATE payment_sources SET source_type='prepaid' WHERE name='旧カード';")
    const result=await edit(db,draft({
      sourceType:'standard',expected:{...original,sourceType:'prepaid'}
    }))
    assert.equal(result.status,409)
    assert.equal(sqlite.prepare('SELECT name,source_type FROM payment_sources').get().name,'旧カード')
    assert.equal(sqlite.prepare('SELECT payment_source FROM entries WHERE id=1').get().payment_source,'旧カード')
  }finally{sqlite.close()}
})

test('metadata-only changes do not rewrite ledger entry names',async()=>{
  const {db,sqlite}=testDb()
  try{
    await authorize(sqlite);seed(sqlite)
    const result=await edit(db,draft({name:'旧カード',closingDay:17}))
    assert.equal(result.status,200,JSON.stringify(result))
    assert.equal(sqlite.prepare('SELECT closing_day,stat_group FROM payment_sources').get().closing_day,17)
    assert.equal(sqlite.prepare('SELECT payment_source FROM entries WHERE id=1').get().payment_source,'旧カード')
  }finally{sqlite.close()}
})
