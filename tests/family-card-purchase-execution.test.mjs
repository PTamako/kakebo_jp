import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHmac,webcrypto} from 'node:crypto';
import {familyCardPurchases} from '../functions/api/family-finance/card-purchases.js';
import {approvedCardPurchaseRoute,cardClosingMonth}
 from '../functions/api/internal/card-purchases/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const member='22222222-2222-4222-8222-222222222222',owner='11111111-1111-4111-8111-111111111111';
const account='a'.repeat(32),approval='55555555-5555-4555-8555-555555555555';
const secrets={pending:'1'.repeat(64),submit:'2'.repeat(64),execute:'3'.repeat(64),proof:'4'.repeat(64)};
const sign=(domain,secret,stamp,raw)=>createHmac('sha256',Buffer.from(secret,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex');
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 sql.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT);');
 const migration=readFileSync(new URL('../migrations/0031_family_card_purchase_execution.sql',import.meta.url),'utf8');
 sql.exec(migration);sql.exec(migration);
 for(const [id,role] of [[owner,'owner'],[member,'member']])
  sql.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
   .run(id,'primary',role,role,'active',Date.now());
 sql.prepare('INSERT INTO family_financial_accounts('+
  'account_id,household_id,owner_user_id,label,account_kind,origin,closing_day,'+
  'created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(account,'primary',member,'Member credit card','credit_card','member_created',10,member,member);
 const db={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(list){
  sql.exec('BEGIN IMMEDIATE');
  try{const r=list.map(x=>x.sync());sql.exec('COMMIT');return r}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 const calls={submit:0,proof:0};
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_CARD_PURCHASES_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:secrets.pending,
  KAKEIBO_CARD_SUBMISSION_SECRET:secrets.submit,
  KAKEIBO_CARD_EXECUTION_SECRET:secrets.execute,
  KAKEIBO_CARD_PROOF_SECRET:secrets.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 let activeProof=true;
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const pathname=new URL(req.url).pathname;
  const raw=await req.text(),stamp=req.headers.get('x-approval-timestamp');
  if(pathname.endsWith('/card-submit')){
   calls.submit++;
   assert.equal(req.headers.get('x-approval-client'),'kakeibo-card');
   assert.equal(req.headers.get('x-approval-signature'),
    sign('kakeibo-card:submit',secrets.submit,stamp,raw));
   const b=JSON.parse(raw);
   assert.equal(b.household_id,'primary');assert.equal(b.requester_user_id,member);
   assert.equal(b.expected_version,1);
   return Response.json({ok:true,approval_id:approval,status:'pending',
    resource_id:b.resource_id,payload_sha256:b.payload_sha256,
    household_id:b.household_id,requester_user_id:b.requester_user_id,
    expected_version:b.expected_version,applied:false});
  }
  assert.equal(pathname,'/api/internal/approvals/verify');
  calls.proof++;
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-card');
  assert.equal(req.headers.get('x-approval-signature'),
   sign('kakeibo-card:execution-proof',secrets.proof,stamp,raw));
  const b=JSON.parse(raw);
  assert.equal(b.idempotency_key,'kakeibo:card:'+b.resource_id);
  assert.equal(b.expected_version,1);
  assert.equal(b.purpose,'execute');assert.equal(b.execution_nonce,'f'.repeat(64));
  if(!activeProof)return Response.json({code:'revoked'},{status:409});
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.credit_card.purchase',resource_type:'credit_card_purchase',
   request_id:b.request_id,resource_id:b.resource_id,
   household_id:b.household_id,requester_user_id:b.requester_user_id,
   payload_sha256:b.payload_sha256,idempotency_key:b.idempotency_key,
   expected_version:1,approver_user_id:owner,
   approved_at:Date.now()-1000,expires_at:Date.now()+120000,applied:false});
 }};
 const user={user_id:member,household_id:'primary',role:'member'};
 const url=new URL('https://kakeibo.example.test/api/family-finance/card-purchases');
 const input={expected_user_id:member,idempotency_key:'card-purchase:20261114:01',
  account_id:account,account_version:1,date:'2026-11-14',amount_jpy:1520,
  merchant:'マクドナルド',category:'食費',note:'カード決済'};
 const source=async(parts=['card-purchases'],method='POST',payload=input,actor=user)=>{
  const req=new Request(url,{method,headers:method==='POST'?
   {origin:url.origin,'content-type':'application/json'}:{},
   ...(method==='POST'?{body:JSON.stringify(payload)}:{})});
  const res=await familyCardPurchases(req,env,url,actor,parts);
  return {status:res.status,body:await res.json()};
 };
 const send=async(mode,p,extra={})=>{
  const body=mode==='execute'?{...p,execution_nonce:'f'.repeat(64)}:p;
  const raw=JSON.stringify(body),stamp=String(Date.now());
  const req=new Request('https://kakeibo.internal/api/internal/card-purchases/'+mode,{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'homeflow','x-approval-timestamp':stamp,
    'x-approval-signature':extra.invalid?'0'.repeat(64):
     sign('homeflow:card-'+mode,secrets.execute,stamp,raw),
    ...(extra.browser?{origin:'https://browser.invalid'}:{})},body:raw});
  const res=await approvedCardPurchaseRoute(req,env,[mode]);
  return {status:res.status,body:await res.json()};
 };
 const prepare=async()=>source();
 const submit=async id=>source(['card-purchases',id,'submit'],'POST',
  {expected_user_id:member});
 const flow=async()=>{
  const p=await prepare();
  assert.equal(p.status,201,JSON.stringify(p));
  const id=p.body.prepared.request_id;
  const s=await submit(id);
  assert.equal(s.status,200,JSON.stringify(s));
  const b={request_id:approval,resource_id:id,household_id:'primary',
   requester_user_id:member,payload_sha256:p.body.prepared.payload_sha256};
  return {id,p,s,b};
 };
 return {sql,env,user,input,calls,source,prepare,submit,send,flow,
  disableProof(){activeProof=false},close(){sql.close()}};
}
test('approved credit-card purchase posts exactly one expense AND one noncash payable, atomic audit and replay',async()=>{
 const f=setup();try{
  const {b,id}=await f.flow();
  const applied=await f.send('execute',b);
  assert.equal(applied.status,200,JSON.stringify(applied.body));
  assert.equal(applied.body.applied,true);
  assert.equal(applied.body.account_id,account);
  assert.equal(applied.body.amount_jpy,1520);
  assert.equal(applied.body.bill_month,'2026-12');
  assert.equal(applied.body.approver_user_id,owner);
  const entry=f.sql.prepare('SELECT * FROM entries').get();
  assert.equal(entry.type,'expense');
  assert.equal(entry.payment_source,'cc:'+account);
  assert.equal(entry.family_account_id,account);
  assert.equal(entry.transfer_target,null,'a credit purchase cannot debit bank/cash/prepaid');
  assert.equal(entry.amount,1520);
  const payable=f.sql.prepare('SELECT * FROM family_card_purchase_applied').get();
  assert.equal(payable.entry_id,entry.id);
  assert.equal(payable.homeflow_request_id,approval);
  assert.equal(payable.proposal_id,id);
  assert.equal(payable.approver_user_id,owner);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_audit').get().n,1);
  const receipt=await f.send('receipt',b);
  assert.equal(receipt.status,200);
  assert.equal(receipt.body.entry_id,entry.id);
  const replay=await f.send('execute',b);
  assert.equal(replay.status,200);
  assert.equal(replay.body.already_applied,true);
  assert.equal(f.calls.proof,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,1);
  assert.throws(()=>f.sql.prepare('DELETE FROM family_card_purchase_applied').run(),/CARD_APPLIED_IMMUTABLE/);
  assert.throws(()=>f.sql.prepare("UPDATE family_card_purchase_applied SET amount_jpy=1").run(),/CARD_APPLIED_IMMUTABLE/);
 }finally{f.close()}
});
test('forged browser, wrong user, stale version and revoked membership produce zero noncash purchases',async()=>{
 for(const type of ['invalid-hmac','browser','wrong-user','version','revoked','proof','flag']){
  const f=setup();try{
   if(type==='wrong-user'){
    const r=await f.source(['card-purchases'],'POST',
     {...f.input,expected_user_id:'someone-else'});
    assert.equal(r.status,403);
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_intents').get().n,0);
    continue;
   }
   const {b}=await f.flow();
   if(type==='version')f.sql.prepare("UPDATE family_financial_accounts SET version=2 WHERE account_id=?").run(account);
   if(type==='revoked')f.sql.prepare("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id=?").run(member);
   if(type==='proof')f.disableProof();
   if(type==='flag')f.env.KAKEIBO_CARD_PURCHASES_ENABLED='false';
   const r=await f.send('execute',b,{invalid:type==='invalid-hmac',browser:type==='browser'});
   assert.notEqual(r.status,200,JSON.stringify({type,r}));
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0,type);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,0,type);
  }finally{f.close()}
 }
});
test('failed approver audit SQL aborts entire credit purchase and retry persists once',async()=>{
 const f=setup();try{
  const {b}=await f.flow();
  f.sql.exec("CREATE TRIGGER fail_card_audit BEFORE INSERT ON family_card_purchase_audit BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END");
  const rejected=await f.send('execute',b);
  assert.notEqual(rejected.status,200);
  for(const table of ['entries','family_card_purchase_applied','family_card_purchase_audit'])
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
  f.sql.exec('DROP TRIGGER fail_card_audit');
  assert.equal((await f.send('execute',b)).status,200);
 }finally{f.close()}
});
test('card statement months clamp short months and never invent a bank payment due date',()=>{
 assert.equal(cardClosingMonth('2026-11-10',10),'2026-11');
 assert.equal(cardClosingMonth('2026-11-11',10),'2026-12');
 assert.equal(cardClosingMonth('2026-02-28',31),'2026-02');
 assert.equal(cardClosingMonth('2026-03-01',31),'2026-03');
 assert.equal(cardClosingMonth('2026-11-15',null),'2026-11');
 assert.equal(cardClosingMonth('2026-02-30',10),null);
});
