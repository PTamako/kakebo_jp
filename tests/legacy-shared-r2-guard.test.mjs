import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleR2Receipts} from '../functions/api/r2-receipts.js';
test('legacy R2 single and bulk endpoints refuse adopted IDs before tombstone or R2 access',async()=>{
 const sql=new DatabaseSync(':memory:');try{
  sql.exec('CREATE TABLE family_legacy_shared_adoptions(entry_id INTEGER PRIMARY KEY)');
  sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER,size_bytes INTEGER,updated_at TEXT)');
  sql.exec('INSERT INTO family_legacy_shared_adoptions VALUES(7)');
  const db={prepare(q){return{bind(...a){return{
   first:async()=>sql.prepare(q).get(...a)||null,
   all:async()=>({results:sql.prepare(q).all(...a)}),
   run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}}),
  }}}},batch:async()=>{throw Error('tombstone must never run')}};
  let r2Calls=0;
  const R2={head:async()=>{r2Calls++;return null},get:async()=>{r2Calls++;return null},
   delete:async()=>{r2Calls++},put:async()=>{r2Calls++}};
  const env={RECEIPTS_R2:R2,KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED:'true'};
  const ask=async(method,segments,body)=>handleR2Receipts(new Request(
   'https://kakeibo.test/api/r2-receipts/'+segments.join('/'),{
    method,...(['GET','HEAD'].includes(method)?{}:{body:body||'x',
     headers:{'content-type':'application/json'}})}),env,db,segments);
  for(const method of ['GET','HEAD','PUT','DELETE']){
   const res=await ask(method,['7']);assert.equal(res.status,410,method);
  }
  const bulk=await ask('DELETE',[],JSON.stringify({ids:[7,8]}));
  assert.equal(bulk.status,409);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM receipt_r2_state').get().n,0);
  assert.equal(r2Calls,0);
 }finally{sql.close()}
});


test('release-only R2 write freeze denies older iPhone mutations even for non-adopted records',async()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  const db={prepare:()=>{throw Error('frozen gateway must stop before DB')},
   batch:()=>{throw Error('frozen gateway must not tombstone')}};
  let calls=0;
  const env={KAKEIBO_LEGACY_R2_WRITES_FROZEN:'true',RECEIPTS_R2:{
   get:async()=>{calls++},head:async()=>{calls++},put:async()=>{calls++},delete:async()=>{calls++}}};
  for(const [method,path,body] of [
   ['PUT',['8'],'a'],['DELETE',['8'],'a'],
   ['DELETE',[],JSON.stringify({ids:[8]})],
   ['POST',['cleanup'],JSON.stringify({after:0})]
  ]){
   const url='https://kakeibo.test/api/r2-receipts/'+path.join('/');
   const res=await handleR2Receipts(new Request(url,{method,body}),env,db,path);
   assert.equal(res.status,503,method+' '+path.join('/'));
  }
  assert.equal(calls,0);
 }finally{sql.close()}
});
