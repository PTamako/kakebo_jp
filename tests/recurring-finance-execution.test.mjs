import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {webcrypto,createHmac} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {familyMemberRecurringPlans} from '../functions/api/family-finance/member-recurring-plans.js'
import {familyRecurringOccurrences} from '../functions/api/family-finance/recurring-occurrences.js'
import {recurringFinanceIndependentReceipt} from '../functions/api/internal/recurring-finance/receipt.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const member='22222222-2222-4222-8222-222222222222',owner='11111111-1111-4111-8111-111111111111'
const bank='b'.repeat(32),sec='c'.repeat(32),hh='primary'
const url=new URL('https://kakeibo.test/api/family-finance/recurring-occurrences')
const secrets={reserve:'2'.repeat(64),proof:'3'.repeat(64),record:'4'.repeat(64),receipt:'5'.repeat(64)}
const sign=(s,domain,t,raw)=>createHmac('sha256',Buffer.from(s,'hex')).update(domain+'\n'+t+'\n'+raw).digest('hex')
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const wireKeys=['occurrence_id','policy_id','household_id','member_user_id','plan_resource_id','plan_payload_sha256','source_account_version','period_key','due_date','amount_jpy','entry_intent_sha256']
function setup(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('PRAGMA foreign_keys=ON')
 for(const p of ['schema.sql','migrations/0001_support_tables.sql',
  'migrations/0002_versioned_migration_tracking.sql',
  'migrations/0022_homeflow_identity_foundation.sql',
  'migrations/0023_family_financial_account_identities.sql'])
  sql.exec(readFileSync(new URL('../'+p,import.meta.url),'utf8'))
 sql.exec('ALTER TABLE entries ADD COLUMN family_account_id TEXT; ALTER TABLE entries ADD COLUMN family_transfer_target_account_id TEXT')
 sql.exec('CREATE TABLE family_sbi_cash_bank_evidence(bank_account_id TEXT,reference_hash TEXT)')
 sql.exec('CREATE TABLE family_card_bank_debit_evidence(bank_account_id TEXT,reference_hash TEXT)')
 sql.exec('CREATE TABLE family_sbi_cash_refund_evidence(bank_account_id TEXT,bank_refund_hash TEXT)')
 sql.exec('CREATE TABLE family_bank_transfer_posted_evidence(source_account_id TEXT,source_reference_hash TEXT,target_account_id TEXT,target_reference_hash TEXT)')
 sql.exec('CREATE TABLE family_cross_bank_journal(source_account_id TEXT,source_reference_hash TEXT,target_account_id TEXT,credit_reference_hash TEXT)')
 sql.exec('CREATE TABLE family_sbi_cash_lots(broker_reference_hash TEXT)')
 sql.exec('CREATE TABLE family_sbi_point_lots(broker_reference_hash TEXT)')
 for(const p of ['0053_member_recurring_finance_plans.sql','0054_recurring_finance_ledger_execution.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+p,import.meta.url),'utf8'))
 for(const [u,r] of [[owner,'owner'],[member,'member']])
  sql.prepare("INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)")
   .run(u,hh,r,r,'active',Date.now())
 for(const [a,k] of [[bank,'bank'],[sec,'securities']])
  sql.prepare('INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,opening_balance,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(a,hh,member,k,k,'member_created',100000,member,member)
 const db={prepare(q){return{bind(...p){return{
  first:async()=>sql.prepare(q).get(...p)||null,
  all:async()=>({results:sql.prepare(q).all(...p)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...p).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...p).changes}})
 }}}},async batch(a){sql.exec('BEGIN IMMEDIATE');try{
  const o=a.map(x=>x.sync());sql.exec('COMMIT');return o
 }catch(e){sql.exec('ROLLBACK');console.error('RECURRING_SQLITE_BATCH_ERROR:',e.message);throw e}}}
 const env={APP_ENV:'production',DB:db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_RECURRING_FINANCE_PLANS_ENABLED:'true',KAKEIBO_RECURRING_EXECUTION_ENABLED:'true',
  KAKEIBO_RECURRING_PAYLOAD_KEY:'1'.repeat(64),
  KAKEIBO_RECURRING_HOMEFLOW_RESERVATION_SECRET:secrets.reserve,
  KAKEIBO_RECURRING_HOMEFLOW_PROOF_SECRET:secrets.proof,
  KAKEIBO_RECURRING_HOMEFLOW_RECORD_SECRET:secrets.record,
  KAKEIBO_RECURRING_RECEIPT_SECRET:secrets.receipt,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.test'}
 let rejectProof=false,rejectRecord=false,reads=0
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const mode=new URL(req.url).pathname.split('/').at(-1),stamp=req.headers.get('x-approval-timestamp')
  const raw=await req.text(),b=JSON.parse(raw)
  assert.equal(req.headers.get('x-approval-signature'),
   sign(secrets[mode==='execution-proof'?'proof':mode],
    'kakeibo-recurring-finance:'+mode,stamp,raw))
  if(mode==='reserve')return Response.json({ok:true,reserved_only:true,execution_permitted:false,...b})
  if(mode==='execution-proof'){
   if(rejectProof)return Response.json({ok:false},{status:409})
   const p=sql.prepare('SELECT plan_type FROM family_member_recurring_plans WHERE plan_resource_id=?').get(b.plan_resource_id)
   return Response.json({ok:true,execution_permitted:true,ledger_applied:false,...b,plan_type:p.plan_type,
    owner_authorizer_user_id:owner,bank_statements_verified_by_institution:false,
    broker_transactions_verified_by_institution:false,proof_expires_at:Date.now()+20000})
  }
  if(rejectRecord)return Response.json({ok:false},{status:503})
  const fields=Object.fromEntries(wireKeys.map(k=>[k,b[k]])),proof=JSON.stringify(fields),time=String(Date.now())
  const check=await recurringFinanceIndependentReceipt(new Request('https://kakeibo.internal/api/internal/recurring-finance/receipt',{
   method:'POST',headers:{'content-type':'application/json','x-approval-client':'homeflow-recurring-finance',
    'x-approval-timestamp':time,'x-approval-signature':sign(secrets.receipt,'homeflow:recurring-finance-receipt',time,proof)},
   body:proof}),env)
  assert.equal(check.status,200)
  const receipt=await check.json()
  for(const key of wireKeys)assert.equal(receipt[key],b[key],key)
  assert.equal(receipt.target_journal_sha256,b.target_journal_sha256)
  reads++
  return Response.json({ok:true,ledger_applied:true,occurrence_id:b.occurrence_id,
   target_journal_sha256:b.target_journal_sha256,target_entry_id:b.target_entry_id})
 }}
 const u={user_id:member,household_id:hh,role:'member'}
 async function call(handler,parts,data){
  const req=new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},body:JSON.stringify(data)})
  const r=await handler(req,env,url,u,parts)
  return {status:r.status,data:await r.json()}
 }
 async function prepare(type){
  const date=today(),month=date.slice(0,7),due=Math.min(28,Number(date.slice(-2)))
  const body={expected_user_id:member,idempotency_key:'plan-'+type+'-'+month,
   plan_type:type,source_bank_account_id:bank,source_account_version:1,
   securities_account_id:type==='fixed_cost'?null:sec,securities_version:type==='fixed_cost'?null:1,
   amount_jpy:type==='fixed_cost'?5000:15000,due_day:due,start_month:month,end_month:month,
   category:type==='fixed_cost'?'住居':'積立',merchant:type==='fixed_cost'?'家賃':'SBI証券',
   fund_code:type==='fixed_cost'?null:'12345678',fund_name:type==='fixed_cost'?null:'Index Fund',
   account_type:type==='fixed_cost'?null:'tsumitate'}
  const p=await call(familyMemberRecurringPlans,['member-recurring-plans'],body)
  assert.equal(p.status,201,JSON.stringify(p))
  const o={expected_user_id:member,policy_id:crypto.randomUUID(),
   plan_resource_id:p.data.plan.plan_resource_id,period_key:month,debit_date:date,
   bank_reference:'bank-statement-'+type+'-202611',bank_debit_posted:true,
   confirmed_units:type==='fixed_cost'?null:150000,
   broker_trade_reference:type==='fixed_cost'?null:'sbi-broker-trade-202611',
   trade_date:type==='fixed_cost'?null:date,effective_date:type==='fixed_cost'?null:date,
   broker_order_executed:type!=='fixed_cost'}
  const ready=await call(familyRecurringOccurrences,['recurring-occurrences'],o)
  assert.equal(ready.status,201,JSON.stringify(ready))
  return ready.data.prepared.occurrence_id
 }
 async function execute(id){
  return call(familyRecurringOccurrences,['recurring-occurrences',id,'execute'],
   {expected_user_id:member,confirm_occurrence_id:id})
 }
 const count=t=>sql.prepare('SELECT COUNT(*) n FROM '+t).get().n
 return {sql,env,prepare,execute,count,disableProof:()=>{rejectProof=true},
  disableRecord:()=>{rejectRecord=true},enableRecord:()=>{rejectRecord=false},
  get reads(){return reads},close:()=>sql.close()}
}
for(const type of ['fixed_cost','sbi_tsumitate']){
 test('monthly real D1 execution '+type+' is exactly once and independently journal-verified',async()=>{
  const f=setup()
  try{
   const id=await f.prepare(type)
   assert.equal(f.count('entries'),0)
   const result=await f.execute(id)
   assert.equal(result.status,200,JSON.stringify(result))
   assert.equal(result.data.homeflow_receipt_confirmed,true)
   assert.equal(f.count('entries'),1)
   assert.equal(f.count('family_recurring_execution_applied'),1)
   assert.equal(f.count('family_recurring_execution_audit'),1)
   const entry=f.sql.prepare('SELECT * FROM entries').get()
   assert.equal(entry.type,type==='fixed_cost'?'expense':'transfer')
   if(type==='sbi_tsumitate'){
    const lot=f.sql.prepare('SELECT * FROM family_recurring_sbi_lots').get()
    assert.equal(lot.confirmed_units,150000)
    assert.equal(lot.acquisition_cost_jpy,15000)
    assert.equal(lot.institution_broker_reconciled,0)
    assert.equal(lot.included_in_tracked_assets,0)
    assert.equal(result.data.market_value_jpy,null)
   }else assert.equal(f.count('family_recurring_sbi_lots'),0)
   const retry=await f.execute(id)
   assert.equal(retry.status,200)
   assert.equal(retry.data.already_applied,true)
   assert.equal(f.count('entries'),1)
   assert.equal(f.reads,2)
   assert.throws(()=>f.sql.prepare('DELETE FROM entries').run(),/IMMUTABLE/)
  }finally{f.close()}
 })
}
test('rejected policy proof or forced audit rollback does not debit bank',async()=>{
 for(const fault of ['proof','audit']){
  const f=setup()
  try{
   const id=await f.prepare('sbi_tsumitate')
   if(fault==='proof')f.disableProof()
   else f.sql.exec("CREATE TRIGGER fail_recurring_audit BEFORE INSERT ON family_recurring_execution_audit BEGIN SELECT RAISE(ABORT,'AUDIT_BLOCK'); END;")
   const result=await f.execute(id)
   assert.notEqual(result.status,200)
   for(const t of ['entries','family_recurring_execution_applied','family_recurring_sbi_lots'])
    assert.equal(f.count(t),0)
  }finally{f.close()}
 }
})
test('lost external HomeFlow receipt leaves durable Kakeibo one-time ledger and original-ID readback',async()=>{
 const f=setup()
 try{
  const id=await f.prepare('fixed_cost')
  f.disableRecord()
  const uncertain=await f.execute(id)
  assert.equal(uncertain.status,202,JSON.stringify(uncertain))
  assert.equal(uncertain.data.homeflow_receipt_confirmed,false)
  f.enableRecord()
  const retried=await f.execute(id)
  assert.equal(retried.status,200,JSON.stringify(retried))
  assert.equal(retried.data.already_applied,true)
  assert.equal(f.count('entries'),1)
 }finally{f.close()}
})
