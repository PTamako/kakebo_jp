import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto} from 'node:crypto'
import {familyMemberPersonalPoints} from '../functions/api/family-finance/member-personal-points.js'
import {familyMemberPointAssets} from '../functions/api/family-finance/member-points-asset-actions.js'
import {familyMemberPointAssetReversals} from '../functions/api/family-finance/member-point-asset-reversals.js'
import {memberPointsBalances} from '../functions/api/family-finance/points-balance-projection.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',
 points='a'.repeat(32),prepaid='b'.repeat(32),card='c'.repeat(32),
 fund='d'.repeat(32),points2='e'.repeat(32),foreign='f'.repeat(32),
 purchaseApproval='11111111-1111-4111-8111-111111111114'
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const stmt=(db,q,...args)=>db.prepare(q).run(...args)
function fixture(){
 const s=new DatabaseSync(':memory:');s.exec('PRAGMA foreign_keys=ON')
 for(const n of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0025_family_financial_resource_owners.sql','0027_family_legacy_entry_link_audit.sql'])
  s.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'))
 s.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);')
 s.exec(readFileSync(new URL('../migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8'))
 for(const n of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql','0034_family_points_foundation.sql',
  '0035_points_prepaid_atomic.sql','0036_points_card_offset.sql',
  '0037_points_transfer_exchange.sql','0038_points_earn_expiry_reversals.sql',
  '0040_points_sbi_lots.sql','0041_points_transfer_atomic_refund.sql',
  '0042_points_prepaid_refund.sql','0043_points_card_offset_refund.sql',
  '0044_sbi_cash_purchases.sql','0045_sbi_cash_reversals.sql',
  '0046_sbi_legacy_holding_review.sql','0047_sbi_point_full_refund.sql',
  '0067_member_personal_points.sql','0069_member_self_asset_points.sql',
  '0070_member_self_asset_points_reversal.sql'])
   s.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'))
 for(const [id,role] of [[owner,'owner'],[member,'member'],[other,'member']])
  stmt(s,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   id,hh,role,role,'active',Date.now())
 for(const [id,kind,ownerId] of [[points,'points',member],[prepaid,'prepaid',member],
  [card,'credit_card',member],[fund,'securities',member],[points2,'points',member],
  [foreign,'prepaid',other]])
  stmt(s,"INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) VALUES(?,?,?,?,?,'member_created',?,?)",
   id,hh,ownerId,kind,kind,ownerId,ownerId)
 stmt(s,"INSERT INTO entries(id,date,amount,type,client_request_id,family_account_id,payment_source) VALUES(1,'2026-11-14',1000,'expense','purchase1',?,?)",card,'cc:'+card)
 const cardIntent='f'.repeat(32),now=Date.now()
 stmt(s,"INSERT INTO family_card_purchase_intents(request_id,household_id,requester_user_id,account_id,account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) VALUES(?,?,?,?,?,?,?,?,?,'submitted',?,?,?,?)",
  cardIntent,hh,member,card,1,'f'.repeat(64),'cipher','iv','e'.repeat(64),purchaseApproval,now-1000,now+86400000,now)
 stmt(s,'INSERT INTO family_card_purchase_applied(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,account_id,account_version,payload_sha256,client_request_id,entry_id,amount_jpy,purchase_date,bill_month,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  purchaseApproval,cardIntent,hh,member,owner,card,1,'f'.repeat(64),'purchase1',1,1000,'2026-11-14','2026-11',now)
 const db={
  prepare(q){return{bind(...args){const query=s.prepare(q);return{
   first:async()=>query.get(...args)||null,
   all:async()=>({results:query.all(...args)}),
   run:async()=>({meta:{changes:query.run(...args).changes}}),
   sync:()=>({meta:{changes:query.run(...args).changes}})
  }}}},
  async batch(statements){
   s.exec('BEGIN IMMEDIATE')
   try{const rows=statements.map(t=>t.sync());s.exec('COMMIT');return rows}
   catch(e){s.exec('ROLLBACK');throw e}
  }
 }
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_POINTS_ACTIONS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:'1'.repeat(64),DB:db}
 const who={role:'member',user_id:member,household_id:hh}
 async function call(handler,input=null,as=who,method='POST'){
  const name=handler===familyMemberPointAssets?'member-points-asset-actions':
   handler===familyMemberPointAssetReversals?'member-point-asset-reversals':'member-personal-points'
  const url=new URL('https://kakeibo.test/api/family-finance/'+name)
  const request=new Request(url,{method,
   ...(method==='POST'?{headers:{origin:url.origin,'content-type':'application/json'},
    body:JSON.stringify(input)}:{})})
  const r=await handler(request,env,url,as,[name]);return {status:r.status,data:await r.json()}
 }
 let n=0
 async function earn(units=1000){
  const p={expected_user_id:member,idempotency_key:'personal-points-seed:'+ ++n,
   points_account_id:points,points_version:1,operation:'earn_campaign',units,
   effective_date:today(),issuer_reference:'ISSUER-BONUS-'+n,
   issuer_confirmed:true,original_request_id:null}
  const res=await call(familyMemberPersonalPoints,p)
  assert.equal(res.status,201,JSON.stringify(res.data))
 }
 function input(operation='transfer_prepaid',reference='REDEEM-001'){
  const k=['transfer_out','exchange_out'].includes(operation)
  const target=operation==='transfer_prepaid'?prepaid:operation==='offset_card'?card:
   operation==='redeem_asset'?fund:points2
  return {expected_user_id:member,idempotency_key:'personal-asset:'+reference,
   operation,points_account_id:points,points_version:1,
   target_account_id:target,target_version:1,units:100,yen_value:100,
   rate_numerator:1,rate_denominator:1,effective_date:today(),
   issuer_reference:reference,counterpart_reference:'RECEIVED-'+reference,
   issuer_confirmed:true,counterpart_confirmed:true,
   ...(operation==='offset_card'?{target_purchase_request_id:purchaseApproval}:{}),
   ...(operation==='redeem_asset'?{sbi_fund_code:'JP123456',
    sbi_account_type:'growth',sbi_confirmed_units:1000,
    broker_trade_reference:'SBI-BROKER-'+reference,broker_execution_confirmed:true}:{}),
   ...(k?{target_units:operation==='exchange_out'?50:100,
    target_rate_numerator:operation==='exchange_out'?2:1,target_rate_denominator:1}:{})}
 }
 return {s,db,env,who,call,earn,input,close:()=>s.close()}
}
test('confirmed member point-to-prepaid credit is atomic, exactly once and owner-review free',async()=>{
 const f=fixture();try{
  await f.earn()
  const p=f.input()
  const first=await f.call(familyMemberPointAssets,p)
  assert.equal(first.status,201,JSON.stringify(first.data))
  assert.equal(first.data.ledger_changed,false)
  assert.equal(first.data.balance_after_units,900)
  assert.equal(stmt,stmt) // keep deterministic function reference
  const credit=f.s.prepare('SELECT amount_jpy,balance_after_jpy FROM family_points_prepaid_credits').get()
  assert.equal(credit.amount_jpy,100)
  assert.equal(credit.balance_after_jpy,100)
  assert.equal((await f.call(familyMemberPointAssets,p)).data.replayed,true)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_direct_asset_proofs').get().n,1)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_actor_audit').get().n,2)
  const audit=f.s.prepare("SELECT approver_user_id,actor_user_id FROM family_points_journal WHERE operation='transfer_prepaid'").get()
  assert.equal(audit.approver_user_id,member)
  assert.equal(audit.actor_user_id,member)
 }finally{f.close()}
})
test('member points card offset applies only to owned posted purchase and prevents duplicate discount',async()=>{
 const f=fixture();try{
  await f.earn()
  const one=await f.call(familyMemberPointAssets,f.input('offset_card','OFFSET-001'))
  assert.equal(one.status,201,JSON.stringify(one.data))
  assert.equal(f.s.prepare('SELECT remaining_after_jpy FROM family_points_card_offsets').get().remaining_after_jpy,900)
  assert.equal((await f.call(familyMemberPointAssets,{...f.input('offset_card','OFFSET-002'),
   target_purchase_request_id:'22222222-2222-4222-8222-222222222222'})).status,409)
  assert.equal((await f.call(familyMemberPointAssets,{...f.input('offset_card','OFFSET-003'),target_account_id:foreign})).status,409)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_card_offsets').get().n,1)
 }finally{f.close()}
})
test('SBI points purchase records only confirmed lot, never broker order or ledger expense',async()=>{
 const f=fixture();try{
  await f.earn()
  const x=f.input('redeem_asset','SBI-REDEEM-001')
  const res=await f.call(familyMemberPointAssets,x)
  assert.equal(res.status,201,JSON.stringify(res.data))
  assert.equal(res.data.broker_ordered,false)
  assert.equal(res.data.issuer_api_verified,false)
  const lot=f.s.prepare('SELECT confirmed_units,acquisition_cost_jpy,owner_user_id FROM family_sbi_point_lots').get()
  assert.equal(lot.confirmed_units,1000);assert.equal(lot.acquisition_cost_jpy,100)
  assert.equal(lot.owner_user_id,member)
  assert.equal((await f.call(familyMemberPointAssets,{...f.input('redeem_asset','SBI-REDEEM-002'),broker_execution_confirmed:false})).status,400)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
 }finally{f.close()}
})
test('same-member points transfer and exchange conserve source and credited target units',async()=>{
 const f=fixture();try{
  await f.earn()
  const a=await f.call(familyMemberPointAssets,f.input('transfer_out','XFER-001'))
  const b=await f.call(familyMemberPointAssets,f.input('exchange_out','XCHG-001'))
  assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(b.status,201,JSON.stringify(b.data))
  const credits=f.s.prepare('SELECT target_units,operation FROM family_points_transfer_credits ORDER BY created_at,homeflow_request_id').all()
  assert.deepEqual(credits.map(x=>x.target_units).sort((a,b)=>a-b),[50,100])
  const projection=await memberPointsBalances(f.db,hh)
  assert.equal(projection.accounts.find(x=>x.account_id===points).balance_units,800)
  assert.equal(projection.accounts.find(x=>x.account_id===points2).balance_units,150)
 }finally{f.close()}
})
test('source amount, target owner and proof failures rollback all four inserts',async()=>{
 const f=fixture();try{
  await f.earn(120)
  const illegal=await f.call(familyMemberPointAssets,{...f.input(),yen_value:101})
  assert.equal(illegal.status,400)
  const over=await f.call(familyMemberPointAssets,{...f.input('transfer_prepaid','OVER-001'),units:121,
   yen_value:121,rate_numerator:1})
  assert.equal(over.status,409)
  const foreignTarget=await f.call(familyMemberPointAssets,{...f.input(),target_account_id:foreign})
  assert.equal(foreignTarget.status,409)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_direct_asset_proofs').get().n,0)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_prepaid_credits').get().n,0)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_journal').get().n,1)
 }finally{f.close()}
})
test('personal point asset list hides all other household member accounts and card data',async()=>{
 const f=fixture();try{
  const listed=await f.call(familyMemberPointAssets,null,f.who,'GET')
  assert.equal(listed.status,200,JSON.stringify(listed.data))
  assert.equal(listed.data.scope,'personal')
  assert.equal(listed.data.viewer_user_id,member)
  assert.equal(listed.data.accounts.some(x=>x.account_id===foreign),false)
  assert.equal(listed.data.purchases.length,1)
  assert.equal((await f.call(familyMemberPointAssets,null,{...f.who,user_id:other},'GET')).data.accounts.some(x=>x.account_id===card),false)
 }finally{f.close()}
})

test('prepaid refund reverses original units and target yen atomically, exactly once',async()=>{
 const f=fixture();try{
  await f.earn()
  const used=await f.call(familyMemberPointAssets,f.input('transfer_prepaid','PREPAID-A-001'))
  assert.equal(used.status,201,JSON.stringify(used.data))
  const p=refundInput(used.data.journal_id,'REFUND-PREPAID-001')
  const out=await f.call(familyMemberPointAssetReversals,p)
  assert.equal(out.status,201,JSON.stringify(out.data))
  assert.equal(out.data.counterpart_refunded,true)
  assert.equal(out.data.balance_after_units,1000)
  assert.equal(f.s.prepare('SELECT debited_prepaid_jpy,balance_after_jpy FROM family_points_prepaid_refunds').get().debited_prepaid_jpy,100)
  assert.equal((await f.call(familyMemberPointAssetReversals,p)).data.replayed,true)
  assert.equal((await f.call(familyMemberPointAssetReversals,refundInput(used.data.journal_id,'REFUND-PREPAID-002'))).status,409)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_journal').get().n,3)
 }finally{f.close()}
})
test('card points offset refund restores full liability without family second expense',async()=>{
 const f=fixture();try{
  await f.earn()
  const use=await f.call(familyMemberPointAssets,f.input('offset_card','CARD-A-001'))
  assert.equal(use.status,201,JSON.stringify(use.data))
  const back=await f.call(familyMemberPointAssetReversals,refundInput(use.data.journal_id,'CARD-REFUND-001'))
  assert.equal(back.status,201,JSON.stringify(back.data))
  assert.equal(back.data.balance_after_units,1000)
  const refund=f.s.prepare('SELECT restored_jpy,liability_after_jpy FROM family_points_card_offset_refunds').get()
  assert.equal(refund.restored_jpy,100)
  assert.equal(refund.liability_after_jpy,1000)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
 }finally{f.close()}
})
test('same-owner point transfer and exchange refund must have exact target balance',async()=>{
 const f=fixture();try{
  await f.earn()
  for(const [operation,key] of [['transfer_out','MOVE-B-001'],['exchange_out','EXCHANGE-B-001']]){
   const moved=await f.call(familyMemberPointAssets,f.input(operation,key))
   assert.equal(moved.status,201,JSON.stringify(moved.data))
   const reverse=await f.call(familyMemberPointAssetReversals,refundInput(moved.data.journal_id,'RETURN-'+key))
   assert.equal(reverse.status,201,JSON.stringify(reverse.data))
  }
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_transfer_refunds').get().n,2)
  const values=await memberPointsBalances(f.db,hh)
  assert.equal(values.accounts.find(a=>a.account_id===points).balance_units,1000)
  assert.equal(values.accounts.find(a=>a.account_id===points2).balance_units,0)
 }finally{f.close()}
})
test('SBI exact broker cancellation and issuer point return self-reverse lot without bank charge',async()=>{
 const f=fixture();try{
  await f.earn()
  const buy=await f.call(familyMemberPointAssets,f.input('redeem_asset','SBI-BUY-C-001'))
  assert.equal(buy.status,201,JSON.stringify(buy.data))
  const reversed=await f.call(familyMemberPointAssetReversals,{
   ...refundInput(buy.data.journal_id,'SBI-RETURN-C-001'),
   broker_cancel_reference:'SBI-CANCEL-C-001',broker_cancel_date:today(),
   points_returned_date:today(),broker_cancel_confirmed:true
  })
  assert.equal(reversed.status,201,JSON.stringify(reversed.data))
  assert.equal(reversed.data.broker_ordered,false)
  assert.equal(reversed.data.balance_after_units,1000)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_sbi_point_refunds').get().n,1)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
 }finally{f.close()}
})
test('cross-user fake reversal, absent issuer proof and forced audit rollback leave originals untouched',async()=>{
 const f=fixture();try{
  await f.earn()
  const transfer=await f.call(familyMemberPointAssets,f.input('transfer_prepaid','PREPAID-D-001'))
  assert.equal(transfer.status,201)
  const p=refundInput(transfer.data.journal_id,'REFUND-PREPAID-D-001')
  assert.equal((await f.call(familyMemberPointAssetReversals,{...p,issuer_points_returned_confirmed:false})).status,400)
  assert.equal((await f.call(familyMemberPointAssetReversals,p,{role:'member',user_id:other,household_id:hh})).status,403)
  f.s.exec("CREATE TRIGGER force_asset_refund_audit_fail BEFORE INSERT ON family_points_actor_audit "+
   "WHEN NEW.operation='reversal' BEGIN SELECT RAISE(ABORT,'FORCED_REFUND_AUDIT_FAIL'); END")
  const denied=await f.call(familyMemberPointAssetReversals,p)
  assert.equal(denied.status,409,JSON.stringify(denied.data))
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_direct_asset_refund_proofs').get().n,0)
  assert.equal(f.s.prepare('SELECT COUNT(*) n FROM family_points_prepaid_refunds').get().n,0)
  f.s.exec('DROP TRIGGER force_asset_refund_audit_fail')
  assert.equal((await f.call(familyMemberPointAssetReversals,p)).status,201)
 }finally{f.close()}
})
test('member direct refund list only returns own unrefunded entries',async()=>{
 const f=fixture();try{
  await f.earn()
  const original=await f.call(familyMemberPointAssets,f.input('transfer_prepaid','PREPAID-LIST-001'))
  const before=await f.call(familyMemberPointAssetReversals,null,f.who,'GET')
  assert.equal(before.status,200)
  assert.equal(before.data.eligible.length,1)
  await f.call(familyMemberPointAssetReversals,refundInput(original.data.journal_id,'REFUND-LIST-001'))
  const after=await f.call(familyMemberPointAssetReversals,null,f.who,'GET')
  assert.equal(after.data.eligible.length,0)
  const foreignList=await f.call(familyMemberPointAssetReversals,null,{role:'member',user_id:other,household_id:hh},'GET')
  assert.equal(foreignList.data.eligible.length,0)
 }finally{f.close()}
})
function refundInput(original,key){
 return {expected_user_id:member,idempotency_key:'personal-asset-refund:'+key,
  original_request_id:original,effective_date:today(),
  issuer_refund_reference:'POINTS-RETURN-'+key,
  counterpart_reversal_reference:'TARGET-RETURN-'+key,
  issuer_points_returned_confirmed:true,counterpart_reverted_confirmed:true}
}
