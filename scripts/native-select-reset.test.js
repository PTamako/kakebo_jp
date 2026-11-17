import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const vueFiles = [
  'src/AmountInput.vue',
  'src/App.vue',
  'src/FinanceTools.vue',
  'src/InvestmentTransferReview.vue',
  'src/PrepaidAssets.vue',
  'src/SbiPortfolio.vue',
  'src/TransactionForm.vue',
  'src/pages/AssetsPage.vue',
  'src/pages/LedgerPage.vue',
  'src/pages/ManagementPage.vue',
  'src/pages/StatisticsPage.vue',
]
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const finance = read('src/FinanceTools.vue')+'\n'+read('src/FixedCostEditorFields.vue')
const controls = read('src/CardManagementControls.vue')
const cardPanel=read('src/OriginalCardManagementPanel.vue')
const selects = vueFiles.flatMap(file =>
  [...read(file).matchAll(/<select\b[\s\S]*?<\/select>/g)].map(match => ({ file, markup: match[0] }))
)

test('all native select placeholders remain selectable on iOS Safari', () => {
  // A disabled placeholder stays visible in iOS's native picker, but users
  // cannot select it after choosing a real option.
  assert.equal(selects.length, 0, 'all legacy native select controls are now mobile-first choice components')
  for (const { file, markup } of selects) {
    assert.doesNotMatch(markup, /<option\b(?=[^>]*\bvalue=(?:""|''))(?=[^>]*\bdisabled\b)[^>]*>/,
      file + ': initial blank option must not be disabled')
  }
})

test('all native selects have controlled application state', () => {
  for (const { file, markup } of selects) {
    assert.match(markup, /(?:v-model(?:\.number)?=|:value=)/, file + ': select must have an active value')
    // Controlled :value selects need an explicit change event handler.
    if (!/v-model(?:\.number)?=/.test(markup)) {
      assert.match(markup, /@change=/, file + ': value-only select must handle change')
    }
  }
})

test('card management, billing, and recurring category can return to initial labels', () => {
  assert.match(finance, /<OriginalCardManagementPanel v-show="managementTab === 'cards'"/)
  assert.match(cardPanel, /<CardManagementControls :model-value="selected"/)
  assert.match(controls, /<MobileChoiceSheet[\s\S]*?支払方法・カードを選択/)
  assert.match(finance, /<CardUsageSummaryFields :card="bill\.name" :month="bill\.month"/)
  assert.match(finance, /:card-options="\[\{value:'',label:'カードを選択'\}/)
  assert.match(read('src/CardUsageSummaryFields.vue'), /<MobileChoiceSheet :model-value="card" label="カード名" :options="cardOptions"/)
  assert.match(finance, /<MobileChoiceSheet v-model="model\.category"[^>]*選択してください/)
  // Other optional selectors must remain resettable too.
  const transaction = read('src/TransactionForm.vue')
  assert.match(transaction, /<MobileChoiceSheet(?: v-else)? v-model="record\.transferTarget"[^>]*transferOptions/)
  assert.match(transaction, /<MobileChoiceSheet :model-value="record\.paymentSource"[^>]*paymentOptions/)
})

test('the card editor resets its draft every time the selected card or mode changes', () => {
  const sheet=read('src/MobileCardEditorSheet.vue')
  assert.match(sheet,/watch\(\(\)=>\[props\.mode,props\.cardName\]/)
  assert.match(sheet,/resetDraft\(\)/)
  assert.match(sheet,/name\.value=props\.cardName/)
  assert.match(sheet,/sourceType\.value=card\.source_type\|\|'standard'/)
  assert.match(sheet,/statGroup\.value=card\.stat_group\|\|'card'/)
  assert.match(sheet,/name\.value='';sourceType\.value=props\.defaultSourceType==='prepaid'\?'prepaid':'standard'/)
  assert.match(sheet,/if\(dirty\.value&&!window\.confirm\('変更内容を破棄しますか？'\)\)return/)
})

test('blank billing card hides totals, saved bill and actions instead of mutating D1', () => {
  assert.match(finance, /if \(!isCreditCard\(bill\.value\.name\)\) return null/)
  assert.match(finance, /const cardTransactions=computed\(\(\)=>rows\.value\.filter\(e=>isCardBilledEntry\(e,cardPeriod\.value,bill\.value\.name\)\)\)/)
  assert.match(finance, /const selectedSavedBill = computed\(\(\) => isCreditCard\(bill\.value\.name\)/)
  assert.match(finance, /<div v-if="bill\.name" class="card-billing-actions">/)
  assert.match(finance, /<div v-if="selectedSavedBill" class="finance-saved-bill">/)
  assert.match(finance, /:amount="loaded && bill\.name && cardPeriod \? yen\(cardTotal\) : '—'"/)
  assert.match(read('src/CardUsageSummaryFields.vue'), /<output class="card-usage-total" aria-live="polite">\{\{amount\}\}<\/output>/)
})

test('clearing a required recurring category is reversible without saving invalid settings', () => {
  assert.match(finance, /const blankPlan = \(\) => \(\{name:'',amount:'',day:1,weekday:1,weekdays:\[1\],monthDays:\[1\],intervalMonths:1,scheduleType:'monthly',category:'',paymentSource:'現金'/)
  assert.match(finance, /!props\.categories\.includes\(plan\.value\.category\)/)
  assert.match(finance, /message\.value='名称・金額・記帳日・開始月・カテゴリ・支払方法を確認してください';return/)
})
