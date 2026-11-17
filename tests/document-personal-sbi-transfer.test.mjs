import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHmac} from 'node:crypto';
import {documentPersonalSbiRoute} from '../functions/api/internal/document-personal-sbi/[[path]].js';
import {familyPersonalDocumentSbi} from '../functions/api/family-finance/personal-document-sbi.js';
import {routeInternalFinance} from '../workers/family-finance-service-router.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const id='a'.repeat(32),doc='b'.repeat(32),
 actor='22222222-2222-4222-8222-222222222222',secret='c'.repeat(64);
const payload={source:'jp-document-assistant',source_document_id:doc,
 source_candidate_id:id,household_id:'primary',owner_user_id:actor,
 idempotency_key:'jda:personal-sbi:'+id,date:'2026-11-17',
 effective_date:'2026-11-17',amount_jpy:15000,purpose:'monthly',
 merchant:'SBI証券 投信積立サービス',note:'',confirmed:true};
function signed(mode,body=payload,opt={}){
 const raw=JSON.stringify(body),stamp=String(Date.now());
 const signature=createHmac('sha256',Buffer.from(secret,'hex'))
  .update((mode==='execute'?'jpda:personal-sbi-execute':'jpda:personal-sbi-receipt')+
   '\n'+stamp+'\n'+raw).digest('hex');
 return new Request('https://kakeibo.internal/api/internal/document-personal-sbi/'+mode,{
  method:'POST',headers:{'content-type':'application/json',
   'x-approval-client':'jp-document-assistant','x-approval-timestamp':stamp,
   'x-approval-signature':opt.forged?'0'.repeat(64):signature,
   ...(opt.browser?{cookie:'sid=attacker'}:{})},body:raw});
}
function setup(){
 let row=null,calls=0;
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_DOCUMENT_FINANCE_SECRET:secret,DB:{
   prepare(sql){
    return {bind(...args){return {
     async first(){
      if(sql.includes('FROM homeflow_identity_links'))
       return args[0]===actor&&args[1]==='primary'?{yes:1,display_name:'本人'}:null;
      if(sql.includes('FROM family_document_personal_sbi_transfers'))return row;
      return null;
     },
     async all(){return {results:row?[row]:[]};},
     async run(){calls++;return {meta:{changes:1}};}
    }}};
   },
   async batch(queries){
    calls++;
    const b=queries[0];
    const x=b.__arguments;
    if(!row){
     const s=x||[];row={transfer_id:id,household_id:'primary',owner_user_id:actor,
      source_document_id:doc,source_candidate_id:id,source_sha256:s[5],
      date:payload.date,effective_date:payload.effective_date,
      amount_jpy:15000,purpose:'monthly',merchant:payload.merchant,note:'',
      state:'active',version:1,created_at:Date.now(),updated_at:Date.now()};
    }
    return [{meta:{changes:1}},{meta:{changes:1}}];
   }
  }};
 // Fake D1 batch bind metadata without converting user data into a browser payload.
 const orig=env.DB.prepare.bind(env.DB);
 env.DB.prepare=(sql)=>({
  bind(...args){const r=orig(sql).bind(...args);r.__arguments=args;return r;}
 });
 return {env,read:()=>row,calls:()=>calls};
}
test('private executor rejects unsigned and browser requests, without touching ledger',async()=>{
 const t=setup();
 assert.equal((await routeInternalFinance(signed('execute',payload,{forged:true}),t.env)).status,403);
 assert.equal((await routeInternalFinance(signed('execute',payload,{browser:true}),t.env)).status,403);
 assert.equal(t.calls(),0);
 assert.equal(t.read(),null);
});
test('personal SBI journals only the verified member transfer and does not create holdings/cards',async()=>{
 const t=setup();
 const first=await documentPersonalSbiRoute(signed('execute'),t.env,'execute');
 assert.equal(first.status,200);
 const value=await first.json();
 assert.equal(value.recorded_type,'transfer');
 assert.equal(value.fund_units_created,0);
 assert.equal(value.owner_user_id,actor);
 assert.equal(t.read().amount_jpy,15000);
 const again=await documentPersonalSbiRoute(signed('execute'),t.env,'execute');
 assert.equal((await again.json()).already_applied,true);
 assert.equal(t.calls(),1);
 const receipt=await documentPersonalSbiRoute(signed('receipt',{
  source:'jp-document-assistant',source_candidate_id:id,
  household_id:'primary',owner_user_id:actor,idempotency_key:'jda:personal-sbi:'+id}),t.env,'receipt');
 assert.equal((await receipt.json()).state,'active');
});
test('member-only read model returns transfers, not income/expense, and isolates user',async()=>{
 const t=setup();
 await documentPersonalSbiRoute(signed('execute'),t.env,'execute');
 const url=new URL('https://kakeibo.example/api/family-finance/personal-document-sbi?month=2026-11');
 const view=await familyPersonalDocumentSbi(new Request(url),t.env,url,
  {role:'member',user_id:actor,household_id:'primary'},['personal-document-sbi']);
 assert.equal(view.status,200);
 const result=await view.json();
 assert.equal(result.scope,'personal');
 assert.equal(result.items[0].type,'transfer');
 assert.equal(result.items[0].asset_balance_unverified,true);
 assert.equal((await familyPersonalDocumentSbi(new Request(url),t.env,url,
  {role:'owner',user_id:'owner',household_id:'primary'},['personal-document-sbi'])).status,403);
});
