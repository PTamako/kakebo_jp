import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHmac} from 'node:crypto';
import {routeInternalFinance} from '../workers/family-finance-service-router.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const member='22222222-2222-4222-8222-222222222222';
const secret='c'.repeat(64);
const account='a'.repeat(32);
const env={
 APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
 KAKEIBO_DOCUMENT_ACCOUNT_VERIFY_ENABLED:'true',
 KAKEIBO_DOCUMENT_ACCOUNT_VERIFICATION_SECRET:secret,
 DB:{prepare(sql){return {bind(...args){return {
  async first(){
   if(sql.includes('homeflow_identity_links'))
    return args[0]===member?{role:'member',state:'active'}:null;
   return args[0]===account&&args[2]===member?
    {account_id:account,household_id:'primary',owner_user_id:member,
     label:'現金',account_kind:'cash',origin:'member_created',
     is_archived:0,version:1,role:'member',state:'active'}:null;
  },
  async all(){return {results:[{account_id:account,label:'現金',
    account_kind:'cash',account_version:1}]}}
 }}}}}
};
function request(path,payload,opts={}){
 const stamp=String(Date.now()),raw=JSON.stringify(payload);
 const signature=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('jpda:finance-account\\n'+stamp+'\\n'+raw).digest('hex');
 return new Request('https://kakeibo.internal/api/internal/document-accounts/'+path,{
  method:'POST',headers:{'content-type':'application/json',
   'x-approval-client':'jp-document-assistant',
   'x-approval-timestamp':stamp,
   'x-approval-signature':opts.badSignature?'0'.repeat(64):signature,
   ...(opts.browser?{cookie:'browser-session'}:{})},body:raw});
}
test('private Worker routes signed document finance account read-only proofs',async()=>{
 const verify=await routeInternalFinance(request('verify',{account_id:account,
   household_id:'primary',requester_user_id:member,entry_type:'expense'}),env);
 assert.equal(verify.status,200);
 const proof=await verify.json();
 assert.equal(proof.account_id,account);
 assert.equal(proof.owner_user_id,member);
 assert.equal(proof.applied,false);
 const list=await routeInternalFinance(request('list',{
  household_id:'primary',requester_user_id:member}),env);
 assert.equal(list.status,200);
 assert.deepEqual((await list.json()).accounts.map(a=>a.account_id),[account]);
});
test('private Worker rejects forged/browser requests and unknown account paths',async()=>{
 const payload={account_id:account,household_id:'primary',
   requester_user_id:member,entry_type:'expense'};
 assert.equal((await routeInternalFinance(request('verify',payload,{badSignature:true}),env)).status,403);
 assert.equal((await routeInternalFinance(request('verify',payload,{browser:true}),env)).status,403);
 assert.equal(await routeInternalFinance(request('arbitrary',payload),env),null);
});
