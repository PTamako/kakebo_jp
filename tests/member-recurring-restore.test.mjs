import test from 'node:test';import assert from 'node:assert/strict'
import {prepareMemberRecurringRestores} from '../src/member-recurring-restore.js'
const owner='member',hh='2026-11'
const accounts=[
 {owner_user_id:owner,account_id:'a'.repeat(32),account_kind:'bank',origin:'member_created',is_archived:0,version:2},
 {owner_user_id:owner,account_id:'b'.repeat(32),account_kind:'securities',origin:'member_created',is_archived:0,version:3}
];
const plan=(type='sbi_tsumitate',id='f'.repeat(32))=>({
 owner_user_id:owner,plan_resource_id:id,plan_type:type,state:'active',
 source_bank_account_id:'c'.repeat(32),source_account_version:1,
 securities_account_id:type==='sbi_tsumitate'?'d'.repeat(32):null,
 securities_version:type==='sbi_tsumitate'?1:null,
 amount_jpy:10000,due_day:9,start_month:'2026-12',end_month:'2027-10',
 category:'投資',merchant:'SBI',fund_code:type==='sbi_tsumitate'?'0331418A':null,
 fund_name:type==='sbi_tsumitate'?'オールカントリー':null,
 account_type:type==='sbi_tsumitate'?'tsumitate':null
});
const map=new Map([['c'.repeat(32),'a'.repeat(32)],['d'.repeat(32),'b'.repeat(32)]]);
const run=(oldPlans,existingPlans=[],extra={})=>prepareMemberRecurringRestores({
 ownerUserId:owner,oldPlans,existingPlans,accounts,accountMap:map,nowMonth:hh,...extra
});
test('restore future independent personal SBI plan with destination account remap and current CAS',()=>{
 const r=run([plan()])
 assert.equal(r.restore.length,1)
 assert.equal(r.restore[0].source_bank_account_id,'a'.repeat(32))
 assert.equal(r.restore[0].source_account_version,2)
 assert.equal(r.restore[0].securities_version,3)
 assert.equal(r.restore[0].idempotency_key,'restore-member-plan:'+'f'.repeat(32))
 assert.equal(r.restore[0].fund_code,'0331418A')
 assert.equal(r.restore[0].owner_approved,undefined)
})
test('never duplicate a previously restored plan or restart historical/archived plans',()=>{
 const a=run([plan('fixed_cost','e'.repeat(32))])
 assert.equal(a.restore.length,1)
 assert.equal(run([plan('fixed_cost','e'.repeat(32))],a.restore).restore.length,0)
 assert.equal(run([{...plan(),start_month:'2025-01'}]).restore.length,0)
 assert.equal(run([{...plan(),state:'revoked'}]).restore.length,0)
 assert.equal(run([plan('fixed_cost','1'.repeat(32)),plan('fixed_cost','2'.repeat(32))]).restore.length,1)
})
test('reject cross-user plans, foreign accounts and invalid fund identities',()=>{
 assert.throws(()=>run([{...plan(),owner_user_id:'other'}]),/本人以外/)
 assert.equal(run([plan()],[],{accountMap:new Map()}).restore.length,0)
 assert.equal(run([{...plan(),fund_code:'SQL INJECTION'}]).restore.length,0)
 assert.throws(()=>run([plan()],[],{accounts:[{...accounts[0],owner_user_id:'other'}]}),/本人以外/)
})
