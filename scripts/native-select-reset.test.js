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
const finance = read('src/FinanceTools.vue')
const selects = vueFiles.flatMap(file =>
  [...read(file).matchAll(/<select\b[\s\S]*?<\/select>/g)].map(match => ({ file, markup: match[0] }))
)

test('all native select placeholders remain selectable on iOS Safari', () => {
  // A disabled placeholder stays visible in iOS's native picker, but users
  // cannot select it after choosing a real option.
  assert.ok(selects.length >= 4, 'audit the remaining native specialized selects across the app')
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
  assert.match(finance, /<MobileChoiceSheet v-model="selectedCard"[^>]*支払方法・カードを選択/)
  assert.match(finance, /<MobileChoiceSheet v-model="bill\.name"[^>]*カードを選択/)
  assert.match(finance, /<MobileChoiceSheet v-model="plan\.category"[^>]*選択してください/)
  // Other optional selectors must remain resettable too.
  const transaction = read('src/TransactionForm.vue')
  assert.match(transaction, /<MobileChoiceSheet v-model="record\.transferTarget"[^>]*transferOptions/)
  assert.match(transaction, /<MobileChoiceSheet :model-value="record\.paymentSource"[^>]*paymentOptions/)
})

test('clearing a selected management card closes its editor and discards stale draft data', () => {
  const body = finance.match(/watch\(selectedCard, \(name\) => \{([\s\S]*?)\}, \{ flush: 'sync' \}\)/)?.[1]
  assert.ok(body, 'card selection watcher exists')
  const cardMode = { value: 'edit' }
  const editedCardName = { value: '以前のカード' }
  const editSourceType = { value: 'prepaid' }
  const selectedSourceType = { value: 'standard' }
  const cardMessage = { value: '以前のカードを保存しました' }
  const handleChange = new Function('name', 'cardMode', 'editedCardName', 'editSourceType', 'selectedSourceType', 'cardMessage', body)
  handleChange('', cardMode, editedCardName, editSourceType, selectedSourceType, cardMessage)
  assert.equal(cardMode.value, '')
  assert.equal(editedCardName.value, '')
  assert.equal(editSourceType.value, 'standard')
  assert.equal(cardMessage.value, '')
})

test('blank billing card hides totals, saved bill and actions instead of mutating D1', () => {
  assert.match(finance, /if \(!isCreditCard\(bill\.value\.name\)\) return null/)
  assert.match(finance, /const cardTransactions=computed\(\(\)=>rows\.value\.filter\(e=>isCardBilledEntry\(e,cardPeriod\.value,bill\.value\.name\)\)\)/)
  assert.match(finance, /const selectedSavedBill = computed\(\(\) => isCreditCard\(bill\.value\.name\)/)
  assert.match(finance, /<div v-if="bill\.name" class="card-billing-actions">/)
  assert.match(finance, /<div v-if="selectedSavedBill" class="finance-saved-bill">/)
  assert.match(finance, /<output class="card-usage-total"[^>]*>\{\{loaded && bill\.name && cardPeriod \? yen\(cardTotal\) : "—"\}\}<\/output>/)
})

test('clearing a required recurring category is reversible without saving invalid settings', () => {
  assert.match(finance, /const blankPlan = \(\) => \(\{name:'',amount:'',day:1,weekday:1,scheduleType:'monthly',category:'',paymentSource:'現金'/)
  assert.match(finance, /!props\.categories\.includes\(plan\.value\.category\)/)
  assert.match(finance, /message\.value='名称・金額・記帳日・開始月・カテゴリ・支払方法を確認してください';return/)
})
