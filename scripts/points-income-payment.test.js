import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('points cashback is selectable only as income, not as an expense category', () => {
  const app = read('src/App.vue')
  const api = read('functions/api/[[path]].js')
  const form = read('src/TransactionForm.vue')
  assert.match(app, /const INCOME_CATEGORIES = sortOtherLast\(\[[^\]]*'ポイント還元'[^\]]*\]\)/)
  assert.match(form, /record\.type==='income'\?orderedIncomeCategories/)
  assert.match(api, /SELECT category FROM category_source WHERE category NOT IN \([^)]*'ポイント還元'[^)]*\)/)
  assert.match(api, /const reserved = \[[^\]]*'ポイント還元'[^\]]*\]/)
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
