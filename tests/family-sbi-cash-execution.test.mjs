import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac,webcrypto} from 'node:crypto';
import {familySbiCashActions} from '../functions/api/family-finance/sbi-cash-actions.js';
import {approvedSbiCashRoute} from '../functions/api/internal/sbi-cash-actions/[[path]].js';
import {memberSbiCashPositions} from '../functions/api/family-finance/sbi-cash-lot-projection.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const household='primary',bank='b'.repeat(32),securities='c'.repeat(32);
const approval='55555555-5555-4555-8555-555555555555';
const keys={pending:'1'.repeat(64),submission:'2'.repeat(64),
 execution:'3'.repeat(64),proof:'4'.repeat(64)};
const sign=(domain,key,stamp,raw)=>createHmac('sha256',Buffer.from(key,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex');
const stmt=(db,sql,...values)=>db.prepare(sql).run(...values);
const read=(db,sql,...values)=>db.prepare(sql).get(...values);
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('PRAGMA foreign_keys=ON;');
 for(const x of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0027_family_legacy_entry_link_audit.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+x,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 for(const x of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql','0034_family_points_foundation.sql',
  '0035_points_prepaid_atomic.sql','0036_points_card_offset.sql',
  '0037_points_transfer_exchange.sql','0038_points_earn_expiry_reversals.sql',
  '0039_points_legacy_provenance.sql','0040_points_sbi_lots.sql',
  '0041_points_transfer_atomic_refund.sql','0042_points_prepaid_refund.sql',
  '0043_points_card_offset_refund.sql','0044_sbi_cash_purchases.sql']){
  const migration=readFileSync(new URL('../migrations/'+x,import.meta.url),'utf8');
  sql.exec(migration);
  if(x==='0044_sbi_cash_purchases.sql')sql.exec(migration); // migration replay
 }
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,household,role,role,'active',Date.now());
 for(const [account,kind,opening] of [[bank,'bank',3000],[securities,'securities',0]])
  stmt(sql,'INSERT INTO family_financial_accounts '+
   '(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,created_by_user_id,updated_by_user_id) '+
   'VALUES(?,?,?,?,?,?,?,?,?)',account,household,member,kind,kind,'member_created',opening,member,member);
 const db={prepare(q){return {bind(...values){return {
  first:async()=>sql.prepare(q).get(...values)||null,
  all:async()=>({results:sql.prepare(q).all(...values)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...values).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...values).changes}})
 };}}},async batch(commands){
  sql.exec('BEGIN IMMEDIATE');
  try{const result=commands.map(x=>x.sync());sql.exec('COMMIT');return result;}
  catch(e){sql.exec('ROLLBACK');throw e;}
 }};
 let proofActive=true;
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_SBI_CASH_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_SBI_CASH_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_SBI_CASH_EXECUTION_SECRET:keys.execution,
  KAKEIBO_SBI_CASH_PROOF_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 const calls={submission:0,proof:0};
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const url=new URL(req.url),raw=await req.text(),stamp=req.headers.get('x-approval-timestamp');
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-sbi-cash');
  if(url.pathname.endsWith('sbi-cash-submit')){
   calls.submission++;
   assert.equal(req.headers.get('x-approval-signature'),sign('kakeibo-sbi-cash:submit',keys.submission,stamp,raw));
   const b=JSON.parse(raw);
   return Response.json({ok:true,approval_id:approval,resource_id:b.resource_id,
    payload_sha256:b.payload_sha256,household_id:b.household_id,
    requester_user_id:b.requester_user_id,expected_version:b.expected_version,
    operation:'finance.sbi_cash.'+b.kind,status:'pending',applied:false});
  }
  calls.proof++;
  assert.equal(url.pathname,'/api/internal/approvals/verify');
  assert.equal(req.headers.get('x-approval-signature'),sign('kakeibo-sbi-cash:execution-proof',keys.proof,stamp,raw));
  if(!proofActive)return Response.json({error:'revoked'},{status:409});
  const b=JSON.parse(raw);
  assert.equal(b.idempotency_key,'kakeibo:sbi-cash:'+b.resource_id);
  assert.equal(b.execution_nonce,'f'.repeat(64));
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.sbi_cash.'+read(sql,'SELECT kind FROM family_sbi_cash_intents WHERE request_id=?',b.resource_id).kind,
   resource_type:'sbi_cash_action',
   request_id:b.request_id,resource_id:b.resource_id,household_id:b.household_id,
   requester_user_id:b.requester_user_id,payload_sha256:b.payload_sha256,
   idempotency_key:b.idempotency_key,expected_version:1,approver_user_id:owner,
   approved_at:Date.now()-1000,expires_at:Date.now()+120000,applied:false});
 }};
 const user={user_id:member,household_id:household,role:'member'};
 const url=new URL('https://kakeibo.example.test/api/family-finance/sbi-cash-actions');
 const input={expected_user_id:member,idempotency_key:'cash-sbi-real-20261115-001',
  bank_account_id:bank,bank_version:1,securities_account_id:securities,
  securities_version:1,kind:'tsumitate',debit_date:'2026-11-12',
  trade_date:'2026-11-13',effective_date:'2026-11-14',amount_jpy:1500,
  bank_reference:'bank-real-20261112-001',broker_trade_reference:'sbi-trade-20261113-001',
  fund_code:'1234ABCD',account_type:'tsumitate',confirmed_units:1234500,
  bank_debit_confirmed:true,broker_execution_attested:true};
 const source=async (parts=['sbi-cash-actions'],body=input,actor=user)=>{
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)});
  const res=await familySbiCashActions(req,env,url,actor,parts);
  return {status:res.status,data:await res.json()};
 };
 const target=async(mode,b,{badSign=false}={})=>{
  const wire=mode==='execute'?{...b,execution_nonce:'f'.repeat(64)}:b;
  const raw=JSON.stringify(wire),stamp=String(Date.now());
  const req=new Request('https://kakeibo.internal/api/internal/sbi-cash-actions/'+mode,{
   method:'POST',headers:{'content-type':'application/json','x-approval-client':'homeflow',
    'x-approval-timestamp':stamp,'x-approval-signature':badSign?'0'.repeat(64):
     sign('homeflow:sbi-cash-'+mode,keys.execution,stamp,raw)},body:raw});
  const res=await approvedSbiCashRoute(req,env,[mode]);
  return {status:res.status,data:await res.json()};
 };
 const prepare=async()=>{const result=await source();assert.equal(result.status,201,JSON.stringify(result));
  const submit=await source(['sbi-cash-actions',result.data.prepared.request_id,'submit'],
   {expected_user_id:member});
  assert.equal(submit.status,200,JSON.stringify(submit));
  return {request_id:approval,resource_id:result.data.prepared.request_id,household_id:household,
   requester_user_id:member,payload_sha256:result.data.prepared.payload_sha256};
 };
 return {sql,db,env,calls,input,source,target,prepare,disableProof(){proofActive=false},close(){sql.close();}};
}
test('SBI cash confirmed tsumitate: encrypted pending -> signed approved atomic bank transfer and immutable lot',async()=>{
 const f=fixture();try{
  const bad=await f.source(undefined,{...f.input,broker_execution_attested:false});
  assert.equal(bad.status,400);
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM entries').n,0);
  const b=await f.prepare();
  const i=read(f.sql,'SELECT * FROM family_sbi_cash_intents');
  assert.equal(i.payload_cipher.includes('sbi-trade-20261113'),false);
  assert.equal(JSON.stringify(i).includes(f.input.broker_trade_reference),false);
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM entries').n,0);
  const pending=await f.target('receipt',b);assert.equal(pending.status,404);
  const forbidden=await f.target('execute',b,{badSign:true});assert.equal(forbidden.status,403);
  const done=await f.target('execute',b);
  assert.equal(done.status,200,JSON.stringify(done));assert.equal(done.data.applied,true);
  assert.equal(done.data.amount_jpy,1500);assert.equal(done.data.confirmed_units,1234500);
  assert.equal(done.data.broker_reconciled,false);
  assert.equal(done.data.included_in_tracked_assets_jpy,false);
  const transfer=read(f.sql,"SELECT * FROM entries WHERE type='transfer'");
  assert.equal(transfer.amount,1500);assert.equal(transfer.family_account_id,bank);
  assert.equal(transfer.family_transfer_target_account_id,securities);
  assert.equal(transfer.date,'2026-11-12');assert.equal(transfer.transfer_date,'2026-11-14');
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM family_sbi_cash_lots').n,1);
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM family_sbi_cash_audit').n,1);
  assert.equal(read(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,0);
  assert.throws(()=>stmt(f.sql,'DELETE FROM family_sbi_cash_lots'));
  assert.throws(()=>stmt(f.sql,"UPDATE family_sbi_cash_lots SET confirmed_units=1"));
  const view=await memberSbiCashPositions(f.db,household);
  assert.equal(view.positions[0].confirmed_units,1234500);
  assert.equal(view.included_in_tracked_assets_jpy,false);
  const again=await f.target('receipt',b);
  assert.equal(again.status,200);assert.equal(again.data.already_applied,true);
  const retry=await f.target('execute',b);
  assert.equal(retry.status,200);assert.equal(retry.data.already_applied,true);
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM entries').n,1);
  assert.equal(f.calls.proof,1);
 }finally{f.close();}
});
test('SBI cash fails closed for bank version drift, revocation, overdraft and audit failure',async()=>{
 for(const mode of ['version','revoked','overdraft','audit']){
  const f=fixture();try{
   const b=await f.prepare();
   if(mode==='version')stmt(f.sql,'UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?',bank);
   if(mode==='revoked')f.disableProof();
   if(mode==='overdraft')stmt(f.sql,'UPDATE family_financial_accounts SET opening_balance=1000 WHERE account_id=?',bank);
   if(mode==='audit')f.sql.exec("CREATE TRIGGER fail_sbi_cash_audit BEFORE INSERT ON family_sbi_cash_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE'); END;");
   const result=await f.target('execute',b);
   assert.notEqual(result.status,200,mode);
   for(const t of ['entries','family_sbi_cash_bank_evidence','family_sbi_cash_applied',
    'family_sbi_cash_lots','family_sbi_cash_audit'])
    assert.equal(read(f.sql,'SELECT COUNT(*) n FROM '+t).n,0,t+' '+mode);
  }finally{f.close();}
 }
});
test('one bank debit and one broker execution can only create one cash lot; no new income or double-valued holdings',async()=>{
 const f=fixture();try{
  const b=await f.prepare();assert.equal((await f.target('execute',b)).status,200);
  const second=await f.source(undefined,{...f.input,
   idempotency_key:'cash-sbi-real-20261115-002',broker_trade_reference:'sbi-trade-20261113-002'});
  assert.equal(second.status,201);
  const duplicateBank=read(f.sql,'SELECT reference_hash FROM family_sbi_cash_bank_evidence');
  assert.equal(typeof duplicateBank.reference_hash,'string');
  const fresh=await f.source(undefined,{...f.input,
   idempotency_key:'cash-sbi-real-20261115-003',bank_reference:'bank-real-20261112-003'});
  assert.equal(fresh.status,201);
  // Both pending intents remain unposted; identity and evidence can never auto-mint lots.
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM family_sbi_cash_lots').n,1);
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM entries').n,1);
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,0);
 }finally{f.close();}
});

test('confirmed SBI additional buy is NOT auto-classified as regular 積立 and keeps actual effective date',async()=>{
 const f=fixture();try{
  const input={...f.input,kind:'additional',account_type:'growth',
   idempotency_key:'cash-sbi-additional-20261115-004'};
  const prepared=await f.source(undefined,input);
  assert.equal(prepared.status,201,JSON.stringify(prepared));
  const submitted=await f.source(['sbi-cash-actions',prepared.data.prepared.request_id,'submit'],
   {expected_user_id:member});
  assert.equal(submitted.status,200,JSON.stringify(submitted));
  const b={request_id:approval,resource_id:prepared.data.prepared.request_id,household_id:household,
   requester_user_id:member,payload_sha256:prepared.data.prepared.payload_sha256};
  const done=await f.target('execute',b);
  assert.equal(done.status,200,JSON.stringify(done));
  assert.equal(done.data.kind,'additional');
  assert.equal(done.data.account_type,'growth');
  const row=read(f.sql,"SELECT note,category,date,transfer_date FROM entries WHERE type='transfer'");
  assert.equal(row.note,'追加買付');
  assert.equal(row.date,'2026-11-12');
  assert.equal(row.transfer_date,'2026-11-14');
  assert.equal(read(f.sql,'SELECT kind FROM family_sbi_cash_lots').kind,'additional');
  assert.equal(read(f.sql,'SELECT COUNT(*) n FROM family_sbi_cash_lots').n,1);
 }finally{f.close();}
});
