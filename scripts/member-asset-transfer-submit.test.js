import test from 'node:test'
import assert from 'node:assert/strict'
import {submitMemberPersonalTransfer} from '../src/member-asset-transfer-submit.js'
const uid='member-1'
const points='a'.repeat(32),prepaid='b'.repeat(32)
const account=(account_id,account_kind)=>({account_id,account_kind,
 owner_user_id:uid,origin:'member_created',label:account_kind,is_archived:0,
 opening_balance:0,version:1})
function withMockFetch(fn){
 const beforeFetch=globalThis.fetch, beforeWindow=globalThis.window
 return Promise.resolve().then(async()=>{
  globalThis.window={confirm:()=>true}
  try{return await fn()}finally{
   globalThis.fetch=beforeFetch;globalThis.window=beforeWindow
  }
 })
}
test('original-form prepaid transfer uses only personal topup executor',async()=>{
 await withMockFetch(async()=>{
  const calls=[]
  globalThis.fetch=async (url,options)=>{
   calls.push({url,body:JSON.parse(options.body)})
   return {ok:true,json:async()=>({ok:true,ledger_changed:false,topup:{amount_jpy:500}})}
  }
  const record={type:'transfer',transferTarget:'prepaid:'+prepaid,
   amount:500,transferDate:'2026-01-01',assetConfirmed:true}
  assert.deepEqual(await submitMemberPersonalTransfer({record,userId:uid,
   accounts:[account(prepaid,'prepaid')]}),{type:'applied'})
  assert.equal(calls.length,1)
  assert.match(calls[0].url,/member-prepaid-topups$/)
  assert.equal(calls[0].body.prepaid_account_id,prepaid)
  assert.equal(calls[0].body.expected_user_id,uid)
  assert.ok(!('entry' in calls[0].body))
  assert.equal(record.memberAssetPending,null)
 })
})
test('personal point-to-prepaid transfer accepts server-scoped projection without owner_user_id',async()=>{
 await withMockFetch(async()=>{
  const calls=[]
  globalThis.fetch=async (url,options={})=>{
   calls.push({url,body:options.body?JSON.parse(options.body):null})
   if(!options.method)return {ok:true,json:async()=>({
    ok:true,scope:'personal',viewer_user_id:uid,ledger_changed:false,
    accounts:[{account_id:points,account_kind:'points',version:1},
      {account_id:prepaid,account_kind:'prepaid',version:1}],
    purchases:[],recent:[]
   })}
   return {ok:true,json:async()=>({ok:true,scope:'personal',ledger_changed:false,
    issuer_api_verified:false,applied:true,counterpart_confirmed:true})}
  }
  const record={type:'transfer',transferTarget:'points:prepaid',amount:500,
   transferDate:'2026-01-01',pointSourceId:points,assetTargetId:prepaid,
   pointUnits:1000,issuerReference:'issued-0001',counterpartReference:'receipt-0001',
   issuerConfirmed:true,counterpartConfirmed:true}
  assert.deepEqual(await submitMemberPersonalTransfer({record,userId:uid,
   accounts:[account(points,'points'),account(prepaid,'prepaid')]}),{type:'applied'})
  assert.equal(calls.length,2)
  assert.equal(calls[1].body.operation,'transfer_prepaid')
  assert.equal(calls[1].body.rate_numerator,500)
  assert.equal(calls[1].body.rate_denominator,1000)
  assert.equal(calls[1].body.points_account_id,points)
  assert.equal(calls[1].body.target_account_id,prepaid)
 })
})
test('never permit a foreign-owned prepaid account to be charged',async()=>{
 await withMockFetch(async()=>{
  globalThis.fetch=()=>{throw Error('must not reach server')}
  const foreign={...account(prepaid,'prepaid'),owner_user_id:'spouse'}
  await assert.rejects(()=>submitMemberPersonalTransfer({record:{
   type:'transfer',transferTarget:'prepaid:'+prepaid,amount:500,
   transferDate:'2026-01-01',assetConfirmed:true},userId:uid,
   accounts:[foreign]}),/本人の電子マネー/)
 })
})
