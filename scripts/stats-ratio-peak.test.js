import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { highestSpendingRatioMonth } from '../src/stats-ratio-peak.js'

test('peak spending ratio picks the same month as the highest plotted ratio', () => {
  const rows = [
    { month:'2026-03', label:'3月', ratio:0.23 },
    { month:'2026-07', label:'7月', ratio:0.84 },
    { month:'2026-08', label:'8月', ratio:0.42 },
  ]
  assert.equal(highestSpendingRatioMonth(rows)?.label, '7月')
  assert.equal(highestSpendingRatioMonth(rows)?.ratio, 0.84)
})

test('income-free months are excluded instead of misleadingly winning the comparison', () => {
  const rows = [
    { month:'2026-01', label:'1月', ratio:null, amount:9999999, income:0 },
    { month:'2026-04', label:'4月', ratio:0.84 },
    { month:'2026-10', label:'10月', ratio:undefined },
  ]
  assert.equal(highestSpendingRatioMonth(rows)?.label, '4月')
})

test('zero ratio is valid, while a year without income ratios has no peak month', () => {
  assert.equal(highestSpendingRatioMonth([{month:'2026-03',label:'3月',ratio:0}])?.label, '3月')
  assert.equal(highestSpendingRatioMonth([{month:'2026-03',label:'3月',ratio:null}]), null)
  assert.equal(highestSpendingRatioMonth([]), null)
})

test('ties retain the earliest month from ascending chart points', () => {
  assert.equal(highestSpendingRatioMonth([
    { month:'2026-02',label:'2月',ratio:1.2 },
    { month:'2026-09',label:'9月',ratio:1.2 },
  ])?.label, '2月')
})

test('annual summary appends the month on the same line as the peak ratio label', () => {
  const page = readFileSync(new URL('../src/pages/StatisticsPage.vue', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(page, /支出割合が最も高い月 · \{\{ highestRatioMonth\?\.label \|\| 'データなし' \}\}/)
  assert.match(page, /<span>支出割合が最も高い月 · \{\{ highestRatioMonth\?\.label \|\| 'データなし' \}\}<\/span>/)
  assert.match(app, /highestSpendingRatioMonth\(ratioTrendPoints\.value\)/)
  assert.match(app, /highestIncomeMonth, ratioTrendMax, highestRatioMonth,/)
})
