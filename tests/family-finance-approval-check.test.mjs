import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

const component=readFileSync(new URL('../src/FamilyFinanceProposals.vue',import.meta.url),'utf8')
const begin=component.indexOf('const approvalUuid=')
const end=component.indexOf('function onForeground(){',begin)
assert.ok(begin>=0&&end>begin,'PWA approval proof handler must exist')
const source=component.slice(begin,end)
const item={request_id:'a'.repeat(32),account_id:'b'.repeat(32),
 status:'submitted_status_unknown',payload_sha256:'c'.repeat(64),
 homeflow_approval_id:'33333333-3333-4333-8333-333333333333',
 entry_id:null,ledger_changed:false}
function boot(result){
 const requests=[]
 const state={
  revision:5,alive:true,props:{userId:'member-1'},
  open:{value:true},busy:{value:''},loading:{value:false},
  error:{value:''},message:{value:''},
  verify:p=>p===item,
  call:async(path,options)=>{requests.push({path,options});return result},
 }
 const ctx=vm.createContext(state)
 vm.runInContext(source+'\nthis.invoke=checkApproval',ctx)
 return {ctx,state,requests}
}
test('verified HomeFlow review is shown only as approved-not-applied and never posts a ledger entry',async()=>{
 const {ctx,state,requests}=boot({
  ok:true,approval_confirmed:true,status:'approved_not_applied',
  applied:false,ledger_changed:false,
  proposal_id:item.request_id,homeflow_request_id:item.homeflow_approval_id
 })
 await ctx.invoke(item)
 assert.equal(requests.length,1)
 assert.equal(requests[0].path,'/api/family-finance/proposals/'+item.request_id+'/approval-proof')
 assert.equal(requests[0].options.method,'POST')
 assert.deepEqual(JSON.parse(requests[0].options.body),{
  expected_user_id:'member-1',homeflow_request_id:item.homeflow_approval_id})
 assert.match(state.message.value,/已确认批准.*但家計簿尚未入账/)
 assert.equal(state.error.value,'')
 assert.equal(state.busy.value,'')
 assert.doesNotMatch(requests[0].path,/\/api\/entries\b|\/api\/internal\/approved-actions/)
})
test('malformed or prematurely applied review response cannot be shown as a verified approval',async()=>{
 const {ctx,state}=boot({
  ok:true,approval_confirmed:true,status:'approved_not_applied',
  applied:true,ledger_changed:false,
  proposal_id:item.request_id,homeflow_request_id:item.homeflow_approval_id
 })
 await ctx.invoke(item)
 assert.equal(state.message.value,'')
 assert.match(state.error.value,/回执不完整/)
})
test('switching identity while HomeFlow proof is in flight never displays old member result',async()=>{
 let resolve
 const pending=new Promise(r=>resolve=r)
 const {ctx,state,requests}=boot(pending)
 const task=ctx.invoke(item)
 for(let i=0;i<5&&!requests.length;i++)await new Promise(r=>setImmediate(r))
 assert.equal(requests.length,1)
 state.props.userId='member-2'
 resolve({
  ok:true,approval_confirmed:true,status:'approved_not_applied',
  applied:false,ledger_changed:false,
  proposal_id:item.request_id,homeflow_request_id:item.homeflow_approval_id
 })
 await task
 assert.equal(state.message.value,'')
 assert.equal(state.error.value,'')
})
test('approval verification stays actor-scoped and never assumes an approved review is applied',()=>{
 assert.match(component,/v-else-if="item.status==='submitted_status_unknown'&&item.homeflow_approval_id"/)
 assert.match(component,/@click="checkApproval\(item\)"/)
 assert.match(component,/expected_user_id:user/)
 assert.match(component,/result.status!=='approved_not_applied'/)
 assert.match(component,/result.applied!==false/)
 assert.match(component,/result.ledger_changed!==false/)
 assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|\/api\/entries|approved-actions/)
})
