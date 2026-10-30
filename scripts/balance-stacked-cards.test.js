import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8')
const page = read('src/pages/AssetsPage.vue')
const portfolio = read('src/SbiPortfolio.vue')

test('phone: one-column investment/wallet overview, desktop: side by side',()=>{
  assert.match(page,/\.asset-overview\{display:grid;grid-template-columns:minmax\(0,1fr\)/)
  assert.match(page,/@media\(min-width:768px\)\{\.asset-overview\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.ok(page.indexOf('class="asset-investment"') < page.indexOf('class="asset-wallet"'))
  assert.match(page,/class="balance-view-switch"/)
  assert.doesNotMatch(page,/資産合計|assetsTotal/)
})

test('investment allocation remains colored and displays every fund name + value percentage',()=>{
  assert.match(portfolio,/const allocationRows = computed\(\(\) => \{/)
  assert.match(portfolio,/Number\(h.market_value\) \/ total \* 100/)
  assert.match(portfolio,/name: shortFundName\(h\)/)
  assert.match(portfolio,/color: allocationColors\[index % allocationColors.length\]/)
  assert.match(page,/class="asset-allocation" role="img"/)
  assert.match(page,/class="asset-allocation-legend"/)
  assert.match(page,/v-for="a in allocation"/)
  assert.match(page,/\{\{a\.name\}\}/)
  assert.match(page,/\{\{a\.ratio\.toFixed\(1\)\}\}%/)
  assert.match(page,/background:a.color/)
  assert.match(page,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
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
