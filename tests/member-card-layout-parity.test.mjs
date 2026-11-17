import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('both identities render the same card utilization component rather than duplicating controls',()=>{
 const original=read('src/FinanceTools.vue')
 const member=read('src/MemberCardUsage.vue')
 const shared=read('src/CardUsageSummaryFields.vue')
 assert.match(original,/<CardUsageSummaryFields /)
 assert.match(member,/<CardUsageSummaryFields /)
 assert.doesNotMatch(original,/<div class="finance-inputs card-billing-fields">/)
 assert.doesNotMatch(member,/<div class="finance-inputs card-billing-fields">/)
 assert.match(shared,/class="finance-inputs card-billing-fields card-usage-summary"/)
 assert.match(shared,/class="card-closing-month" type="month"/)
 assert.match(shared,/class="card-usage-total" aria-live="polite"/)
 assert.match(shared,/\.card-usage-summary-month\{/)
 assert.match(shared,/overflow:hidden/)
 assert.match(shared,/max-width:100%!important/)
 assert.match(shared,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(shared,/class="card-usage-summary-field card-usage-summary-month"/)
 assert.match(shared,/class="card-usage-summary-field card-usage-summary-amount"/)
})

test('member utilization stays authenticated and no spouse private cards enter the selector',()=>{
 const member=read('src/MemberCardUsage.vue')
 assert.match(member,/body\.viewer_user_id!==actor/)
 assert.match(member,/body\.scope!=='personal-card-usage'/)
 assert.match(member,/x\.owner_user_id!==actor/)
 assert.match(member,/rows\.value=body\.items/)
 assert.match(member,/:card-options="options"/)
 assert.match(member,/:amount="loaded&&selected\?yen\(selected\.amount_jpy\):'—'"/)
})

test('both accounts have consistent default status and refreshed management header',()=>{
 const card=read('src/OriginalCardManagementPanel.vue')
 const member=read('src/FamilyMemberWorkspace.vue')
 const heading=read('src/FinanceTools.vue')
 assert.match(card,/<p class="card-default-status">デフォルト：/)
 assert.match(card,/'未設定'/)
 assert.match(member,/const memberStatus=computed/)
 assert.match(member,/memberLastRefreshAt\.value=new Date\(\)/)
 assert.match(member,/memberStatus,/)
 assert.match(heading,/:status="memberView \? memberStatus :/)
})
