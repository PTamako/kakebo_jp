import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {legacySharedAdoptionPreflight as preflight} from '../functions/api/family-finance/legacy-shared-adoption-preflight.js'
const hh='house',owner='owner',other='member',account='a'.repeat(32)
const base='https://kakeibo.test/api/family-finance/legacy/shared-adoption-preflight'
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT);
 CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT);
 CREATE TABLE family_financial_accounts(account_id TEXT,owner_user_id TEXT,household_id TEXT,is_archived INTEGER);
 CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,type TEXT,category TEXT,merchant TEXT,note TEXT,raw TEXT,payment_source TEXT,client_request_id TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT,created_at TEXT);
 CREATE TABLE receipt_r2_state(entry_id INTEGER,deleted INTEGER);
 CREATE TABLE family_shared_entry_registry(entry_id INTEGER); `)
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(owner,hh,'owner','active')
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(other,hh,'member','active')
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,0)').run(account,owner,hh)
 for(const [id,type,request] of [[1,'expense',null],[2,'income',null],[3,'transfer','hfbanktransfer:old']]){
  sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
   id,'2026-10-01','',1000,type,'test','merchant','note','', 'Bank',
   request,account,null,'2026-10-01')
  sql.prepare('INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?,?)')
   .run(id,hh,owner,account,'Bank','d'.repeat(64))
 }
 sql.prepare('INSERT INTO receipt_r2_state VALUES(2,0)').run()
 const db={prepare(q){return {bind(...a){return{
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)})
 }}}}}
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED:'true',DB:db}
 const user=(id,role)=>({user_id:id,role,household_id:hh})
 async function call(who=owner,role='owner',url=base,method='GET'){
  const req=new Request(url,{method})
  const r=await preflight(req,env,new URL(url),user(who,role))
  return{status:r.status,data:await r.json()}
 }
 return{sql,env,call,close:()=>sql.close()}
}
test('original verified owner sees only read-only historical adoption candidates with exact snapshot digest, never duplicates ledger',async()=>{
 const f=fixture()
 try{
  const before=f.sql.prepare('SELECT * FROM entries ORDER BY id').all()
  const r=await f.call()
  assert.equal(r.status,200)
  assert.equal(r.data.items.length,3)
  assert.equal(r.data.read_only,true)
  assert.equal(r.data.adopted,false)
  assert.equal(r.data.ledger_applied,false)
  assert.equal(r.data.external_institution_verified,false)
  assert.equal(r.data.items[0].adoption_state,'manual_review_required')
  assert.equal(r.data.items[0].account_id,account)
  assert.match(r.data.items[0].source_snapshot_sha256,/^[a-f0-9]{64}$/)
  assert.equal(r.data.items[0].may_mutate,false)
  assert.deepEqual(r.data.items[1].blockers,['requires_original_r2_object_and_tombstone_review'])
  assert.ok(r.data.items[2].blockers.includes('nonordinary_financial_operation'))
  assert.ok(r.data.items[2].blockers.includes('already_special_finance_or_shared_entry'))
  assert.deepEqual(f.sql.prepare('SELECT * FROM entries ORDER BY id').all(),before)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0)
 }finally{f.close()}
})
test('non-owner, changed owner session, wrong method, invalid cursor, disabled feature and changed account owner deny adoption',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.call(other,'member')).status,403)
  assert.equal((await f.call(owner,'member')).status,403)
  assert.equal((await f.call(owner,'owner',base,'POST')).status,405)
  assert.equal((await f.call(owner,'owner',base+'?after_id=-1')).status,400)
  f.sql.prepare('UPDATE family_financial_accounts SET owner_user_id=?').run(other)
  const blocked=await f.call()
  assert.ok(blocked.data.items.every(x=>x.blockers.includes('owner_or_household_not_current')))
  f.env.KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED='false'
  assert.equal((await f.call()).status,503)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0)
 }finally{f.close()}
})
test('read-only preflight snapshots fail safe on source drift and never invent attachment or shared-entry ownership',async()=>{
 const f=fixture()
 try{
  f.sql.prepare('UPDATE entries SET payment_source=? WHERE id=1').run('Other')
  f.sql.prepare('INSERT INTO family_shared_entry_registry VALUES(1)').run()
  const r=await f.call()
  assert.deepEqual(r.data.items[0].blockers,
   ['linked_account_or_payment_source_drift','already_under_shared_lifecycle'])
  assert.equal(r.data.items[0].may_mutate,false)
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=1').get().family_account_id,account)
 }finally{f.close()}
})
