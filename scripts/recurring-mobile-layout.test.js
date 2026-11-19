import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/FinanceTools.vue', import.meta.url), 'utf8')
const fixedFields = readFileSync(new URL('../src/FixedCostEditorFields.vue', import.meta.url),'utf8')
const fixed = (source.match(/<article class="finance-panel recurring-manager-panel">([\s\S]*?)\n  <\/article>/)?.[1] || '')+'\n'+fixedFields
const review = source.match(/<article class="finance-panel recurring-review-panel"[^>]*aria-label="固定費の記帳確認">([\s\S]*?)\n  <\/article>/)?.[1] || ''
const registered = readFileSync(new URL('../src/OriginalFixedCostList.vue',import.meta.url),'utf8')

test('iPhone effective-month input stays within its own grid cell', () => {
  assert.match(fixed, /class="recurring-form-field recurring-start-month"><span>開始月<\/span>\s*<input v-model="model.startMonth" type="month"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-form-layout\{display:grid;grid-template-columns:minmax\(0,1fr\)/)
  assert.match(fixed, /v-model="model.postingMode" type="radio" value="auto"/)
  assert.match(fixed, /v-model="model.postingMode" type="radio" value="manual"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-start-month\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*overflow:hidden/)
  assert.match(source, /\.finance-panel \.recurring-start-month input\[type=month\]\{[^}]*width:100%!important;max-width:100%!important;min-width:0!important;min-inline-size:0!important;box-sizing:border-box!important/)
  assert.match(source, /::-webkit-date-and-time-value\{min-width:0/)
})

test('expense candidates use native 18px checkboxes and readable rows', () => {
  assert.match(review, /class="finance-row recurring-candidate"/)
  assert.match(review, /<input type="checkbox" :checked="recurringSelected/)
  assert.match(review, /class="recurring-candidate-checkbox"/)
  assert.match(source, /\.finance-panel \.recurring-candidate input\.recurring-candidate-checkbox\[type=checkbox\]\{[^}]*width:18px!important;height:18px!important/)
  assert.match(review, /class="recurring-candidate-name"/)
  assert.match(review, /class="recurring-candidate-amount"/)
  assert.match(review, /class="recurring-candidate-date"/)
  assert.match(review, /過去分は推定/)
  assert.match(review, /既存の明細を優先（対象外）/)
  assert.match(review, /登録対象/)
  assert.match(review, /@change="toggleRecurringSelection\(candidate,\$event\.target\.checked\)"/)
})

test('registered fixed expense list has owner and member shared summary, chevron and metadata',()=>{
 assert.match(source,/<OriginalFixedCostList\s/)
 assert.match(registered,/<details class="recurring-list-disclosure"/)
 assert.match(registered,/<summary class="recurring-list-summary">/)
 assert.match(registered, /class="recurring-list-summary-total"/)
 for(const cls of ['recurring-plan-name','recurring-plan-amount','recurring-plan-chevron','recurring-plan-meta-item']) {
   assert.match(registered,new RegExp('class="'+cls))
 }
 assert.match(registered, /recurringFrequencyLabel\(p\)/)
 assert.match(registered, /class="recurring-plan-meta-item">開始 \{\{p.startMonth/)
 assert.match(registered,/\.recurring-list-summary\{display:grid;grid-template-columns:minmax\(0,1fr\) 18px/)
})
test('original owner create, review, edit and delete remain wired through shared list events',()=>{
 assert.match(fixed, /@click="addPlan"/)
 assert.match(fixed, /@click="cancelPlanEdit"/)
 assert.match(review, /@click="reviewRecurring"/)
 assert.match(review, /@click="applyRecurring"/)
 assert.match(source, /@edit="beginEditPlan" @toggle="togglePlanEnabled" @remove="p=>removePlan\(p.id\)"/)
 assert.match(registered, /@click="emit\('edit',p\)"/)
 assert.match(registered, /@click="emit\('toggle',p\)"/)
 assert.match(registered, /@click="emit\('remove',p\)"/)
 assert.match(registered, /v-model="query"/)
 assert.match(registered, /v-model="filter"/)
 assert.match(source, /if\(!confirm\(summary\)\)return/)
 assert.match(source, /postApprovedRecurringEntries\(props.api,safe\)/)
 assert.match(source, /await props.api\(updated\?'recurring-plans\/'/)
 assert.doesNotMatch(fixed, /:style="\{.*width:100vw/)
})
test('mobile fixed expense form removes redundant text and avoids a tall blank gap', () => {
  assert.doesNotMatch(fixed, /recurring-form-caption|周期・開始月・記帳方法を設定します/)
  assert.match(fixed, /class="recurring-form-field recurring-form-schedule"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-form-layout\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:9px;margin:0 0 6px/)
  assert.match(source, /@media\(min-width:360px\) and \(max-width:679px\)\{/)
  assert.match(source, /\.recurring-manager-panel \.recurring-form-name,\s*\.recurring-manager-panel \.recurring-form-amount,\s*\.recurring-manager-panel \.recurring-form-schedule,/)
  assert.match(source, /main \.finance-tools \.recurring-manager-panel\{padding:12px;row-gap:6px\}/)
  assert.match(source, /\.finance-tools \.recurring-review-panel\{padding:12px\}/)
  assert.match(source, /\.recurring-review-panel\{[^}]*display:grid;[^}]*margin:0\}/)
  assert.match(source, /\.recurring-manager-panel \.recurring-posting-mode label\{min-height:44px;padding:7px\}/)
})

test('review card stays distinct from the background and collapses into a compact iPhone row', () => {
  assert.match(review, /class="recurring-review-heading"/)
  assert.match(review, /過去分・明日の予定/)
  assert.match(review, /aria-controls="recurring-candidate-list"/)
  assert.match(review, /未記帳分を確認/)
  assert.match(source, /\.recurring-common-review-area>\.recurring-review-panel\{\s*background:#fff;[^}]*border-left:3px solid var\(--blue\)/)
  assert.match(source, /\.recurring-common-review-area>\.recurring-review-panel:not\(\.is-expanded\)\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(120px,auto\)/)
  assert.match(source, /\.recurring-common-review-area>\.recurring-review-panel:not\(\.is-expanded\) \.recurring-review-actions\{[^}]*grid-column:2/)
  assert.match(source, /\.recurring-common-review-area>\.recurring-review-panel \.recurring-review-results\{grid-column:1\/-1\}/)
  assert.match(source, /\.recurring-common-review-area>\.recurring-review-panel:not\(\.is-expanded\) \.recurring-review-actions button\{[^}]*min-height:44px/)
})

test('posting method options are compact horizontal touch targets with native-size radio inputs', () => {
  assert.match(fixed, /<fieldset class="recurring-posting-mode">/)
  assert.match(fixed, /value="auto"[\s\S]*?name="recurring-posting-mode"/)
  assert.match(fixed, /value="manual"[\s\S]*?name="recurring-posting-mode"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-posting-mode label\{[^}]*flex-direction:row;[^}]*min-height:44px;[^}]*white-space:nowrap/)
  assert.match(source, /\.recurring-manager-panel \.recurring-posting-mode input\[type=radio\]\{[^}]*width:16px!important;[^}]*height:16px!important;min-height:16px!important;max-height:16px!important;[^}]*padding:0!important/)
  // Keep the shared 44px rule on normal inputs; only the radio circle is 16px.
  assert.match(source, /\.finance-panel input:not\(\[type=file\]\),\.finance-panel select\{height:44px!important;/)
})

test('fixed-expense form, due review and saved plans remain peer cards inside the fixed tab', () => {
  assert.match(source, /id="recurring-cost-panel-fixed"[\s\S]*?<OriginalFixedCostList[\s\S]*?<\/section>/)
  assert.match(source, /v-show="managementTab === 'plans' && recurringCostTab === 'fixed'"/)
  assert.ok(fixed && review && registered)
  assert.doesNotMatch(fixed, /recurring-review-panel|recurring-list-disclosure/)
  assert.doesNotMatch(review, /recurring-form-layout|recurring-list-disclosure/)
  assert.doesNotMatch(registered, /recurring-form-layout|reviewRecurring/)
  assert.match(registered, /\.recurring-list-summary\{display:grid/)
})

test('fixed and variable cost tabs isolate the panels and preserve variable draft state', () => {
 assert.match(source, /role="tablist" aria-label="固定費の種類"/)
 assert.match(source, /role="tab"[^>]*aria-controls="recurring-cost-panel-fixed"/)
 assert.match(source, /role="tab"[^>]*aria-controls="recurring-cost-panel-variable"/)
 assert.match(source, /v-show="managementTab === 'plans' && recurringCostTab === 'variable'"/)
 assert.match(source, /const variableCostTabVisited = ref\(false\)/)
 assert.match(source, /if \(tab === 'variable'\) variableCostTabVisited.value = true/)
 assert.match(source, /<VariableRecurringCosts v-if="variableCostTabVisited" inline/)
 const variable = readFileSync(new URL('../src/VariableRecurringCosts.vue', import.meta.url),'utf8')
 assert.match(variable, /const expanded=ref\(false\),planEditor=ref\(false\)/)
 assert.match(variable, /<div v-if="inline \|\| expanded" class="body">/)
})
