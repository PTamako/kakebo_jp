import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/FinanceTools.vue', import.meta.url), 'utf8')
const fixed = source.match(/<article v-show="managementTab === 'plans'" class="finance-panel recurring-manager-panel">([\s\S]*?)\n  <\/article>/)?.[1] || ''
const review = source.match(/<article v-show="managementTab === 'plans'" class="finance-panel recurring-review-panel" aria-label="固定費の記帳確認">([\s\S]*?)\n  <\/article>/)?.[1] || ''
const registered = source.match(/<article v-show="managementTab === 'plans'" class="finance-panel recurring-plans-panel">([\s\S]*?)\n  <\/article>/)?.[1] || ''

test('iPhone effective-month input stays within its own grid cell', () => {
  assert.match(fixed, /class="recurring-form-field recurring-start-month"><span>開始月<\/span><input v-model="plan.startMonth" type="month"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-form-layout\{display:grid;grid-template-columns:minmax\(0,1fr\)/)
  assert.match(fixed, /v-model="plan.postingMode" type="radio" value="auto"/)
  assert.match(fixed, /v-model="plan.postingMode" type="radio" value="manual"/)
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

test('registered-plan disclosure reserves right-hand chevron and keeps amount and metadata tidy', () => {
  assert.match(registered, /<details class="recurring-list-disclosure">/)
  assert.match(registered, /<summary class="recurring-list-summary">/)
  assert.match(source, /\.recurring-list-summary\{display:grid;grid-template-columns:minmax\(0,1fr\) 18px;grid-template-rows:auto auto/)
  assert.match(source, /\.recurring-list-summary:after\{grid-column:2;grid-row:1;/)
  assert.match(source, /\.recurring-list-summary-total\{grid-column:1\/-1;grid-row:2;/)
  assert.match(registered, /class="recurring-plan-name"/)
  assert.match(registered, /class="recurring-plan-amount"/)
  assert.match(registered, /class="recurring-plan-chevron"/)
  assert.match(registered, /class="recurring-plan-meta-item">\{\{recurringFrequencyLabel\(p\)\}\}/)
  assert.match(registered, /class="recurring-plan-meta-item">開始 \{\{p.startMonth/)
  assert.match(source, /\.recurring-plan-meta\{grid-column:1\/-1;grid-row:2;display:flex;flex-wrap:wrap/)
  assert.match(source, /\.recurring-plan-meta-item\{[^}]*white-space:nowrap/)
})

test('existing create, edit, preview, selection and explicit posting confirmation stay unchanged', () => {
  assert.match(fixed, /@click="addPlan"/)
  assert.match(fixed, /@click="cancelPlanEdit"/)
  assert.match(review, /@click="reviewRecurring"/)
  assert.match(review, /@click="applyRecurring"/)
  assert.match(registered, /@click="beginEditPlan\(p\)"/)
  assert.match(registered, /@click="togglePlanEnabled\(p\)"/)
  assert.match(registered, /@click="removePlan\(p.id\)"/)
  assert.match(registered, /v-model="recurringListQuery"/)
  assert.match(registered, /v-model="recurringListFilter"/)
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
  assert.match(source, /\.recurring-review-panel\{display:grid;[^}]*margin:0\}/)
  assert.match(source, /\.recurring-manager-panel \.recurring-posting-mode label\{min-height:44px;padding:7px\}/)
})

test('posting method options are compact horizontal touch targets with native-size radio inputs', () => {
  assert.match(fixed, /<fieldset class="recurring-posting-mode">/)
  assert.match(fixed, /value="auto" name="recurring-posting-mode"/)
  assert.match(fixed, /value="manual" name="recurring-posting-mode"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-posting-mode label\{[^}]*flex-direction:row;[^}]*min-height:44px;[^}]*white-space:nowrap/)
  assert.match(source, /\.recurring-manager-panel \.recurring-posting-mode input\[type=radio\]\{[^}]*width:16px!important;[^}]*height:16px!important;min-height:16px!important;max-height:16px!important;[^}]*padding:0!important/)
  // Keep the shared 44px rule on normal inputs; only the radio circle is 16px.
  assert.match(source, /\.finance-panel input:not\(\[type=file\]\),\.finance-panel select\{height:44px!important;/)
})

test('fixed-expense form, due review and saved plans are separate peer cards', () => {
  assert.ok(fixed && review && registered)
  assert.doesNotMatch(fixed, /recurring-review-panel|recurring-list-disclosure/)
  assert.doesNotMatch(review, /recurring-form-layout|recurring-list-disclosure/)
  assert.doesNotMatch(registered, /recurring-form-layout|reviewRecurring/)
  assert.match(source, /\.recurring-plans-panel \.recurring-list-summary\{display:grid/)
})
