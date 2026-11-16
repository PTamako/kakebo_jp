import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHmac,webcrypto} from 'node:crypto'
import {familyBankTransfers} from '../functions/api/family-finance/bank-transfers.js'
import {approvedBankTransferRoute} from '../functions/api/internal/bank-transfers/[[path]].js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const hh='primary',src='b'.repeat(32),dst='c'.repeat(32)
const approval='66666666-6666-4666-8666-666666666666'
const keys={pending:'1'.repeat(64),submission:'2'.repeat(64),
 execution:'3'.repeat(64),proof:'4'.repeat(64)}
const sign=(domain,secret,stamp,raw)=>createHmac('sha256',Buffer.from(secret,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex')
const stmt=(s,q,...v)=>s.prepare(q).run(...v)
const get=(s,q,...v)=>s.prepare(q).get(...v)
const count=(s,t)=>get(s,'SELECT COUNT(*) n FROM '+t).n
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0025_family_financial_resource_owners.sql','0027_family_legacy_entry_link_audit.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);')
 sql.exec(readFileSync(new URL('../migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8'))
 for(const name of [
  '0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql','0034_family_points_foundation.sql',
  '0035_points_prepaid_atomic.sql','0036_points_card_offset.sql',
  '0037_points_transfer_exchange.sql','0038_points_earn_expiry_reversals.sql',
  '0039_points_legacy_provenance.sql','0040_points_sbi_lots.sql',
  '0041_points_transfer_atomic_refund.sql','0042_points_prepaid_refund.sql',
  '0043_points_card_offset_refund.sql','0044_sbi_cash_purchases.sql',
  '0045_sbi_cash_reversals.sql','0046_sbi_legacy_holding_review.sql',
  '0047_sbi_point_full_refund.sql','0048_posted_bank_transfers.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  stmt(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) '+
   'VALUES(?,?,?,?,?,?)',u,hh,role,role,'active',Date.now())
 for(const [account,opening] of [[src,3000],[dst,500]])
  stmt(sql,'INSERT INTO family_financial_accounts '+
   '(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,'+
   'created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)',
   account,hh,member,account,'bank','member_created',opening,member,member)
 const db={prepare(q){return {bind(...v){return {
  first:async()=>sql.prepare(q).get(...v)||null,
  all:async()=>({results:sql.prepare(q).all(...v)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...v).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...v).changes}})
 }}}},async batch(statements){sql.exec('BEGIN IMMEDIATE')
  try{const x=statements.map(y=>y.sync());sql.exec('COMMIT');return x}
  catch(e){sql.exec('ROLLBACK');throw e}}}
 let proofActive=true
 const env={APP_ENV:'production',DB:db,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_BANK_TRANSFER_ENABLED:'true',
  KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET:keys.execution,
  KAKEIBO_BANK_TRANSFER_PROOF_SECRET:keys.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'}
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const url=new URL(req.url),raw=await req.text(),stamp=req.headers.get('x-approval-timestamp')
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-bank-transfer')
  if(url.pathname.endsWith('/bank-transfer-submit')){
   assert.equal(req.headers.get('x-approval-signature'),sign('kakeibo-bank-transfer:submit',keys.submission,stamp,raw))
   const b=JSON.parse(raw)
   return Response.json({ok:true,approval_id:approval,resource_id:b.resource_id,
    payload_sha256:b.payload_sha256,household_id:b.household_id,
    requester_user_id:b.requester_user_id,expected_version:b.expected_version,
    operation:'finance.asset_transfer.bank_to_bank',applied:false})
  }
  assert.equal(url.pathname,'/api/internal/approvals/verify')
  assert.equal(req.headers.get('x-approval-signature'),
   sign('kakeibo-bank-transfer:execution-proof',keys.proof,stamp,raw))
  if(!proofActive)return Response.json({ok:false},{status:409})
  const b=JSON.parse(raw)
  assert.equal(b.idempotency_key,'kakeibo:bank-transfer:'+b.resource_id)
  assert.equal(b.execution_nonce,'f'.repeat(64))
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.asset_transfer.bank_to_bank',resource_type:'bank_transfer_posted',
   request_id:b.request_id,resource_id:b.resource_id,
   household_id:b.household_id,requester_user_id:b.requester_user_id,
   payload_sha256:b.payload_sha256,idempotency_key:b.idempotency_key,
   expected_version:1,approver_user_id:owner,approved_at:Date.now()-1000,
   expires_at:Date.now()+100000,applied:false})
 }}
 const url=new URL('https://kakeibo.example.test/api/family-finance/bank-transfers')
 const form={expected_user_id:member,idempotency_key:'posted-bank-transfer-20261115-01',
  source_account_id:src,source_version:1,target_account_id:dst,target_version:1,
  debit_date:'2026-11-13',credit_date:'2026-11-14',amount_jpy:1500,
  source_bank_reference:'source-bank-confirmed-20261113-01',
  target_bank_reference:'target-bank-confirmed-20261114-01',
  bank_debit_posted:true,bank_credit_posted:true}
 async function source(parts=['bank-transfers'],body=form,actor={user_id:member,household_id:hh,role:'member'}){
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)})
  const res=await familyBankTransfers(req,env,url,actor,parts)
  return {status:res.status,data:await res.json()}
 }
 async function target(mode,b,{badSign=false}={}){
  const wire=mode==='execute'?{...b,execution_nonce:'f'.repeat(64)}:b
  const raw=JSON.stringify(wire),stamp=String(Date.now())
  const req=new Request('https://kakeibo.internal/api/internal/bank-transfers/'+mode,{
   method:'POST',headers:{'content-type':'application/json','x-approval-client':'homeflow',
    'x-approval-timestamp':stamp,'x-approval-signature':badSign?'0'.repeat(64):
     sign('homeflow:bank-transfer-'+mode,keys.execution,stamp,raw)},body:raw})
  const response=await approvedBankTransferRoute(req,env,[mode])
  return {status:response.status,data:await response.json()}
 }
 async function prepare(){
  const p=await source();assert.equal(p.status,201,JSON.stringify(p))
  const requestId=p.data.prepared.request_id
  const sub=await source(['bank-transfers',requestId,'submit'],{expected_user_id:member})
  assert.equal(sub.status,200,JSON.stringify(sub))
  return {request_id:approval,resource_id:requestId,household_id:hh,
   requester_user_id:member,payload_sha256:p.data.prepared.payload_sha256}
 }
 return {sql,db,env,source,target,prepare,form,disableProof(){proofActive=false},close(){sql.close()}}
}
test('posted bank-to-bank, 2 confirmed statements: single balanced transfer, immutable proof and receipt replay',async()=>{
 const f=fixture();try{
  const b=await f.prepare()
  assert.equal(count(f.sql,'entries'),0)
  const pending=await f.target('receipt',b);assert.equal(pending.status,404)
  const forged=await f.target('execute',b,{badSign:true});assert.equal(forged.status,403)
  const posted=await f.target('execute',b)
  assert.equal(posted.status,200,JSON.stringify(posted))
  assert.equal(posted.data.amount_jpy,1500)
  assert.equal(posted.data.entry_type,'transfer')
  assert.equal(posted.data.balance_conserving,true)
  assert.equal(posted.data.source_account_id,src)
  assert.equal(posted.data.target_account_id,dst)
  const row=get(f.sql,'SELECT * FROM entries')
  assert.equal(row.type,'transfer')
  assert.equal(row.payment_source,'bank:'+src)
  assert.equal(row.transfer_target,'bank:'+dst)
  assert.equal(row.family_account_id,src)
  assert.equal(row.family_transfer_target_account_id,dst)
  assert.equal(count(f.sql,'family_bank_transfer_posted_evidence'),1)
  assert.equal(count(f.sql,'family_bank_transfers_applied'),1)
  assert.equal(count(f.sql,'family_bank_transfer_actor_audit'),1)
  assert.equal(count(f.sql,'entries'),1)
  assert.equal(get(f.sql,"SELECT COUNT(*) n FROM entries WHERE type IN ('income','expense')").n,0)
  assert.equal(3000-1500,1500)
  assert.equal(500+1500,2000)
  assert.equal((await f.target('receipt',b)).data.already_applied,true)
  assert.equal((await f.target('execute',b)).data.already_applied,true)
  assert.equal(count(f.sql,'family_bank_transfers_applied'),1)
  assert.throws(()=>stmt(f.sql,'DELETE FROM family_bank_transfers_applied'),/IMMUTABLE/)
  assert.throws(()=>stmt(f.sql,'UPDATE family_bank_transfer_posted_evidence SET amount_jpy=1'),/IMMUTABLE/)
  assert.throws(()=>stmt(f.sql,'DELETE FROM entries'),/BANK_TRANSFER_ENTRY_IMMUTABLE/)
 }finally{f.close()}
})
test('missing posted credit/debit, foreign source, stale CAS, overdraw and revoked approval always fail closed',async()=>{
 for(const kind of ['credit','debit','foreign','cas','overdraw','revoked','audit']){
  const f=fixture();try{
   if(kind==='credit'||kind==='debit'){
    const bad=await f.source(undefined,{...f.form,
     ...(kind==='credit'?{bank_credit_posted:false}:{bank_debit_posted:false})})
    assert.equal(bad.status,400,kind)
    assert.equal(count(f.sql,'family_bank_transfer_intents'),0)
    continue
   }
   if(kind==='foreign'){
    stmt(f.sql,"UPDATE family_financial_accounts SET is_archived=1 WHERE account_id=?",dst)
    const bad=await f.source();assert.notEqual(bad.status,201)
    assert.equal(count(f.sql,'entries'),0)
    continue
   }
   const b=await f.prepare()
   if(kind==='cas')stmt(f.sql,'UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?',src)
   if(kind==='overdraw')stmt(f.sql,"UPDATE family_financial_accounts SET opening_balance=100 WHERE account_id=?",src)
   if(kind==='revoked')f.disableProof()
   if(kind==='audit')f.sql.exec("CREATE TRIGGER fail_bank_transfer_actor BEFORE INSERT ON family_bank_transfer_actor_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END;")
   const failed=await f.target('execute',b)
   assert.notEqual(failed.status,200,kind)
   for(const table of ['family_bank_transfer_posted_evidence','family_bank_transfers_applied',
    'family_bank_transfer_actor_audit','entries'])
    assert.equal(count(f.sql,table),0,kind+':'+table)
  }finally{f.close()}
 }
})
test('source bank statement reference cannot also pay card or SBI and all partial insertions rollback',async()=>{
 const f=fixture();try{
  const b=await f.prepare()
  const posted=await f.target('execute',b);assert.equal(posted.status,200)
  const e=get(f.sql,'SELECT * FROM family_bank_transfer_posted_evidence')
  assert.throws(()=>stmt(f.sql,'INSERT INTO family_card_bank_debit_evidence '+
   "(evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,"+
   "evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,'owner_confirmed_statement',?)",
   'd'.repeat(32),hh,src,1,e.source_reference_hash,'2026-11-13',1500,Date.now()),
  /BANK_TRANSFER_STATEMENT_ALREADY_USED/)
  assert.throws(()=>stmt(f.sql,'INSERT INTO family_sbi_cash_bank_evidence '+
   "(evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,"+
   "evidence_kind,recorded_at) VALUES(?,?,?,?,?,?,?,'owner_confirmed_statement',?)",
   'e'.repeat(32),hh,src,1,e.source_reference_hash,'2026-11-13',1500,Date.now()),
  /BANK_TRANSFER_STATEMENT_ALREADY_USED/)
 }finally{f.close()}
})
