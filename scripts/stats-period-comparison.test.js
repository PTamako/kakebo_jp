import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { comparisonWindow, calculateSpendingComparison, nextCivilDay } from '../src/stats-period-comparison.js'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('November 10 compares against October 1 through October 10, not October 31', () => {
  assert.deepEqual(comparisonWindow({ month: '2026-11', today: '2026-11-10' }), {
    currentStart: '2026-11-01',
    currentEnd: '2026-11-10',
    previousStart: '2026-10-01',
    previousEnd: '2026-10-10',
  })
})

test('year ending in September compares with previous year through September', () => {
  assert.deepEqual(comparisonWindow({ year: '2026', today: '2026-09-30' }), {
    currentStart: '2026-01-01',
    currentEnd: '2026-09-30',
    previousStart: '2025-01-01',
    previousEnd: '2025-09-30',
  })
})

test('completed periods compare whole corresponding periods', () => {
  const month = comparisonWindow({ month: '2026-10', today: '2026-11-10' })
  assert.equal(month.currentEnd, '2026-10-31')
  assert.equal(month.previousEnd, '2026-09-30')
  const year = comparisonWindow({ year: '2025', today: '2026-11-10' })
  assert.equal(year.currentEnd, '2025-12-31')
  assert.equal(year.previousEnd, '2024-12-31')
})

test('January comparison correctly crosses the calendar year', () => {
  const w = comparisonWindow({ month: '2026-01', today: '2026-01-10' })
  assert.equal(w.previousStart, '2025-12-01')
  assert.equal(w.previousEnd, '2025-12-10')
})

test('leap day has valid previous-year comparison date', () => {
  const w = comparisonWindow({ year: '2024', today: '2024-02-29' })
  assert.equal(w.currentEnd, '2024-02-29')
  assert.equal(w.previousEnd, '2023-02-28')
  assert.equal(nextCivilDay('2023-02-28'), '2023-03-01')
})

test('future month or year has no comparison rather than a misleading zero', () => {
  assert.equal(comparisonWindow({ month: '2026-12', today: '2026-11-10' }), null)
  assert.equal(comparisonWindow({ year: '2027', today: '2026-11-10' }), null)
})

test('only expenses from the elapsed current window are summed', () => {
  const w = comparisonWindow({ month: '2026-11', today: '2026-11-10' })
  const result = calculateSpendingComparison([
    { date: '2026-11-01', amount: 500 },
    { date: '2026-11-03', amount: 1500 },
    { date: '2026-11-10', amount: 1000 },
    { date: '2026-11-11', amount: 100000 },
  ], 4000, w)
  assert.equal(result.currentTotal, 3000)
  assert.equal(result.previousTotal, 4000)
  assert.equal(result.percent, -25)
})

test('when prior-period spending is zero, percentage is undefined', () => {
  const w = comparisonWindow({ year: '2026', today: '2026-09-30' })
  assert.equal(calculateSpendingComparison([{ date: '2026-03-12', amount: 200 }], 0, w).percent, null)
})

test('statistics API computes comparison from expense-only day totals and previous expense-only rows', () => {
  const api = source('functions/api/[[path]].js')
  assert.match(api, /type = 'expense' AND date >= \?1 AND date < \?2/)
  assert.match(api, /periodComparison: comparison/)
  assert.match(api, /periodComparison\(day\.results, \{ year \}\)/)
  assert.match(api, /periodComparison\(day\.results, \{ month \}\)/)
})

test('monthly and annual comparison cards and highest-income month are rendered', () => {
  const ui = source('src/pages/StatisticsPage.vue')
  assert.match(ui, /前月同期間比/)
  assert.match(ui, /前年同期間比/)
  assert.match(ui, /highestIncomeMonth\.income \? highestIncomeMonth\.label/)
  const main = source('src/App.vue')
  assert.match(main, /const highestIncomeMonth = computed\(/)
})
