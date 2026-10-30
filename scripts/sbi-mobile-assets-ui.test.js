import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const page = read('src/pages/AssetsPage.vue')
const portfolio = read('src/SbiPortfolio.vue')
const api = read('functions/api/investment-portfolio.js')

test('mobile assets start with four summaries, scheduled transfers and then compact wallet/holdings', () => {
  const pageMarkers = ['class="asset-overview"', 'class="panel pending-transfer-panel"', '<SbiPortfolio', '<PrepaidAssets']
  const pageIndices = pageMarkers.map(marker => page.indexOf(marker))
  assert.ok(pageIndices.every(index => index >= 0))
  assert.deepEqual([...pageIndices].sort((a,b)=>a-b),pageIndices)
  const portfolioMarkers = ['<slot name="before-holdings" />', 'class="panel sbi-card sbi-holdings" open', 'class="panel sbi-card sbi-plans"', 'class="panel sbi-card sbi-transfers"']
  const indices = portfolioMarkers.map(marker => portfolio.indexOf(marker))
  assert.ok(indices.every(index => index >= 0))
  assert.deepEqual([...indices].sort((a,b)=>a-b),indices)
  assert.match(page,/資産合計/)
  assert.match(page,/プリペイド残高/)
  assert.match(page,/投資信託評価額/)
  assert.match(page,/振替状況/)
  assert.match(page,/現金残高・未登録の資産は含みません/)
  assert.match(portfolio,/class="sbi-hero-value"/)
  assert.match(portfolio,/data\.valuation\.value === null \? '—'/)
  assert.match(portfolio,/returnRatio !== null/)
  assert.match(portfolio,/totalAcquisition/)
})

test('fund rows label NAV dates and data sources without claiming all prices are live', () => {
  assert.match(portfolio,/official_mufg/)
  assert.match(portfolio,/sourceLabel\(h\.source\)/)
  assert.match(portfolio,/初期記録/)
  assert.match(portfolio,/h\.source==='sbi_screenshot'\?'確認日':'基準日'/)
  assert.match(portfolio,/自動取得は対応銘柄のみ/)
  assert.match(portfolio,/autoNavSupported\(h\.fund_code\)/)
  assert.match(portfolio,/navModeHelp\(holding\.fundCode\)/)
  const coverage=read('src/fund-nav-coverage.js')
  const provider=read('functions/api/fund-nav-sync.js')
  assert.match(provider,/from '\.\.\/\.\.\/src\/fund-nav-coverage\.js'/)
  assert.match(coverage,/03311187/)
  assert.match(coverage,/0331418A/)
  assert.match(coverage,/0331A172/)
  assert.doesNotMatch(coverage,/04317188/)
  assert.match(portfolio,/source === 'manual' \? '手入力'/)
  assert.doesNotMatch(portfolio,/旧評価額（過去の手入力データ）|旧評価損益/)
  assert.doesNotMatch(page,/legacy-investment-details/)
})

test('mobile controls keep edit functions, transfer month and keyboard accessible dialogs', () => {
  for (const name of ['editPlan','editHolding','editPrice','submitTransfer','closeEditor','onEditorKeydown']) {
    assert.match(portfolio,new RegExp('function '+name+'\\('))
  }
  assert.match(portfolio,/aria-label="資産情報を更新"/)
  assert.doesNotMatch(portfolio,/investment-portfolio\/initialize|async function initialize\(/)
  assert.match(portfolio,/class="sbi-holding-footer"/)\n  assert.match(portfolio,/class="sbi-holding-commands"/)\n  assert.match(portfolio,/class="sbi-nav-status"/)
  assert.match(portfolio,/class="sbi-holding-detail"/)
  assert.match(portfolio,/@click="editHolding\(h\)"/)
  assert.match(portfolio,/@click="editPrice\(h\)"/)
  assert.match(portfolio,/aria-label="保有情報の編集"/)
  assert.match(portfolio,/aria-label="基準価額の編集"/)
  assert.match(portfolio,/aria-modal="true"/)
  assert.match(portfolio,/env\(safe-area-inset-bottom/)
  assert.match(portfolio,/min-height:44px/)
  assert.match(portfolio,/window\.removeEventListener\('keydown',onEditorKeydown\)/)
  assert.match(portfolio,/if \(data\.value\?\.month !== targetMonth\) \{ data\.value = null; emit\('summary',null\) \}/)
})

test('UI never changes the existing authenticated portfolio API or DB tables', () => {
  assert.match(portfolio,/props\.api\('investment-portfolio\?month='/)
  for (const route of ['plan','holding','price','transfer-month']) {
    assert.match(api,new RegExp("sub==='"+route+"'"))
  }
  assert.match(api,/SELECT h\.fund_code,h\.account_type,h\.fund_name/)
  assert.doesNotMatch(page,/DROP TABLE|DELETE FROM|CREATE TABLE/)
})
