import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8')
const page = read('src/pages/AssetsPage.vue')
const portfolio = read('src/SbiPortfolio.vue')

test('phone: one-column investment/wallet overview, desktop: side by side',()=>{
  assert.match(page,/\.asset-overview\{display:grid;grid-template-columns:minmax\(0,1fr\)/)
  assert.match(page,/@media\(min-width:768px\)\{\.asset-overview\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.ok(page.indexOf('class="asset-wallet"') < page.indexOf('class="asset-investment"'))
  assert.match(page,/class="balance-view-switch"/)
  assert.doesNotMatch(page,/資産合計|assetsTotal/)
})

test('investment allocation retains its color bar but removes the growing fund legend',()=>{
  assert.match(portfolio,/const allocationRows = computed\(\(\) => \{/)
  assert.match(portfolio,/Number\(fund.market_value\) \/ total \* 100/)
  assert.match(portfolio,/name: shortFundName\(fund\)/)
  assert.match(portfolio,/color: allocationColors\[index % allocationColors.length\]/)
  assert.match(page,/class="asset-allocation" role="img"/)
  assert.match(page,/v-for="a in allocation"/)
  assert.match(page,/background:a.color/)
  assert.match(page,/allocation.map\(a=>a.name\+' '\+a.ratio.toFixed\(1\)\+'%'\)/)
  assert.doesNotMatch(page,/asset-allocation-legend|asset-allocation-legend-item|asset-allocation-name/)
})

test('long card and merchant names truncate without pushing monetary amounts out of the card',()=>{
  assert.match(page,/\.asset-wallet-event\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)
  assert.match(page,/\.asset-wallet-event-info\{[^}]*min-width:0;max-width:100%/)
  assert.match(page,/\.asset-wallet-card,\.asset-wallet-event-meta\{[^}]*overflow:hidden;text-overflow:ellipsis;white-space:nowrap/)
  assert.match(page,/class="asset-wallet-event-side"/)
  assert.match(page,/\.asset-wallet-event-side\{display:flex;flex-direction:column;align-items:flex-end/)
  assert.match(page,/\.asset-wallet-event-amount\{[^}]*white-space:nowrap/)
  assert.match(page,/:title="latestUsage.card"/)
  assert.match(page,/:title="latestCharge.card"/)
  assert.match(page,/:title="latestUsage.merchant \|\| ''"/)
  assert.match(page,/:title="latestCharge.funding_source \|\| ''"/)
  assert.match(page,/shortDate\(latestUsage.date\)/)
  assert.match(page,/shortDate\(latestCharge.date\)/)
})

test('all daily money and investment data still comes from existing summary streams, not samples',()=>{
  assert.match(page,/@summary="onPortfolioSummary"/)
  assert.match(page,/@summary="onPrepaidSummary"/)
  assert.match(page,/latestUsage = computed\(\(\) => prepaidSummary\.value\?\.latestUsage/)
  assert.match(page,/latestCharge = computed\(\(\) => prepaidSummary\.value\?\.latestCharge/)
  assert.match(page,/allocation = computed\(\(\) => portfolioSummary\.value\?\.allocation/)
  assert.doesNotMatch(page,/\bINSERT INTO\b|\bUPDATE entries\b|\bCREATE TABLE\b/)
})
