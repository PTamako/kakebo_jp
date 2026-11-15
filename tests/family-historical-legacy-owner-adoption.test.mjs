import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {legacyEntryLinks} from '../functions/api/family-finance/legacy-entry-links.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const account='a'.repeat(32),url=new URL('https://kakeibo.test/api/family-finance/legacy/entry-links')
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec("PRAGMA foreign_keys=ON;"+
 "CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT);"+
 "CREATE TABLE payment_sources(name TEXT PRIMARY KEY);"+
 "CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,legacy_source_name TEXT,origin TEXT,label TEXT);"+
 "CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,type TEXT,amount INTEGER,category TEXT,merchant TEXT,note TEXT,payment_source TEXT,family_account_id TEXT);"+
 "CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT,linked_at INTEGER);"+
 "INSERT INTO payment_sources VALUES('bank-A');"+
 "INSERT INTO entries VALUES(1,'2026-10-15','expense',6800,'食費','Supermarket','old handwritten','bank-A',NULL);"+
 "INSERT INTO entries VALUES(2,'2026-10-16','transfer',40000,'資産','Bank',NULL,'bank-A',NULL);")
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(u,'household',role,'active')
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?)')
  .run(account,'household',owner,'bank-A','legacy','verified old bank')
 const db={prepare(q){return{bind(...args){return {
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(cmds){
  sql.exec('BEGIN IMMEDIATE')
  try{const result=cmds.map(x=>x.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 const env={APP_ENV:'production',KAKEIBO_LEGACY_ENTRY_LINKS_ENABLED:'true',DB:db}
 async function invoke(method,user,payload){
  const req=new Request(url,{method,headers:method==='POST'?{
   origin:url.origin,'content-type':'application/json'}:{},
   ...(payload?{body:JSON.stringify(payload)}:{})})
  const res=await legacyEntryLinks(req,env,url,{user_id:user,household_id:'household',
   role:user===owner?'owner':'member'})
  return {status:res.status,body:await res.json()}
 }
 return {sql,env,invoke,close:()=>sql.close()}
}
test('historical ordinary entry is linked to verified original account only after owner explicitly matches full digest; financial fields stay bit-for-bit',async()=>{
 const f=fixture()
 try{
  const plan=await f.invoke('GET',owner)
  assert.equal(plan.status,200)
  assert.equal(plan.body.items.length,1)
  const original=f.sql.prepare('SELECT * FROM entries WHERE id=1').get()
  const item=plan.body.items[0]
  const payload={expected_user_id:owner,entry_id:item.entry_id,
   account_id:item.account_id,source_digest:item.source_digest,confirm:true}
  const saved=await f.invoke('POST',owner,payload)
  assert.equal(saved.status,200,JSON.stringify(saved))
  assert.equal(saved.body.financial_values_changed,false)
  const after=f.sql.prepare('SELECT * FROM entries WHERE id=1').get()
  assert.deepEqual({...after,family_account_id:null},{...original})
  assert.equal(after.family_account_id,account)
  assert.equal((await f.invoke('POST',owner,payload)).body.already_linked,true)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_finance_legacy_entry_links').get().n,1)
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=2').get().family_account_id,null)
 }finally{f.close()}
})
test('historical transfer cannot be adopted as ordinary shared entry; foreign member cannot even list candidates',async()=>{
 const f=fixture()
 try{
  const denied=await f.invoke('GET',member)
  assert.equal(denied.status,403)
  const normal=await f.invoke('GET',owner)
  assert.equal(normal.body.items.length,1)
  assert.equal(normal.body.items[0].type,'expense')
  const spoof=await f.invoke('POST',member,{expected_user_id:member,
   entry_id:1,account_id:account,source_digest:normal.body.items[0].source_digest,confirm:true})
  assert.equal(spoof.status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_finance_legacy_entry_links').get().n,0)
 }finally{f.close()}
})
test('historical reclassification is blocked by changed merchant/SHA and atomically rolls back if audit ledger insert fails',async()=>{
 const f=fixture()
 try{
  const item=(await f.invoke('GET',owner)).body.items[0]
  const body={expected_user_id:owner,entry_id:1,account_id:account,source_digest:item.source_digest,confirm:true}
  f.sql.prepare('UPDATE entries SET merchant=? WHERE id=1').run('Changed Merchant')
  assert.equal((await f.invoke('POST',owner,body)).status,409)
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=1').get().family_account_id,null)
  const refreshed=(await f.invoke('GET',owner)).body.items[0]
  f.sql.exec("CREATE TRIGGER block_legacy_link BEFORE INSERT ON family_finance_legacy_entry_links BEGIN SELECT RAISE(ABORT,'LINK_AUDIT_ERROR'); END")
  const failed=await f.invoke('POST',owner,{...body,source_digest:refreshed.source_digest})
  assert.equal(failed.status,503)
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=1').get().family_account_id,null)
 }finally{f.close()}
})
