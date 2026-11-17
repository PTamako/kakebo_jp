import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {familySharedEntries} from '../functions/api/family-finance/shared-entries.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const household='primary'
const url=new URL('https://kakeibo.example.test/api/family-finance/shared-entries')
const sample={date:'2026-11-14',time:'12:30',amount:1200,type:'expense',
 category:'食費',merchant:'スーパー',note:'家庭の買物'}
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON')
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)')
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)')
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,category TEXT,'+
  'merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,'+
  'family_account_id TEXT,family_transfer_target_account_id TEXT,transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER DEFAULT 0)')
 sql.exec(readFileSync(new URL('../migrations/0051_shared_entry_lifecycle.sql',import.meta.url),'utf8'))
 sql.exec(readFileSync(new URL('../migrations/0052_shared_mutation_approved_execution.sql',import.meta.url),'utf8'))
 sql.exec(readFileSync(new URL('../migrations/0067_neutral_spouse_transfer.sql',import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,? ,?,'active')").run(u,household,role)
 const db={prepare(q){return {bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(statements){
  sql.exec('BEGIN IMMEDIATE')
  try{const result=statements.map(v=>v.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 const store=new Map();let failDelete=false
 const bucket={
  async put(key,bytes,opts){if(store.has(key))return null
   const o={body:bytes,size:bytes.byteLength,httpMetadata:opts.httpMetadata,
    customMetadata:opts.customMetadata}
   store.set(key,o);return o},
  async head(key){return store.get(key)||null},
  async get(key){return store.get(key)||null},
  async delete(keys){if(failDelete)throw Error('R2 fail simulated')
   for(const k of Array.isArray(keys)?keys:[keys])store.delete(k)}
 }
 const env={APP_ENV:'production',DB:db,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_SHARED_ENTRY_ENABLED:'true',
  RECEIPTS_R2:bucket}
 const o={user_id:owner,household_id:household,role:'owner'}
 const m={user_id:member,household_id:household,role:'member'}
 async function invoke(method,parts=['shared-entries'],data=null,actor=o,headers={}){
  const req=new Request(url,{method,headers:{...headers,
   ...(method==='GET'?{}:{origin:url.origin,...(data instanceof Uint8Array?
    {'content-type':'image/webp'}:{'content-type':'application/json'})})},
   ...(['GET','HEAD'].includes(method)?{}:{body:data instanceof Uint8Array?data:JSON.stringify(data)})})
  const res=await familySharedEntries(req,env,url,actor,parts)
  const json=(res.headers.get('content-type')||'').includes('json')?await res.json():null
  return {status:res.status,data:json,response:res}
 }
 const create=async()=>{const x=await invoke('POST',['shared-entries'],{
   expected_user_id:owner,idempotency_key:'shared-create-20261115-a',
   entry:sample})
  assert.equal(x.status,201,JSON.stringify(x))
  return x.data.action}
 const count=t=>sql.prepare('SELECT COUNT(*) n FROM '+t).get().n
 return {sql,store,env,owner:o,member:m,create,invoke,count,
  setDeleteFail(v){failDelete=v},close(){sql.close()}}
}
test('owner-created ordinary shared entry counts exactly once and legacy writers cannot bypass protected revision approval',async()=>{
 const f=fixture();try{
  const first=await f.create(),id=first.resource_id
  assert.equal(f.count('entries'),1)
  assert.equal(f.count('family_shared_entry_registry'),1)
  assert.equal(f.count('family_shared_entry_audit'),1)
  const fake=await f.invoke('POST',['shared-entries'],{
   expected_user_id:member,idempotency_key:'shared-other-member-create',entry:sample},f.member)
  assert.equal(fake.status,403)
  const stale=await f.invoke('PUT',['shared-entries',id],{
   expected_user_id:owner,expected_version:99,entry:{...sample,amount:1500}})
  assert.equal(stale.status,409)
  const updated=await f.invoke('PUT',['shared-entries',id],{
   expected_user_id:owner,expected_version:1,entry:{...sample,amount:1500}})
  assert.equal(updated.status,200,JSON.stringify(updated))
  assert.equal(updated.data.action.version,2)
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,1500)
  assert.equal(f.count('entries'),1)
  assert.equal(f.count('family_shared_entry_audit'),2)
  assert.throws(()=>f.sql.prepare('UPDATE entries SET amount=999').run(),
   /SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED/)
  assert.throws(()=>f.sql.prepare('DELETE FROM entries').run(),
   /SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED/)
  assert.throws(()=>f.sql.prepare('DELETE FROM family_shared_entry_audit').run(),/IMMUTABLE/)
  const other=await f.invoke('GET',['shared-entries',id],null,f.member)
  assert.equal(other.status,200)
  assert.equal(other.data.action.entry.amount,1500)
  const gone=await f.invoke('DELETE',['shared-entries',id],{expected_user_id:owner,expected_version:2})
  assert.equal(gone.status,200,JSON.stringify(gone))
  assert.equal(f.count('entries'),0)
  assert.equal(f.count('family_shared_entry_audit'),3)
  assert.equal(gone.data.action.state,'deleted')
  const restored=await f.invoke('POST',['shared-entries',id,'restore'],
    {expected_user_id:owner,expected_version:3})
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(restored.data.action.entry_id,first.entry_id)
  assert.equal(f.count('entries'),1)
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,1500)
  assert.equal(f.count('family_shared_entry_audit'),4)
  const replay=await f.invoke('POST',['shared-entries'],{
   expected_user_id:owner,idempotency_key:'shared-create-20261115-a',entry:sample})
  assert.equal(replay.status,409)
 }finally{f.close()}
})
test('entry revision and revision audit fail in one real SQLite transaction, no partial entry or metadata update',async()=>{
 const f=fixture();try{
  const id=(await f.create()).resource_id
  f.sql.exec("CREATE TRIGGER abort_shared_audit BEFORE INSERT ON family_shared_entry_audit "+
   "WHEN NEW.to_version=2 BEGIN SELECT RAISE(ABORT,'AUDIT_FAIL'); END")
  const attempt=await f.invoke('PUT',['shared-entries',id],
   {expected_user_id:owner,expected_version:1,entry:{...sample,amount:2500}})
  assert.equal(attempt.status,409)
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,1200)
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,1)
  assert.equal(f.count('family_shared_entry_write_context'),0)
  assert.equal(f.count('family_shared_entry_audit'),1)
 }finally{f.close()}
})
test('R2 shared attachment is separate from legacy numeric receipts; trash preserves it, explicit purge tombstones and retries on object failure',async()=>{
 const f=fixture();try{
  const first=await f.create(),id=first.resource_id
  const bytes=new TextEncoder().encode('minimal simulated WEBP')
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
   x=>x.toString(16).padStart(2,'0')).join('')
  const pending=await f.invoke('POST',['shared-entries',id,'attachments'],{
   expected_user_id:owner,idempotency_key:'shared-attachment-20261115',content_type:'image/webp',
   sha256:digest,size_bytes:bytes.byteLength})
  assert.equal(pending.status,201,JSON.stringify(pending))
  const obj=pending.data.attachment.object_id
  const uploading=await f.invoke('PUT',['shared-entries',id,'attachments',obj],bytes)
  assert.equal(uploading.status,200,JSON.stringify(uploading))
  assert(f.store.has('shared/v1/'+id+'/'+obj))
  assert(!f.store.has('receipts/v1/'+first.entry_id))
  const normalDownload=await f.invoke('GET',['shared-entries',id,'attachments',obj],null,f.member)
  assert.equal(normalDownload.status,200)
  const removed=await f.invoke('DELETE',['shared-entries',id],{
   expected_user_id:owner,expected_version:1})
  assert.equal(removed.status,200)
  assert.equal((await f.invoke('GET',['shared-entries',id,'attachments',obj],null,f.member)).status,403)
  assert.equal((await f.invoke('GET',['shared-entries',id,'attachments',obj])).status,200)
  f.setDeleteFail(true)
  const purge=await f.invoke('POST',['shared-entries',id,'purge'],{
   expected_user_id:owner,expected_version:2,confirm_resource_id:id})
  assert.equal(purge.status,503)
  assert.equal(f.sql.prepare('SELECT state FROM family_shared_entry_registry').get().state,'purge_pending')
  assert.equal((await f.invoke('GET',['shared-entries',id,'attachments',obj])).status,410)
  assert.equal(f.count('entries'),0)
  f.setDeleteFail(false)
  const reconcile=await f.invoke('POST',['shared-entries',id,'purge'],{
   expected_user_id:owner,expected_version:3,confirm_resource_id:id})
  assert.equal(reconcile.status,200,JSON.stringify(reconcile))
  assert.equal(f.store.size,0)
  const after=f.sql.prepare('SELECT state,snapshot_json FROM family_shared_entry_registry').get()
  assert.equal(after.state,'purged')
  assert.equal(after.snapshot_json,null)
  assert.equal(f.count('family_shared_entry_audit'),4)
  assert.equal(f.sql.prepare('SELECT state FROM family_shared_entry_attachments').get().state,'purged')
  assert.equal((await f.invoke('POST',['shared-entries',id,'restore'],
   {expected_user_id:owner,expected_version:4})).status,409)
 }finally{f.close()}
})


test('one spouse transfer is exactly one shared transfer row, never spouse income or expense; replay and lifecycle stay atomic',async()=>{
 const f=fixture();try{
  const entry={date:'2026-11-17',time:'12:30',amount:10000,type:'transfer',
   category:'投資・資産移動',merchant:'配偶への振替',note:'',transfer_target:'spouse',transfer_date:'2026-11-17'};
  const payload={expected_user_id:owner,idempotency_key:'neutral-spouse-transfer-20261117',entry};
  const first=await f.invoke('POST',['shared-entries'],payload);
  assert.equal(first.status,201,JSON.stringify(first.data));
  const retry=await f.invoke('POST',['shared-entries'],payload);
  assert.equal(retry.status,200);assert.equal(retry.data.replayed,true);
  assert.equal(f.count('entries'),1);
  const stored=f.sql.prepare('SELECT type,amount,transfer_target,transfer_applied FROM entries').get();
  assert.equal(stored.type,'transfer');assert.equal(stored.transfer_target,'spouse');
  assert.equal(stored.transfer_applied,0);
  const totals=f.sql.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,"+
   "COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense FROM entries").get();
  assert.deepEqual(totals,{income:0,expense:0});
  const id=first.data.action.resource_id;
  const edit=await f.invoke('PUT',['shared-entries',id],{expected_user_id:owner,expected_version:1,
   entry:{...entry,amount:12000}});
  assert.equal(edit.status,200,JSON.stringify(edit.data));
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,12000);
  const del=await f.invoke('DELETE',['shared-entries',id],{expected_user_id:owner,expected_version:2});
  assert.equal(del.status,200);assert.equal(f.count('entries'),0);
  const restore=await f.invoke('POST',['shared-entries',id,'restore'],{expected_user_id:owner,expected_version:3});
  assert.equal(restore.status,200,JSON.stringify(restore.data));
  assert.equal(f.count('entries'),1);assert.equal(f.count('family_shared_entry_registry'),1);
  assert.equal(f.count('family_shared_entry_audit'),4);
 }finally{f.close()}
});
