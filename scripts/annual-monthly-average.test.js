import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { annualExpenseAverageByRecordedMonth } from '../src/annual-monthly-average.js'

test('annual average divides by actual expense months, not 12', () => {
  const stats = {
    total: 120000,
    byMonth: [
      { month: '2026-03', amount: 30000 },
      { month: '2026-06', amount: 40000 },
      { month: '2026-11', amount: 50000 },
    ],
  }
  assert.deepEqual(annualExpenseAverageByRecordedMonth(stats, 2026), {
    monthCount: 3, average: 40000,
  })
})

test('zero-spend and other-year months do not increase the denominator', () => {
  const stats = { total: 9000, byMonth: [
    { month: '2026-01', amount: 3000 }, { month: '2026-01', amount: 6000 },
    { month: '2026-02', amount: 0 }, { month: '2025-12', amount: 400 },
    { month: '2026-03', amount: -20 },
  ] }
  assert.deepEqual(annualExpenseAverageByRecordedMonth(stats, 2026), {
    monthCount: 1, average: 9000,
  })
})

test('no valid months returns null rather than division by zero', () => {
  assert.deepEqual(annualExpenseAverageByRecordedMonth({ total: 0, byMonth: [] }, 2026), {
    monthCount: 0, average: null,
  })
})

test('UI shows effective month count and empty averages correctly', () => {
  const ui = readFileSync(new URL('../src/pages/StatisticsPage.vue', import.meta.url), 'utf8')
  assert.match(ui, /annualAverageSummary\.monthCount/)
  assert.match(ui, /annualAverageSummary\.average === null/)
  assert.doesNotMatch(ui, /12か月で計算/)
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /annualExpenseAverageByRecordedMonth\(annualStats\.value, selectedYear\.value\)/)
  assert.match(app, /spendingAverageOnExpenseDays\(/)
  assert.match(app, /recordedMonthsOnly: true/)
  assert.match(app, /spendingAveragesByDayType\(/)
  assert.match(ui, /averageDaily === null \? '—'/)
})
