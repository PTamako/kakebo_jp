import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {onRequestPost} from '../functions/api/bridge/document-assistant.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const secret='fixture_kakebo_prepaid_topup_secret_with_entropy_1234567'
const actor='approved_kakebo_owner'
const base='https://kakebo.example.test/api/bridge/document-assistant'
async function signed(payload,key='jda:kakebo:abcd1234abcd1234'){
 const raw=JSON.stringify(payload),stamp=String(Date.now())
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const sig=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(stamp+'\\n'+raw))
 const hex=Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('')
 return new Request(base,{method:'POST',headers:{'content-type':'application/json',
  'x-da-timestamp':stamp,'x-da-signature':hex,'Idempotency-Key':key},body:raw})
}
test('signed Suica top-up transfers only between registered sources, never expense or SBI',async()=>{
 const sql=new DatabaseSync(':memory:')
 try{
  sql.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
  sql.prepare("INSERT INTO payment_sources(name,source_type) VALUES('Suica','prepaid'),('楽天カード','standard'),('現金','standard')").run()
  const db={prepare(query){return {bind(...params){return {
   first:async()=>sql.prepare(query).get(...params)||null,
   run:async()=>{const r=sql.prepare(query).run(...params);return {meta:{changes:Number(r.changes)}}}
  }}}}}
  const env={JPDA_BRIDGE_ENABLED:'true',JPDA_BRIDGE_SECRET:secret,JPDA_BRIDGE_ALLOWED_USER:actor,DB:db}
  const opts={source:'jp-document-assistant',actor_user_id:actor,payload:{operation:'options',
   entryType:'transfer',merchant:'Suicaチャージ'}}
  // The options endpoint uses a batch catalogue; its production path is
  // separately checked by the existing bridge-options tests.
  const entry=(key,patch={})=>({source:'jp-document-assistant',actor_user_id:actor,
   idempotency_key:key,payload:{operation:'entry',type:'transfer',date:'2026-11-20',
    time:'16:17',amount:5000,category:'投資・資産移動',paymentSource:'楽天カード',
    merchant:'Suicaチャージ',note:'',transferTarget:'prepaid:Suica',
    transferDate:'2026-11-20',...patch}})
  const key='jda:kakebo:1234567890abcd12'
  const first=await onRequestPost({request:await signed(entry(key),key),env})
  assert.equal(first.status,200,JSON.stringify(await first.clone().json()))
  const created=(await first.json()).remote_id
  const saved=sql.prepare('SELECT type,category,payment_source,transfer_target,transfer_date,transfer_applied,amount FROM entries WHERE id=?').get(Number(created))
  assert.equal(saved.type,'transfer')
  assert.equal(saved.category,'投資・資産移動')
  assert.equal(saved.amount,5000)
  assert.equal(saved.payment_source,'楽天カード')
  assert.equal(saved.transfer_target,'prepaid:Suica')
  assert.equal(saved.transfer_applied,1)
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM sbi_transfer_links').get().n,0)
  const retry=await onRequestPost({request:await signed(entry(key),key),env})
  assert.equal(retry.status,200)
  assert.equal((await retry.json()).remote_id,created)
  const duplicateKey='jda:kakebo:1234567890abcd13'
  const duplicate=await onRequestPost({request:await signed(entry(duplicateKey,{merchant:'Suica 充值'}),duplicateKey),env})
  assert.equal(duplicate.status,409)
  assert.equal((await duplicate.json()).error,'duplicate_candidate')
  for(const [i,patch] of [{transferTarget:'prepaid:楽天カード'},
   {paymentSource:'Suica'},{transferTarget:'prepaid:Unknown'},
   {sbiPurpose:'purchase'},{transferDate:'2026-11-21'}].entries()){
   const k='jda:kakebo:1234567890ab'+String(i+40).padStart(4,'0')
   const response=await onRequestPost({request:await signed(entry(k,patch),k),env})
   assert.ok(response.status>=400,`invalid transfer accepted: ${JSON.stringify(patch)}`)
  }
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM entries').get().n,1)
 }finally{sql.close()}
})
