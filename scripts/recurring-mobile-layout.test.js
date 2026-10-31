import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/FinanceTools.vue', import.meta.url), 'utf8')
const fixed = source.match(/<article v-show="managementTab === 'plans'" class="finance-panel recurring-manager-panel">([\s\S]*?)\n  <\/article>/)?.[1] || ''

test('iPhone effective-month input stays within its own grid cell', () => {
  assert.match(fixed, /<label class="recurring-start-month">適用開始月<input v-model="plan.startMonth" type="month"/)
  assert.match(source, /\.recurring-manager-panel \.recurring-start-month\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*overflow:hidden/)
  assert.match(source, /\.finance-panel \.recurring-start-month input\[type=month\]\{[^}]*width:100%!important;max-width:100%!important;min-width:0!important;min-inline-size:0!important;box-sizing:border-box!important/)
  assert.match(source, /::-webkit-date-and-time-value\{min-width:0/)
})

test('expense candidates use native 18px checkboxes and readable rows', () => {
  assert.match(fixed, /class="finance-row recurring-candidate"/)
  assert.match(fixed, /<input type="checkbox" :checked="recurringSelected/)
  assert.match(fixed, /class="recurring-candidate-checkbox"/)
  assert.match(source, /\.finance-panel \.recurring-candidate input\.recurring-candidate-checkbox\[type=checkbox\]\{[^}]*width:18px!important;height:18px!important/)
  assert.match(fixed, /class="recurring-candidate-name"/)
  assert.match(fixed, /class="recurring-candidate-amount"/)
  assert.match(fixed, /class="recurring-candidate-date"/)
  assert.match(fixed, /過去分は推定/)
  assert.match(fixed, /既存の明細を優先（対象外）/)
  assert.match(fixed, /登録対象/)
  assert.match(fixed, /@change="toggleRecurringSelection\(candidate,\$event\.target\.checked\)"/)
})

test('registered-plan disclosure reserves right-hand chevron and keeps amount and metadata tidy', () => {
  assert.match(fixed, /<details class="recurring-list-disclosure">/)
  assert.match(fixed, /<summary class="recurring-list-summary">/)
  assert.match(source, /\.recurring-list-summary\{display:grid;grid-template-columns:minmax\(0,1fr\) 18px;grid-template-rows:auto auto/)
  assert.match(source, /\.recurring-list-summary:after\{grid-column:2;grid-row:1;/)
  assert.match(source, /\.recurring-list-summary-total\{grid-column:1\/-1;grid-row:2;/)
  assert.match(fixed, /class="recurring-plan-name"/)
  assert.match(fixed, /class="recurring-plan-amount"/)
  assert.match(fixed, /class="recurring-plan-chevron"/)
  assert.match(fixed, /class="recurring-plan-meta-item">毎月\{\{p.day\}\}日/)
  assert.match(fixed, /class="recurring-plan-meta-item">開始 \{\{p.startMonth/)
  assert.match(source, /\.recurring-plan-meta\{grid-column:1\/-1;grid-row:2;display:flex;flex-wrap:wrap/)
  assert.match(source, /\.recurring-plan-meta-item\{[^}]*white-space:nowrap/)
})

test('existing create, edit, preview, selection and explicit posting confirmation stay unchanged', () => {
  assert.match(fixed, /@click="addPlan"/)
  assert.match(fixed, /@click="cancelPlanEdit"/)
  assert.match(fixed, /@click="reviewRecurring"/)
  assert.match(fixed, /@click="applyRecurring"/)
  assert.match(fixed, /@click="beginEditPlan\(p\)"/)
  assert.match(fixed, /@click="togglePlanEnabled\(p\)"/)
  assert.match(fixed, /@click="removePlan\(p.id\)"/)
  assert.match(fixed, /v-model="recurringListQuery"/)
  assert.match(fixed, /v-model="recurringListFilter"/)
  assert.match(source, /if\(!confirm\(summary\)\)return/)
  assert.match(source, /postApprovedRecurringEntries\(props.api,safe\)/)
  assert.match(source, /await props.api\(updated\?'recurring-plans\/'/)
  assert.doesNotMatch(fixed, /:style="\{.*width:100vw/)
})
