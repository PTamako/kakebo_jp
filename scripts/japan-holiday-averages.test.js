import test from 'node:test'
import assert from 'node:assert/strict'
import { isJapanHoliday } from '../src/japan-holidays.js'
import { japanTodayKey, spendingAveragesByDayType } from '../src/spending-day-type.js'

test('2026 Cabinet Office dates include weekends, substitute holidays and citizens\' holidays', () => {
  for (const date of ['2026-11-01', '2026-11-03', '2026-11-23', '2026-05-06', '2026-09-22']) {
    assert.equal(isJapanHoliday(date), true, date)
  }
  for (const date of ['2026-11-02', '2026-11-04', '2026-09-24']) {
    assert.equal(isJapanHoliday(date), false, date)
  }
})

test('2027 spring equinox Sunday has a substitute holiday on Monday', () => {
  assert.equal(isJapanHoliday('2027-03-21'), true)
  assert.equal(isJapanHoliday('2027-03-22'), true)
  assert.equal(isJapanHoliday('2027-03-23'), false)
})

test('special enthronement and Olympic-year holidays are recognized', () => {
  for (const date of ['2019-04-30', '2019-05-01', '2019-05-02', '2019-10-22', '2020-07-23', '2020-07-24', '2021-07-22', '2021-07-23', '2021-08-09']) {
    assert.equal(isJapanHoliday(date), true, date)
  }
  assert.equal(isJapanHoliday('2020-07-20'), false)
  assert.equal(isJapanHoliday('2021-07-19'), false)
  assert.equal(isJapanHoliday('2021-08-11'), false)
})

test('Tokyo date conversion is independent of the UTC day', () => {
  assert.equal(japanTodayKey(new Date('2026-10-31T15:15:00Z')), '2026-11-01')
  assert.equal(japanTodayKey(new Date('2026-11-01T14:59:00Z')), '2026-11-01')
})

test('monthly average counts only days with recorded positive expenses, not zero-spend days or future dates', () => {
  const result = spendingAveragesByDayType(
    [{ date: '2026-11-01', amount: 3000 }, { date: '2026-11-02', amount: 1000 },
      { date: '2026-11-03', amount: 500 }, { date: '2026-11-08', amount: 9999 }],
    '2026-11-01', '2026-11-30', '2026-11-04',
  )
  assert.deepEqual(result.weekday, { total: 1000, days: 1, average: 1000 })
  assert.deepEqual(result.holiday, { total: 3500, days: 2, average: 1750 })
})

test('days with no expense records do not count; no valid days displays no average', () => {
  const onlySunday = spendingAveragesByDayType([], '2026-11-01', '2026-11-30', '2026-11-01')
  assert.deepEqual(onlySunday.weekday, { total: 0, days: 0, average: null })
  assert.deepEqual(onlySunday.holiday, { total: 0, days: 0, average: null })
  const future = spendingAveragesByDayType([], '2026-12-01', '2026-12-31', '2026-11-01')
  assert.equal(future.weekday.average, null)
  assert.equal(future.holiday.average, null)
})

test('annual average counts spending days only, keeping holiday classification and excluding future transfers', () => {
  // The stats API supplies expense-only byDay rows; prepaid top-ups are transfers.
  const result = spendingAveragesByDayType(
    [{ date: '2026-01-02', amount: 100 }, { date: '2026-11-01', amount: 500 },
      { date: '2026-11-25', amount: 100000 }],
    '2026-01-01', '2026-12-31', '2026-11-01',
  )
  assert.deepEqual(result.weekday, { total: 100, days: 1, average: 100 })
  assert.deepEqual(result.holiday, { total: 500, days: 1, average: 500 })
})

test('multiple purchases on the same date count as one valid day; non-positive totals are excluded', () => {
  const result = spendingAveragesByDayType([
    { date: '2026-11-02', amount: 250 },
    { date: '2026-11-02', amount: 750 },
    { date: '2026-11-04', amount: 0 },
    { date: '2026-11-05', amount: -80 },
  ], '2026-11-01', '2026-11-30', '2026-11-10')
  assert.deepEqual(result.weekday, { total: 1000, days: 1, average: 1000 })
  assert.deepEqual(result.holiday, { total: 0, days: 0, average: null })
})

test('February 29 is a valid day when it has spending', () => {
  const result = spendingAveragesByDayType([
    { date: '2024-02-29', amount: 2200 },
  ], '2024-02-01', '2024-02-29', '2026-11-01')
  assert.deepEqual(result.weekday, { total: 2200, days: 1, average: 2200 })
  assert.equal(isJapanHoliday('2024-02-12'), true)
})
