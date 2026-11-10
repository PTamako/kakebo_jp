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
  assert.match(form, /record\.value\.type==='income'\?orderedIncomeCategories\.value/)
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
  assert.match(form, /orderedPayments\.value\.map\(name=>/)
  assert.match(form, /record\.type==='transfer'/)
  assert.match(finance, /const isCreditCard = name =>[^\n]*source_type === 'standard'/)
  assert.match(finance, /value:'prepaid',label:'プリペイドカード'/)
})

test('reward destination is selected from D1 cards and prepaid rewards create a linked transfer atomically', () => {
  const app=read('src/App.vue'),form=read('src/TransactionForm.vue')
  const api=read('functions/api/[[path]].js'),finance=read('src/FinanceTools.vue')
  assert.match(app,/const rewardDestinations = computed\(/)
  assert.match(app,/paymentSourceMeta\.value\[name\]\?\.source_type==='prepaid'|prepaidSources\.value\.map/)
  assert.match(form,/record\.type==='income' && record\.category==='ポイント還元'/)
  assert.match(form,/v-model="record\.rewardDestination"/)
  assert.match(api,/const rewardPrepaid=!!reward\.target\?\.startsWith\('prepaid:'\)/)
  assert.match(api,/await db\.batch\(\[insertStatement,/)
  assert.match(api,/db\.prepare\(pointTopUpSql\)/)
  assert.match(api,/credit:'\|\|\?1/)
  assert.match(finance,/cardBilledAmount\(e\)/)
  assert.match(api,/const \[result\]=needsPairUpdate \? await db\.batch\(\[entryUpdate,pairedWrite\]\)/)
  assert.match(api,/pairedEntryId:paired\?\.id\|\|null/)
})

test('generated point-funded prepaid transfers use the registered wallet name with チャージ', () => {
  const api=read('functions/api/[[path]].js')
  const topup=api.match(/const pointTopUpSql = `([\s\S]*?)`/)?.[1] || ''
  assert.ok(topup,'point wallet transfer SQL exists')
  // Use the actual transfer_target, so future wallets are supported without hardcoding brands.
  assert.match(topup,/substr\(transfer_target,9\)\|\|'チャージ'/)
  assert.match(topup,/merchant=excluded\.merchant/)
  assert.match(topup,/payment_source=excluded\.payment_source/)
  assert.doesNotMatch(topup,/,'ポイント還元','ポイント還元の自動チャージ'/)
  // Rename updates both the linked target and its display title, while
  // unrelated asset transfers keep their existing merchant name.
  assert.match(api,/client_request_id LIKE 'point_charge_%'/)
  assert.match(api,/merchant IN \('ポイント還元',\?3\|\|'チャージ'\)/)
  assert.match(api,/\?4\|\|'チャージ'/)
  // A previously archived companion also gets the destination-based label on restore.
  assert.match(api,/pairedEntry\.transfer_target\.slice\(8\)\+'チャージ'/)
})
