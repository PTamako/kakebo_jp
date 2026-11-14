import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// Draft P0-4 settlement *accounting* regression. No real bank API, OAuth,
// HomeFlow Service Binding, or production Cloudflare D1 is called.
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const household='primary',card='a'.repeat(32),bank='b'.repeat(32);
const purchaseA='11111111-1111-4111-8111-111111111112';
const purchaseB='11111111-1111-4111-8111-111111111113';
const settlementA='33333333-3333-4333-8333-333333333333';
const settlementB='33333333-3333-4333-8333-333333333334';
const now=Date.now();
const stmt=(s,q,...args)=>s.prepare(q).run(...args);
const one=(s,q,...args)=>s.prepare(q).get(...args);
function schema(){
 const s=new DatabaseSync(':memory:');
 s.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql']){
  s.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 }
 s.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT,'+
  'family_transfer_target_account_id TEXT);');
 s.exec(readFileSync(new URL('../migrations/0031_family_card_purchase_execution.sql',import.meta.url),'utf8'));
 const mig=readFileSync(new URL('../migrations/0032_family_card_settlement_foundation.sql',import.meta.url),'utf8');
 s.exec(mig);s.exec(mig);
 for(const [user,role] of [[owner,'owner'],[member,'member']])
  stmt(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   user,household,role,role,'active',now);
 for(const [id,kind,day] of [[card,'credit_card',10],[bank,'bank',null]])
  stmt(s,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,closing_day,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)',
   id,household,member,kind,kind,'member_created',day,member,member);
 return s;
}
function purchase(s,requestId,proposalId,amount,date,billMonth){
 const digest='f'.repeat(64);
 stmt(s,"INSERT INTO family_card_purchase_intents(request_id,household_id,requester_user_id,account_id,account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
  proposalId,household,member,card,1,digest,'sealed','iv',proposalId.padEnd(64,'1'),requestId,now-1000,now+86400000,now);
 stmt(s,"INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,family_account_id) VALUES(?,'',?,'食費','Store','','','expense',?,?,?)",
  date,amount,'hfcard:'+requestId,'cc:'+card,card);
 const entry=one(s,"SELECT id FROM entries WHERE client_request_id=?", 'hfcard:'+requestId).id;
 stmt(s,"INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  requestId,proposalId,household,member,owner,card,1,digest,
  'hfcard:'+requestId,entry,amount,date,billMonth,now);
}
function prepare(s,requestId,proposalId){
 stmt(s,"INSERT INTO family_card_settlement_intents(request_id,household_id,requester_user_id,card_account_id,card_version,bank_account_id,bank_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
  proposalId,household,member,card,1,bank,1,'f'.repeat(64),
  'encrypted','iv',proposalId.padEnd(64,'a'),requestId,now-2000,now+86400000,now);
}
function debit(s,requestId,id,ref,amount,date='2026-11-18'){
 stmt(s,"INSERT INTO family_card_bank_debit_evidence(evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,'owner_confirmed_statement',?)",
  id,household,bank,1,ref, date,amount,now);
 stmt(s,"INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) VALUES(?,'',?,'投資・資産移動','カード引落','','','transfer',?,1,?,?,?,?,?)",
  date,amount,'cc:'+card,date,'hfcardsettle:'+requestId,'bank:'+bank,bank,card);
 return one(s,'SELECT id FROM entries WHERE client_request_id=?','hfcardsettle:'+requestId).id;
}
function apply(s,requestId,proposalId,evidenceId,entry,amount,date='2026-11-18'){
 stmt(s,"INSERT INTO family_card_settlements_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,card_account_id,card_version,bank_account_id,bank_version,payload_sha256,evidence_id,transfer_entry_id,amount_jpy,debit_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  requestId,proposalId,household,member,owner,owner,card,1,bank,1,
  'f'.repeat(64),evidenceId,entry,amount,date,now);
}
function alloc(s,requestId,purchaseId,amount){
 stmt(s,'INSERT INTO family_card_settlement_allocations(homeflow_request_id,purchase_request_id,amount_jpy) VALUES(?,?,?)',
  requestId,purchaseId,amount);
}
function audit(s,requestId){
 stmt(s,"INSERT INTO family_card_settlement_audit(event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?,'credit_card_bank_settlement_applied',?)",
  crypto.randomUUID(),requestId,member,owner,owner,now);
}
function seed(s){
 purchase(s,purchaseA,'c'.repeat(32),1000,'2026-11-14','2026-12');
 purchase(s,purchaseB,'d'.repeat(32),500,'2026-10-14','2026-11');
}
test('schema is replayable; real card charges stay expenses while bank payment is a transfer',()=>{
 const s=schema();try{
  seed(s);
  assert.equal(one(s,"SELECT SUM(amount) v FROM entries WHERE type='expense'").v,1500);
  prepare(s,settlementA,'e'.repeat(32));
  const entry=debit(s,settlementA,'1'.repeat(32),'2'.repeat(64),1200);
  s.exec('BEGIN IMMEDIATE');
  try{
   apply(s,settlementA,'e'.repeat(32),'1'.repeat(32),entry,1200);
   alloc(s,settlementA,purchaseA,800);
   alloc(s,settlementA,purchaseB,400);
   audit(s,settlementA);
   s.exec('COMMIT');
  }catch(e){s.exec('ROLLBACK');throw e}
  assert.equal(one(s,"SELECT SUM(amount) v FROM entries WHERE type='expense'").v,1500);
  assert.equal(one(s,"SELECT SUM(amount) v FROM entries WHERE type='transfer'").v,1200);
  assert.equal(one(s,'SELECT SUM(amount_jpy) v FROM family_card_settlement_allocations').v,1200);
  assert.equal(one(s,'SELECT SUM(amount_jpy) v FROM family_card_purchase_applied').v,1500);
  assert.equal(one(s,'SELECT COUNT(*) n FROM family_card_settlement_audit').n,1);
  assert.throws(()=>stmt(s,'UPDATE entries SET amount=999 WHERE id=?',entry),/CARD_BANK_DEBIT_ENTRY_IMMUTABLE/);
  assert.throws(()=>stmt(s,'UPDATE entries SET amount=999 WHERE client_request_id=?','hfcard:'+purchaseA),/CARD_PURCHASE_ENTRY_IMMUTABLE/);
  assert.throws(()=>stmt(s,'DELETE FROM family_card_settlement_allocations'),/IMMUTABLE/);
  assert.throws(()=>stmt(s,'DELETE FROM family_card_bank_debit_evidence'),/IMMUTABLE/);
 }finally{s.close()}
});
test('overpay/duplicate source evidence/duplicate settlement ID fail closed',()=>{
 const s=schema();try{
  seed(s);
  prepare(s,settlementA,'e'.repeat(32));
  const entry=debit(s,settlementA,'1'.repeat(32),'2'.repeat(64),1200);
  apply(s,settlementA,'e'.repeat(32),'1'.repeat(32),entry,1200);
  alloc(s,settlementA,purchaseA,1000);
  alloc(s,settlementA,purchaseB,200);
  audit(s,settlementA);
  assert.throws(()=>alloc(s,settlementA,purchaseB,400),/UNIQUE constraint failed/);
  assert.throws(()=>stmt(s,"INSERT INTO family_card_bank_debit_evidence(evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,'statement_import',?)",
   '3'.repeat(32),household,bank,1,'2'.repeat(64),'2026-11-18',200,now),/UNIQUE constraint failed/);
  prepare(s,settlementB,'9'.repeat(32));
  const second=debit(s,settlementB,'4'.repeat(32),'5'.repeat(64),400);
  apply(s,settlementB,'9'.repeat(32),'4'.repeat(32),second,400);
  assert.throws(()=>alloc(s,settlementB,purchaseB,400),/CARD_SETTLEMENT_OVERPAY_OR_WRONG_ACCOUNT/);
  assert.throws(()=>audit(s,settlementB),/CARD_SETTLEMENT_ALLOCATION_TOTAL_OR_AUDIT/);
 }finally{s.close()}
});
test('no invented bank date, wrong source bank, or revoked account version can create applied settlement',()=>{
 for(const fault of ['date','source','version']){
  const s=schema();try{
   seed(s);
   prepare(s,settlementA,'e'.repeat(32));
   const entry=debit(s,settlementA,'1'.repeat(32),'2'.repeat(64),1200);
   if(fault==='date'){
    assert.throws(()=>apply(s,settlementA,'e'.repeat(32),'1'.repeat(32),entry,1200,'2026-11-19'),/CARD_SETTLEMENT_DEBIT_NOT_MATCHED/);
   }else if(fault==='source'){
    stmt(s,'UPDATE entries SET family_account_id=NULL WHERE id=?',entry);
    assert.throws(()=>apply(s,settlementA,'e'.repeat(32),'1'.repeat(32),entry,1200),/CARD_SETTLEMENT_DEBIT_NOT_MATCHED/);
   }else{
    stmt(s,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',card);
    assert.throws(()=>apply(s,settlementA,'e'.repeat(32),'1'.repeat(32),entry,1200),/CARD_SETTLEMENT_DEBIT_NOT_MATCHED/);
   }
   assert.equal(one(s,'SELECT COUNT(*) n FROM family_card_settlements_applied').n,0);
  }finally{s.close()}
 }
});
