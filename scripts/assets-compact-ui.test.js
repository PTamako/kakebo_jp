import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')

test('balance page summarizes wallets, holdings, fund profit/loss and scheduled transfers without a misleading wealth total', () => {
  const source = read('pages/AssetsPage.vue')
  for (const label of ['残高</h1>', '電子マネー残高', '投資信託評価額', '評価損益']) {
    assert.ok(source.includes(label), label)
  }
  assert.match(source, /class="balance-view-switch"/)
  assert.match(source, /@click="selectView\('funds'\)"/)
  assert.match(source, /@click="selectView\('wallets'\)"/)
  assert.doesNotMatch(source, /pending-transfer-panel|積立管理|振替予定/)
  assert.match(source, /@summary="onPortfolioSummary"/)
  assert.match(source, /@summary="onPrepaidSummary"/)
  assert.match(source, /aria-label="残高の概要"/)
  assert.match(source, /gainYen\(pnl\)/)
  assert.doesNotMatch(source, /資産合計|assetsTotal/)
  assert.match(source, /class="asset-investment"/)
  assert.match(source, /class="asset-wallet"/)
  assert.match(source, /asset-investment-foot/)
  assert.doesNotMatch(source, /class="asset-stat asset-stat-compact"/)
  assert.doesNotMatch(source, /pending-numbers|pending-progress|pending-transfer-list/)
  assert.doesNotMatch(source, /資産合計|assetsTotal/)
})

test('prepaid and holdings default open, while monthly plans and purchase months default closed', () => {
  const prepaid = read('PrepaidAssets.vue')
  const portfolio = read('SbiPortfolio.vue')
  assert.match(prepaid, /<details class="panel wallet-panel" open/)
  assert.match(portfolio, /<details class="panel sbi-card sbi-holdings" open>/)
  assert.match(portfolio, /<details class="panel sbi-card sbi-investment-manage" open>/)
  assert.match(portfolio, /<details class="sbi-transfer-disclosure">/)
  assert.doesNotMatch(portfolio, /class="panel sbi-card sbi-plans"|class="panel sbi-card sbi-transfers"/)
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
