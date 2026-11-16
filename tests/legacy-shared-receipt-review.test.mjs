import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {legacySharedReceiptReview as review} from '../functions/api/family-finance/legacy-shared-receipt-review.js';
const owner='owner',member='member',house='home',acc='a'.repeat(32),url='https://kakeibo.test/api/family-finance/legacy/shared-receipt-review?entry_id=7';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT)');
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT,household_id TEXT,owner_user_id TEXT,is_archived INTEGER)');
 sql.exec('CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT)');
 sql.exec('CREATE TABLE entries(id INTEGER,date TEXT,type TEXT,payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT)');
 sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER,deleted INTEGER,size_bytes INTEGER)');
 sql.exec('CREATE TABLE family_shared_entry_registry(entry_id INTEGER)');
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(owner,house,'owner','active');
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(member,house,'member','active');
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,0)').run(acc,house,owner);
 sql.prepare('INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?)').run(7,house,owner,acc,'Bank');
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,NULL)').run(7,'2026-10-02','expense','Bank',acc);
 sql.prepare('INSERT INTO receipt_r2_state VALUES(7,0,8)').run();
 const bytes=new TextEncoder().encode('original');
 let readCount=0;
 let obj={size:bytes.byteLength,httpMetadata:{contentType:'image/webp'},customMetadata:{},
  httpEtag:'"valid"',arrayBuffer:async()=>bytes.buffer};
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_RECEIPT_REVIEW_ENABLED:'true',
  DB:{prepare(q){return{bind(...args){return{first:async()=>sql.prepare(q).get(...args)||null}}}}},
  RECEIPTS_R2:{get:async(key)=>{readCount++;assert.equal(key,'receipts/v1/7');return obj}}};
 async function call(actor={user_id:owner,role:'owner',household_id:house},input=url,method='GET'){
  const res=await review(new Request(input,{method}),env,new URL(input),actor);
  return {status:res.status,data:await res.json()};
 }
 return {sql,env,call,changeObject(v){obj=v},reads(){return readCount},close(){sql.close()}};
}
test('original owner obtains verified original byte checksum but no R2 object URL nor copied/linked row',async()=>{
 const f=fixture();try{
  const r=await f.call();assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.data.read_only,true);assert.equal(r.data.copied,false);
  assert.equal(r.data.attachment_authorized,false);assert.equal(r.data.ledger_changed,false);
  assert.match(r.data.original_sha256,/^[a-f0-9]{64}$/);
  assert.match(r.data.source_object_key_sha256,/^[a-f0-9]{64}$/);
  assert.equal(r.data.stored_sha256_verified,false);
  assert.equal(r.data.object_key,undefined);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0);
 }finally{f.close()}
});
test('member, revoked owner, tombstone, drifted source, forged household and flag OFF never read R2 bytes',async()=>{
 for(const state of ['member','revoked','tombstone','drift','foreign','flag']){
  const f=fixture();try{
   if(state==='revoked')f.sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(owner);
   if(state==='tombstone')f.sql.prepare('UPDATE receipt_r2_state SET deleted=1').run();
   if(state==='drift')f.sql.prepare("UPDATE entries SET payment_source='Different'").run();
   if(state==='flag')f.env.KAKEIBO_LEGACY_SHARED_RECEIPT_REVIEW_ENABLED='false';
   const person=state==='member'?{user_id:member,role:'member',household_id:house}:
      {user_id:owner,role:'owner',household_id:state==='foreign'?'foreign':house};
   const r=await f.call(person);assert.notEqual(r.status,200,state);
   assert.equal(f.reads(),0,state);
  }finally{f.close()}
 }
});
test('original hash conflict, unexpected MIME and wrong size fail closed before owner copy eligibility',async()=>{
 for(const mode of ['hash','mime','size','absent']){
  const f=fixture();try{
   const bytes=new TextEncoder().encode('original');
   const obj={size:mode==='size'?9:8,
    httpMetadata:{contentType:mode==='mime'?'text/html':'image/webp'},
    customMetadata:{sha256:mode==='hash'?'0'.repeat(64):undefined},
    arrayBuffer:async()=>bytes.buffer};
   f.changeObject(mode==='absent'?null:obj);
   const r=await f.call();assert.notEqual(r.status,200,mode);
   assert.equal(r.data.copied,false);assert.equal(r.data.attachment_authorized,false);
  }finally{f.close()}
 }
});
