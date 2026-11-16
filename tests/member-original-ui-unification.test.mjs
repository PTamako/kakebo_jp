import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {memberInvestmentSnapshot} from '../src/member-investment-view.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const member='11111111111111111111111111111111'
const owner='22222222222222222222222222222222'
const p=(who,id,money)=>({
 owner_user_id:who,plan_type:'sbi_tsumitate',
 plan_resource_id:id,fund_code:'0331418A',fund_name:'オールカントリー',
 account_type:'tsumitate',amount_jpy:money,due_day:9,
 start_month:'2026-11',end_month:'2026-12',state:'active'
})
test('original pages, card management, fixed costs, investment and Other all reuse original components',()=>{
 const app=read('src/App.vue')
 const spouse=read('src/FamilyMemberWorkspace.vue')
 const pages=read('src/OriginalKakeiboPages.vue')
 const finance=read('src/FinanceTools.vue')
 const tools=read('src/OriginalOtherManagement.vue')
 assert.match(app,/<OriginalKakeiboPages :identity="familyIdentity"/)
 assert.match(spouse,/<OriginalKakeiboPages :identity="user"/)
 for(const name of ['EntryInputPage','LedgerPage','StatisticsPage','AssetsPage','ManagementPage'])
  assert.match(pages,new RegExp('<'+name+' '))
 assert.match(finance,/<OriginalCardManagementPanel v-show=/)
 assert.match(spouse,/<OriginalCardManagementPanel\s/)
 assert.match(finance,/<OriginalFixedCostList v-show=/)
 assert.match(read('src/MemberFixedCosts.vue'),/<OriginalFixedCostList :items=/)
 assert.match(finance,/<SbiPortfolio :api="props.api" active-view="plans"/)
 assert.match(spouse,/<SbiPortfolio member-mode active-view="plans"/)
 assert.match(finance,/<OriginalOtherManagement v-if="memberView"/)
 assert.match(finance,/<OriginalOtherManagement :active="managementTab==='tools'"/)
 for(const x of ['定期処理の実行状況','端末のプライバシー設定','バックアップ・復元','重複の可能性','ゴミ箱'])
  assert.ok(tools.includes(x),'original Other header missing '+x)
 assert.doesNotMatch(spouse,/<ManagementPage v-else-if=/)
})
test('member original SBI screen is backed only by per-user scoped real plan data',()=>{
 const view=memberInvestmentSnapshot({
  userId:member,requestedMonth:'2026-11',
  plans:[p(member,'own-one',15000),p(owner,'not-mine',90000)],
  occurrences:[{owner_user_id:member,plan_type:'sbi_tsumitate',period_key:'2026-11',occurrence_id:'a',
   amount_jpy:9000,ledger_applied:false},
   {owner_user_id:owner,plan_type:'sbi_tsumitate',period_key:'2026-11',occurrence_id:'x',
   amount_jpy:90000,ledger_applied:true}]
 })
 assert.equal(view.plans.length,1)
 assert.equal(view.plans[0].plan_resource_id,'own-one')
 assert.equal(view.reconciliation.monthly_amount,15000)
 assert.equal(view.reconciliation.registered,0)
 assert.deepEqual(view.holdings,[])
 assert.deepEqual(view.transfers,[])
 assert.equal(view.valuation.value,null)
 assert.equal(view.institution_verified,false)
 assert.equal(view.viewer_user_id,member)
})
test('missing broker evidence produces unknown, never 0 yen or fake holdings',()=>{
 const view=memberInvestmentSnapshot({userId:member,requestedMonth:'2026-11',
  plans:[p(member,'own-one',15000)],occurrences:null})
 assert.equal(view.reconciliation.registered,null)
 assert.equal(view.reconciliation.funded,null)
 assert.deepEqual(view.holdings,[])
 assert.equal(view.valuation.value,null)
 assert.throws(()=>memberInvestmentSnapshot({userId:'',requestedMonth:'2026-11'}))
 assert.throws(()=>memberInvestmentSnapshot({userId:member,requestedMonth:'2026-13'}))
})
test('member investment mutations cannot reach the owner legacy SBI API',()=>{
 const memberView=read('src/FamilyMemberWorkspace.vue')
 const sbi=read('src/SbiPortfolio.vue')
 assert.match(memberView,/const map=\{'investment-portfolio\/holding':'holding'/)
  assert.match(memberView,/api\('manual-holdings\/'\+sub,request\(payload,'PUT'\)\)/)
 assert.match(memberView,/api\('member-recurring-plans'\),api\('recurring-occurrences'\),api\('manual-holdings'\)/)
 assert.doesNotMatch(memberView,/api\('investment-portfolio\?/)
 assert.match(sbi,/if\(props.memberMode\)\{/)
 assert.match(sbi,/props.onMemberEdit\?\.\(p\)/)
 assert.match(sbi,/本人の積立変更は HomeFlow 承認のある専用設定から行ってください/)
})
