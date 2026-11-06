import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {sortOtherLast, isOtherOption, OTHER_SORT_ORDER} from '../src/category-sort.js'

const sourceFile=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('other is always last, across Japanese, Chinese, income and payments',()=>{
  assert.equal(OTHER_SORT_ORDER,99999)
  for(const other of ['其他','その他','其他收入','その他の収入']) {
    assert.equal(isOtherOption(other),true)
    const src=['新規',other,'既存','追加']
    assert.deepEqual(sortOtherLast(src),['新規','既存','追加',other])
    assert.deepEqual(src,['新規',other,'既存','追加'],'sorting never mutates original refs')
  }
  assert.deepEqual(sortOtherLast(['その他','現金','カードA','カードB']),['現金','カードA','カードB','その他'])
  assert.deepEqual(sortOtherLast(['其他','飲食料品','新規カスタム']),['飲食料品','新規カスタム','其他'])
})

test('the category and card dropdowns use the same stable Other-last order',()=>{
  const app=sourceFile('src/App.vue')
  const form=sourceFile('src/TransactionForm.vue')
  const finance=sourceFile('src/FinanceTools.vue')
  assert.match(app,/paymentSources\.value = sortOtherLast\(cards\.map\(x => x\.name\)\)/)
  assert.match(app,/categories\.value = sortOtherLast\(rows\.filter\(row => row\.entry_type === 'expense'\)/)
  assert.match(app,/INCOME_CATEGORIES\.value = sortOtherLast\(rows\.filter\(row => row\.entry_type === 'income'\)/)
  assert.match(form,/v-for="source in orderedPayments"/)
  assert.match(form,/record\.type==='income'\?orderedIncomeCategories:orderedCategories/)
  assert.match(finance,/v-for="category in orderedCategories"/)
  assert.match(finance,/v-for="source in orderedPayments"/)
  assert.doesNotMatch(finance,/v-for="source in props\.paymentSources"/)
  assert.doesNotMatch(finance,/v-for="category in props\.categories"/)
})

test('D1 persistence gives Other sentinel 99999 in all card creation, restore and category paths',()=>{
  const api=sourceFile('functions/api/[[path]].js')
  const atomic=sourceFile('functions/api/restore-atomic.js')
  const schema=sourceFile('schema.sql')
  const legacyMigration=sourceFile('migrations/0004_other_last_sort_order.sql')
  assert.doesNotMatch(api,/UPDATE payment_sources SET sort_order=99999 WHERE name IN/, 'reading card settings never rewrites migrated sorting')
  assert.match(api,/ORDER BY CASE WHEN name IN \('その他','其他'\) THEN 1 ELSE 0 END/)
  assert.doesNotMatch(api,/ensureCategorySource|category_sort_order|category_icons/)
  assert.match(api,/SELECT category FROM category_source WHERE entry_type='expense'/)
  assert.match(api,/ORDER BY CASE WHEN category IN \('其他','その他'\) THEN 1 ELSE 0 END/)
  assert.match(atomic,/CASE WHEN \?1 IN \('其他','其他收入'\) THEN 99999/)
  assert.match(api,/WHEN \?1 IN \('その他','其他'\) THEN 99999/g)
  assert.match(atomic,/WHEN \?1 IN \('その他','其他'\) THEN 99999/)
  assert.match(schema,/CREATE TABLE IF NOT EXISTS category_source/)
  assert.doesNotMatch(schema,/CREATE TABLE IF NOT EXISTS category_icons|CREATE TABLE IF NOT EXISTS category_sort_order/)
  assert.match(legacyMigration,/UPDATE payment_sources\s+SET sort_order=99999/)
  assert.doesNotMatch(legacyMigration,/DELETE FROM entries|DROP TABLE|UPDATE entries|UPDATE investment_snapshots/)
})
