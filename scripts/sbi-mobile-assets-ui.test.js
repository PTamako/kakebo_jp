import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const page = read('src/pages/AssetsPage.vue')
const portfolio = read('src/SbiPortfolio.vue')
const api = read('functions/api/investment-portfolio.js')

test('mobile asset hierarchy prioritizes valuation, holdings, plan then transfer', () => {
  const markers = ['aria-label="資産サマリー"', 'id="sbi-holdings-title"', 'id="sbi-plans-title"', 'id="sbi-transfer-title"']
  const indices = markers.map(marker => portfolio.indexOf(marker))
  assert.ok(indices.every(index => index >= 0))
  assert.deepEqual([...indices].sort((a,b)=>a-b),indices)
  assert.match(portfolio,/class="sbi-hero-value"/)
  assert.match(portfolio,/data\.valuation\.value === null \? '—'/)
  assert.match(portfolio,/returnRatio !== null/)
  assert.match(portfolio,/totalAcquisition/)
  assert.ok(page.indexOf('<SbiPortfolio') < page.indexOf('class="panel pending-transfer-panel"'))
  assert.match(page,/v-if="transferLoading \|\| pendingTransfers\.length"/)
})

test('fund rows label NAV dates and data sources without claiming all prices are live', () => {
  assert.match(portfolio,/official_mufg/)
  assert.match(portfolio,/sourceLabel\(h\.source\)/)
  assert.match(portfolio,/初期記録/)
  assert.match(portfolio,/h\.source==='sbi_screenshot'\?'確認日':'基準日'/)
  assert.match(portfolio,/基準価額は三菱UFJ運用の3銘柄を自動更新します。/)
  assert.match(portfolio,/NASDAQ100は手入力/)
  assert.doesNotMatch(portfolio,/旧評価額（過去の手入力データ）|旧評価損益/)
  assert.doesNotMatch(page,/legacy-investment-details/)
})

test('mobile controls keep edit functions, transfer month and keyboard accessible dialogs', () => {
  for (const name of ['editPlan','editHolding','editPrice','submitTransfer','initialize','closeEditor','onEditorKeydown']) {
    assert.match(portfolio,new RegExp('function '+name+'\\('))
  }
  assert.match(portfolio,/aria-label="資産情報を更新"/)
  assert.match(portfolio,/sbi-action-menu/)
  assert.match(portfolio,/aria-label="保有情報の編集"/)
  assert.match(portfolio,/aria-label="基準価額の編集"/)
  assert.match(portfolio,/aria-modal="true"/)
  assert.match(portfolio,/env\(safe-area-inset-bottom/)
  assert.match(portfolio,/min-height:44px/)
  assert.match(portfolio,/window\.removeEventListener\('keydown',onEditorKeydown\)/)
  assert.match(portfolio,/data\.value\?\.month !== targetMonth\) data\.value = null/)
})

test('UI never changes the existing authenticated portfolio API or DB tables', () => {
  assert.match(portfolio,/props\.api\('investment-portfolio\?month='/)
  for (const route of ['plan','holding','price','transfer-month']) {
    assert.match(api,new RegExp("sub==='"+route+"'"))
  }
  assert.match(api,/SELECT h\.fund_code,h\.account_type,h\.fund_name/)
  assert.doesNotMatch(page,/DROP TABLE|DELETE FROM|CREATE TABLE/)
})
