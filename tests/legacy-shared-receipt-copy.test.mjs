import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {legacySharedReceiptCopy as copy} from '../functions/api/family-finance/legacy-shared-receipt-copy.js';
const hh='home',owner='owner',other='member',account='a'.repeat(32);
const endpoint=new URL('https://kakeibo.test/api/family-finance/legacy/shared-receipt-copy');
const bytes=new TextEncoder().encode('oldphoto');
const sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(v)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)');
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,is_archived INTEGER)');
 sql.exec('CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT)');
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,type TEXT,category TEXT,merchant TEXT,note TEXT,raw TEXT,payment_source TEXT,client_request_id TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT,created_at TEXT)');
 sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER,size_bytes INTEGER)');
 sql.exec('CREATE TABLE family_shared_entry_registry(entry_id INTEGER)');
 sql.exec(readFileSync(new URL('../migrations/0056_legacy_shared_receipt_copy.sql',import.meta.url),'utf8'));
 sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,'owner','active')").run(owner,hh);
 sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,'member','active')").run(other,hh);
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,0)').run(account,hh,owner);
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(7,'2026-10-01','',1000,'expense','Food','Store','old','', 'Bank',null,account,null,'2026-10-01');
 sql.prepare('INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?,?)').run(7,hh,owner,account,'Bank','a'.repeat(64));
 sql.prepare('INSERT INTO receipt_r2_state VALUES(7,0,8)').run();
 const db={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},batch:async()=>{}};
 const store=new Map([['receipts/v1/7',{body:bytes,size:8,httpEtag:'"oldetag"',httpMetadata:{contentType:'image/webp'},customMetadata:{}}]]);
 let failPut=false,puts=0;
 const bucket={
  async get(key){const o=store.get(key);return o?{...o,arrayBuffer:async()=>o.body.buffer}:null},
  async head(key){const o=store.get(key);return o?{...o}:null},
  async put(key,data,opts){puts++;if(failPut)throw Error('network');if(store.has(key))return null;
   const o={body:new Uint8Array(data),size:data.byteLength,httpEtag:'"newetag"',
    httpMetadata:opts.httpMetadata,customMetadata:opts.customMetadata};
   store.set(key,o);return o}
 };
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_RECEIPT_COPY_ENABLED:'true',
  KAKEIBO_LEGACY_R2_WRITES_FROZEN:'true',RECEIPTS_R2:bucket};
 const person={user_id:owner,role:'owner',household_id:hh};
 const member={user_id:other,role:'member',household_id:hh};
 async function digest(){const r=sql.prepare('SELECT e.*,l.actor_user_id,l.account_id,l.original_source,l.source_digest FROM entries e JOIN family_finance_legacy_entry_links l ON l.entry_id=e.id').get();
  return sha(JSON.stringify([r.id,r.date,r.time,r.amount,r.type,r.category,r.merchant,r.note,
   r.raw,r.payment_source,r.client_request_id,r.family_account_id,r.family_transfer_target_account_id,
   r.created_at,r.actor_user_id,r.account_id,r.original_source,r.source_digest]))}
 async function call(actor=person,fields={}){
  const v={expected_user_id:actor.user_id,entry_id:7,account_id:account,
   source_snapshot_sha256:await digest(),confirm:true,...fields};
  const res=await copy(new Request(endpoint,{method:'POST',headers:{origin:endpoint.origin,'content-type':'application/json'},body:JSON.stringify(v)}),env,endpoint,actor);
  return {status:res.status,data:await res.json()};
 }
 return {sql,env,person,member,call,store,puts:()=>puts,fail(v){failPut=v},close(){sql.close()}};
}
test('owner confirmed copy is byte-identical, only one destination, with durable immutable D1 receipt; no ledger/adopt or old key deletion',async()=>{
 const f=fixture();try{
  const before=f.sql.prepare('SELECT * FROM entries').get();
  const r=await f.call();assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.data.state,'verified_copy_not_adopted');assert.equal(r.data.ledger_changed,false);
  assert.equal(r.data.copied_to_shared_registry,false);assert.equal(r.data.legacy_object_deleted,false);
  assert.equal(f.store.size,2);assert.equal(f.puts(),1);
  const target='shared/v1/'+r.data.resource_id+'/'+r.data.object_id;
  assert.deepEqual([...f.store.get(target).body],[...f.store.get('receipts/v1/7').body]);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM entries').get()},{...before});
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_copy_audit').get().n,2);
  const again=await f.call();assert.equal(again.status,200,JSON.stringify(again));
  assert.equal(again.data.replayed,true);assert.equal(f.puts(),1);
  assert.throws(()=>f.sql.prepare('DELETE FROM family_legacy_shared_receipt_copies').run(),/IMMUTABLE/);
  assert.throws(()=>f.sql.prepare('UPDATE family_legacy_shared_receipt_copies SET byte_sha256=?').run('x'),/IMMUTABLE/);
 }finally{f.close()}
});
test('R2 interrupted upload leaves durable pending and exact owner retry promotes once',async()=>{
 const f=fixture();try{
  f.fail(true);const a=await f.call();assert.equal(a.status,503);
  assert.equal(f.sql.prepare('SELECT state FROM family_legacy_shared_receipt_copies').get().state,'pending');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_copy_audit').get().n,1);
  f.fail(false);const b=await f.call();assert.equal(b.status,200,JSON.stringify(b));
  assert.equal(f.sql.prepare('SELECT state FROM family_legacy_shared_receipt_copies').get().state,'verified');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_copy_audit').get().n,2);
 }finally{f.close()}
});
test('member, old device not frozen, tombstone, source drift and changed source ETag fail closed',async()=>{
 for(const scenario of ['member','no_freeze','tombstone','drift','etag']){
  const f=fixture();try{
   if(scenario==='no_freeze')f.env.KAKEIBO_LEGACY_R2_WRITES_FROZEN='false';
   if(scenario==='tombstone')f.sql.prepare('UPDATE receipt_r2_state SET deleted=1').run();
   if(scenario==='drift')f.sql.prepare("UPDATE entries SET type='transfer'").run();
   if(scenario==='etag')f.store.get('receipts/v1/7').httpEtag='';
   const r=await f.call(scenario==='member'?f.member:f.person);
   assert.notEqual(r.status,200,scenario);
   assert.equal(f.store.size,1);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_copies').get().n,0);
  }finally{f.close()}
 }
});
