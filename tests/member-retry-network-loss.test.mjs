import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const member=source('src/FamilyMemberWorkspace.vue')
const approval=source('src/FamilySharedMutationRequests.vue')
const paidBody=member.slice(member.indexOf('async function submitPaidExpense(choice,record){'),
 member.indexOf('async function submitMemberFixedCost(item){'))
const sharedBody=approval.slice(approval.indexOf('async function submitIntent(operation,entry,target=null){'),
 approval.indexOf('// Caller clears only after its corresponding draft removal'))
assert.ok(paidBody.startsWith('async function submitPaidExpense('))
assert.ok(sharedBody.startsWith('async function submitIntent('))
function memberHarness({initial=null,persist,api}){
 const factory=new Function('initial','persist','api',`
  let pendingPaidEntry=initial
  const safeSpend=r=>({date:r.date,time:'',amount:r.amount,merchant:r.merchant,
    category:r.category,note:''})
  const props={user:{user_id:'member-a'}}
  const request=body=>({method:'POST',body:JSON.stringify(body)})
  const sharedMutationRef={value:null}
  const crypto={randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'}
  const persistMemberDraft=async()=>persist(pendingPaidEntry)
  ${paidBody}
  return {submit:submitPaidExpense,pending:()=>pendingPaidEntry}
 `)
 return factory(initial,persist,api)
}
test('card prepare/submit response loss replays exactly one server request id after restart',async()=>{
 let latest=null,prepares=0,submits=0,accepted=0
 const save=async pending=>{latest=pending?structuredClone(pending):null}
 const api=async path=>{
  if(path==='card-purchases'){prepares++;return {prepared:{request_id:'request-1',status:'prepared'}}}
  if(path==='card-purchases/request-1/submit'){
   submits++;if(submits===1){accepted++;throw Error('network reply lost after server acceptance')}
   return {applied:false,status:'submitted_status_unknown'}
  }
  throw Error('unexpected route '+path)
 }
 const record={type:'expense',date:'2026-11-20',amount:490,
  merchant:'sample',category:'food',paymentSource:'member-card'}
 const choice={kind:'personal',account:{account_id:'card1',account_kind:'credit_card',version:1}}
 const first=memberHarness({persist:save,api})
 await assert.rejects(()=>first.submit(choice,record),/network reply lost/)
 assert.equal(prepares,1);assert.equal(submits,1);assert.equal(accepted,1)
 assert.equal(latest.requestId,'request-1')
 assert.equal(latest.acknowledged,false)
 const second=memberHarness({initial:latest,persist:save,api})
 const receipt=await second.submit(choice,record)
 assert.deepEqual(receipt,{type:'pending',receiptRef:'request:request-1'})
 assert.equal(latest.acknowledged,true)
 assert.equal(prepares,1,'must not prepare a new card purchase')
 const again=await second.submit(choice,record)
 assert.deepEqual(again,receipt)
 assert.equal(submits,2,'acknowledged receipt must not hit the network again')
})

test('no member card request is sent when first durable snapshot fails',async()=>{
 let apiCalls=0
 const h=memberHarness({persist:async()=>{throw Error('IndexedDB quota')},
  api:async()=>{apiCalls++;return {}}})
 await assert.rejects(()=>h.submit({kind:'personal',account:{account_kind:'credit_card'}},
  {date:'2026-11-20',amount:100,merchant:'sample',category:'food',paymentSource:'card'}),/IndexedDB quota/)
 assert.equal(apiCalls,0)
})

function approvalHarness({store,api}){
 const factory=new Function('store','api',`
  let inlineRequest=null
  const props={userId:'member-a',householdId:'household-one'}
  const busy={value:false}
  const crypto={randomUUID:()=> '123e4567-e89b-42d3-a456-426614174000'}
  const post=data=>({method:'POST',body:JSON.stringify(data)})
  const readMemberDeviceState=async(u,h,slot)=>store.get([u,h,slot].join(':'))
  const writeMemberDeviceState=async(u,h,object,slot)=>{
   store.set([u,h,slot].join(':'),structuredClone(object))
  }
  const clearMemberDeviceState=async(u,h,slot)=>{store.delete([u,h,slot].join(':'))}
  ${sharedBody}
  return {submit:submitIntent,current:()=>inlineRequest}
 `)
 return factory(store,api)
}
test('HomeFlow approval lost response retains same proposal and retry key after restart',async()=>{
 const store=new Map()
 let prepares=0,submits=0
 const api=async path=>{
  if(path==='/api/family-finance/shared-mutation-requests'){
   prepares++;return {prepared:{applied:false,proposal_id:'proposal-1',status:'prepared'}}
  }
  if(path==='/api/family-finance/shared-mutation-requests/proposal-1/submit'){
   submits++;if(submits===1)throw Error('response lost')
   return {applied:false,status:'submitted_status_unknown'}
  }
  throw Error('unexpected '+path)
 }
 const entry={date:'2026-11-20',time:'',amount:320,type:'expense',category:'food',merchant:'store',note:''}
 const first=approvalHarness({store,api})
 await assert.rejects(()=>first.submit('create',entry),/response lost/)
 assert.equal(prepares,1)
 assert.equal(store.size,1)
 const stored=[...store.values()][0]
 assert.equal(stored.proposalId,'proposal-1')
 const second=approvalHarness({store,api})
 await assert.rejects(()=>second.submit('create',{...entry,amount:321}),
  /元の内容で再試行|申請結果/)
 assert.equal(store.size,1,'unknown prior outcome must block a changed intent')
 const done=await second.submit('create',entry)
 assert.deepEqual(done,{proposalId:'proposal-1',status:'submitted_status_unknown'})
 assert.equal(prepares,1)
 assert.equal(submits,2)
 assert.equal((await second.submit('create',entry)).status,'submitted_status_unknown')
 assert.equal(submits,2,'acknowledged intent is never submitted twice')
})
