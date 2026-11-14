import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,webcrypto} from 'node:crypto';
import {familyPrepaidActions} from '../functions/api/family-finance/prepaid-actions.js';
import {approvedPrepaidActionRoute} from '../functions/api/internal/prepaid-actions/[[path]].js';
import {memberPrepaidBalances} from '../functions/api/family-finance/prepaid-balance-projection.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const household='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',prepaid='a'.repeat(32),bank='b'.repeat(32);
const secrets={aes:'1'.repeat(64),submit:'2'.repeat(64),proof:'3'.repeat(64),execute:'4'.repeat(64)};
const sign=(domain,key,stamp,raw)=>createHmac('sha256',Buffer.from(key,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex');
const query=(sql,q,...args)=>sql.prepare(q).get(...args);
const stmt=(sql,q,...args)=>sql.prepare(q).run(...args);
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 const migration=readFileSync(new URL('../migrations/0033_member_prepaid_actions.sql',import.meta.url),'utf8');
 sql.exec(migration);sql.exec(migration);
 sql.exec(readFileSync(new URL('../migrations/0034_family_points_foundation.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0035_points_prepaid_atomic.sql',import.meta.url),'utf8'));
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,household,role,role,'active',Date.now());
 for(const [id,kind] of [[prepaid,'prepaid'],[bank,'bank']])
  stmt(sql,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)',
   id,household,member,kind,kind,'member_created',member,member);
 const db={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(actions){
  sql.exec('BEGIN IMMEDIATE');
  try{const results=actions.map(a=>a.sync());sql.exec('COMMIT');return results}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 const approvalByProposal=new Map(),approvalById=new Map();
 let permitted=true,proofCount=0;
 const env={APP_ENV:'production',DB:db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_PREPAID_ACTIONS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:secrets.aes,
  KAKEIBO_PREPAID_SUBMISSION_SECRET:secrets.submit,
  KAKEIBO_PREPAID_PROOF_SECRET:secrets.proof,
  KAKEIBO_PREPAID_EXECUTION_SECRET:secrets.execute,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const raw=await req.text(),b=JSON.parse(raw),stamp=req.headers.get('x-approval-timestamp'),
   url=new URL(req.url);
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-prepaid');
  if(url.pathname.endsWith('prepaid-submit')){
   assert.equal(req.headers.get('x-approval-signature'),
    sign('kakeibo-prepaid:submit',secrets.submit,stamp,raw));
   let r=approvalByProposal.get(b.resource_id);
   if(!r){r=crypto.randomUUID();approvalByProposal.set(b.resource_id,r);
    approvalById.set(r,{action:b.action,proposal:b.resource_id,hash:b.payload_sha256})}
   return Response.json({ok:true,approval_id:r,resource_id:b.resource_id,
    household_id:b.household_id,requester_user_id:b.requester_user_id,
    payload_sha256:b.payload_sha256,expected_version:b.expected_version,
    operation:'finance.prepaid.'+b.action,applied:false});
  }
  assert.equal(url.pathname,'/api/internal/approvals/verify');
  proofCount++;
  assert.equal(req.headers.get('x-approval-signature'),
   sign('kakeibo-prepaid:execution-proof',secrets.proof,stamp,raw));
  if(!permitted)return Response.json({code:'revoked'},{status:409});
  const a=approvalById.get(b.request_id);
  if(!a)return Response.json({code:'not-found'},{status:404});
  assert.equal(b.idempotency_key,'kakeibo:prepaid:'+b.resource_id);
  assert.equal(b.execution_nonce,'f'.repeat(64));
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.prepaid.'+a.action,resource_type:'prepaid_action',
   request_id:b.request_id,resource_id:b.resource_id,
   household_id:b.household_id,requester_user_id:b.requester_user_id,
   payload_sha256:b.payload_sha256,idempotency_key:b.idempotency_key,
   expected_version:1,approver_user_id:owner,
   approved_at:Date.now()-1000,expires_at:Date.now()+120000,applied:false});
 }};
 const user={user_id:member,household_id:household,role:'member'};
 const url=new URL('https://kakeibo.example.test/api/family-finance/prepaid-actions');
 const call=async(parts=['prepaid-actions'],body,method='POST')=>{
  const req=new Request(url,{method,headers:method==='POST'?
   {origin:url.origin,'content-type':'application/json'}:{},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const r=await familyPrepaidActions(req,env,url,user,parts);
  return {status:r.status,data:await r.json()};
 };
 const execute=async(approval,mode='execute',opts={})=>{
  const record=approvalById.get(approval);assert.ok(record);
  const wire={request_id:approval,resource_id:record.proposal,
   household_id:household,requester_user_id:member,payload_sha256:record.hash,
   ...(mode==='execute'?{execution_nonce:'f'.repeat(64)}:{})};
  const raw=JSON.stringify(wire),stamp=String(Date.now());
  const req=new Request('https://kakeibo.internal/api/internal/prepaid-actions/'+mode,{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'homeflow','x-approval-timestamp':stamp,
    'x-approval-signature':opts.invalid?'0'.repeat(64):
     sign('homeflow:prepaid-'+mode,secrets.execute,stamp,raw)},body:raw});
  const r=await approvedPrepaidActionRoute(req,env,[mode]);
  return {status:r.status,data:await r.json()};
 };
 let counter=0;
 const topup=(ref='confirmed-bank-ref-001',yen=1000)=>({
  expected_user_id:member,idempotency_key:'prepaid-topup-'+(++counter)+'-20261114',
  prepaid_account_id:prepaid,prepaid_version:1,
  action:'topup',bank_account_id:bank,bank_version:1,
  date:'2026-11-14',amount_jpy:yen,bank_reference:ref,statement_confirmed:true});
 const spend=(yen=400)=>({
  expected_user_id:member,idempotency_key:'prepaid-spend-'+(++counter)+'-20261114',
  prepaid_account_id:prepaid,prepaid_version:1,
  action:'spend',date:'2026-11-14',amount_jpy:yen,
  merchant:'セブン-イレブン',category:'食費',note:''});
 const submit=async input=>{
  const p=await call(['prepaid-actions'],input);
  assert.equal(p.status,201,JSON.stringify(p));
  const id=p.data.prepared.request_id;
  const s=await call(['prepaid-actions',id,'submit'],{expected_user_id:member});
  assert.equal(s.status,200,JSON.stringify(s));
  return s.data.approval_id;
 };
 return {sql,env,user,call,execute,topup,spend,submit,prepaid,bank,owner,member,
  revokeProof(){permitted=false},get proofCount(){return proofCount},
  close(){sql.close()}};
}
test('prepaid topup only transfers bank→prepaid and spend alone creates expense, accurate nonnegative journal',async()=>{
 const f=fixture();try{
  const initial=await f.call(['prepaid-actions','balances'],undefined,'GET');
  assert.equal(initial.data.items[0].balance_jpy,0);
  const funded=await f.submit(f.topup());
  assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_prepaid_actions_applied').n,0);
  assert.equal((await f.execute(funded,'receipt')).status,404);
  assert.equal((await f.execute(funded,'execute',{invalid:true})).status,403);
  const posted=await f.execute(funded);assert.equal(posted.status,200,JSON.stringify(posted));
  assert.equal(posted.data.action,'topup');assert.equal(posted.data.balance_after_jpy,1000);
  assert.equal(query(f.sql,"SELECT SUM(amount) v FROM entries WHERE type='transfer'").v,1000);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,0);
  const purchased=await f.submit(f.spend(400));
  assert.equal((await f.execute(purchased)).status,200);
  assert.equal(query(f.sql,'SELECT SUM(delta_jpy) v FROM family_prepaid_balance_journal').v,600);
  assert.equal(query(f.sql,"SELECT SUM(amount) v FROM entries WHERE type='expense'").v,400);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,1);
  const balances=await f.call(['prepaid-actions','balances'],undefined,'GET');
  assert.equal(balances.data.items[0].balance_jpy,600);
  const receipt=await f.execute(purchased,'receipt');
  assert.equal(receipt.status,200);assert.equal(receipt.data.already_applied,true);
  const duplicate=await f.execute(purchased);
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.already_applied,true);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,1);
  assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_prepaid_action_audit').n,2);
  assert.equal(f.proofCount,2);
 }finally{f.close()}
});
test('cannot spend unconfirmed balance, double spend under concurrent approvals, or reuse the bank debit',async()=>{
 const f=fixture();try{
  const noMoney=await f.call(['prepaid-actions'],f.spend(100));
  assert.equal(noMoney.status,409);assert.equal(noMoney.data.code,'PREPAID_INSUFFICIENT_BALANCE');
  const funded=await f.submit(f.topup());
  assert.equal((await f.execute(funded)).status,200);
  const spend1=await f.submit(f.spend(700)),spend2=await f.submit(f.spend(700));
  assert.equal((await f.execute(spend1)).status,200);
  const over=await f.execute(spend2);assert.notEqual(over.status,200);
  assert.equal(query(f.sql,'SELECT SUM(delta_jpy) v FROM family_prepaid_balance_journal').v,300);
  assert.equal(query(f.sql,"SELECT SUM(amount) v FROM entries WHERE type='expense'").v,700);
  const duplicateBank=await f.submit(f.topup('confirmed-bank-ref-001',200));
  assert.notEqual((await f.execute(duplicateBank)).status,200);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,1);
  assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_prepaid_actions_applied').n,2);
 }finally{f.close()}
});
test('revoked identity, stale bank/prepaid version, invalid bank confirmation and audit failure abort whole transaction',async()=>{
 for(const mode of ['member_disabled','bank_version','prepaid_version','audit','revoked_proof']){
  const f=fixture();try{
   const p=await f.submit(f.topup());
   if(mode==='member_disabled')stmt(f.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",member);
   if(mode==='bank_version')stmt(f.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',bank);
   if(mode==='prepaid_version')stmt(f.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',prepaid);
   if(mode==='audit')f.sql.exec("CREATE TRIGGER injected_prepaid_failure BEFORE INSERT ON family_prepaid_action_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FAULT'); END;");
   if(mode==='revoked_proof')f.revokeProof();
   assert.notEqual((await f.execute(p)).status,200,mode);
   assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0,mode);
   assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_prepaid_balance_journal').n,0,mode);
   assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_prepaid_actions_applied').n,0,mode);
  }finally{f.close()}
 }
 const f=fixture();try{
  const bad=await f.call(['prepaid-actions'],{...f.topup(),statement_confirmed:false});
  assert.equal(bad.status,400);
  const future=await f.call(['prepaid-actions'],{...f.topup(),date:'2031-10-01'});
  assert.equal(future.status,400);
  const invalidOwner=await f.call(['prepaid-actions'],{...f.topup(),expected_user_id:owner});
  assert.equal(invalidOwner.status,403);
 }finally{f.close()}
});


test('new stable-ID prepaid balance is household-shared and never aliases unowned legacy Suica names',async()=>{
 const f=fixture();try{
  const before=await memberPrepaidBalances(f.env.DB,household);
  assert.equal(before.total_jpy,0);
  assert.deepEqual(before.accounts.map(x=>x.account_id),[prepaid]);
  assert.equal(before.accounts[0].owner_user_id,member);
  assert.equal(before.accounts[0].identity_basis,'member_created_stable_id');
  const id=await f.submit(f.topup('user-verified-bank-ref',1000));
  assert.equal((await f.execute(id)).status,200);
  const snapshot=await memberPrepaidBalances(f.env.DB,household);
  assert.equal(snapshot.total_jpy,1000);
  assert.equal(snapshot.accounts.length,1);
  assert.equal(snapshot.accounts[0].balance_jpy,1000);
  assert.equal(snapshot.ledger_changed,false);
  // Household reads are identical for either member; only stable ownership decides labels.
  const ownerView=await memberPrepaidBalances(f.env.DB,household);
  assert.deepEqual(ownerView,snapshot);
  assert.deepEqual((await memberPrepaidBalances(f.env.DB,'another-household')).accounts,[]);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,0);
 }finally{f.close()}
});
