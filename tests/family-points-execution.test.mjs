import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac,webcrypto} from 'node:crypto';
import {familyPointsActions} from '../functions/api/family-finance/points-actions.js';
import {approvedPointsRoute} from '../functions/api/internal/points-actions/points-execution.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',
 other='33333333-3333-4333-8333-333333333333',
 points='a'.repeat(32),memberCard='b'.repeat(32),otherCard='c'.repeat(32),prepaid='d'.repeat(32);
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
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,amount INTEGER,type TEXT,'+
  'client_request_id TEXT UNIQUE,family_account_id TEXT,payment_source TEXT);');
 const p33=readFileSync(new URL('../migrations/0033_member_prepaid_actions.sql',import.meta.url),'utf8');
 sql.exec(p33);
 const mig=readFileSync(new URL('../migrations/0034_family_points_foundation.sql',import.meta.url),'utf8');
 sql.exec(mig);sql.exec(mig);
 const p35=readFileSync(new URL('../migrations/0035_points_prepaid_atomic.sql',import.meta.url),'utf8');
 sql.exec(p35);
 for(const [u,role] of [[owner,'owner'],[member,'member'],[other,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,hh,role,role,'active',Date.now());
 for(const [aid,kind,u] of [[points,'points',member],[memberCard,'credit_card',member],[otherCard,'credit_card',other],[prepaid,'prepaid',member]])
  stmt(sql,"INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,'member_created',?,?)",
   aid,hh,u,kind,kind,u,u);
 for(const [entry,card] of [[1,memberCard],[2,otherCard]])
  stmt(sql,"INSERT INTO entries(id,date,amount,type,client_request_id,family_account_id,payment_source) VALUES(?,'2026-11-14',1000,'expense',?,?,?)",
   entry,'card'+entry,card,'cc:'+card);
 stmt(sql,"INSERT INTO entries(id,date,amount,type,client_request_id,family_account_id,payment_source) VALUES(3,'2026-11-14',100,'expense','points-funded-1',?,?)",
  points,'points:'+points);
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
 const foreignId='e'.repeat(32);
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
