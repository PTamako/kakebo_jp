import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app=read('src/App.vue')
const ledger=read('src/pages/LedgerPage.vue')
const stats=read('src/pages/StatisticsPage.vue')
const assets=read('src/pages/AssetsPage.vue')
const management=read('src/pages/ManagementPage.vue')
const api=read('functions/api/[[path]].js')
const schema=read('schema.sql')

test('App only coordinates tabs; all four pages own their templates',()=>{
  for(const component of ['LedgerPage','StatisticsPage','AssetsPage','ManagementPage']) {
    assert.match(app,new RegExp('import '+component+' from [\\x27\\x22]\\./pages/'+component+'\\.vue'))
    assert.match(app,new RegExp('<'+component+' '))
  }
  assert.doesNotMatch(app,/<section v-else-if="tab === 'list'"/)
  assert.doesNotMatch(app,/<section v-else-if="tab === 'stat'/)
  assert.doesNotMatch(app,/<section v-else-if="tab === 'investments'"/)
  assert.match(ledger,/class="month-calendar"/)
  assert.match(ledger,/class="edit-dialog"/)
  assert.match(stats,/statsPeriod === 'month'/)
  assert.match(stats,/class="page-section stats-page annual-page"/)
  assert.match(assets,/<SbiPortfolio :api="api" :transfer-loading="transferLoading" :active-view="activeView" @summary="onPortfolioSummary">/)
  assert.match(assets,/<PrepaidAssets :api="api" :active="true" :revision="ledgerRevision"/)
  assert.match(assets,/@summary="onPrepaidSummary"/)
  assert.doesNotMatch(assets,/旧評価額|旧評価損益|legacy-investment-details/)
  assert.match(management,/<FinanceTools v-bind="\$attrs"\s*\/>/)
  assert.match(app,/<ManagementPage [^>]*v-show="tab === 'finance'"/)
})

test('extracted pages share exactly the parent navigation refs and do not create independent filters',()=>{
  const match=app.match(/provide\('kakeibo-page-context',\s*\{([^}]+)\}\)/)
  assert.ok(match,'App injects a single shared ref registry')
  const names=new Set(match[1].split(',').map(s=>s.trim()))
  for (const [name,source] of [['明細',ledger],['統計',stats],['残高',assets]]) {
    const injection=source.match(/const \{([^}]+)\} = inject\('kakeibo-page-context'\)/)
    assert.ok(injection, name+' has parent state')
    for (const symbol of injection[1].split(',').map(x=>x.trim()))
      assert.ok(names.has(symbol),name+' missing parent symbol '+symbol)
  }
  assert.match(ledger,/const \{ categories,/)
  assert.match(stats,/const \{ stats,/)
  for(const fn of ['openMonthDetails','openCategoryDetails','openPaymentMethodDetails','openDuplicateDate','openLedgerFromNav']){
    assert.match(app,new RegExp('(?:async )?function '+fn+'\\('))
  }
  assert.match(stats,/@click="openMonthDetails\(point, 'expense'\)"/)
  assert.match(stats,/@click="openCategoryDetails\(c\.category, 'expense', 'year'\)"/)
  assert.match(stats,/@click="openPaymentMethodDetails\(method,'year'\)"/)
  assert.match(app,/@open-duplicate="openDuplicateDate"/)
  assert.match(app,/@click="openLedgerFromNav"/)
  assert.match(ledger,/@click="clearDetailFilter"/)
  assert.match(ledger,/@click="setEntryTypeFilter/)
})

test('finance_settings is retired, while login attempt throttling remains active',()=>{
  assert.doesNotMatch(schema,/CREATE TABLE IF NOT EXISTS finance_settings/)
  assert.doesNotMatch(api,/\b(?:CREATE|INSERT|UPDATE|DELETE|SELECT)\b[^\n]*\bfinance_settings\b/i)
  assert.match(api,/if \(a === 'finance-settings'\)/)
  assert.match(api,/deprecated_finance_settings/)
  assert.doesNotMatch(app,/api\('finance-settings/)
  assert.match(schema,/CREATE TABLE IF NOT EXISTS login_attempts/)
  assert.match(api,/SELECT attempts, reset_at FROM login_attempts/)
  assert.match(api,/INSERT INTO login_attempts/)
  assert.match(api,/attempt\.attempts >= 5/)
})

test('compact calendar legend is natural Japanese and accessible labels explain monetary peaks',()=>{
  const legend=ledger.match(/<div class="calendar-legend"[\s\S]*?<\/div>/)?.[0]
  assert.ok(legend)
  assert.match(legend, /<i class="legend-today"><\/i>今日/)
  assert.match(legend, /<i class="calendar-peak-expense">支<\/i>支出最多/)
  assert.match(legend, /<i class="calendar-peak-income">収<\/i>収入最多/)
  assert.doesNotMatch(legend,/最も多い日|支出ピーク|収入ピーク/)
  // Screen readers and tooltip titles retain the precise meaning: amount, not count.
  for(const label of ['支出額が最も多い日','収入額が最も多い日']){
    assert.equal(ledger.split(label).length-1,2,label+' must appear in aria-label and badge title')
    assert.match(ledger,new RegExp('title="'+label+'"'))
  }
  assert.doesNotMatch(ledger,/支出ピーク|収入ピーク/)
})
