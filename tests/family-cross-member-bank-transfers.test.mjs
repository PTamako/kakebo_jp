import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHmac,webcrypto} from 'node:crypto'
import {familyCrossMemberBankTransfers} from '../functions/api/family-finance/cross-member-bank-transfers.js'
import {approvedBankTransferRoute} from '../functions/api/internal/bank-transfers/[[path]].js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const hh='primary',src='b'.repeat(32),dst='c'.repeat(32)
const approval='66666666-6666-4666-8666-666666666666'
const consentId='77777777-7777-4777-8777-777777777777'
const keys={pending:'1'.repeat(64),submission:'2'.repeat(64),
 execution:'3'.repeat(64),approval:'4'.repeat(64),consent:'5'.repeat(64)}
const sign=(domain,secret,t,raw)=>createHmac('sha256',Buffer.from(secret,'hex'))
 .update(domain+'\n'+t+'\n'+raw).digest('hex')
const add=(s,q,...args)=>s.prepare(q).run(...args)
const get=(s,q,...args)=>s.prepare(q).get(...args)
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
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT)')
 sql.exec(readFileSync(new URL('../migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8'))
 for(const name of ['0031_family_card_purchase_execution.sql',
  '0032_family_card_settlement_foundation.sql','0033_member_prepaid_actions.sql',
  '0034_family_points_foundation.sql','0035_points_prepaid_atomic.sql',
  '0036_points_card_offset.sql','0037_points_transfer_exchange.sql',
  '0038_points_earn_expiry_reversals.sql','0039_points_legacy_provenance.sql',
  '0040_points_sbi_lots.sql','0041_points_transfer_atomic_refund.sql',
  '0042_points_prepaid_refund.sql','0043_points_card_offset_refund.sql',
  '0044_sbi_cash_purchases.sql','0045_sbi_cash_reversals.sql',
  '0046_sbi_legacy_holding_review.sql','0047_sbi_point_full_refund.sql',
  '0048_posted_bank_transfers.sql','0049_cross_member_bank_transfers.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  add(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   u,hh,role,role,'active',Date.now())
 for(const [account,u,opening] of [[src,member,3000],[dst,owner,500]])
  add(sql,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,'+
   'account_kind,origin,opening_balance,created_by_user_id,updated_by_user_id) '+
   'VALUES(?,?,?,?,?,?,?,?,?)',account,hh,u,account,'bank','member_created',opening,u,u)
 const db={prepare(q){return {bind(...v){return{
  first:async()=>sql.prepare(q).get(...v)||null,
  all:async()=>({results:sql.prepare(q).all(...v)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...v).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...v).changes}})
 }}}},async batch(actions){sql.exec('BEGIN IMMEDIATE')
  try{const result=actions.map(x=>x.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}}}
 let validConsent=true,validApproval=true
 const env={APP_ENV:'production',DB:db,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_BANK_TRANSFER_ENABLED:'true',
  KAKEIBO_CROSS_MEMBER_BANK_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:keys.pending,
  KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET:keys.submission,
  KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET:keys.execution,
  KAKEIBO_BANK_TRANSFER_PROOF_SECRET:keys.approval,
  KAKEIBO_CROSS_MEMBER_PROOF_SECRET:keys.consent,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'}
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const path=new URL(req.url).pathname,raw=await req.text()
  const b=JSON.parse(raw),t=req.headers.get('x-approval-timestamp')
  if(path.endsWith('/cross-member/consent-proof')){
   assert.equal(req.headers.get('x-approval-client'),'kakeibo-cross-member')
   assert.equal(req.headers.get('x-approval-signature'),
    sign('kakeibo-cross-member:consent-proof',keys.consent,t,raw))
   if(!validConsent)return Response.json({ok:false},{status:409})
   assert.equal(b.consent_id,consentId)
   assert.equal(b.source_user_id,member)
   assert.equal(b.recipient_user_id,owner)
   return Response.json({ok:true,consent_verified:true,ledger_applied:false,
    bank_statements_verified:false,target_ledger_authorized:false,
    ...b,owner_authorizer_user_id:owner,consent_version:3,
    valid_until:Date.now()+600000})
  }
  if(path.endsWith('/bank-transfer-submit')){
   assert.equal(req.headers.get('x-approval-client'),'kakeibo-bank-transfer')
   assert.equal(req.headers.get('x-approval-signature'),
    sign('kakeibo-bank-transfer:submit',keys.submission,t,raw))
   return Response.json({ok:true,approval_id:approval,resource_id:b.resource_id,
    payload_sha256:b.payload_sha256,household_id:b.household_id,
    requester_user_id:b.requester_user_id,expected_version:b.expected_version,
    operation:'finance.asset_transfer.bank_to_bank',applied:false})
  }
  assert.equal(path,'/api/internal/approvals/verify')
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-bank-transfer')
  assert.equal(req.headers.get('x-approval-signature'),
   sign('kakeibo-bank-transfer:execution-proof',keys.approval,t,raw))
  if(!validApproval)return Response.json({ok:false},{status:409})
  assert.equal(b.idempotency_key,'kakeibo:bank-transfer:'+b.resource_id)
  assert.equal(b.execution_nonce,'f'.repeat(64))
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   operation:'finance.asset_transfer.bank_to_bank',resource_type:'bank_transfer_posted',
   request_id:b.request_id,resource_id:b.resource_id,
   household_id:b.household_id,requester_user_id:b.requester_user_id,
   payload_sha256:b.payload_sha256,idempotency_key:b.idempotency_key,
   expected_version:1,approver_user_id:owner,approved_at:Date.now()-1000,
   expires_at:Date.now()+600000,applied:false})
 }}
 const url=new URL('https://kakeibo.example.test/api/family-finance/cross-member-bank-transfers')
 const sender={user_id:member,household_id:hh,role:'member'}
 const receiver={user_id:owner,household_id:hh,role:'owner'}
 const sourceForm={expected_user_id:member,idempotency_key:'cross-member-bank-20261115-01',
  recipient_user_id:owner,source_account_id:src,source_version:1,target_account_id:dst,
  target_version:1,debit_date:'2026-11-13',amount_jpy:1500,
  source_bank_reference:'source-bank-posted-20261113-01',bank_debit_posted:true}
 const creditForm={expected_user_id:owner,credit_date:'2026-11-14',
  amount_jpy:1500,target_bank_reference:'target-bank-posted-20261114-01',
  bank_credit_posted:true}
 async function source(parts=['cross-member-bank-transfers'],body=sourceForm,actor=sender){
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)})
  const res=await familyCrossMemberBankTransfers(req,env,url,actor,parts)
  return {status:res.status,data:await res.json()}
 }
 async function target(mode,b,badSign=false){
  const wire=mode==='execute'?{...b,execution_nonce:'f'.repeat(64)}:b
  const raw=JSON.stringify(wire),t=String(Date.now())
  const req=new Request('https://kakeibo.internal/api/internal/bank-transfers/'+mode,{
   method:'POST',headers:{'content-type':'application/json','x-approval-client':'homeflow',
   'x-approval-timestamp':t,'x-approval-signature':badSign?'0'.repeat(64):
    sign('homeflow:bank-transfer-'+mode,keys.execution,t,raw)},body:raw})
  const res=await approvedBankTransferRoute(req,env,[mode])
  return {status:res.status,data:await res.json()}
 }
 async function setup(){
  const p=await source();assert.equal(p.status,201,JSON.stringify(p))
  const id=p.data.prepared.request_id
  const c=await source(['cross-member-bank-transfers',id,'recipient'],creditForm,receiver)
  assert.equal(c.status,201,JSON.stringify(c))
  const sub=await source(['cross-member-bank-transfers',id,'submit'],
   {expected_user_id:member,consent_id:consentId})
  assert.equal(sub.status,200,JSON.stringify(sub))
  return {request_id:approval,resource_id:id,household_id:hh,requester_user_id:member,
   payload_sha256:p.data.prepared.payload_sha256}
 }
 return {sql,env,source,target,setup,sourceForm,creditForm,receiver,
  disableConsent(){validConsent=false},disableApproval(){validApproval=false},close(){sql.close()}}
}
test('independent member debit + owner credit + consent + signed approval: one immutable double-sided bank transfer',async()=>{
 const f=fixture();try{
  const p=await f.source()
  assert.equal(p.status,201,JSON.stringify(p))
  const id=p.data.prepared.request_id
  const before=await f.source(['cross-member-bank-transfers',id,'submit'],
   {expected_user_id:member,consent_id:consentId})
  assert.equal(before.status,409)
  const forged=await f.source(['cross-member-bank-transfers',id,'recipient'],
   f.creditForm,{user_id:member,household_id:hh,role:'member'})
  assert.notEqual(forged.status,201)
  const confirmed=await f.source(['cross-member-bank-transfers',id,'recipient'],
   f.creditForm,f.receiver)
  assert.equal(confirmed.status,201,JSON.stringify(confirmed))
  assert.equal(count(f.sql,'entries'),0)
  const sub=await f.source(['cross-member-bank-transfers',id,'submit'],
   {expected_user_id:member,consent_id:consentId})
  assert.equal(sub.status,200,JSON.stringify(sub))
  const b={request_id:approval,resource_id:id,household_id:hh,
   requester_user_id:member,payload_sha256:p.data.prepared.payload_sha256}
  assert.equal((await f.target('execute',b,true)).status,403)
  assert.equal((await f.target('receipt',b)).status,404)
  const first=await f.target('execute',b)
  assert.equal(first.status,200,JSON.stringify(first))
  assert.equal(first.data.cross_member,true)
  assert.equal(first.data.source_owner_user_id,member)
  assert.equal(first.data.target_owner_user_id,owner)
  assert.equal(first.data.consent_id,consentId)
  assert.equal(first.data.bank_statements_verified_by_institution,false)
  assert.equal(first.data.amount_jpy,1500)
  assert.equal(first.data.entry_type,'transfer')
  assert.equal(first.data.balance_conserving,true)
  assert.equal(count(f.sql,'entries'),1)
  assert.equal(count(f.sql,'family_cross_bank_journal'),1)
  assert.equal(count(f.sql,'family_cross_bank_actor_audit'),1)
  assert.equal(get(f.sql,'SELECT type FROM entries').type,'transfer')
  assert.equal((await f.target('receipt',b)).data.already_applied,true)
  assert.equal((await f.target('execute',b)).data.already_applied,true)
  assert.equal(count(f.sql,'entries'),1)
  assert.throws(()=>add(f.sql,'DELETE FROM family_cross_bank_journal'),/IMMUTABLE/)
  assert.throws(()=>add(f.sql,'UPDATE family_cross_bank_recipient_evidence SET amount_jpy=1'),/IMMUTABLE/)
  assert.throws(()=>add(f.sql,'DELETE FROM entries'),/CROSS_BANK_ENTRY_IMMUTABLE/)
 }finally{f.close()}
})
test('disabled/revoked consent, proof, CAS, negative balance and audit failures never add partial finance entries',async()=>{
 for(const kind of ['consent','approval','cas','balance','audit','recipient']){
  const f=fixture();try{
   const b=await f.setup()
   if(kind==='consent')f.disableConsent()
   if(kind==='approval')f.disableApproval()
   if(kind==='cas')add(f.sql,'UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?',dst)
   if(kind==='balance')add(f.sql,'UPDATE family_financial_accounts SET opening_balance=100 WHERE account_id=?',src)
   if(kind==='audit')f.sql.exec("CREATE TRIGGER reject_cross_audit BEFORE INSERT ON family_cross_bank_actor_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END")
   if(kind==='recipient')add(f.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",owner)
   const r=await f.target('execute',b)
   assert.notEqual(r.status,200,kind+':'+JSON.stringify(r))
   for(const t of ['entries','family_cross_bank_journal','family_cross_bank_actor_audit'])
    assert.equal(count(f.sql,t),0,kind+':'+t)
  }finally{f.close()}
 }
})
test('source cannot create recipient confirmation; amount and reference cannot silently change',async()=>{
 const f=fixture();try{
  const p=await f.source();assert.equal(p.status,201)
  const id=p.data.prepared.request_id
  const wrong=await f.source(['cross-member-bank-transfers',id,'recipient'],
   {...f.creditForm,amount_jpy:100},f.receiver)
  assert.equal(wrong.status,409)
  const c=await f.source(['cross-member-bank-transfers',id,'recipient'],f.creditForm,f.receiver)
  assert.equal(c.status,201)
  const replay=await f.source(['cross-member-bank-transfers',id,'recipient'],f.creditForm,f.receiver)
  assert.equal(replay.data.replayed,true)
  const tamper=await f.source(['cross-member-bank-transfers',id,'recipient'],
   {...f.creditForm,target_bank_reference:'different-bank-statement-xyz'},f.receiver)
  assert.equal(tamper.status,409)
  assert.equal(count(f.sql,'family_cross_bank_recipient_evidence'),1)
  const duplicated=await f.source()
  assert.equal(duplicated.data.replayed,true)
  assert.equal(count(f.sql,'family_cross_bank_intents'),1)
 }finally{f.close()}
})
