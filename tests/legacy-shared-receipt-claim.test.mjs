import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {legacySharedReceiptCopy} from '../functions/api/family-finance/legacy-shared-receipt-copy.js';
import {legacySharedAdopt} from '../functions/api/family-finance/legacy-shared-adopt.js';
import {legacySharedSourceRefcount} from '../functions/api/family-finance/legacy-shared-source-refcount.js';
import {legacySharedReceiptRepair} from '../functions/api/family-finance/legacy-shared-receipt-repair.js';
import {familySharedEntries} from '../functions/api/family-finance/shared-entries.js';
import {handleR2Receipts} from '../functions/api/r2-receipts.js';
const hh='house',owner='owner',member='member',acc='a'.repeat(32);
const base='https://kakeibo.test/api/family-finance/';
const source=new TextEncoder().encode('oldphoto');
const sha=async x=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(x)))].map(b=>b.toString(16).padStart(2,'0')).join('');
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON');
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)');
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,is_archived INTEGER)');
 sql.exec('CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT)');
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT,created_at TEXT)');
 sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER,size_bytes INTEGER,updated_at TEXT)');
 sql.exec('CREATE TABLE family_finance_events(event_id TEXT PRIMARY KEY,household_id TEXT,actor_user_id TEXT,resource_id TEXT,action TEXT,created_at INTEGER)');
 for(const f of ['0051_shared_entry_lifecycle.sql','0055_legacy_shared_entry_adoption.sql',
  '0056_legacy_shared_receipt_copy.sql','0057_legacy_shared_receipt_claim.sql',
  '0059_legacy_shared_receipt_repair.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,'owner','active')").run(owner,hh);
 sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,'member','active')").run(member,hh);
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,0)').run(acc,hh,owner);
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(7,'2026-10-01','',1000,
  '食品','スーパー','原ノート','原OCR','expense',null,'Bank',acc,null,'2026-10-01');
 sql.prepare('INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?,?)').run(7,hh,owner,acc,'Bank','f'.repeat(64));
 sql.prepare("INSERT INTO receipt_r2_state VALUES(7,0,8,'2026-10-01')").run();
 const db={prepare(q){return{bind(...a){return{
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...a).changes}})
 }}}},async batch(stmts){sql.exec('BEGIN IMMEDIATE');try{
  const result=stmts.map(s=>s.sync());sql.exec('COMMIT');return result;
 }catch(e){sql.exec('ROLLBACK');throw e}}};
 const objects=new Map([['receipts/v1/7',{
  body:source,size:source.byteLength,httpMetadata:{contentType:'image/webp'},
  customMetadata:{},httpEtag:'"original-etag"'}]]);
 let deletes=0,writeFail=false;
 const r2={
  async get(k){const r=objects.get(k);return r?{...r,arrayBuffer:async()=>r.body.buffer}:null},
  async head(k){return objects.get(k)||null},
  async put(k,v,opt){if(writeFail)throw Error('R2 failure');
   if(objects.has(k))return null;const result={body:new Uint8Array(v),size:v.byteLength,
    httpMetadata:opt.httpMetadata,customMetadata:opt.customMetadata,httpEtag:'"shared-etag"'};
   objects.set(k,result);return result},
  async delete(k){deletes++;for(const item of Array.isArray(k)?k:[k])objects.delete(item)}
 };
 const env={DB:db,RECEIPTS_R2:r2,APP_ENV:'production',
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_SHARED_ENTRY_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_RECEIPT_COPY_ENABLED:'true',
  KAKEIBO_LEGACY_R2_WRITES_FROZEN:'true'};
 const actor={user_id:owner,household_id:hh,role:'owner'};
 const outsider={user_id:member,household_id:hh,role:'member'};
 async function digest(){
  const r=sql.prepare('SELECT e.*,l.actor_user_id,l.account_id,l.original_source,l.source_digest FROM entries e JOIN family_finance_legacy_entry_links l ON l.entry_id=e.id').get();
  return sha(JSON.stringify([r.id,r.date,r.time,r.amount,r.type,r.category,r.merchant,r.note,
   r.raw,r.payment_source,r.client_request_id,r.family_account_id,r.family_transfer_target_account_id,
   r.created_at,r.actor_user_id,r.account_id,r.original_source,r.source_digest]));
 }
 async function action(endpoint,handler,person=actor,override={}){
  const url=new URL(base+'legacy/'+endpoint);
  const payload={expected_user_id:person.user_id,entry_id:7,account_id:acc,
   source_snapshot_sha256:await digest(),confirm:true,...override};
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(payload)});
  const result=await handler(req,env,url,person);return{status:result.status,data:await result.json()};
 }
 async function shared(method,id,data,person=actor){
  const url=new URL(base+'shared-entries');
  const req=new Request(url,{method,headers:{origin:url.origin,'content-type':'application/json'},
   ...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify(data)})});
  const parts=['shared-entries',id,...(method==='POST'?['restore']:[])];
  const r=await familySharedEntries(req,env,url,person,parts);
  return{status:r.status,data:await r.json()};
 }
 return {sql,db,actor,outsider,env,objects,digest,
  copy:(who=actor,extra={})=>action('shared-receipt-copy',legacySharedReceiptCopy,who,extra),
  adopt:(who=actor,extra={})=>action('shared-adopt',legacySharedAdopt,who,extra),
  shared,deletes:()=>deletes,setWriteFail(x){writeFail=x},close(){sql.close()}};
}
test('original attachment SHA-verified R2 copy is atomically claimed: one entry, private new key, old tombstone, immutable audit and CRUD',async()=>{
 const f=fixture();try{
  const orig=f.sql.prepare('SELECT * FROM entries').get();
  const snap=f.sql.prepare('SELECT COUNT(*) n,SUM(amount) total FROM entries').get();
  const prepare=await f.copy();assert.equal(prepare.status,200,JSON.stringify(prepare));
  assert.equal(f.objects.size,2);
  const adopted=await f.adopt();assert.equal(adopted.status,201,JSON.stringify(adopted));
  assert.equal(adopted.data.receipt_claimed,true);
  const id=adopted.data.adoption.resource_id,obj=prepare.data.object_id;
  assert.equal(id,prepare.data.resource_id);
  assert.equal(f.sql.prepare('SELECT deleted FROM receipt_r2_state WHERE entry_id=7').get().deleted,1);
  assert.equal(f.sql.prepare("SELECT state FROM family_shared_entry_attachments").get().state,'ready');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_claims').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_audit').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n,SUM(amount) total FROM entries').get().total,snap.total);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM entries').get()},{...orig});
  const sharedKey='shared/v1/'+id+'/'+obj;
  assert.deepEqual([...f.objects.get(sharedKey).body],[...f.objects.get('receipts/v1/7').body]);
  const re=await f.adopt();assert.equal(re.status,200,JSON.stringify(re));assert.equal(re.data.replayed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_claims').get().n,1);
  assert.throws(()=>f.sql.prepare('UPDATE receipt_r2_state SET deleted=0 WHERE entry_id=7').run(),
   /TOMBSTONE_IMMUTABLE/);
  assert.throws(()=>f.sql.prepare('DELETE FROM family_legacy_shared_receipt_claims').run(),/IMMUTABLE/);
  const legacy=await handleR2Receipts(new Request('https://kakeibo.test/api/r2-receipts/7'),
   f.env,f.db,['7']);assert.equal(legacy.status,410);
  const old=await f.shared('PUT',id,{expected_user_id:owner,expected_version:1,
   entry:{date:'2026-10-01',time:'',amount:1500,type:'expense',category:'食品',
    merchant:'スーパー',note:'更新'}});
  assert.equal(old.status,200,JSON.stringify(old));
  const del=await f.shared('DELETE',id,{expected_user_id:owner,expected_version:2});
  assert.equal(del.status,200,JSON.stringify(del));
  const rest=await f.shared('POST',id,{expected_user_id:owner,expected_version:3});
  assert.equal(rest.status,200,JSON.stringify(rest));
  assert.equal(f.sql.prepare('SELECT raw FROM entries').get().raw,'原OCR');
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'Bank');
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,1500);
  assert.equal(f.objects.has('receipts/v1/7'),true);
  assert.equal(f.deletes(),0);
 }finally{f.close()}
});
test('claim journal SQL failure rolls back registry, attachment, old tombstone and unchanged income; retry exact source succeeds',async()=>{
 const f=fixture();try{
  const copy=await f.copy();assert.equal(copy.status,200,JSON.stringify(copy));
  f.sql.exec("CREATE TRIGGER simulate_claim_failure BEFORE INSERT ON family_legacy_shared_receipt_claims BEGIN SELECT RAISE(ABORT,'CLAIM_BLOCK'); END");
  const attempt=await f.adopt();assert.equal(attempt.status,503,JSON.stringify(attempt));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_adoptions').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_attachments').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_audit').get().n,0);
  assert.equal(f.sql.prepare('SELECT deleted FROM receipt_r2_state').get().deleted,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n,SUM(amount) total FROM entries').get().total,1000);
  assert.equal(f.objects.size,2);
  f.sql.exec('DROP TRIGGER simulate_claim_failure');
  const good=await f.adopt();assert.equal(good.status,201,JSON.stringify(good));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_claims').get().n,1);
 }finally{f.close()}
});
test('source replaced, R2 copy missing or changed, revoked owner, stale source and member cannot adopt',async()=>{
 for(const mode of ['missing','changed','revoked','stale','member']){
  const f=fixture();try{
   const copied=await f.copy();assert.equal(copied.status,200);
   const key='shared/v1/'+copied.data.resource_id+'/'+copied.data.object_id;
   if(mode==='missing')f.objects.delete(key);
   if(mode==='changed')f.objects.get(key).customMetadata.sha256='0'.repeat(64);
   if(mode==='revoked')f.sql.prepare("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id=?").run(owner);
   if(mode==='stale')f.sql.prepare("UPDATE entries SET merchant='Another'").run();
   const res=await f.adopt(mode==='member'?f.outsider:f.actor);
   assert.notEqual(res.status,201,mode);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0);
   assert.equal(f.sql.prepare('SELECT deleted FROM receipt_r2_state').get().deleted,0);
  }finally{f.close()}
 }
});
test('legacy cleanup skips claimed old R2 original and cannot delete the verified shared copy',async()=>{
 const f=fixture();try{
  await f.copy();const adoption=await f.adopt();assert.equal(adoption.status,201);
  f.env.KAKEIBO_LEGACY_R2_WRITES_FROZEN='false';
  const url='https://kakeibo.test/api/r2-receipts/cleanup';
  const r=await handleR2Receipts(new Request(url,{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({after:0})}),
   f.env,f.db,['cleanup']);
  assert.equal(r.status,200);
  assert.equal(f.deletes(),0);
  assert.equal(f.objects.has('receipts/v1/7'),true);
  assert.equal(f.objects.size,2);
 }finally{f.close()}
});

async function sourceAudit(f,actor=f.actor,method='GET'){
 const endpoint=new URL(base+'legacy/shared-source-refcount?entry_id=7')
 const response=await legacySharedSourceRefcount(new Request(endpoint,{method}),f.env,endpoint,actor)
 return {status:response.status,data:await response.json()}
}
test('old R2 source reference audit verifies both original and claimed bytes without deleting either',async()=>{
 const f=fixture();try{
  const copy=await f.copy();assert.equal(copy.status,200)
  const adopted=await f.adopt();assert.equal(adopted.status,201)
  f.env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED='true'
  const before=f.sql.prepare('SELECT id,amount,raw,payment_source FROM entries').get()
  const checked=await sourceAudit(f)
  assert.equal(checked.status,200,JSON.stringify(checked))
  assert.equal(checked.data.original_and_shared_sha256_verified,true)
  assert.equal(checked.data.source_copy_refs,1)
  assert.equal(checked.data.claim_refs,1)
  assert.equal(checked.data.shared_ready_refs,1)
  assert.equal(checked.data.old_live_refs,0)
  assert.equal(checked.data.original_deleted,false)
  assert.equal(checked.data.source_purge_authorized,false)
  assert.equal(f.deletes(),0)
  assert.equal(f.objects.size,2)
  assert.deepEqual({...f.sql.prepare('SELECT id,amount,raw,payment_source FROM entries').get()},{...before})
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_audit').get().n,1)
 }finally{f.close()}
})
test('source R2 audit denies invalid actor, writes, unfrozen configuration and missing/mismatched original or copy',async()=>{
 for(const failure of ['member','write','flag','unfrozen','source_missing','target_missing','target_corrupt','owner_revoked']){
  const f=fixture();try{
   const copied=await f.copy();assert.equal(copied.status,200)
   assert.equal((await f.adopt()).status,201)
   f.env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED='true'
   const sharedKey='shared/v1/'+copied.data.resource_id+'/'+copied.data.object_id
   if(failure==='flag')f.env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED='false'
   if(failure==='unfrozen')f.env.KAKEIBO_LEGACY_R2_WRITES_FROZEN='false'
   if(failure==='source_missing')f.objects.delete('receipts/v1/7')
   if(failure==='target_missing')f.objects.delete(sharedKey)
   if(failure==='target_corrupt')f.objects.get(sharedKey).body[0]^=1
   if(failure==='owner_revoked')f.sql.prepare("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id=?").run(owner)
   const result=await sourceAudit(f,failure==='member'?f.outsider:f.actor,
    failure==='write'?'POST':'GET')
   assert.notEqual(result.status,200,failure+':'+JSON.stringify(result))
   assert.equal(result.data.source_purge_authorized,false)
   assert.equal(f.deletes(),0)
   assert.equal(f.sql.prepare('SELECT deleted FROM receipt_r2_state').get().deleted,1)
  }finally{f.close()}
 }
})

async function recover(f,person=f.actor,extra={}){
 const url=new URL(base+'legacy/shared-receipt-repair');
 const claim=f.sql.prepare('SELECT * FROM family_legacy_shared_receipt_copies WHERE entry_id=7').get();
 const x={expected_user_id:person.user_id,entry_id:7,resource_id:claim.resource_id,
  expected_sha256:claim.byte_sha256,request_id:'a'.repeat(32),confirm:true,...extra};
 const req=new Request(url,{method:'POST',headers:{origin:url.origin,
   'content-type':'application/json'},body:JSON.stringify(x)});
 const result=await legacySharedReceiptRepair(req,f.env,url,person);
 return{status:result.status,data:await result.json()};
}
test('0059 repairs missing shared R2 bytes from immutable retained owner source and replays one audit intent',async()=>{
 const f=fixture();try{
  const copy=await f.copy();assert.equal(copy.status,200);
  const adopted=await f.adopt();assert.equal(adopted.status,201);
  f.env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED='true';
  f.env.KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED='true';
  const sharedKey='shared/v1/'+copy.data.resource_id+'/'+copy.data.object_id;
  const ledgerBefore=f.sql.prepare('SELECT COUNT(*) n,SUM(amount) total FROM entries').get();
  f.objects.delete(sharedKey);
  const repair=await recover(f);
  assert.equal(repair.status,200,JSON.stringify(repair));
  assert.equal(repair.data.repaired,true);
  assert.equal(repair.data.original_deleted,false);
  assert.equal(repair.data.source_purge_authorized,false);
  assert.deepEqual([...f.objects.get(sharedKey).body],[...f.objects.get('receipts/v1/7').body]);
  assert.equal(f.deletes(),0);
  assert.deepEqual(f.sql.prepare('SELECT COUNT(*) n,SUM(amount) total FROM entries').get(),ledgerBefore);
  const audit=f.sql.prepare('SELECT * FROM family_legacy_shared_receipt_repairs').get();
  assert.equal(audit.status,'completed');assert.equal(audit.owner_user_id,owner);
  const again=await recover(f);assert.equal(again.status,200,JSON.stringify(again));
  assert.equal(again.data.replayed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_repairs').get().n,1);
  assert.throws(()=>f.sql.prepare('DELETE FROM family_legacy_shared_receipt_repairs').run(),/IMMUTABLE/);
  assert.throws(()=>f.sql.prepare("UPDATE family_legacy_shared_receipt_repairs SET byte_sha256='bad'").run(),/IMMUTABLE/);
 }finally{f.close()}
});
test('0059 denied when flags off, member, source tampered, request ID reused or target already corrupt',async()=>{
 for(const mode of ['disabled','member','source_bad','reused','target_bad','owner_revoked']){
  const f=fixture();try{
   const copy=await f.copy();assert.equal(copy.status,200);
   assert.equal((await f.adopt()).status,201);
   f.env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED='true';
   f.env.KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED='true';
   const key='shared/v1/'+copy.data.resource_id+'/'+copy.data.object_id;
   if(mode!=='target_bad')f.objects.delete(key);
   if(mode==='disabled')f.env.KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED='false';
   if(mode==='source_bad')f.objects.get('receipts/v1/7').body[0]^=1;
   if(mode==='target_bad')f.objects.get(key).body[0]^=1;
   if(mode==='owner_revoked')f.sql.prepare("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id=?").run(owner);
   if(mode==='reused')f.sql.prepare("INSERT INTO family_legacy_shared_receipt_repairs "+
    "(request_id,entry_id,resource_id,object_id,household_id,owner_user_id,byte_sha256,status,prepared_at) "+
    "VALUES(?,?,?,?,?,?,?,'pending',?)").run('a'.repeat(32),7,copy.data.resource_id,copy.data.object_id,hh,owner,
      '1'.repeat(64),Date.now());
   const result=await recover(f,mode==='member'?f.outsider:f.actor);
   assert.notEqual(result.status,200,mode+':'+JSON.stringify(result));
   assert.equal(result.data.source_purge_authorized,false);
   assert.equal(f.deletes(),0);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n,SUM(amount) total FROM entries').get().total,1000);
  }finally{f.close()}
 }
});
test('0059 conditional R2 error leaves pending durable intent and exact ID retry completes safely',async()=>{
 const f=fixture();try{
  const copy=await f.copy();assert.equal(copy.status,200);
  assert.equal((await f.adopt()).status,201);
  f.env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED='true';
  f.env.KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED='true';
  const key='shared/v1/'+copy.data.resource_id+'/'+copy.data.object_id;
  f.objects.delete(key);f.setWriteFail(true);
  const failed=await recover(f);assert.equal(failed.status,503,JSON.stringify(failed));
  assert.equal(f.sql.prepare('SELECT status FROM family_legacy_shared_receipt_repairs').get().status,'pending');
  assert.equal(f.objects.has(key),false);assert.equal(f.objects.has('receipts/v1/7'),true);
  f.setWriteFail(false);
  const retry=await recover(f);assert.equal(retry.status,200,JSON.stringify(retry));
  assert.equal(f.sql.prepare('SELECT status FROM family_legacy_shared_receipt_repairs').get().status,'completed');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_receipt_repairs').get().n,1);
  f.objects.delete(key);
  const late=await recover(f);assert.notEqual(late.status,200);
  assert.equal(late.data.code,'REPAIR_COMPLETED_TARGET_MISSING_NEW_REVIEW_REQUIRED');
  assert.equal(f.objects.has('receipts/v1/7'),true);
 }finally{f.close()}
});
