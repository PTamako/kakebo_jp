import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,webcrypto} from 'node:crypto';
import {familyCardSettlements} from '../functions/api/family-finance/card-settlements.js';
import {approvedCardSettlementRoute} from '../functions/api/internal/card-settlements/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222';
const card='a'.repeat(32),bank='b'.repeat(32),household='primary';
const approval='55555555-5555-4555-8555-555555555555';
const purchaseA='11111111-1111-4111-8111-111111111112',purchaseB='11111111-1111-4111-8111-111111111113';
const keys={pending:'1'.repeat(64),submission:'2'.repeat(64),execution:'3'.repeat(64),proof:'4'.repeat(64)};
const sign=(domain,secret,stamp,raw)=>createHmac('sha256',Buffer.from(secret,'hex')).update(domain+'\n'+stamp+'\n'+raw).digest('hex');
const stmt=(s,q,...args)=>s.prepare(q).run(...args);
const query=(s,q,...args)=>s.prepare(q).get(...args);
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT,'+
  'family_transfer_target_account_id TEXT);');
 for(const f of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql']){
  const migration=readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8');
  sql.exec(migration);sql.exec(migration);
 }
 for(const [user,role] of [[owner,'owner'],[member,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   user,household,role,role,'active',Date.now());
 for(const [id,kind,day] of [[card,'credit_card',10],[bank,'bank',null]])
  stmt(sql,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,closing_day,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)',
   id,household,member,kind,kind,'member_created',day,member,member);
 for(const [req,proposal,amt,date,month] of [
  [purchaseA,'c'.repeat(32),1000,'2026-11-14','2026-12'],
  [purchaseB,'d'.repeat(32),500,'2026-10-14','2026-11']]){
  stmt(sql,"INSERT INTO family_card_purchase_intents(request_id,household_id,requester_user_id,account_id,account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
   proposal,household,member,card,1,'f'.repeat(64),'encrypted','iv',proposal.padEnd(64,'1'),req,Date.now()-2000,Date.now()+86400000,Date.now());
  stmt(sql,"INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,family_account_id) VALUES(?,'',?,'食費','Store','','','expense',?,?,?)",
   date,amt,'hfcard:'+req,'cc:'+card,card);
  const entry=query(sql,'SELECT id FROM entries WHERE client_request_id=?','hfcard:'+req).id;
  stmt(sql,'INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
   req,proposal,household,member,owner,card,1,'f'.repeat(64),'hfcard:'+req,entry,amt,date,month,Date.now());
 }
 const db={prepare(q){return{bind(...params){return{
   first:async()=>sql.prepare(q).get(...params)||null,
   all:async()=>({results:sql.prepare(q).all(...params)}),
   run:async()=>({meta:{changes:sql.prepare(q).run(...params).changes}}),
   sync:()=>({meta:{changes:sql.prepare(q).run(...params).changes}})
 };}}},async batch(list){sql.exec('BEGIN IMMEDIATE');try{
   const r=list.map(x=>x.sync());sql.exec('COMMIT');return r;
  }catch(e){sql.exec('ROLLBACK');throw e}}
 };
 let active=true;
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_CARD_SETTLEMENTS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_CARD_SETTLEMENT_EXECUTION_SECRET:keys.execution,
  KAKEIBO_CARD_SETTLEMENT_PROOF_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 const calls={submission:0,proof:0};
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const url=new URL(req.url),raw=await req.text(),stamp=req.headers.get('x-approval-timestamp');
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-card-settlement');
  if(url.pathname.endsWith('card-settlement-submit')){
   calls.submission++;
   assert.equal(req.headers.get('x-approval-signature'),
    sign('kakeibo-card-settlement:submit',keys.submission,stamp,raw));
   const b=JSON.parse(raw);
   assert.equal(b.household_id,household);
   return Response.json({ok:true,approval_id:approval,resource_id:b.resource_id,
    payload_sha256:b.payload_sha256,household_id:b.household_id,
    requester_user_id:b.requester_user_id,expected_version:b.expected_version,
    status:'pending',applied:false});
  }
  calls.proof++;
  assert.equal(url.pathname,'/api/internal/approvals/verify');
  assert.equal(req.headers.get('x-approval-signature'),
   sign('kakeibo-card-settlement:execution-proof',keys.proof,stamp,raw));
  if(!active)return Response.json({error:'disabled'},{status:409});
  const b=JSON.parse(raw);
  assert.equal(b.idempotency_key,'kakeibo:cardsettle:'+b.resource_id);
  assert.equal(b.expected_version,1);assert.equal(b.execution_nonce,'f'.repeat(64));
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.credit_card.settlement',resource_type:'credit_card_settlement',
   request_id:b.request_id,resource_id:b.resource_id,household_id:b.household_id,
   requester_user_id:b.requester_user_id,payload_sha256:b.payload_sha256,
   idempotency_key:b.idempotency_key,expected_version:1,approver_user_id:owner,
   approved_at:Date.now()-1000,expires_at:Date.now()+120000,applied:false});
 }};
 const user={user_id:member,household_id:household,role:'member'};
 const url=new URL('https://kakeibo.example.test/api/family-finance/card-settlements');
 const input={expected_user_id:member,idempotency_key:'card-settlement-20261118-1',
  card_account_id:card,card_version:1,bank_account_id:bank,bank_version:1,
  debit_date:'2026-11-14',amount_jpy:1200,
  bank_reference:'real-bank-transaction-reference-1848',statement_confirmed:true,
  allocations:[{purchase_request_id:purchaseA,amount_jpy:800},
   {purchase_request_id:purchaseB,amount_jpy:400}]};
 const source=async(parts=['card-settlements'],method='POST',body=input,actor=user)=>{
  const req=new Request(url,{method,headers:method==='POST'?{
   origin:url.origin,'content-type':'application/json'}:{},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const response=await familyCardSettlements(req,env,url,actor,parts);
  return {status:response.status,data:await response.json()};
 };
 const send=async(mode,b,opts={})=>{
  const wire=mode==='execute'?{...b,execution_nonce:'f'.repeat(64)}:b;
  const raw=JSON.stringify(wire),stamp=String(Date.now());
  const req=new Request('https://kakeibo.internal/api/internal/card-settlements/'+mode,{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'homeflow','x-approval-timestamp':stamp,
    'x-approval-signature':opts.badSignature?'0'.repeat(64):
      sign('homeflow:card-settlement-'+mode,keys.execution,stamp,raw),
    ...(opts.origin?{origin:'https://evil.example.test'}:{})},body:raw});
  const r=await approvedCardSettlementRoute(req,env,[mode]);
  return {status:r.status,data:await r.json()};
 };
 const flow=async()=>{
  const p=await source();
  assert.equal(p.status,201,JSON.stringify(p));
  const s=await source(['card-settlements',p.data.prepared.request_id,'submit'],'POST',{expected_user_id:member});
  assert.equal(s.status,200,JSON.stringify(s));
  return {proposal:p.data.prepared.request_id,b:{
   request_id:approval,resource_id:p.data.prepared.request_id,
   household_id:household,requester_user_id:member,payload_sha256:p.data.prepared.payload_sha256}};
 };
 return {sql,env,source,send,flow,input,calls,disableProof(){active=false},close(){sql.close()}};
}
test('encrypted bank settlement proposal requires explicit evidence and member-owned stable account IDs',async()=>{
 const f=fixture();try{
  const bad=await f.source(['card-settlements'],'POST',{...f.input,statement_confirmed:false});
  assert.equal(bad.status,400);assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_card_settlement_intents').n,0);
  const other=await f.source(['card-settlements'],'POST',{...f.input,expected_user_id:owner});
  assert.equal(other.status,403);
  const prepared=await f.source();
  assert.equal(prepared.status,201,JSON.stringify(prepared));
  const intent=query(f.sql,'SELECT * FROM family_card_settlement_intents');
  assert.equal(intent.payload_sha256,prepared.data.prepared.payload_sha256);
  assert.equal(intent.payload_cipher.includes('real-bank-transaction-reference'),false);
  assert.equal(JSON.stringify(prepared.data).includes('real-bank-transaction-reference'),false);
  const replay=await f.source();assert.equal(replay.status,200);
  assert.equal(replay.data.replayed,true);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,2);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0);
 }finally{f.close()}
});
test('real SQLite target records one bank transfer and allocates cross-month partial balances without second expense',async()=>{
 const f=fixture();try{
  const {b}=await f.flow();
  assert.equal((await f.send('receipt',b)).status,404);
  const denied=await f.send('execute',b,{badSignature:true});
  assert.equal(denied.status,403);
  assert.equal((await f.send('execute',b,{origin:true})).status,403);
  const applied=await f.send('execute',b);
  assert.equal(applied.status,200,JSON.stringify(applied));
  assert.equal(applied.data.applied,true);assert.equal(applied.data.actor_user_id,owner);
  assert.equal(applied.data.debit_date,'2026-11-14');
  assert.equal(query(f.sql,"SELECT SUM(amount) v FROM entries WHERE type='expense'").v,1500);
  const transfer=query(f.sql,"SELECT * FROM entries WHERE type='transfer'");
  assert.equal(transfer.amount,1200);assert.equal(transfer.family_account_id,bank);
  assert.equal(transfer.family_transfer_target_account_id,card);
  assert.equal(transfer.date,'2026-11-14');
  assert.equal(query(f.sql,'SELECT SUM(amount_jpy) v FROM family_card_settlement_allocations').v,1200);
  assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_card_settlement_audit').n,1);
  const receipt=await f.send('receipt',b);
  assert.equal(receipt.status,200);assert.equal(receipt.data.already_applied,true);
  const duplicate=await f.send('execute',b);
  assert.equal(duplicate.status,200);assert.equal(duplicate.data.already_applied,true);
  assert.equal(f.calls.proof,1,'replay cannot obtain new execution proof');
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,1);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,2);
 }finally{f.close()}
});
test('proof revocation, account CAS changes, missing flag and audit failure are fail closed',async()=>{
 for(const mode of ['revoked','card_version','bank_version','flag','audit']){
  const f=fixture();try{
   const {b}=await f.flow();
   if(mode==='revoked')f.disableProof();
   if(mode==='card_version')stmt(f.sql,'UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?',card);
   if(mode==='bank_version')stmt(f.sql,'UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?',bank);
   if(mode==='flag')f.env.KAKEIBO_CARD_SETTLEMENTS_ENABLED='false';
   if(mode==='audit')f.sql.exec("CREATE TRIGGER fail_card_settlement_audit BEFORE INSERT ON family_card_settlement_audit BEGIN SELECT RAISE(ABORT,'INJECTED_AUDIT_FAILURE'); END;");
   const denied=await f.send('execute',b);
   assert.notEqual(denied.status,200,JSON.stringify({mode,denied}));
   assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0,mode);
   assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_card_bank_debit_evidence').n,0,mode);
   assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_card_settlements_applied').n,0,mode);
   assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_card_settlement_allocations').n,0,mode);
  }finally{f.close()}
 }
});
test('overpayment or duplicate bank reference fails as a single rolled back D1 batch',async()=>{
 const f=fixture();try{
  const {b}=await f.flow();
  // A separate approved cash allocation consumes a portion before this approval executes.
  f.sql.exec("CREATE TRIGGER reject_duplicate_bank_debit BEFORE INSERT ON family_card_bank_debit_evidence BEGIN SELECT RAISE(ABORT,'DUPLICATE_EXTERNAL_DEBIT'); END;");
  const denied=await f.send('execute',b);
  assert.notEqual(denied.status,200);
  assert.equal(query(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='transfer'").n,0);
  assert.equal(query(f.sql,'SELECT COUNT(*) n FROM family_card_settlements_applied').n,0);
 }finally{f.close()}
});
