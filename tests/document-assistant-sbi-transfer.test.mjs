import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../functions/api/bridge/document-assistant.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const secret='a-strong-local-test-secret-for-sbi-bridge-12345';
const actor='sbi-bridge-owner';
const endpoint='https://kakebo.example.test/api/bridge/document-assistant';
const env=db=>({JPDA_BRIDGE_ENABLED:'true',JPDA_BRIDGE_SECRET:secret,JPDA_BRIDGE_ALLOWED_USER:actor,DB:db});
const base=(key,changes={})=>({
  source:'jp-document-assistant',actor_user_id:actor,idempotency_key:key,
  payload:{operation:'entry',type:'transfer',date:'2026-11-12',time:'',amount:15000,
    category:'投資・資産移動',merchant:'SBI証券投信積立サービス（翌月買付分）',
    paymentSource:'三井住友カード',note:'',transferTarget:'sbi',
    transferDate:'2026-12-15',sbiPurpose:'monthly',...changes}
});
async function signed(payload){
  const raw=JSON.stringify(payload),stamp=String(Date.now());
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(stamp+'\n'+raw)));
  const signature=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return new Request(endpoint,{method:'POST',headers:{
    'X-DA-Timestamp':stamp,'X-DA-Signature':signature,
    'Idempotency-Key':payload.idempotency_key},body:raw});
}
function d1(sqlite){
  return {
    prepare(sql){
      let args=[];
      return {
        bind(...values){args=values;return this},
        async first(){return sqlite.prepare(sql).get(...args)||null},
        async run(){const v=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(v.changes)}}}
      };
    },
    async batch(statements){
      sqlite.exec('BEGIN');
      try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}
      catch(e){sqlite.exec('ROLLBACK');throw e}
    }
  };
}
test('SBI monthly investment is a transfer, with effective date, purpose and duplicate protection',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  sqlite.prepare("INSERT INTO payment_sources(name,is_default) VALUES('三井住友カード',1)").run();
  const db=d1(sqlite),environment=env(db);
  async function send(key,changes={}){
    const response=await onRequestPost({request:await signed(base(key,changes)),env:environment});
    return {status:response.status,body:await response.json()};
  }
  try{
    const first=await send('jda:kakebo:1000000000000001');
    assert.equal(first.status,200,JSON.stringify(first.body));
    const row=sqlite.prepare('SELECT * FROM entries WHERE id=?1').get(Number(first.body.remote_id));
    assert.equal(row.type,'transfer');
    assert.equal(row.category,'投資・資産移動');
    assert.equal(row.transfer_target,'sbi');
    assert.equal(row.transfer_date,'2026-12-15');
    assert.equal(row.transfer_applied,0);
    assert.equal(row.payment_source,'三井住友カード');
    const link=sqlite.prepare('SELECT purchase_month,purpose FROM sbi_transfer_links WHERE entry_id=?1').get(row.id);
    assert.deepEqual(link,{purchase_month:'2026-12',purpose:'monthly'});
    const repeat=await send('jda:kakebo:1000000000000001');
    assert.equal(repeat.status,200);
    assert.equal(repeat.body.remote_id,first.body.remote_id);
    const duplicate=await send('jda:kakebo:1000000000000002');
    assert.equal(duplicate.status,409);
    assert.equal(duplicate.body.error,'duplicate_candidate');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,1);
    // Other SBI purchases are non-recurring even when the same account is used.
    const purchase=await send('jda:kakebo:1000000000000003',{
      date:'2026-11-13',time:'10:20',amount:1751,
      merchant:'SBI証券 投信 買付',sbiPurpose:'purchase',transferDate:'2026-11-13'});
    assert.equal(purchase.status,200,JSON.stringify(purchase.body));
    const purpose=sqlite.prepare('SELECT purpose FROM sbi_transfer_links WHERE entry_id=?1').get(Number(purchase.body.remote_id)).purpose;
    assert.equal(purpose,'purchase');
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM entries WHERE type='expense'").get().n,0);
  }finally{sqlite.close()}
});
test('SBI transfer endpoint rejects missing or false effective-date/purpose/target before writing',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  const environment=env(d1(sqlite));
  try{
    for(const changes of [
      {transferDate:''},{transferDate:'2026-02-31'},
      {transferTarget:'other'},{category:'日用品'},
      {sbiPurpose:'funding'},{sbiPurpose:null}
    ]){
      const req=await signed(base('jda:kakebo:1000000000000004',changes));
      const result=await onRequestPost({request:req,env:environment});
      assert.equal(result.status,400,JSON.stringify(changes));
      assert.equal((await result.json()).error,'invalid_transfer');
    }
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0);
  }finally{sqlite.close()}
});
