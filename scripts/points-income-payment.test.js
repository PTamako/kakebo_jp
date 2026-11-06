import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('points cashback is selectable only as income, not as an expense category', () => {
  const app = read('src/App.vue')
  const api = read('functions/api/[[path]].js')
  const form = read('src/TransactionForm.vue')
  const migration = read('migrations/0016_category_types.sql')
  assert.match(app, /const INCOME_CATEGORIES = ref\(\[\]\)/)
  assert.match(app, /INCOME_CATEGORIES\.value = sortOtherLast\(rows\.filter\(row => row\.entry_type === 'income'\)/)
  assert.match(form, /record\.type==='income'\?orderedIncomeCategories/)
  assert.match(api, /SELECT category FROM category_source WHERE entry_type='expense'/)
  assert.match(migration, /'ポイント還元'/)
  assert.doesNotMatch(app, /CATEGORIES as BASE_CATEGORIES|legacyCategoryLabels/)
})

test('points payment source is loaded from D1 and can fund wallet transfers and expenses', () => {
  const app = read('src/App.vue')
  const api = read('functions/api/[[path]].js')
  const form = read('src/TransactionForm.vue')
  const finance = read('src/FinanceTools.vue')
  assert.match(app, /const paymentSources = ref\(\[\]\)/)
  assert.match(app, /const cards = await api\('payment-sources'\)/)
  assert.match(api, /if \(a === 'payment-sources' && !b && m === 'GET'\)/)
  assert.match(form, /v-for="source in orderedPayments"/)
  assert.match(form, /record\.type==='transfer'/)
  assert.match(finance, /const isCreditCard = name =>[^\n]*source_type === 'standard'/)
  assert.match(finance, /<option value="prepaid">プリペイドカード/)
})
