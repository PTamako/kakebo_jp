import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {onRequestPost} from '../functions/api/bridge/document-assistant.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const secret='a_document_bridge_test_secret_longer_than_32_chars'
const actor='owner_a'
const base='https://kakeibo.example/api/bridge/document-assistant'
const key='jda:kakebo:abcdef1234567890'
const planId='11111111-1111-4111-8111-111111111111'
const candidateId='candidate_12345678'
const documentId='document_12345678'
const payload=(operation='variable_bill_draft',change={})=>({
 source:'jp-document-assistant',actor_user_id:actor,
 idempotency_key:key,source_document_id:documentId,source_candidate_id:candidateId,
 payload:{operation,planId,periodMonth:'2026-11',amount:5500,
  billDate:'2026-11-12',merchant:'東京ガス',...change}
})
async function signed(p){
 const stamp=String(Date.now()),raw=JSON.stringify(p)
 const mac=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const hash=await crypto.subtle.sign('HMAC',mac,new TextEncoder().encode(stamp+'\n'+raw))
 const hex=Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')
 return new Request(base,{method:'POST',headers:{'content-type':'application/json',
  'X-DA-Timestamp':stamp,'X-DA-Signature':hex,'Idempotency-Key':key},body:raw})
}
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT);"+
  "CREATE TABLE entries(id INTEGER PRIMARY KEY,client_request_id TEXT UNIQUE);"+
  "CREATE TABLE trash_items(item_type TEXT,item_id TEXT,payload_json TEXT);"+
  "CREATE TABLE payment_sources(name TEXT PRIMARY KEY,is_archived INTEGER);")
 sql.exec(readFileSync(new URL('../migrations/0109_variable_recurring_bills.sql',import.meta.url),'utf8'))
 sql.prepare('INSERT INTO variable_recurring_plans'+
  '(id,name,category,payment_source,start_month,interval_months,enabled,created_at,updated_at)'+
  ' VALUES(?,?,?,?,?,1,1,?,?)').run(planId,'東京ガス','光熱費','AEON Card','2026-11',1,1)
 const db={prepare(statement){
  return {bind(...args){
   return {async first(){return sql.prepare(statement).get(...args)||null},
    async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}}
   }
  }}
 }}
 const env={JPDA_BRIDGE_ENABLED:'true',JPDA_BRIDGE_SECRET:secret,
  JPDA_BRIDGE_ALLOWED_USER:actor,DB:db}
 return {sql,env}
}
test('signed document sync saves draft, never writes ledger and never double-creates',async()=>{
 const {sql,env}=fixture()
 let res=await onRequestPost({request:await signed(payload()),env})
 assert.equal(res.status,200)
 let body=await res.json()
 assert.equal(body.draft_only,true);assert.equal(body.reused,false)
 assert.equal(sql.prepare('SELECT count(*) n FROM entries').get().n,0)
 assert.equal(sql.prepare('SELECT status FROM variable_recurring_bills').get().status,'draft')
 res=await onRequestPost({request:await signed(payload()),env})
 assert.equal((await res.json()).reused,true)
 assert.equal(sql.prepare('SELECT count(*) n FROM variable_recurring_bills').get().n,1)
 res=await onRequestPost({request:await signed(payload('lookup')),env})
 body=await res.json()
 assert.equal(body.exists,true)
 assert.equal(body.remote_id,'variable-bill:'+planId+':2026-11')
})
test('new utility drafts preserve proposed card day and metering range but never auto-post',async()=>{
 const {sql,env}=fixture()
 const p=payload('variable_bill_draft',{
  periodMonth:'2026-11',billDate:null,expenseDate:'2026-11-27',
  serviceStart:'2026-10-16',serviceEnd:'2026-11-15'
 })
 const res=await onRequestPost({request:await signed(p),env})
 assert.equal(res.status,200)
 const row=sql.prepare('SELECT bill_date,expense_date,service_start,service_end,status FROM variable_recurring_bills').get()
 assert.equal(row.bill_date,null)
 assert.equal(row.expense_date,'2026-11-27')
 assert.equal(row.service_start,'2026-10-16')
 assert.equal(row.service_end,'2026-11-15')
 assert.equal(row.status,'draft')
 assert.equal(sql.prepare('SELECT count(*) count FROM entries').get().count,0)
})
test('different document cannot overwrite an existing billed period or select an invalid period',async()=>{
 const {sql,env}=fixture()
 let res=await onRequestPost({request:await signed(payload()),env})
 assert.equal(res.status,200)
 res=await onRequestPost({request:await signed({
  ...payload(),source_candidate_id:'candidate_98765432',
  source_document_id:'document_98765432'
 }),env})
 assert.equal(res.status,409)
 assert.equal(sql.prepare('SELECT amount_jpy FROM variable_recurring_bills').get().amount_jpy,5500)
 res=await onRequestPost({request:await signed(payload('variable_bill_draft',{periodMonth:'2026-10'})),env})
 assert.equal(res.status,409)
})
test('bad signature is rejected before bill draft can reach D1',async()=>{
 const {sql,env}=fixture()
 const signedReq=await signed(payload())
 const tampered=new Request(base,{method:'POST',headers:signedReq.headers,
  body:JSON.stringify(payload('variable_bill_draft',{amount:999999}))})
 const r=await onRequestPost({request:tampered,env})
 assert.equal(r.status,401)
 assert.equal(sql.prepare('SELECT count(*) n FROM variable_recurring_bills').get().n,0)
})
