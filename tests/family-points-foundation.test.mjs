import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {pointAccountingPlan} from '../functions/api/family-finance/point-accounting.js';
import {memberPointsBalances} from '../functions/api/family-finance/points-balance-projection.js';
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const household='primary',account='a'.repeat(32),otherAccount='b'.repeat(32),prepaid='c'.repeat(32);
const date=Date.now(),digest='f'.repeat(64);
const run=(s,q,...args)=>s.prepare(q).run(...args);
const get=(s,q,...args)=>s.prepare(q).get(...args);
function fixture(){
 const s=new DatabaseSync(':memory:');s.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  s.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 s.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 for(const name of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql'])
  s.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const migration=readFileSync(new URL('../migrations/0034_family_points_foundation.sql',import.meta.url),'utf8');
 s.exec(migration);s.exec(migration);
 for(const name of ['0035_points_prepaid_atomic.sql','0036_points_card_offset.sql',
  '0037_points_transfer_exchange.sql','0038_points_earn_expiry_reversals.sql'])
  s.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 for(const [id,role] of [[owner,'owner'],[member,'member'],[other,'member']])
  run(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   id,household,role,role,'active',date);
 for(const [id,kind,u] of [[account,'points',member],[otherAccount,'points',other],[prepaid,'prepaid',member]])
  run(s,"INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,'member_created',?,?)",
   id,household,u,kind,kind,u,u);
 run(s,"INSERT INTO entries(id,amount,type,client_request_id) VALUES(1,1000,'expense','old-expense')");
 return s;
}
let seq=0;
function intent(s,{user=member,acc=account,kind='earn_campaign',ver=1}={}){
 const n=String(++seq).padStart(32,'0');
 const approval='77777777-7777-4777-8777-'+n.slice(-12);
 run(s,"INSERT INTO family_points_intents(request_id,household_id,requester_user_id,points_account_id,expected_version,operation,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
  n,household,user,acc,ver,kind,digest,'sealed','iv',n.padEnd(64,'b'),approval,date-1000,date+86400000,date);
 return {n,approval,kind,acc,user};
}
function post(s,p,{units=100,after=100,operation=p.kind,ref='1'.repeat(64),entry=null,
  target=null,reverse=null,value=100,numer=1,denom=1,approver=owner,actor=owner}={}){
 run(s,'INSERT INTO family_points_journal(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,points_account_id,account_version,operation,delta_units,balance_after_units,yen_value,yen_per_unit_numerator,yen_per_unit_denominator,target_account_id,linked_entry_id,source_reference_hash,reversed_request_id,payload_sha256,effective_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  p.approval,p.n,household,p.user,approver,actor,p.acc,1,operation,units,after,value,numer,denom,target,entry,ref,reverse,digest,'2026-11-14',date);
}
test('points pure semantics: purchase/bonus are noncash, redemptions never create second expense',()=>{
 for(const operation of ['earn_purchase','earn_campaign']){
  const p=pointAccountingPlan({operation,units:100,rate_numerator:1,rate_denominator:1,
   yen_value:100,source_reference_hash:digest});
  assert.equal(p.ok,true);assert.equal(p.delta_units,100);
  assert.equal(p.household_cash_income_delta_jpy,0);assert.equal(p.new_household_expense_entry,false);
 }
 for(const operation of ['redeem_discount','redeem_purchase']){
  const p=pointAccountingPlan({operation,units:100,rate_numerator:1,rate_denominator:1,
    yen_value:100,linked_entry_id:1});
  assert.equal(p.ok,true);assert.equal(p.delta_units,-100);
  assert.equal(p.existing_purchase_entry_id,1);assert.equal(p.new_household_expense_entry,false);
 }
 assert.equal(pointAccountingPlan({operation:'earn_campaign',units:5,
  rate_numerator:1,rate_denominator:2,yen_value:3,source_reference_hash:digest}).code,
  'POINT_RATE_OR_JPY_MISMATCH');
});
test('point topup/card offsets/SBI investments stay noncash with explicit target',()=>{
 for(const [operation,kind,key] of [['transfer_prepaid','prepaid','prepaid_credit_jpy'],
  ['offset_card','credit_card','liability_offset_jpy'],
  ['redeem_asset','securities','investment_point_funding_jpy']]){
  const p=pointAccountingPlan({operation,units:250,rate_numerator:1,
   rate_denominator:1,yen_value:250,points_account_id:account,
   target_account_id:prepaid,target_account_kind:kind});
  assert.equal(p.ok,true);assert.equal(p[key],250);
  assert.equal(p.requires_atomic_counterpart,true);assert.equal(p.never_classify_as_sbi_monthly,true);
  assert.equal(p.household_cash_outflow_delta_jpy,0);
 }
 assert.equal(pointAccountingPlan({operation:'offset_card',units:20}).code,'POINT_TARGET_REQUIRED');
});
test('migration replays, verified members and strict account version/owner',()=>{
 const s=fixture();
 assert.throws(()=>intent(s,{user:other,acc:account}),/POINTS_INTENT_IDENTITY_OR_VERSION/);
 assert.throws(()=>intent(s,{ver:2}),/POINTS_INTENT_IDENTITY_OR_VERSION/);
 assert.throws(()=>intent(s,{user:owner}),/POINTS_INTENT_IDENTITY_OR_VERSION/);
 const p=intent(s);
 assert.throws(()=>run(s,"UPDATE family_points_intents SET payload_sha256=? WHERE request_id=?", 'e'.repeat(64),p.n),/POINTS_INTENT_IMMUTABLE/);
});
test('ledger is balance-conserving, immutable, audited and idempotent',()=>{
 const s=fixture(),p=intent(s);
 assert.throws(()=>post(s,p,{units:-1,after:-1}),/CHECK constraint failed|POINTS_JOURNAL_INVARIANT/);
 assert.throws(()=>post(s,p,{units:100,after:101}),/POINTS_JOURNAL_INVARIANT/);
 assert.throws(()=>post(s,p,{units:100,after:100,approver:other,actor:other}),/POINTS_JOURNAL_INVARIANT/);
 post(s,p);
 assert.equal(get(s,'SELECT balance_after_units FROM family_points_journal WHERE homeflow_request_id=?',p.approval).balance_after_units,100);
 assert.equal(get(s,'SELECT COUNT(*) n FROM family_points_actor_audit').n,1);
 assert.throws(()=>post(s,p),/UNIQUE constraint failed|POINTS_JOURNAL_INVARIANT/);
 assert.throws(()=>run(s,"UPDATE family_points_journal SET delta_units=10 WHERE homeflow_request_id=?",p.approval),/POINTS_JOURNAL_IMMUTABLE/);
 assert.throws(()=>run(s,"DELETE FROM family_points_actor_audit"),/POINTS_AUDIT_IMMUTABLE/);
 assert.throws(()=>run(s,"DELETE FROM family_points_journal"),/POINTS_JOURNAL_IMMUTABLE/);
});
test('duplicate notification and cross-user reference cannot mint double units',()=>{
 const s=fixture(),p=intent(s);post(s,p);
 const dup=intent(s);
 assert.throws(()=>post(s,dup,{units:50,after:150,value:50}),/UNIQUE constraint failed|POINTS_JOURNAL_INVARIANT/);
 const separate=intent(s,{user:other,acc:otherAccount});
 post(s,separate,{units:80,after:80,value:80});
 assert.equal(get(s,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',account).n,100);
 assert.equal(get(s,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',otherAccount).n,80);
});
test('historical reward linking is evidence only: no re-mint, no name-based ownership',()=>{
 const s=fixture();
 run(s,"INSERT INTO family_points_legacy_links(legacy_entry_id,household_id,owner_user_id,points_account_id,legacy_kind,reviewed_by_user_id,reviewed_at) VALUES(?,?,?,?,?,?,?)",
  1,household,member,account,'earn',owner,date);
 assert.equal(get(s,'SELECT COUNT(*) n FROM family_points_journal').n,0);
 assert.throws(()=>run(s,"INSERT INTO family_points_legacy_links(legacy_entry_id,household_id,owner_user_id,points_account_id,legacy_kind,reviewed_by_user_id,reviewed_at) VALUES(?,?,?,?,?,?,?)",
  1,household,member,account,'earn',owner,date),/UNIQUE constraint failed/);
 assert.throws(()=>run(s,"UPDATE family_points_legacy_links SET owner_user_id=? WHERE legacy_entry_id=1",owner),/POINTS_LEGACY_LINK_IMMUTABLE/);
 assert.throws(()=>run(s,"INSERT INTO family_points_legacy_links(legacy_entry_id,household_id,owner_user_id,points_account_id,legacy_kind,reviewed_by_user_id,reviewed_at) VALUES(?,?,?,?,?,?,?)",
  1,household,other,account,'earn',owner,date),/POINTS_LEGACY_OWNER_UNVERIFIED/);
});

test('family point balances are shared read-only quantities and exclude legacy income from new units',async()=>{
 const s=fixture();
 const p=intent(s);post(s,p);
 run(s,"INSERT INTO family_points_legacy_links(legacy_entry_id,household_id,owner_user_id,points_account_id,legacy_kind,reviewed_by_user_id,reviewed_at) VALUES(?,?,?,?,?,?,?)",
  1,household,member,account,'earn',owner,date);
 const db={prepare(q){return{bind(...args){return{
  all:async()=>({results:s.prepare(q).all(...args)})}}}}};
 const projection=await memberPointsBalances(db,household);
 assert.equal(projection.scope,'household');
 assert.equal(projection.included_in_tracked_assets,false);
 assert.equal(projection.monetary_total_jpy,null);
 const a=projection.accounts.find(a=>a.account_id===account);
 const b=projection.accounts.find(a=>a.account_id===otherAccount);
 assert.equal(a.owner_user_id,member);
 assert.equal(a.balance_units,100);
 assert.equal(a.legacy_reviewed_count,1);
 assert.equal(b.owner_user_id,other);
 assert.equal(b.balance_units,0);
 assert.equal(projection.accounts.length,2);
 assert.equal(get(s,'SELECT COUNT(*) n FROM family_points_journal').n,1);
});
