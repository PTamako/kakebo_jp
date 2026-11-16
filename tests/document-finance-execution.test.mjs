import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto,createHmac} from 'node:crypto';
import {documentFinanceRoute} from '../functions/api/internal/document-finance/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const member='22222222-2222-4222-8222-222222222222';
const owner='11111111-1111-4111-8111-111111111111';
const account='a'.repeat(32),candidate='b'.repeat(32),digest='c'.repeat(64);
const approval='55555555-5555-4555-8555-555555555555';
const secret='d'.repeat(64),homeSecret='e'.repeat(64);
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
function setup(){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
  sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 sqlite.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY,date TEXT,time TEXT,'+
  'amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,'+
  'transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT,'+
  'client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT);');
 sqlite.exec(readFileSync(new URL('../migrations/0030_document_finance_execution.sql',import.meta.url),'utf8'));
 for(const [id,role] of [[owner,'owner'],[member,'member']])
  sqlite.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
   .run(id,'primary',role,role,'active',Date.now());
 sqlite.prepare('INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?)')
  .run(account,'primary',member,'现金账户','cash','member_created',member,member);
 const statement=sql=>({bind(...params){return{
  first:async()=>sqlite.prepare(sql).get(...params)||null,
  run:async()=>({meta:{changes:sqlite.prepare(sql).run(...params).changes}}),
  runSync:()=>({meta:{changes:sqlite.prepare(sql).run(...params).changes}})
 }}});
 const DB={prepare:statement,async batch(items){sqlite.exec('BEGIN IMMEDIATE');
  try{const result=items.map(s=>s.runSync());sqlite.exec('COMMIT');return result;}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }};
 let homeCalls=0,sourceCalls=0,sourceAllowed=true,proofAllowed=true;
 const env={DB,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_DOCUMENT_FINANCE_EXECUTION_ENABLED:'true',KAKEIBO_APPROVAL_PROOF_ENABLED:'true',
  KAKEIBO_DOCUMENT_FINANCE_SECRET:secret,KAKEIBO_APPROVAL_VERIFICATION_SECRET:homeSecret,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'};
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  homeCalls++;const raw=await req.text(),t=req.headers.get('x-approval-timestamp');
  assert.equal(req.headers.get('x-approval-signature'),
   createHmac('sha256',Buffer.from(homeSecret,'hex')).update('kakeibo\n'+t+'\n'+raw).digest('hex'));
  const p=JSON.parse(raw);assert.equal(p.execution_nonce,'f'.repeat(64));
  assert.equal(p.idempotency_key,'jpda:sync:'+candidate);
  if(!proofAllowed)return Response.json({code:'not_approved'},{status:409});
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'jp-document-assistant',
   target_app:'kakebo',operation:'document.sync.finance',
   resource_type:'document_sync_candidate',request_id:approval,
   resource_id:candidate,household_id:'primary',requester_user_id:member,
   payload_sha256:digest,idempotency_key:'jpda:sync:'+candidate,
   expected_version:null,approver_user_id:owner,
   approved_at:Date.now()-1000,expires_at:Date.now()+3600000,applied:false});
 }};
 env.DOCUMENT_FINANCE_SOURCE_SERVICE={async fetch(req){
  sourceCalls++;const raw=await req.text(),t=req.headers.get('x-approval-timestamp');
  assert.equal(req.headers.get('x-approval-signature'),
   createHmac('sha256',Buffer.from(secret,'hex')).update('kakeibo:document-source-check\n'+t+'\n'+raw).digest('hex'));
  const b=JSON.parse(raw);
  if(!sourceAllowed)return Response.json({code:'revoked'},{status:409});
  return Response.json({ok:true,verified:true,applied:false,approval_id:approval,
   candidate_id:candidate,household_id:'primary',requester_user_id:member,
   payload_sha256:digest,operation_sha256:b.operation_sha256});
 }};
 const intent=async()=>{const body={request_id:approval,resource_id:candidate,
  household_id:'primary',requester_user_id:member,payload_sha256:digest,
  account_id:account,account_version:1,type:'expense',amount_jpy:1480,
  date:'2026-11-14',merchant:'セブン-イレブン',category:'食費',
  note:'文书确认',payment_source:'现金账户'};
  const op={account_id:body.account_id,account_version:body.account_version,
   type:body.type,amount_jpy:body.amount_jpy,date:body.date,merchant:body.merchant,
   category:body.category,note:body.note,payment_source:body.payment_source};
  return {...body,operation_sha256:await sha(JSON.stringify(op)),execution_nonce:'f'.repeat(64)}};
 const send=async(b,mode='execute',extra={})=>{
  const raw=JSON.stringify(b),stamp=String(Date.now());
  const signature=createHmac('sha256',Buffer.from(secret,'hex'))
   .update((mode==='receipt'?'jpda:finance-receipt':'jpda:finance-execute')+'\n'+stamp+'\n'+raw)
   .digest('hex');
  const req=new Request('https://internal.invalid/api/internal/document-finance/'+mode,{
   method:'POST',headers:{'content-type':'application/json',
   'x-approval-client':'jp-document-assistant','x-approval-timestamp':stamp,
   'x-approval-signature':extra.badSig?'0'.repeat(64):signature,
   ...(extra.browser?{origin:'https://attacker.invalid'}:{})},body:raw});
  const res=await documentFinanceRoute(req,env,[mode]);return{status:res.status,body:await res.json()};
 };
 return {sqlite,env,intent,send,
  sourceOff:()=>{sourceAllowed=false},proofOff:()=>{proofAllowed=false},
  calls:()=>({homeCalls,sourceCalls})};
}
test('document finance commits one ledger entry + journal + true executor audit atomically, replays same ID',async()=>{
 const f=setup();try{
  const body=await f.intent();
  const first=await f.send(body);
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.equal(first.body.applied,true);
  assert.equal(first.body.entry_id,1);
  assert.equal(first.body.approver_user_id,owner);
  const replay=await f.send(body);
  assert.equal(replay.status,200);
  assert.equal(replay.body.already_applied,true);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM document_finance_applied_actions').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT actor_user_id FROM family_finance_events').get().actor_user_id,owner);
  assert.equal(f.calls().homeCalls,1,'journal replay must not request another approval proof');
  const receipt=await f.send(Object.fromEntries(['request_id','resource_id','household_id',
   'requester_user_id','payload_sha256'].map(k=>[k,body[k]])),'receipt');
  assert.equal(receipt.status,200);assert.equal(receipt.body.entry_id,first.body.entry_id);
  assert.throws(()=>f.sqlite.prepare('DELETE FROM document_finance_applied_actions').run(),/DOCUMENT_FINANCE_RECEIPT_IMMUTABLE/);
 }finally{f.sqlite.close()}
});
test('missing approval, revoked source, changed account, forged signature and browser fail closed',async()=>{
 const f=setup();try{
  const intent=await f.intent();
  assert.equal((await f.send(intent,'execute',{badSig:true})).status,403);
  assert.equal((await f.send(intent,'execute',{browser:true})).status,403);
  f.proofOff();assert.equal((await f.send(intent)).status,409);
  f.sqlite.prepare('UPDATE family_financial_accounts SET version=2 WHERE account_id=?').run(account);
  assert.equal((await f.send(intent)).body.code,'ACCOUNT_CHANGED');
  f.sqlite.prepare('UPDATE family_financial_accounts SET version=1 WHERE account_id=?').run(account);
  const other=setup();try{
   other.sourceOff();
   assert.equal((await other.send(await other.intent())).body.code,'SOURCE_REVOKED_OR_CHANGED');
   assert.equal(other.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
  }finally{other.sqlite.close()}
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
 }finally{f.sqlite.close()}
});
