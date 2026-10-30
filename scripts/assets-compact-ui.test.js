import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')

test('assets overview keeps four real-data summaries and a condensed scheduled transfer', () => {
  const source = read('pages/AssetsPage.vue')
  for (const label of ['資産合計', 'プリペイド残高', '投資信託評価額', '振替状況']) {
    assert.ok(source.includes(label), label)
  }
  assert.match(source, /<details class="panel pending-transfer-panel">/)
  assert.match(source, /@summary="onPortfolioSummary"/)
  assert.match(source, /@summary="onPrepaidSummary"/)
  assert.match(source, /現金残高・未登録の資産は含みません/)
  assert.match(source, /Math\.min\(100,100\*posted\.value\/plan\.value\)/)
})

test('prepaid and holdings default open, while monthly plans and purchase months default closed', () => {
  const prepaid = read('PrepaidAssets.vue')
  const portfolio = read('SbiPortfolio.vue')
  assert.match(prepaid, /<details class="panel wallet-panel" open/)
  assert.match(portfolio, /<details class="panel sbi-card sbi-holdings" open>/)
  assert.match(portfolio, /<details class="panel sbi-card sbi-plans">/)
  assert.match(portfolio, /<details class="panel sbi-card sbi-transfers">/)
  assert.match(prepaid, /data\.cards\.slice\(0,2\)/)
  assert.match(portfolio, /holdingsData\.value\.slice\(0,2\)/)
  assert.match(portfolio, /data\.plans\.slice\(0,2\)/)
  assert.match(portfolio, /data\.transfers\.slice\(0,2\)/)
})

test('balance edit and transfer adjustment remain available without changing D1 schemas', () => {
  const prepaid = read('PrepaidAssets.vue')
  const portfolio = read('SbiPortfolio.vue')
  assert.match(prepaid, /prepaid-assets\/opening/)
  assert.match(prepaid, /role="dialog" aria-modal="true"/)
  assert.match(portfolio, /editHolding\(h\)/)
  assert.match(portfolio, /editPrice\(h\)/)
  assert.match(portfolio, /submitTransfer/)
  assert.match(portfolio, /emit\('summary',\{month:response\.month/)
})
