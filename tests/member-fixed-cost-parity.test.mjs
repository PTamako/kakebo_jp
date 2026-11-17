import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {familyMemberFixedCosts} from '../functions/api/family-finance/member-fixed-costs.js'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const member={user_id:'member-123',household_id:'household-123',role:'member'}
const owner={...member,role:'owner'}
const base={name:'家賃',amount_jpy:100000,schedule_type:'monthly',interval_months:1,
 month_days:[27],weekdays:[1],category:'住居費',payment_source:'cash',
 start_month:'2026-11',posting_mode:'manual'}
const call=(method,path='',payload=null,user=member,db)=>{
 const headers={origin:'https://kakeibo.example'}
 if(payload)headers['content-type']='application/json'
 const request=new Request('https://kakeibo.example/api/family-finance/member-fixed-costs'+path,{
  method,headers,body:payload?JSON.stringify(payload):undefined
 })
 return familyMemberFixedCosts(request,{
  APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',DB:db},
  new URL(request.url),user,['member-fixed-costs',...path.split('/').filter(Boolean)])
}
function mock(){
 const entries=new Map()
 const db={prepare(sql){
  return {bind(...args){
   return {
    async first(){
     if(sql.includes('FROM homeflow_identity_links'))return {ok:1}
     if(sql.includes('FROM family_financial_accounts')||sql.includes('FROM family_legacy_card_shares'))return null
     if(sql.includes('FROM family_member_fixed_cost_settings')){
      const x=entries.get(args[0]);return x&&x.household_id===args[1]&&x.owner_user_id===args[2]?x:null
     }
     throw Error('Unexpected read '+sql)
    },
    async all(){
     if(sql.includes('FROM family_member_fixed_cost_settings'))
      return {results:[...entries.values()].filter(x=>x.household_id===args[0]&&x.owner_user_id===args[1])}
     throw Error('Unexpected list '+sql)
    },
    async run(){
     if(sql.startsWith('INSERT INTO family_member_fixed_cost_settings')){
      const keys=['plan_id','household_id','owner_user_id','name','amount_jpy','schedule_type',
       'interval_months','month_days_json','weekdays_json','category','payment_source',
       'start_month','posting_mode','created_at','updated_at']
      const x=Object.fromEntries(keys.map((k,i)=>[k,args[i]]))
      if(entries.has(x.plan_id))return {meta:{changes:0}}
      entries.set(x.plan_id,{...x,version:1,enabled:1})
      return {meta:{changes:1}}
     }
     if(sql.startsWith('DELETE FROM family_member_fixed_cost_settings')){
      const [planId,household,user,version]=args
      const prior=entries.get(planId)
      if(!prior||prior.household_id!==household||
         prior.owner_user_id!==user||prior.version!==version)
       return {meta:{changes:0}}
      entries.delete(planId)
      return {meta:{changes:1}}
     }
     if(sql.startsWith('UPDATE family_member_fixed_cost_settings')){
      const id=args.at(-4),household=args.at(-3),user=args.at(-2),version=args.at(-1)
      const prior=entries.get(id)
      if(!prior||prior.owner_user_id!==user||prior.household_id!==household||prior.version!==version)
       return {meta:{changes:0}}
      const keys=['name','amount_jpy','schedule_type','interval_months','month_days_json',
       'weekdays_json','category','payment_source','start_month','posting_mode','updated_at']
      const update=Object.fromEntries(keys.map((key,i)=>[key,args[i]]))
      entries.set(id,{...prior,...update,version:version+1})
      return {meta:{changes:1}}
     }
     throw Error('Unexpected write '+sql)
    }
   }
  }}
 }}
 return {db,entries}
}
test('member can save and read a cash fixed-cost setting without any bank account',async()=>{
 const {db}=mock()
 const id='member-fixed:11111111-1111-4111-8111-111111111111'
 const oldCrypto=globalThis.crypto
 if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})
 try{
  const res=await call('POST','',{expected_user_id:member.user_id,idempotency_key:id,...base},member,db)
  assert.equal(res.status,201)
  const saved=await res.json()
  assert.equal(saved.ok,true);assert.equal(saved.ledger_applied,false)
  assert.equal(saved.plan.paymentSource,'cash')
  const list=await (await call('GET','',null,member,db)).json()
  assert.equal(list.items.length,1);assert.equal(list.items[0].name,'家賃')
  assert.equal(list.items[0].owner_user_id,member.user_id)
  const retry=await call('POST','',{expected_user_id:member.user_id,idempotency_key:id,...base},member,db)
  assert.equal(retry.status,200)
  assert.equal((await retry.json()).replayed,true)
 }finally{if(!oldCrypto)delete globalThis.crypto}
})
test('wrong actor and arbitrary payment source cannot create private fixed-cost settings',async()=>{
 const {db,entries}=mock()
 let res=await call('GET','',null,owner,db)
 assert.equal(res.status,403)
 res=await call('POST','',{expected_user_id:'other-user',idempotency_key:'member-fixed:11111111-1111-4111-8111-111111111111',...base},member,db)
 assert.equal(res.status,400)
 res=await call('POST','',{expected_user_id:member.user_id,idempotency_key:'member-fixed:11111111-1111-4111-8111-111111111111',...base,payment_source:'personal:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'},member,db)
 assert.equal(res.status,403)
 assert.equal(entries.size,0)
})
test('original and member fixed-cost UI use exactly the same editor component',()=>{
 const ownerUi=read('src/FinanceTools.vue')
 const memberUi=read('src/MemberFixedCosts.vue')
 const shared=read('src/FixedCostEditorFields.vue')
 const balance=read('src/pages/AssetsPage.vue')
 const workspace=read('src/FamilyMemberWorkspace.vue')
 assert.match(ownerUi,/<FixedCostEditorFields :model="plan"/)
 assert.match(memberUi,/<FixedCostEditorFields :model="plan"/)
 assert.match(shared, /<AmountInput v-model="model.amount"/)
 assert.match(shared, /記帳日（複数選択可）/)
 assert.match(memberUi, /onSubmitEntry/)
 assert.match(balance, /personalPortfolioApi/)
 assert.match(balance, /<SbiPortfolio :key=/)
 assert.match(workspace, /:on-create-personal-account="createAccount"/)
 assert.doesNotMatch(workspace, /<FamilyRecurringFinance view="plans"/)
})

test('only the member who owns a fixed-cost setting can delete it; no ledger is changed',async()=>{
 const {db}=mock()
 const oldCrypto=globalThis.crypto
 if(!globalThis.crypto)Object.defineProperty(globalThis,'crypto',{value:webcrypto,configurable:true})
 try{
  const created=await call('POST','',{
   expected_user_id:member.user_id,
   idempotency_key:'member-fixed:22222222-2222-4222-8222-222222222222',
   ...base},member,db)
  const item=(await created.json()).plan
  const other={...member,user_id:'other-member'}
  let result=await call('DELETE','/'+item.plan_id,
   {expected_user_id:other.user_id,version:item.version},other,db)
  assert.equal(result.status,409)
  let rows=(await (await call('GET','',null,member,db)).json()).items
  assert.equal(rows.length,1)
  result=await call('DELETE','/'+item.plan_id,
   {expected_user_id:member.user_id,version:item.version},member,db)
  assert.equal(result.status,200)
  assert.deepEqual(await result.json(),{ok:true,removed:true,ledger_applied:false})
  rows=(await (await call('GET','',null,member,db)).json()).items
  assert.equal(rows.length,0)
 }finally{if(!oldCrypto)delete globalThis.crypto}
})
