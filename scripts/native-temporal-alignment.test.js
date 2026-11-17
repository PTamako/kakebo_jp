import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const mobile = read('src/mobile-ui.css')
const finance = read('src/FinanceTools.vue')+'\n'+read('src/FixedCostEditorFields.vue')
const sbi = read('src/SbiPortfolio.vue')
const transaction = read('src/TransactionForm.vue')
const ledger = read('src/pages/LedgerPage.vue')
const html = read('index.html')

test('one native iPhone Safari alignment rule covers month, date and time throughout the app', () => {
  const target='main input:is([type="date"],[type="month"],[type="time"])'
  assert.match(mobile, /native date\/month\/time controls must remain inline-flex/)
  assert.ok(mobile.includes(target+' {\n  display: inline-flex !important;'))
  assert.match(mobile, /min-height: 44px;[\s\S]*?padding-block: 0 !important;/)
  assert.match(mobile, /::-webkit-date-and-time-value \{[\s\S]*?align-items: center !important;/)
  assert.match(mobile, /::-webkit-datetime-edit-fields-wrapper \{[\s\S]*?align-items: center;/)
  assert.match(mobile, /::-webkit-calendar-picker-indicator \{[\s\S]*?align-self: center;/)
})

test('reported closing month and recurring start month retain native pickers', () => {
  assert.match(finance,/<CardUsageSummaryFields :card="bill\.name" :month="bill\.month"/)
  const shared=read('src/CardUsageSummaryFields.vue')
  assert.match(shared,/<input class="card-closing-month" type="month" :value="month" aria-label="締め月"/)
  assert.match(shared,/@input="emit\('update:month',\$event\.target\.value\)"/)
  assert.match(finance,/v-model="model\.startMonth" type="month"/)
  const child=read('src/FixedCostEditorFields.vue')
  assert.match(child,/\.recurring-start-month input\[type="month"\]/)
  assert.match(child,/min-inline-size:0!important/)
  assert.match(child,/max-inline-size:100%!important/)
  assert.match(child,/box-sizing:border-box!important/)
  assert.match(child,/overflow:hidden/)

  assert.match(finance,/\.finance-panel \.recurring-start-month input\[type=month\]\{display:inline-flex;align-items:center;/)
  assert.doesNotMatch(finance,/input\[type=month\]\{display:block/)
})

test('SBI, transaction date and ledger month use same native Safari alignment', () => {
  assert.match(sbi,/v-model="plan\.effectiveMonth" type="month"/)
  assert.match(sbi,/v-model="price\.priceDate" type="date"/)
  assert.match(sbi,/v-model="newPurchaseMonth" type="month"/)
  assert.match(sbi,/input\[type=month\]\{-webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;/)
  assert.match(transaction,/v-model="record\.date" type="date"/)
  assert.match(ledger,/type="month" v-model="month"/)
})

test('native pickers, card selection and user-requested no-zoom policy remain unchanged', () => {
  assert.match(html,/maximum-scale=1, user-scalable=no, viewport-fit=cover/)
  assert.match(mobile,/html \{ -webkit-text-size-adjust: 100%; touch-action: pan-x pan-y; \}/)
  assert.doesNotMatch(mobile,/pointer-events:\s*none\s*!important/)
  assert.doesNotMatch(mobile,/::-webkit-calendar-picker-indicator\s*\{[^}]*display:\s*none/)
})
