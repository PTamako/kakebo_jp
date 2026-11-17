import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHmac,createHash} from 'node:crypto';
import {approvalPreviewRoute} from '../workers/approval-preview.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const requestId='55555555-5555-4555-8555-555555555555';
const proposalId='b'.repeat(32),accountId='c'.repeat(32);
const house='household',member='member',owner='owner';
const secret='a'.repeat(64),pendingKey='d'.repeat(64);
const core={request_id:requestId,resource_id:proposalId,household_id:house,
 requester_user_id:member,approver_user_id:owner};
const examples=[
 {resource_type:'finance_entry',operation:'finance.entry.create',
  payload:{account_id:accountId,date:'2026-11-17',type:'expense',
   amount_jpy:1200,category:'食費',merchant:'コンビニ',note:'現金'},
  extra:{state:'submitted',operation:'finance.entry.create',account_kind:'cash',
   account_household:house,origin:'member_created',owner_user_id:member,is_archived:0},
  method:'現金',aad:'kakeibo-finance:'},
 {resource_type:'credit_card_purchase',operation:'finance.credit_card.purchase',
  payload:{account_id:accountId,account_version:1,type:'expense',date:'2026-11-17',
   amount_jpy:2400,merchant:'スーパー',category:'食費',note:'カード'},
  extra:{status:'submitted',account_kind:'credit_card',account_household:house,
   origin:'member_created',owner_user_id:member,is_archived:0,
   account_version:1,live_version:1,closing_day:15},
  method:'个人信用卡',aad:'kakeibo-card:'},
 {resource_type:'prepaid_action',operation:'finance.prepaid.spend',
  payload:{action:'spend',prepaid_account_id:accountId,prepaid_version:1,
   date:'2026-11-17',amount_jpy:880,merchant:'便利店',category:'日用品',note:'储值'},
  extra:{status:'submitted',action:'spend',prepaid_kind:'prepaid',
   prepaid_origin:'member_created',prepaid_owner:member,prepaid_household:house,
   prepaid_archived:0,prepaid_version:1,prepaid_live:1,
   prepaid_account_id:accountId,bank_account_id:null,bank_version:null},
  method:'个人储值卡',aad:'kakeibo-prepaid:'}
];
async function prepare(item){
 const raw=JSON.stringify(item.payload),iv=webcrypto.getRandomValues(new Uint8Array(12));
 const key=await webcrypto.subtle.importKey('raw',Buffer.from(pendingKey,'hex'),
  'AES-GCM',false,['encrypt']);
 const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:new TextEncoder().encode(item.aad+proposalId)},key,
  new TextEncoder().encode(raw));
 const b={...core,resource_type:item.resource_type,operation:item.operation,
  payload_sha256:createHash('sha256').update(raw).digest('hex')};
 const row={...item.extra,request_id:proposalId,homeflow_approval_id:requestId,
  household_id:house,requester_user_id:member,requester_role:'member',
  requester_state:'active',expires_at:Date.now()+600000,
  account_id:accountId,payload_sha256:b.payload_sha256,
  payload_iv:Buffer.from(iv).toString('base64'),
  payload_cipher:Buffer.from(cipher).toString('base64')};
 let sqlCalls=0;
 const env={APP_ENV:'production',KAKEIBO_HOUSEHOLD_LEDGER_ONLY:'true',
  KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET:secret,
  KAKEIBO_FAMILY_PENDING_KEY:pendingKey,DB:{
   prepare(sql){sqlCalls++;return {bind(){return{
    all:async()=>({results:[{user_id:owner,role:'owner',state:'active'},
      {user_id:member,role:'member',state:'active'}]}),
    first:async()=>row,
    run:async()=>{throw Error('readonly preview must never write')}
   }}}}
  }};
 const call=(override={},flags={})=>{
  const value={...b,...override},body=JSON.stringify(value),stamp=String(Date.now());
  const signature=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('homeflow:ledger-preview\n'+stamp+'\n'+body).digest('hex');
  const headers={'content-type':'application/json','x-approval-client':'homeflow',
   'x-approval-timestamp':stamp,
   'x-approval-signature':flags.badSignature?'0'.repeat(64):signature,
   ...(flags.origin?{origin:'https://attacker.invalid'}:{})};
  return approvalPreviewRoute(new Request('https://kakeibo.internal/api/internal/approval-preview',
   {method:'POST',headers,body}),env);
 };
 return {env,call,row,getCalls:()=>sqlCalls};
}
for(const item of examples){
 test('read-only signed private '+item.resource_type+' preview validates the sealed source',async()=>{
  const f=await prepare(item);
  const res=await f.call();
  assert.equal(res.status,200,await res.clone().text());
  const data=await res.json();
  assert.equal(data.approval_id,requestId);
  assert.equal(data.operation,item.operation);
  assert.equal(data.entry.date,'2026-11-17');
  assert.equal(data.entry.amount,item.payload.amount_jpy);
  assert.equal(data.entry.merchant,item.payload.merchant);
  assert.equal(data.entry.payment_source,item.method);
  assert.ok(!('account_id' in data.entry));
  assert.ok(f.getCalls()>0);
  assert.equal((await f.call({}, {badSignature:true})).status,403);
  assert.equal((await f.call({}, {origin:true})).status,403);
  assert.equal((await f.call({approver_user_id:member})).status,400);
  f.row.requester_state='revoked';
  assert.equal((await f.call()).status,409);
 });
}
test('a valid signature cannot request an unrelated personal asset operation',async()=>{
 const f=await prepare(examples[0]);
 assert.equal((await f.call({resource_type:'prepaid_action',operation:'finance.prepaid.topup'})).status,400);
 assert.equal((await f.call({resource_type:'sbi_cash_action',operation:'finance.sbi_cash.tsumitate'})).status,400);
});
