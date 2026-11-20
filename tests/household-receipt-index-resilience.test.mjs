import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const member=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
const owner=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const ledger=readFileSync(new URL('../src/pages/LedgerPage.vue',import.meta.url),'utf8')

const memberStart=member.indexOf('async function reloadHouseholdReceipts(entries,replace=false){')
const memberEnd=member.indexOf('async function fetchHouseholdReceipt(entryId){',memberStart)
assert.ok(memberStart>=0&&memberEnd>memberStart)
const memberFunction=member.slice(memberStart,memberEnd)
function memberHarness(fetch,initial=[[554,{entry_id:554,source:'member'}]]){
 const factory=new Function('fetch','initial',`
  const props={user:{user_id:'member'}}
  const householdReceiptIndex={value:new Map(initial)}
  const householdReceiptError={value:''}
  ${memberFunction}
  return {run:reloadHouseholdReceipts,index:householdReceiptIndex,error:householdReceiptError}
 `)
 return factory(fetch,initial)
}
const sourceStart=owner.indexOf('let receiptIndexRequest=0')
const sourceEnd=owner.indexOf('async function viewReceipt(entryId)',sourceStart)
assert.ok(sourceStart>=0&&sourceEnd>sourceStart)
function ownerHarness({family,remote=async()=>[],local=async()=>[]}){
 const factory=new Function('fetchHouseholdReceiptIndex','listR2ReceiptsByIds','listReceiptImageIds',`
  const ref=x=>({value:x})
  const entries={value:[{id:554},{id:449}]}
  const detailSourceEntries={value:[]}
  const receiptImageIds=ref(new Set([554]))
  const householdReceiptIndex=ref(new Map([[554,{entry_id:554,source:'member'}]]))
  ${owner.slice(sourceStart,sourceEnd)}
  return {run:refreshReceiptImageIds,index:householdReceiptIndex,ids:receiptImageIds,
   warning:receiptIndexWarning}
 `)
 return factory(family,remote,local)
}

test('member household index failure must not abort a previously saved ledger or erase badges',async()=>{
 const h=memberHarness(async()=>new Response(JSON.stringify({error:'unavailable'}),{status:503}))
 await h.run([{id:554}],true)
 assert.equal(h.index.value.get(554).source,'member')
 assert.match(h.error.value,/HTTP 503/)
})
test('99+1 receipt index pages update as one verified snapshot',async()=>{
 const lens=[]
 const h=memberHarness(async url=>{
  const ids=new URL('https://example.test'+url).searchParams.get('ids').split(',').map(Number)
  lens.push(ids.length)
  return new Response(JSON.stringify({ok:true,items:ids
   .filter(id=>id===554||id===449)
   .map(entry_id=>({entry_id,source:entry_id===554?'member':'legacy'}))}),
   {status:200,headers:{'content-type':'application/json'}})
 },[])
 await h.run([{id:554},{id:449},...Array.from({length:103},(_,i)=>({id:700+i}))],true)
 assert.deepEqual(lens,[99,6])
 assert.equal(h.index.value.size,2)
 assert.equal(h.error.value,'')
})
test('owner retains member receipt button through background metadata outage',async()=>{
 const h=ownerHarness({family:async()=>{throw Error('503')}})
 await h.run()
 assert.equal(h.ids.value.has(554),true)
 assert.equal(h.index.value.has(554),true)
 assert.match(h.warning.value,/家族の小票/)
 const success=ownerHarness({family:async()=>[{entry_id:554,source:'member'}]})
 await success.run()
 assert.equal(success.ids.value.has(554),true)
 assert.equal(success.warning.value,'')
})
test('a household receipt warning is ledger-only and offers an explicit retry action',()=>{
 assert.match(member,/householdReceiptError && tab==='list'/)
 assert.match(ledger,/v-if="receiptIndexWarning"/)
 assert.match(ledger,/@click="refreshReceiptImageIds"/)
 assert.doesNotMatch(owner,/fetchHouseholdReceiptIndex\(ids\)\.catch\(\(\)=>\[\]\)/)
})
