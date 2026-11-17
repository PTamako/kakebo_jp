import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
const finance=read('FinanceTools.vue')
const fixed=read('UnifiedFixedCostManagement.vue')
const member=read('FamilyMemberWorkspace.vue')
const memberFixed=read('MemberFixedCosts.vue')
const pages=read('OriginalKakeiboPages.vue')

test('a growing household never gets duplicated management or balance page trees',()=>{
 for(const [name,marker] of Object.entries({
  cards:'<OriginalCardManagementPanel',
  fixedCosts:'<UnifiedFixedCostManagement',
  investment:'<SbiPortfolio ',
  other:'<OriginalOtherManagement '
 }))assert.equal(finance.split(marker).length-1,1,name+' must have one render path')
 assert.equal(pages.split('<AssetsPage ').length-1,1)
 assert.equal(pages.split('<ManagementPage ').length-1,1)
 assert.doesNotMatch(finance,/<OriginalOtherManagement v-if="memberView"/)
 assert.doesNotMatch(member,/<OriginalCardManagementPanel|<SbiPortfolio/)
 assert.doesNotMatch(memberFixed,/<FixedCostEditorFields|<OriginalFixedCostList/)
})

test('fixed-cost editor and list are rendered solely by the common component',()=>{
 assert.match(fixed,/<FixedCostEditorFields :model="state.model"/)
 assert.match(fixed,/<OriginalFixedCostList/)
 assert.match(fixed,/@update:cycle-choice="invoke\('onCycleChange',\$event\)"/)
 assert.match(fixed,/@edit="invoke\('onEdit',\$event\)"/)
 assert.match(fixed,/@remove="invoke\('onRemove',\$event\)"/)
 assert.match(finance,/const unifiedPlanConfig=computed/)
 assert.match(finance,/onSave:addPlan,onCancel:cancelPlanEdit/)
 assert.match(finance,/onEdit:beginEditPlan,onToggle:togglePlanEnabled,onRemove:p=>removePlan\(p.id\)/)
 assert.match(memberFixed,/defineExpose\(\{managementConfig,load\}\)/)
 assert.match(memberFixed,/owner_user_id===actor/)
 assert.match(memberFixed,/expected_user_id:props.userId/)
 assert.match(member,/<MemberFixedCosts ref="memberFixedCostRef"/)
 assert.match(member,/memberPlanConfig:memberFixedCostRef\?\.managementConfig\|\|null/)
})

test('SBI and Other share presentation but never share personal execution APIs',()=>{
 assert.match(finance,/:api="unifiedInvestmentApi"/)
 assert.match(finance,/:member-mode="memberView"/)
 assert.match(finance,/missingMemberInvestment=async\(\)=>\{throw Error/)
 assert.match(finance,/:on-member-create="memberInvestmentConfig\?\.onCreate"/)
 assert.match(member,/memberInvestmentConfig:\{api:memberSbiApi/)
 assert.match(finance,/<slot v-if="memberView" name="member-investment"/)
 for(const name of ['rules','jobs','privacy','backup','duplicates','trash'])
  assert.match(finance,new RegExp('<slot v-if="memberView" name="member-'+name+'"'))
 assert.match(finance,/:on-open-trash="memberView\?memberLoadTrash:/)
 assert.match(finance,/<InvestmentTransferReview v-if="!memberView"/)
 assert.doesNotMatch(finance,/\bnew XMLHttpRequest\b|\blocalStorage\.setItem\(/)
})
