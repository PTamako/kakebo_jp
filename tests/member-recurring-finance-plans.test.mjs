import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {webcrypto,createHmac} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {familyMemberRecurringPlans} from '../functions/api/family-finance/member-recurring-plans.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const hh='primary',bank='b'.repeat(32),sec='c'.repeat(32)
const origin='https://kakeibo.example.test/api/family-finance/member-recurring-plans'
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('PRAGMA foreign_keys=ON')
 for(const path of ['schema.sql','migrations/0001_support_tables.sql',
  'migrations/0002_versioned_migration_tracking.sql',
  'migrations/0022_homeflow_identity_foundation.sql',
  'migrations/0023_family_financial_account_identities.sql',
  'migrations/0053_member_recurring_finance_plans.sql'])
  sql.exec(readFileSync(new URL('../'+path,import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  sql.prepare("INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) "+
   "VALUES(?,?,?,?,?,?)").run(u,hh,role,role,'active',Date.now())
 for(const [id,kind] of [[bank,'bank'],[sec,'securities']])
  sql.prepare('INSERT INTO family_financial_accounts '+
   '(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,'+
   'created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,hh,member,kind,kind,'member_created',10000,member,member)
 const db={prepare(q){return {bind(...args){return {
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(actions){
  sql.exec('BEGIN IMMEDIATE')
  try{const result=actions.map(s=>s.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_RECURRING_FINANCE_PLANS_ENABLED:'true'}
 const u={user_id:member,household_id:hh,role:'member'}
 const admin={user_id:owner,household_id:hh,role:'owner'}
 const form=(type='fixed_cost')=>({
  expected_user_id:member,idempotency_key:'member-finance-plan-20261115-'+type,
  plan_type:type,source_bank_account_id:bank,source_account_version:1,
  securities_account_id:type==='fixed_cost'?null:sec,
  securities_version:type==='fixed_cost'?null:1,
  amount_jpy:type==='fixed_cost'?5000:15000,due_day:16,
  start_month:'2026-11',end_month:'2027-11',
  category:type==='fixed_cost'?'家賃':'積立',
  merchant:type==='fixed_cost'?'家賃固定費':'SBI証券',
  fund_code:type==='fixed_cost'?null:'12345678',
  fund_name:type==='fixed_cost'?null:'インデックスファンド',
  account_type:type==='fixed_cost'?null:'tsumitate'
 })
 async function api(body,parts=['member-recurring-plans'],actor=u){
  const req=new Request(origin,{method:'POST',
   headers:{origin:new URL(origin).origin,'content-type':'application/json'},
   body:JSON.stringify(body)})
  const res=await familyMemberRecurringPlans(req,env,new URL(origin),actor,parts)
  return {status:res.status,data:await res.json()}
 }
 const count=t=>sql.prepare('SELECT COUNT(*) n FROM '+t).get().n
 return {sql,env,u,admin,form,api,count,close(){sql.close()}}
}
test('member-owned fixed fee mirrors actual manual recurring_plans row, freezes terms, and prevents old scheduler duplicate entry',async()=>{
 const f=fixture()
 try{
  const first=await f.api(f.form('fixed_cost'))
  assert.equal(first.status,201,JSON.stringify(first))
  const r=first.data.plan
  assert.equal(r.plan_type,'fixed_cost')
  assert.equal(r.source_account_version,1)
  assert.equal(f.count('recurring_plans'),1)
  const old=f.sql.prepare('SELECT * FROM recurring_plans WHERE id=?').get(r.legacy_recurring_plan_id)
  assert.equal(old.posting_mode,'manual')
  assert.equal(old.amount,5000)
  assert.equal(old.payment_source,'bank:'+bank)
  assert.equal(r.plan_resource_id,old.id)
  assert.throws(()=>f.sql.prepare('UPDATE recurring_plans SET amount=1 WHERE id=?')
   .run(old.id),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare('DELETE FROM recurring_plans WHERE id=?').run(old.id),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare("INSERT INTO entries(date,amount,client_request_id) VALUES('2026-11-16',5000,?)")
   .run('recurring_'+old.id+'_202611'),/REQUIRES_APPROVAL/)
  const again=await f.api(f.form('fixed_cost'))
  assert.equal(again.status,200)
  assert.equal(again.data.replayed,true)
  assert.equal(f.count('family_member_recurring_plans'),1)
  const change=await f.api({...f.form('fixed_cost'),amount_jpy:6000})
  assert.equal(change.status,409)
  const revoke=await f.api({expected_user_id:member,confirm_resource_id:r.plan_resource_id},
   ['member-recurring-plans',r.plan_resource_id,'revoke'])
  assert.equal(revoke.status,200)
  assert.equal(f.sql.prepare('SELECT status FROM family_member_recurring_plans').get().status,'revoked')
  assert.throws(()=>f.sql.prepare("UPDATE family_member_recurring_plans SET status='active'").run(),/CANNOT_REAUTHORIZE/)
 }finally{f.close()}
})
test('new per-member SBI plan has stable financial bank/securities owner without overwriting global investment_plans',async()=>{
 const f=fixture()
 try{
  const sbi=await f.api(f.form('sbi_tsumitate'))
  assert.equal(sbi.status,201,JSON.stringify(sbi))
  assert.equal(sbi.data.plan.fund_code,'12345678')
  assert.equal(sbi.data.plan.securities_account_id,sec)
  assert.equal(sbi.data.plan.legacy_recurring_plan_id,null)
  assert.equal(f.count('investment_plans'),0)
  const forged=await f.api({...f.form('sbi_tsumitate'),
   idempotency_key:'fake-owner-plan-new-20261115',expected_user_id:owner},['member-recurring-plans'],f.admin)
  assert.equal(forged.status,403)
  f.sql.prepare('UPDATE family_financial_accounts SET version=version+1 WHERE account_id=?').run(sec)
  const stale=await f.api({...f.form('sbi_tsumitate'),
   idempotency_key:'sbi-plan-new-after-account-version-changed'})
  assert.equal(stale.status,409)
  assert.equal(f.count('family_member_recurring_plans'),1)
 }finally{f.close()}
})

test('member frozen plan submits signed HMAC to real HomeFlow-only policy route, never becomes a ledger row',async()=>{
 const f=fixture()
 try{
  const p=(await f.api(f.form('fixed_cost'))).data.plan
  const secret='6'.repeat(64)
  f.env.KAKEIBO_RECURRING_POLICY_SUBMISSION_ENABLED='true'
  f.env.KAKEIBO_RECURRING_POLICY_SUBMISSION_SECRET=secret
  f.env.HOMEFLOW_OAUTH_ORIGIN='https://homeflow.example.test'
  let called=0
  f.env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
   called++
   assert.equal(new URL(req.url).pathname,'/api/internal/recurring-finance/policy-submit')
   assert.equal(req.headers.get('x-approval-client'),'kakeibo-recurring-policy')
   assert.equal(req.headers.get('origin'),null)
   const raw=await req.text(),b=JSON.parse(raw),stamp=req.headers.get('x-approval-timestamp')
   const expected=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('kakeibo-recurring-policy:submit\n'+stamp+'\n'+raw).digest('hex')
   assert.equal(req.headers.get('x-approval-signature'),expected)
   assert.equal(b.requester_user_id,member)
   assert.equal(b.plan_resource_id,p.plan_resource_id)
   assert.equal(b.plan_payload_sha256,p.plan_payload_sha256)
   return Response.json({ok:true,owner_approved:false,ledger_applied:false,
    plan_resource_id:b.plan_resource_id,plan_payload_sha256:b.plan_payload_sha256,
    requester_user_id:b.requester_user_id,household_id:b.household_id,
    policy:{plan_type:b.plan_type,source_account_version:b.source_account_version,
     due_day:b.due_day,max_amount_jpy:b.max_amount_jpy,
     status:'pending_owner',plan_resource_id:b.plan_resource_id}}, {status:201})
  }}
  const r=await f.api({expected_user_id:member,confirm_plan_resource_id:p.plan_resource_id},
   ['member-recurring-plans',p.plan_resource_id,'submit-policy'])
  assert.equal(r.status,201,JSON.stringify(r))
  assert.equal(r.data.owner_approved,false)
  assert.equal(r.data.ledger_applied,false)
  assert.equal(called,1)
  assert.equal(f.count('entries'),0)
  const forged=await f.api({expected_user_id:owner,confirm_plan_resource_id:p.plan_resource_id},
   ['member-recurring-plans',p.plan_resource_id,'submit-policy'])
  assert.equal(forged.status,403)
  assert.equal(called,1)
 }finally{f.close()}
})
