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

test('current month includes zero-spend elapsed weekdays and excludes future dates', () => {
  const result = spendingAveragesByDayType(
    [{ date: '2026-11-01', amount: 3000 }, { date: '2026-11-02', amount: 1000 },
      { date: '2026-11-03', amount: 500 }, { date: '2026-11-08', amount: 9999 }],
    '2026-11-01', '2026-11-30', '2026-11-04',
  )
  assert.deepEqual(result.weekday, { total: 1000, days: 2, average: 500 })
  assert.deepEqual(result.holiday, { total: 3500, days: 2, average: 1750 })
})

test('no elapsed weekdays show an em dash in the UI rather than misleading zero average', () => {
  const onlySunday = spendingAveragesByDayType([], '2026-11-01', '2026-11-30', '2026-11-01')
  assert.deepEqual(onlySunday.weekday, { total: 0, days: 0, average: null })
  assert.deepEqual(onlySunday.holiday, { total: 0, days: 1, average: 0 })
  const future = spendingAveragesByDayType([], '2026-12-01', '2026-12-31', '2026-11-01')
  assert.equal(future.weekday.average, null)
  assert.equal(future.holiday.average, null)
})

test('annual averages use only calendar days through today and do not count transfers', () => {
  // The stats API supplies expense-only per-day amounts; prepaid top-ups are transfers.
  const result = spendingAveragesByDayType(
    [{ date: '2026-01-02', amount: 100 }, { date: '2026-11-01', amount: 500 }],
    '2026-01-01', '2026-12-31', '2026-11-01',
  )
  assert.equal(result.weekday.days + result.holiday.days, 305)
  assert.equal(result.weekday.total, 100)
  assert.equal(result.holiday.total, 500)
  assert.equal(result.weekday.average, Math.round(100 / result.weekday.days))
  assert.equal(result.holiday.average, Math.round(500 / result.holiday.days))
})

test('2024 leap year calendar includes February 29', () => {
  const result = spendingAveragesByDayType([], '2024-02-01', '2024-02-29', '2026-11-01')
  assert.equal(result.weekday.days + result.holiday.days, 29)
  assert.equal(isJapanHoliday('2024-02-12'), true)
})
