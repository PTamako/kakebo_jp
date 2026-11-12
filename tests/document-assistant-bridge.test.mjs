import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { onRequestPost } from '../functions/api/bridge/document-assistant.js'
if (!globalThis.crypto) globalThis.crypto=webcrypto

const secret='fixture_kakebo_bridge_secret_with_entropy_1234567'
const actor='approved_kakebo_owner'
const id='jda:kakebo:1234567890abcdef'
const url='https://kakebo.example.test/api/bridge/document-assistant'
const body=(changes={})=>({
  source:'jp-document-assistant', actor_user_id:actor,idempotency_key:id,
  payload:{operation:'entry', type:'expense', date:'2026-11-12',
    amount:1200, category:'税金',paymentSource:'現金',note:'测试', ...changes}
})
const env=(overrides={})=>({JPDA_BRIDGE_ENABLED:'true',JPDA_BRIDGE_SECRET:secret,
 JPDA_BRIDGE_ALLOWED_USER:actor,...overrides})
async function signed(payload=body(),time=Date.now()){
 const raw=JSON.stringify(payload),stamp=String(time)
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(stamp+'\n'+raw)))
 const hex=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('')
 return new Request(url,{method:'POST',headers:{'Content-Type':'application/json',
   'X-DA-Timestamp':stamp,'X-DA-Signature':hex,'Idempotency-Key':id},body:raw})
}
test('financial bridge is disabled by default',async()=>{
 const r=await onRequestPost({request:new Request(url,{method:'POST'}),env:env({JPDA_BRIDGE_ENABLED:'false'})})
 assert.equal(r.status,404)
})
test('signature freshness, HMAC integrity and explicit source actor are mandatory',async()=>{
 const old=await onRequestPost({request:await signed(body(),Date.now()-600000),env:env()})
 assert.equal(old.status,401)
 const request=await signed()
 const changed=new Request(url,{method:'POST',headers:request.headers,body:JSON.stringify(body({amount:50000}))})
 assert.equal((await onRequestPost({request:changed,env:env()})).status,401)
 assert.equal((await onRequestPost({request:await signed(),env:env({JPDA_BRIDGE_ALLOWED_USER:'another_account'})})).status,403)
})
test('signed request with invalid financial values never reaches D1',async()=>{
 const environment=env({DB:{prepare(){throw Error('unauthorized D1 access')}}})
 const r=await onRequestPost({request:await signed(body({amount:0})),env:environment})
 assert.equal(r.status,400)
 assert.equal((await r.json()).error,'invalid_entry')
})

test('signed read-only ledger options list real categories and active payment sources',async()=>{
 let calls=0,queries=[];
 const database={
  prepare(sql){queries.push(sql);return {bind(){return this}}},
  async batch(){calls++;return [
   {results:[{category:'饮食料品',display_name:'飲食料品'},{category:'餐饮',display_name:'外食'}]},
   {results:[{name:'三井住友カード'},{name:'楽天カード'}]}
  ]}
 };
 const options={
  source:'jp-document-assistant',actor_user_id:actor,
  payload:{operation:'options',entryType:'expense'}
 };
 const response=await onRequestPost({request:await signed(options),env:env({DB:database})});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.ok,true);
 assert.deepEqual(result.categories.map(x=>x.value),['饮食料品','餐饮']);
 assert.deepEqual(result.categories.map(x=>x.label),['飲食料品','外食']);
 assert.deepEqual(result.payment_sources.map(x=>x.value),['現金','三井住友カード','楽天カード']);
 assert.equal(calls,1);
 assert.equal(queries.length,2);
 assert.ok(queries.every(sql=>/^\s*SELECT/i.test(sql)));
 const bad=await onRequestPost({request:await signed({...options,payload:{operation:'options',entryType:'transfer'}}),env:env({DB:database})});
 assert.equal(bad.status,400);
 assert.equal(calls,1);
});
