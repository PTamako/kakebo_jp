import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac,webcrypto} from 'node:crypto';
import {familyPointsActions} from '../functions/api/family-finance/points-actions.js';
import {approvedPointsRoute} from '../functions/api/internal/points-actions/points-execution.js';
import {memberCardLiabilities} from '../functions/api/family-finance/card-settlement-summary.js';
import {memberPointsBalances} from '../functions/api/family-finance/points-balance-projection.js';
import {memberSbiPointPositions} from '../functions/api/family-finance/sbi-point-lot-projection.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',
 other='33333333-3333-4333-8333-333333333333',
 points='a'.repeat(32),memberCard='b'.repeat(32),otherCard='c'.repeat(32),prepaid='d'.repeat(32),
 receivePoints='e'.repeat(32),foreignPoints='9'.repeat(32),
 securities='6'.repeat(32),foreignSecurities='7'.repeat(32);
const cardPurchaseApproval='11111111-1111-4111-8111-111111111114';
const secrets={pending:'1'.repeat(64),submit:'2'.repeat(64),proof:'3'.repeat(64),execute:'4'.repeat(64)};
const sign=(domain,key,stamp,raw)=>createHmac('sha256',Buffer.from(key,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex');
const stmt=(s,q,...a)=>s.prepare(q).run(...a);
const get=(s,q,...a)=>s.prepare(q).get(...a);
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const n of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0027_family_legacy_entry_link_audit.sql']){
  sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 }
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);');
 for(const name of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const p33=readFileSync(new URL('../migrations/0033_member_prepaid_actions.sql',import.meta.url),'utf8');
 sql.exec(p33);
 const mig=readFileSync(new URL('../migrations/0034_family_points_foundation.sql',import.meta.url),'utf8');
 sql.exec(mig);sql.exec(mig);
 const p35=readFileSync(new URL('../migrations/0035_points_prepaid_atomic.sql',import.meta.url),'utf8');
 sql.exec(p35);
 sql.exec(readFileSync(new URL('../migrations/0036_points_card_offset.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0037_points_transfer_exchange.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0038_points_earn_expiry_reversals.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0040_points_sbi_lots.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0041_points_transfer_atomic_refund.sql',import.meta.url),'utf8'));
 for(const [u,role] of [[owner,'owner'],[member,'member'],[other,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,hh,role,role,'active',Date.now());
 for(const [aid,kind,u] of [[points,'points',member],[memberCard,'credit_card',member],[otherCard,'credit_card',other],[prepaid,'prepaid',member],[receivePoints,'points',member],[foreignPoints,'points',other],[securities,'securities',member],[foreignSecurities,'securities',other]])
  stmt(sql,"INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,'member_created',?,?)",
   aid,hh,u,kind,kind,u,u);
 for(const [entry,card] of [[1,memberCard],[2,otherCard]])
  stmt(sql,"INSERT INTO entries(id,date,amount,type,client_request_id,family_account_id,payment_source) VALUES(?,'2026-11-14',1000,'expense',?,?,?)",
   entry,'card'+entry,card,'cc:'+card);
 stmt(sql,"INSERT INTO entries(id,date,amount,type,client_request_id,family_account_id,payment_source) VALUES(3,'2026-11-14',100,'expense','points-funded-1',?,?)",
  points,'points:'+points);
 const cardIntent='f'.repeat(32),now=Date.now();
 stmt(sql,"INSERT INTO family_card_purchase_intents(request_id,household_id,requester_user_id,account_id,account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
  cardIntent,hh,member,memberCard,1,'f'.repeat(64),'cipher','iv','e'.repeat(64),cardPurchaseApproval,now-1000,now+86400000,now);
 stmt(sql,'INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  cardPurchaseApproval,cardIntent,hh,member,owner,memberCard,1,'f'.repeat(64),
  'card1',1,1000,'2026-11-14','2026-11',now);
 const db={prepare(q){return{bind(...a){return{
  first:async()=>sql.prepare(q).get(...a)||null,
  all:async()=>({results:sql.prepare(q).all(...a)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...a).changes}})
 }}}}};
 const requests=new Map(),approvals=new Map();
 let proofAuthorized=true,invalidProof=false,failSubmit=false;
 const env={APP_ENV:'production',DB:db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_POINTS_ACTIONS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:secrets.pending,
  KAKEIBO_POINTS_SUBMISSION_SECRET:secrets.submit,
  KAKEIBO_POINTS_PROOF_SECRET:secrets.proof,
  KAKEIBO_POINTS_EXECUTION_SECRET:secrets.execute,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const raw=await req.text(),b=JSON.parse(raw);
  const stamp=req.headers.get('x-approval-timestamp');
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-points');
  if(req.url.endsWith('/points-submit')){
   assert.equal(req.headers.get('x-approval-signature'),
    sign('kakeibo-points:submit',secrets.submit,stamp,raw));
   if(failSubmit)return Response.json({code:'retry'},{status:503});
   let approval=requests.get(b.resource_id);
   if(!approval){approval=crypto.randomUUID();requests.set(b.resource_id,approval);
    approvals.set(approval,{...b})}
   return Response.json({ok:true,approval_id:approval,resource_id:b.resource_id,
    household_id:b.household_id,requester_user_id:b.requester_user_id,
    payload_sha256:b.payload_sha256,expected_version:b.expected_version,
    operation:'finance.points.'+b.action,applied:false});
  }
  assert.equal(new URL(req.url).pathname,'/api/internal/approvals/verify');
  assert.equal(req.headers.get('x-approval-signature'),
   sign('kakeibo-points:execution-proof',secrets.proof,stamp,raw));
  assert.equal(b.idempotency_key,'kakeibo:points:'+b.resource_id);
  if(!proofAuthorized)return Response.json({code:'revoked'},{status:409});
  const approval=approvals.get(b.request_id);
  assert.ok(approval);
  if(invalidProof)return Response.json({ok:true,verified:true,execution_authorized:false});
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.points.'+approval.action,resource_type:'points_action',
   request_id:b.request_id,resource_id:b.resource_id,
   household_id:b.household_id,requester_user_id:b.requester_user_id,
   payload_sha256:b.payload_sha256,idempotency_key:b.idempotency_key,
   expected_version:b.expected_version,approver_user_id:owner,
   expires_at:Date.now()+120000,applied:false});
 }};
 const user={user_id:member,household_id:hh,role:'member'};
 const url=new URL('https://kakeibo.example.test/api/family-finance/points-actions');
 const call=async(parts=['points-actions'],body,method='POST',who=user)=>{
  const req=new Request(url,{method,headers:method==='POST'?
    {origin:url.origin,'content-type':'application/json'}:{},
   ...(method==='POST'?{body:JSON.stringify(body)}:{})});
  const r=await familyPointsActions(req,env,url,who,parts);
  return {status:r.status,data:await r.json()};
 };
 const action=(operation,requestId,overrides={})=>({
  expected_user_id:member,idempotency_key:'point-notice-'+requestId,
  points_account_id:points,points_version:1,operation,
  effective_date:'2026-11-14',units:100,
  yen_value:100,rate_numerator:1,rate_denominator:1,
  source_reference:'reference-'+requestId,
  linked_entry_id:['earn_purchase','redeem_discount'].includes(operation)?1:
   operation==='redeem_purchase'?3:null,
  expense_net_confirmed:operation==='redeem_discount',
  ...(operation==='transfer_prepaid'?{target_account_id:prepaid,target_version:1}:{}),
  ...(operation==='offset_card'?{target_account_id:memberCard,target_version:1,
   target_purchase_request_id:cardPurchaseApproval}:{}),
  ...(['transfer_out','exchange_out'].includes(operation)?{
   target_account_id:receivePoints,target_version:1,target_units:100,
   target_rate_numerator:1,target_rate_denominator:1}:{}),
  ...(operation==='reversal'?{original_request_id:'11111111-1111-4111-8111-111111111111'}:{}),
  ...(operation==='redeem_asset'?{
   target_account_id:securities,target_version:1,sbi_fund_code:'JP123456',
   sbi_account_type:'growth',sbi_confirmed_units:1000,
   broker_trade_reference:'SBI-EXEC-'+requestId,
   broker_execution_confirmed:true}:{}),
  ...overrides
 });
 const prepare=async(operation,key,overrides={})=>{
  const result=await call(['points-actions'],action(operation,key,overrides));
  assert.equal(result.status,201,JSON.stringify(result.data));
  return result.data.prepared.request_id;
 };
 const submit=async(id)=>{
  const result=await call(['points-actions',id,'submit'],{expected_user_id:member});
  assert.equal(result.status,200,JSON.stringify(result.data));
  return result.data.approval_id;
 };
 const execute=async(approval,mode='execute',opts={})=>{
  const record=approvals.get(approval);assert.ok(record);
  const b={request_id:approval,resource_id:record.resource_id,household_id:hh,
   requester_user_id:member,payload_sha256:record.payload_sha256,
   ...(mode==='execute'?{execution_nonce:'f'.repeat(64)}:{})};
  const raw=JSON.stringify(b),stamp=String(Date.now());
  const req=new Request('https://kakeibo.internal/api/internal/points-actions/'+mode,{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'homeflow','x-approval-timestamp':stamp,
    'x-approval-signature':opts.badSignature?'f'.repeat(64):
     sign('homeflow:points-'+mode,secrets.execute,stamp,raw)},body:raw});
  const r=await approvedPointsRoute(req,env,[mode]);
  return {status:r.status,data:await r.json()};
 };
 return {sql,db,env,user,call,action,prepare,submit,execute,
  revoke:()=>proofAuthorized=false,enable:()=>proofAuthorized=true,
  denyProof:()=>invalidProof=true,submitError:()=>failSubmit=true};
}
test('real SQLite: earn rewards with exact JPY ratio without a second cash income; original ID replay',async()=>{
 const f=fixture(),entryBefore=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const proposal=await f.prepare('earn_campaign','earn-1');
 const approval=await f.submit(proposal);
 let r=await f.execute(approval);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.delta_units,100);assert.equal(r.data.balance_after_units,100);
 assert.equal(r.data.yen_value,100);assert.equal(r.data.actor_user_id,owner);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,entryBefore);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,1);
 r=await f.execute(approval,'receipt');assert.equal(r.status,200);
 assert.equal(r.data.already_applied,true);
 r=await f.execute(approval);assert.equal(r.status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,1);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,1);
});
test('linked purchase points, discount, expiry remain no new expense; overdraft rejected',async()=>{
 const f=fixture(),p=await f.prepare('earn_purchase','shopping-1');
 assert.equal((await f.execute(await f.submit(p))).status,200);
 const disc=await f.prepare('redeem_discount','discount-1',{units:30,yen_value:30});
 const d=await f.execute(await f.submit(disc));assert.equal(d.status,200);
 assert.equal(d.data.delta_units,-30);assert.equal(d.data.linked_entry_id,1);
 const expiry=await f.prepare('expire','expire-1',{units:20,yen_value:20});
 const x=await f.execute(await f.submit(expiry));assert.equal(x.status,200);
 assert.equal(x.data.balance_after_units,50);
 const tooMuch=await f.prepare('expire','expire-2',{units:999,yen_value:999});
 const reject=await f.execute(await f.submit(tooMuch));assert.equal(reject.status,409);
 assert.equal(reject.data.code,'POINTS_INSUFFICIENT_BALANCE');
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='expense'").n,3);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,50);
});
test('cross-member expense and wrong user cannot create intent; no forged proof',async()=>{
 const f=fixture();
 const invalid=await f.call(['points-actions'],f.action('earn_purchase','foreign',{linked_entry_id:2}));
 assert.equal(invalid.data.code,'POINTS_ENTRY_OWNER_UNVERIFIED');
 const badUser=await f.call(['points-actions'],f.action('earn_campaign','wrong',{expected_user_id:owner}));
 assert.equal(badUser.status,400);
 const p=await f.prepare('earn_campaign','proof-1'),a=await f.submit(p);
 const forged=await f.execute(a,'execute',{badSignature:true});
 assert.equal(forged.status,403);
 f.denyProof();const missing=await f.execute(a);
 assert.equal(missing.status,409);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
});
test('lost HomeFlow receipt, idempotent prepare, source retry and revoked identity fail closed',async()=>{
 const f=fixture(),body=f.action('earn_campaign','repeat-1');
 const a=await f.call(['points-actions'],body);
 const again=await f.call(['points-actions'],body);
 assert.equal(a.status,201);assert.equal(again.data.replayed,true);
 assert.equal(again.data.prepared.request_id,a.data.prepared.request_id);
 const proposal=a.data.prepared.request_id;
 const approval=await f.submit(proposal);
 f.revoke();assert.equal((await f.execute(approval)).status,409);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
 f.enable();assert.equal((await f.execute(approval)).status,200);
 assert.equal((await f.execute(approval,'receipt')).data.already_applied,true);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,1);
 const collision=await f.call(['points-actions'],{...body,units:200,yen_value:200});
 assert.equal(collision.data.code,'POINTS_IDEMPOTENCY_CONFLICT');
});
test('source reference duplicate across distinct requests must not award points twice',async()=>{
 const f=fixture();
 const first=await f.prepare('earn_campaign','duplicate-one',{source_reference:'same-reward-notice'});
 assert.equal((await f.execute(await f.submit(first))).status,200);
 const second=await f.prepare('earn_campaign','duplicate-two',{source_reference:'same-reward-notice'});
 const rejected=await f.execute(await f.submit(second));
 assert.equal(rejected.status,503);
 assert.equal(rejected.data.code,'POINTS_WRITE_RETRY');
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,100);
});
test('account version drift and member disabled before execution deny write',async()=>{
 const f=fixture(),proposal=await f.prepare('earn_campaign','version-one'),
  approval=await f.submit(proposal);
 stmt(f.sql,"UPDATE family_financial_accounts SET version=2 WHERE account_id=?",points);
 const rejected=await f.execute(approval);assert.equal(rejected.status,409);
 assert.equal(rejected.data.code,'POINTS_ACCOUNT_OR_IDENTITY_CHANGED');
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
 stmt(f.sql,"UPDATE family_financial_accounts SET version=1 WHERE account_id=?",points);
 stmt(f.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",member);
 assert.equal((await f.execute(approval)).status,409);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
});

test('point-funded purchase links its existing points expense exactly once, no cash duplicate',async()=>{
 const f=fixture(),base=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const earned=await f.prepare('earn_campaign','point-purchase-funding',{units:300,yen_value:300});
 assert.equal((await f.execute(await f.submit(earned))).status,200);
 const purchase=await f.prepare('redeem_purchase','point-buy',{units:100,yen_value:100,
  linked_entry_id:3});
 const result=await f.execute(await f.submit(purchase));
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.linked_entry_id,3);
 assert.equal(result.data.delta_units,-100);
 assert.equal(result.data.balance_after_units,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,base);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
 const foreign=await f.call(['points-actions'],f.action('redeem_purchase','not-point-funded',{
  linked_entry_id:1}));
 assert.equal(foreign.data.code,'POINTS_ENTRY_OWNER_UNVERIFIED');
});

test('point-to-prepaid is an atomic double-sided credit; no new income, transfer or expense',async()=>{
 const f=fixture(),before=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const earned=await f.prepare('earn_campaign','fund-prepaid',{units:500,yen_value:500});
 assert.equal((await f.execute(await f.submit(earned))).status,200);
 const redeemed=await f.prepare('transfer_prepaid','exchange-prepaid',{units:150,yen_value:150});
 const approval=await f.submit(redeemed);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,0);
 const result=await f.execute(approval);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(result.data.delta_units,-150);
 assert.equal(result.data.balance_after_units,350);
 assert.equal(result.data.prepaid_credit_jpy,150);
 assert.equal(result.data.prepaid_balance_after_jpy,150);
 assert.equal(result.data.target_account_id,prepaid);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,before);
 assert.equal(get(f.sql,'SELECT SUM(amount_jpy) n FROM family_points_prepaid_credits').n,150);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
 assert.equal((await f.execute(approval,'receipt')).data.already_applied,true);
 assert.equal((await f.execute(approval)).data.already_applied,true);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,1);
 const tooMuch=await f.prepare('transfer_prepaid','overdraw',{units:999,yen_value:999});
 assert.equal((await f.execute(await f.submit(tooMuch))).status,409);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,1);
});
test('point-to-prepaid refuses target version drift, cross-owner, false exchange rate and atomic audit failure',async()=>{
 for(const mode of ['target_version','audit']){
  const f=fixture();
  const earned=await f.prepare('earn_campaign','fund-'+mode,{units:200,yen_value:200});
  assert.equal((await f.execute(await f.submit(earned))).status,200);
  const proposal=await f.prepare('transfer_prepaid','credit-'+mode,{units:100,yen_value:100});
  const approval=await f.submit(proposal);
  if(mode==='target_version')stmt(f.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',prepaid);
  if(mode==='audit')f.sql.exec("CREATE TRIGGER fail_points_credit BEFORE INSERT ON family_points_prepaid_credits BEGIN SELECT RAISE(ABORT,'INJECTED_CREDIT_FAILURE'); END;");
  assert.notEqual((await f.execute(approval)).status,200);
  assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_prepaid_credits').n,0);
  assert.equal(get(f.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation='transfer_prepaid'").n,0);
 }
 const foreign=fixture();
 const foreignId='8'.repeat(32);
 stmt(foreign.sql,"INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,'member_created',?,?)",
  foreignId,hh,other,'Other prepaid','prepaid',other,other);
 const ownerDenied=await foreign.call(['points-actions'],foreign.action('transfer_prepaid','other-owned',{target_account_id:foreignId}));
 assert.equal(ownerDenied.status,409);
 assert.equal(ownerDenied.data.code,'POINTS_PREPAID_TARGET_CHANGED');
 assert.equal(get(foreign.sql,'SELECT COUNT(*) n FROM family_points_intents').n,0);
 const f=fixture();
 const bad=await f.call(['points-actions'],f.action('transfer_prepaid','bad-rate',{units:3,yen_value:2,rate_numerator:1,rate_denominator:1}));
 assert.equal(bad.status,400);
 const self=await f.call(['points-actions'],f.action('transfer_prepaid','self',{target_account_id:points}));
 assert.equal(self.status,400);
});

test('points credit-card offset uses canonical payable without new expense or bank debit',async()=>{
 const f=fixture(),before=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const earn=await f.prepare('earn_campaign','fund-card-offset',{units:800,yen_value:800});
 assert.equal((await f.execute(await f.submit(earn))).status,200);
 const offset=await f.prepare('offset_card','card-offset-500',{units:500,yen_value:500});
 const approved=await f.submit(offset);
 const done=await f.execute(approved);
 assert.equal(done.status,200,JSON.stringify(done));
 assert.equal(done.data.delta_units,-500);
 assert.equal(done.data.card_offset_jpy,500);
 assert.equal(done.data.card_remaining_after_jpy,500);
 assert.equal(done.data.card_purchase_request_id,cardPurchaseApproval);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,before);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
 assert.equal(get(f.sql,'SELECT SUM(amount_jpy) n FROM family_points_card_offsets').n,500);
 const view=await memberCardLiabilities(f.db,hh,true);
 assert.equal(view.total,500);
 assert.equal(view.items[0].gross_charges_jpy,1000);
 assert.equal(view.items[0].points_offset_jpy,500);
 assert.equal(view.items[0].settled_jpy,0);
 assert.equal((await f.execute(approved,'receipt')).data.already_applied,true);
 const conflicting=await f.call(['points-actions'],f.action('offset_card','over-pay-card',
  {units:600,yen_value:600}));
 assert.equal(conflicting.status,409);
 assert.equal(conflicting.data.code,'POINTS_CARD_TARGET_OR_LIABILITY_CHANGED');
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_card_offsets').n,1);
});
test('points card offset cannot cross card owners, bypass CAS or survive counterpart fault',async()=>{
 const f=fixture();
 const foreign=await f.call(['points-actions'],f.action('offset_card','foreign-card',{target_account_id:otherCard}));
 assert.equal(foreign.status,409);
 const bad=await f.call(['points-actions'],f.action('offset_card','bad-rate-card',
  {units:3,yen_value:2,rate_numerator:1,rate_denominator:1}));
 assert.equal(bad.status,400);
 const earn=await f.prepare('earn_campaign','fund-card-fault',{units:400,yen_value:400});
 assert.equal((await f.execute(await f.submit(earn))).status,200);
 const p=await f.prepare('offset_card','fault-card',{units:200,yen_value:200});
 const approval=await f.submit(p);
 f.sql.exec("CREATE TRIGGER reject_offset_card_credit BEFORE INSERT ON family_points_card_offsets BEGIN SELECT RAISE(ABORT,'OFFSET_CRASH'); END;");
 assert.notEqual((await f.execute(approval)).status,200);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation='offset_card'").n,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_card_offsets').n,0);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,400);
});

test('two point accounts: transfer and changed-rate exchange both post an immutable counterpart, no cash',async()=>{
 const f=fixture(),initial=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const earn=await f.prepare('earn_campaign','source-fund-300',{units:300,yen_value:300});
 assert.equal((await f.execute(await f.submit(earn))).status,200);
 const transfer=await f.prepare('transfer_out','move-80',
  {units:80,yen_value:80,target_units:80});
 const approved=await f.submit(transfer);
 const posted=await f.execute(approved);
 assert.equal(posted.status,200,JSON.stringify(posted));
 assert.equal(posted.data.delta_units,-80);
 assert.equal(posted.data.transfer_target_units,80);
 assert.equal(posted.data.transfer_target_balance_after_units,80);
 assert.equal(posted.data.transfer_target_version,1);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,220);
 assert.equal(get(f.sql,'SELECT SUM(target_units) n FROM family_points_transfer_credits WHERE target_account_id=?',receivePoints).n,80);
 assert.equal((await f.execute(approved,'receipt')).data.already_applied,true);
 const ex=await f.prepare('exchange_out','convert-60-to-30',
  {units:60,yen_value:120,rate_numerator:2,rate_denominator:1,
   target_units:30,target_rate_numerator:4,target_rate_denominator:1});
 const exchanged=await f.execute(await f.submit(ex));
 assert.equal(exchanged.status,200,JSON.stringify(exchanged));
 assert.equal(exchanged.data.transfer_target_units,30);
 assert.equal(exchanged.data.transfer_target_balance_after_units,110);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,160);
 assert.equal(get(f.sql,'SELECT SUM(target_units) n FROM family_points_transfer_credits WHERE target_account_id=?',receivePoints).n,110);
 const projection=await memberPointsBalances(f.db,hh);
 assert.equal(projection.accounts.find(x=>x.account_id===receivePoints).balance_units,110);
 assert.equal(projection.accounts.find(x=>x.account_id===points).balance_units,160);
 const consume=await f.prepare('expire','use-received-points',
  {points_account_id:receivePoints,units:40,yen_value:40});
 const spent=await f.execute(await f.submit(consume));
 assert.equal(spent.status,200,JSON.stringify(spent));
 assert.equal(spent.data.balance_after_units,70);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,initial);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,4);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,2);
 assert.throws(()=>stmt(f.sql,'DELETE FROM family_points_transfer_credits'),/IMMUTABLE/);
 assert.throws(()=>stmt(f.sql,'UPDATE family_points_transfer_credits SET target_units=100'),/IMMUTABLE/);
});
test('point transfer denies foreign account, stale target CAS, invalid conversion rate, and atomic target failure',async()=>{
 const f=fixture();
 const foreign=await f.call(['points-actions'],f.action('transfer_out','foreign-points',
  {target_account_id:foreignPoints}));
 assert.equal(foreign.status,409);assert.equal(foreign.data.code,'POINTS_TRANSFER_TARGET_CHANGED');
 const wrong=await f.call(['points-actions'],f.action('exchange_out','wrong-ratio',
  {units:100,yen_value:100,target_units:20,target_rate_numerator:3,target_rate_denominator:1}));
 assert.equal(wrong.status,400);
 const mismatch=await f.call(['points-actions'],f.action('transfer_out','alter-transfer',
  {target_units:80}));
 assert.equal(mismatch.status,400);
 const earned=await f.prepare('earn_campaign','fund-target-fault',{units:300,yen_value:300});
 assert.equal((await f.execute(await f.submit(earned))).status,200);
 const stale=await f.prepare('transfer_out','stale-target',
  {units:40,yen_value:40,target_units:40});
 const staleApproval=await f.submit(stale);
 stmt(f.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',receivePoints);
 assert.notEqual((await f.execute(staleApproval)).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,0);
 stmt(f.sql,'UPDATE family_financial_accounts SET version=1 WHERE account_id=?',receivePoints);
 const failure=await f.prepare('exchange_out','inject-transfer-failure',
  {units:100,yen_value:100,target_units:50,target_rate_numerator:2,target_rate_denominator:1});
 const aid=await f.submit(failure);
 f.sql.exec("CREATE TRIGGER fail_transfer_credit BEFORE INSERT ON family_points_transfer_credits BEGIN SELECT RAISE(ABORT,'INJECTED_TRANSFER_FAILURE'); END;");
 assert.notEqual((await f.execute(aid)).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,0);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,300);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation IN ('transfer_out','exchange_out')").n,0);
});

test('owner-approved immutable reversal restores an expired credit and cancels an incorrect point award exactly once',async()=>{
 const f=fixture(),entries=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const earned=await f.prepare('earn_campaign','award-to-reverse',{units:150,yen_value:150});
 const earnApproval=await f.submit(earned);
 assert.equal((await f.execute(earnApproval)).status,200);
 const expired=await f.prepare('expire','expire-to-reverse',{units:40,yen_value:40});
 const expireApproval=await f.submit(expired);
 assert.equal((await f.execute(expireApproval)).status,200);
 const refund=await f.prepare('reversal','restore-expiration',
  {units:40,yen_value:40,original_request_id:expireApproval});
 const refundApproval=await f.submit(refund);
 const result=await f.execute(refundApproval);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.equal(result.data.delta_units,40);
 assert.equal(result.data.reversed_request_id,expireApproval);
 assert.equal(result.data.balance_after_units,150);
 assert.equal((await f.execute(refundApproval,'receipt')).data.already_applied,true);
 const revert=await f.prepare('reversal','cancel-award',
  {units:150,yen_value:150,original_request_id:earnApproval});
 const reversed=await f.execute(await f.submit(revert));
 assert.equal(reversed.status,200,JSON.stringify(reversed));
 assert.equal(reversed.data.delta_units,-150);
 assert.equal(reversed.data.balance_after_units,0);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal WHERE operation=\'reversal\'').n,2);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,4);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,entries);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
 assert.throws(()=>stmt(f.sql,"UPDATE family_points_journal SET delta_units=1 WHERE operation='reversal'"),/POINTS_JOURNAL_IMMUTABLE/);
 const duplicate=await f.call(['points-actions'],f.action('reversal','duplicate-reverse',
  {units:150,yen_value:150,original_request_id:earnApproval}));
 assert.equal(duplicate.status,409);
 assert.equal(duplicate.data.code,'POINTS_REVERSAL_ORIGINAL_CHANGED');
});
test('reversal blocks changed amount, cross-member source, linked counterpart and spent award overdraft',async()=>{
 const f=fixture();
 const earned=await f.prepare('earn_campaign','award-funding',{units:100,yen_value:100});
 const earnApproval=await f.submit(earned);
 assert.equal((await f.execute(earnApproval)).status,200);
 const wrong=await f.call(['points-actions'],f.action('reversal','wrong-units',
  {units:60,yen_value:60,original_request_id:earnApproval}));
 assert.equal(wrong.status,409);
 const foreign=await f.call(['points-actions'],f.action('reversal','foreign-account-reversal',
  {points_account_id:receivePoints,original_request_id:earnApproval}));
 assert.equal(foreign.status,409);
 const exchanged=await f.prepare('transfer_out','cannot-revert-counterpart',
  {units:60,yen_value:60,target_units:60});
 const moveApproval=await f.submit(exchanged);
 assert.equal((await f.execute(moveApproval)).status,200);
 const blocked=await f.call(['points-actions'],f.action('reversal','unsafe-original',
  {units:60,yen_value:60,original_request_id:moveApproval}));
 assert.equal(blocked.status,409);
 const proposal=await f.prepare('reversal','award-spent',
  {units:100,yen_value:100,original_request_id:earnApproval});
 const approval=await f.submit(proposal);
 const rejected=await f.execute(approval);
 assert.equal(rejected.status,409);
 assert.equal(rejected.data.code,'POINTS_INSUFFICIENT_BALANCE');
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation='reversal'").n,0);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,40);
});
test('target actor-audit failure rolls back reversal without erasing original journal',async()=>{
 const f=fixture();
 const award=await f.prepare('earn_campaign','award-protect',{units:100,yen_value:100});
 const awardApproval=await f.submit(award);
 assert.equal((await f.execute(awardApproval)).status,200);
 const reverse=await f.prepare('reversal','audit-fail',
  {units:100,yen_value:100,original_request_id:awardApproval});
 const reversalApproval=await f.submit(reverse);
 f.sql.exec("CREATE TRIGGER fail_reversal_audit BEFORE INSERT ON family_points_actor_audit WHEN NEW.operation='reversal' BEGIN SELECT RAISE(ABORT,'REVERSAL_AUDIT_FAILURE'); END;");
 assert.notEqual((await f.execute(reversalApproval)).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,1);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,1);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,100);
});

test('real SQLite SBI point buy: approved points debit atomically mints exact broker-confirmed units and cost, never cash or plan',async()=>{
 const f=fixture(),before=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const grant=await f.prepare('earn_campaign','sbi-funding-points',{units:600,yen_value:600});
 assert.equal((await f.execute(await f.submit(grant))).status,200);
 const p1=await f.prepare('redeem_asset','sbi-point-buy-a',
  {units:250,yen_value:250,sbi_confirmed_units:1234});
 const approval1=await f.submit(p1),first=await f.execute(approval1);
 assert.equal(first.status,200,JSON.stringify(first));
 assert.equal(first.data.operation,'redeem_asset');
 assert.equal(first.data.delta_units,-250);
 assert.equal(first.data.balance_after_units,350);
 assert.equal(first.data.sbi_confirmed_units,1234);
 assert.equal(first.data.sbi_acquisition_cost_jpy,250);
 assert.equal(first.data.sbi_total_units_after,1234);
 assert.equal(first.data.sbi_total_cost_after_jpy,250);
 assert.equal(first.data.sbi_fund_code,'JP123456');
 assert.equal(first.data.sbi_account_type,'growth');
 assert.equal(first.data.sbi_securities_version,1);
 assert.equal(first.data.sbi_evidence_kind,'user_attested_broker_execution');
 const replay=await f.execute(approval1,'receipt');
 assert.equal(replay.status,200);assert.equal(replay.data.already_applied,true);
 const p2=await f.prepare('redeem_asset','sbi-point-buy-b',
  {units:100,yen_value:100,sbi_confirmed_units:400});
 const second=await f.execute(await f.submit(p2));
 assert.equal(second.status,200,JSON.stringify(second));
 assert.equal(second.data.sbi_total_units_after,1634);
 assert.equal(second.data.sbi_total_cost_after_jpy,350);
 assert.equal(second.data.balance_after_units,250);
 const projection=await memberSbiPointPositions(f.db,hh);
 const p=projection.positions.find(x=>x.securities_account_id===securities);
 assert.equal(p.confirmed_units,1634);assert.equal(p.acquisition_cost_jpy,350);
 assert.equal(p.executed_trade_count,2);
 assert.equal(p.market_value_jpy,null);
 assert.equal(p.broker_reconciled,false);
 assert.equal(projection.included_in_legacy_investment_holdings,false);
 assert.equal(projection.included_in_tracked_assets_jpy,false);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,2);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,before);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM entries WHERE type='income'").n,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,3);
 assert.throws(()=>stmt(f.sql,'UPDATE family_sbi_point_lots SET confirmed_units=1'),/POINTS_SBI_LOT_IMMUTABLE/);
 assert.throws(()=>stmt(f.sql,'DELETE FROM family_sbi_point_lots'),/POINTS_SBI_LOT_IMMUTABLE/);
});
test('SBI purchase rejects forged broker evidence, foreign assets, stale CAS, duplicate trade and insufficient point units',async()=>{
 const f=fixture();
 const noBroker=await f.call(['points-actions'],f.action('redeem_asset','sbi-unattested',
  {broker_execution_confirmed:false}));
 assert.equal(noBroker.status,400);
 const foreign=await f.call(['points-actions'],f.action('redeem_asset','sbi-foreign-target',
  {target_account_id:foreignSecurities}));
 assert.equal(foreign.status,409);
 assert.equal(foreign.data.code,'POINTS_SBI_ACCOUNT_CHANGED');
 const invalidUnits=await f.call(['points-actions'],f.action('redeem_asset','sbi-zero-units',
  {sbi_confirmed_units:0}));
 assert.equal(invalidUnits.status,400);
 const funded=await f.prepare('earn_campaign','sbi-guard-funding',{units:300,yen_value:300});
 assert.equal((await f.execute(await f.submit(funded))).status,200);
 const stale=await f.prepare('redeem_asset','sbi-stale-cas',{units:90,yen_value:90});
 const staleApproval=await f.submit(stale);
 stmt(f.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',securities);
 assert.notEqual((await f.execute(staleApproval)).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,0);
 stmt(f.sql,'UPDATE family_financial_accounts SET version=1 WHERE account_id=?',securities);
 const p1=await f.prepare('redeem_asset','sbi-no-duplicate-a',
  {units:80,yen_value:80,broker_trade_reference:'CONFIRMED-SBI-TRADE-0123'});
 assert.equal((await f.execute(await f.submit(p1))).status,200);
 const p2=await f.prepare('redeem_asset','sbi-no-duplicate-b',
  {units:80,yen_value:80,broker_trade_reference:'CONFIRMED-SBI-TRADE-0123'});
 assert.notEqual((await f.execute(await f.submit(p2))).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,1);
 assert.equal(get(f.sql,"SELECT COUNT(*) n FROM family_points_journal WHERE operation='redeem_asset'").n,1);
 const over=await f.prepare('redeem_asset','sbi-overdraft',{units:300,yen_value:300});
 const no=await f.execute(await f.submit(over));
 assert.equal(no.status,409);assert.equal(no.data.code,'POINTS_INSUFFICIENT_BALANCE');
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,220);
});
test('SBI point target audit fault aborts the source debit and fund lot together',async()=>{
 const f=fixture();
 const fund=await f.prepare('earn_campaign','sbi-fault-funding',{units:200,yen_value:200});
 assert.equal((await f.execute(await f.submit(fund))).status,200);
 const buy=await f.prepare('redeem_asset','sbi-fault-broker',{units:100,yen_value:100});
 const approval=await f.submit(buy);
 f.sql.exec("CREATE TRIGGER fail_sbi_point_lot BEFORE INSERT ON family_sbi_point_lots BEGIN SELECT RAISE(ABORT,'INJECTED_SBI_LOT_FAILURE'); END;");
 assert.notEqual((await f.execute(approval)).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_sbi_point_lots').n,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,1);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,1);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal').n,200);
});

test('real SQLite dual refund: point-to-point transfer returns original source and removes target units, originals immutable',async()=>{
 const f=fixture(),originalEntries=get(f.sql,'SELECT COUNT(*) n FROM entries').n;
 const initial=await f.prepare('earn_campaign','refund-transfer-fund',{units:500,yen_value:500});
 assert.equal((await f.execute(await f.submit(initial))).status,200);
 const sent=await f.prepare('transfer_out','refund-transfer-original',
  {units:160,yen_value:160,target_units:160});
 const sentApproval=await f.submit(sent);
 assert.equal((await f.execute(sentApproval)).status,200);
 const reversed=await f.prepare('reversal','refund-transfer-approved',
  {units:160,yen_value:160,original_request_id:sentApproval});
 const newApproval=await f.submit(reversed);
 const returned=await f.execute(newApproval);
 assert.equal(returned.status,200,JSON.stringify(returned));
 assert.equal(returned.data.delta_units,160);
 assert.equal(returned.data.reversed_request_id,sentApproval);
 assert.equal(returned.data.refunded_target_units,160);
 assert.equal(returned.data.refunded_target_balance_after_units,0);
 assert.equal(returned.data.refunded_target_account_id,receivePoints);
 assert.equal(returned.data.refunded_target_version,1);
 const source=get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n;
 assert.equal(source,500);
 const recv=(await memberPointsBalances(f.db,hh)).accounts.find(x=>x.account_id===receivePoints);
 assert.equal(recv.balance_units,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_credits').n,1);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,1);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,3);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM entries').n,originalEntries);
 assert.equal((await f.execute(newApproval,'receipt')).data.already_applied,true);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,1);
 assert.throws(()=>stmt(f.sql,'DELETE FROM family_points_transfer_refunds'),/POINTS_TRANSFER_REFUND_IMMUTABLE/);
 const repeated=await f.call(['points-actions'],f.action('reversal','refund-transfer-repeated',
  {units:160,yen_value:160,original_request_id:sentApproval}));
 assert.equal(repeated.status,409);
});
test('exchange refund refuses spent recipient units and succeeds after recipient balance restored',async()=>{
 const f=fixture();
 const funded=await f.prepare('earn_campaign','refund-exchange-fund',{units:500,yen_value:500});
 assert.equal((await f.execute(await f.submit(funded))).status,200);
 const x=await f.prepare('exchange_out','refund-exchange-original',
  {units:100,yen_value:200,rate_numerator:2,rate_denominator:1,
   target_units:50,target_rate_numerator:4,target_rate_denominator:1});
 const original=await f.submit(x);
 assert.equal((await f.execute(original)).status,200);
 const spend=await f.prepare('expire','refund-exchange-spend-target',
  {points_account_id:receivePoints,units:20,yen_value:20});
 assert.equal((await f.execute(await f.submit(spend))).status,200);
 const refused=await f.call(['points-actions'],f.action('reversal','refund-exchange-no-funds',
  {units:100,yen_value:200,rate_numerator:2,rate_denominator:1,
   original_request_id:original}));
 assert.equal(refused.status,409);
 assert.equal(refused.data.code,'POINTS_REVERSAL_ORIGINAL_CHANGED');
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,0);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,400);
 const refill=await f.prepare('earn_campaign','refund-exchange-received-extra',
  {points_account_id:receivePoints,units:30,yen_value:30});
 assert.equal((await f.execute(await f.submit(refill))).status,200);
 const r=await f.prepare('reversal','refund-exchange-final',
  {units:100,yen_value:200,rate_numerator:2,rate_denominator:1,
   original_request_id:original});
 const done=await f.execute(await f.submit(r));
 assert.equal(done.status,200,JSON.stringify(done));
 assert.equal(done.data.refunded_target_units,50);
 assert.equal(done.data.refunded_target_balance_after_units,10);
 const read=await memberPointsBalances(f.db,hh);
 assert.equal(read.accounts.find(x=>x.account_id===points).balance_units,500);
 assert.equal(read.accounts.find(x=>x.account_id===receivePoints).balance_units,10);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,1);
});
test('transfer refund target account version drift and injected reversal audit fault never leave one sided credit',async()=>{
 const f=fixture();
 const funded=await f.prepare('earn_campaign','refund-fault-funding',{units:300,yen_value:300});
 assert.equal((await f.execute(await f.submit(funded))).status,200);
 const transfer=await f.prepare('transfer_out','refund-fault-transfer',
  {units:100,yen_value:100,target_units:100});
 const orig=await f.submit(transfer);
 assert.equal((await f.execute(orig)).status,200);
 stmt(f.sql,'UPDATE family_financial_accounts SET version=2 WHERE account_id=?',receivePoints);
 const failVersion=await f.call(['points-actions'],f.action('reversal','refund-stale-cas',
  {units:100,yen_value:100,original_request_id:orig}));
 assert.equal(failVersion.status,409);
 stmt(f.sql,'UPDATE family_financial_accounts SET version=1 WHERE account_id=?',receivePoints);
 const reverse=await f.prepare('reversal','refund-fault-approved',
  {units:100,yen_value:100,original_request_id:orig});
 const app=await f.submit(reverse);
 f.sql.exec("CREATE TRIGGER fail_refund_counterpart BEFORE INSERT ON family_points_transfer_refunds BEGIN SELECT RAISE(ABORT,'REFUND_TARGET_FAILURE'); END;");
 assert.notEqual((await f.execute(app)).status,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_transfer_refunds').n,0);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_journal WHERE reversed_request_id=?',orig).n,0);
 assert.equal(get(f.sql,'SELECT SUM(delta_units) n FROM family_points_journal WHERE points_account_id=?',points).n,200);
 assert.equal(get(f.sql,'SELECT COUNT(*) n FROM family_points_actor_audit').n,2);
});
