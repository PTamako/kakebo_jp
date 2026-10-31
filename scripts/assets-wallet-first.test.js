import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/pages/AssetsPage.vue', import.meta.url), 'utf8')
const overview = source.match(/<section class="asset-overview"[^>]*>([\s\S]*?)\n    <\/section>/)?.[1] || ''
const tabs = source.match(/<nav class="balance-view-switch"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || ''

test('electronic money summary appears before investment summary on mobile and desktop', () => {
  assert.ok(overview.indexOf('class="asset-wallet"') >= 0)
  assert.ok(overview.indexOf('class="asset-investment"') > overview.indexOf('class="asset-wallet"'))
  assert.match(source, /@media\(min-width:768px\)\{\.asset-overview\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
})

test('wallets is selected by default on opening the balance page', () => {
  assert.match(source, /const activeView = ref\('wallets'\)/)
  assert.doesNotMatch(source, /const activeView = ref\('funds'\)/)
})

test('wallets tab appears on the left with existing selection and content handlers intact', () => {
  assert.ok(tabs.indexOf("selectView('wallets')") >= 0)
  assert.ok(tabs.indexOf("selectView('funds')") > tabs.indexOf("selectView('wallets')"))
  assert.match(tabs, /:aria-selected="activeView==='wallets'"/)
  assert.match(tabs, /:aria-selected="activeView==='funds'"/)
  assert.match(source, /<SbiPortfolio [^>]*:active-view="activeView"/)
  assert.match(source, /@summary="onPrepaidSummary"/)
  assert.match(source, /@summary="onPortfolioSummary"/)
})
