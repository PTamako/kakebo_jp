import test from 'node:test'
import assert from 'node:assert/strict'
import { isJapanHoliday } from '../src/japan-holidays.js'
import { japanTodayKey, spendingAveragesByDayType, spendingAverageOnExpenseDays } from '../src/spending-day-type.js'

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

test('month: weekday/holiday average includes elapsed zero-spend days but excludes future ones', () => {
  const rows = [{ date: '2026-11-01', amount: 3000 }, { date: '2026-11-02', amount: 1000 },
    { date: '2026-11-03', amount: 500 }, { date: '2026-11-08', amount: 9999 }]
  const result = spendingAveragesByDayType(rows, '2026-11-01', '2026-11-30', '2026-11-04')
  assert.deepEqual(result.weekday, { total: 1000, days: 2, average: 500 })
  assert.deepEqual(result.holiday, { total: 3500, days: 2, average: 1750 })
  assert.deepEqual(spendingAverageOnExpenseDays(rows, '2026-11-01', '2026-11-30', '2026-11-04'),
    { total: 4500, days: 3, average: 1500 })
})

test('month with no expense history shows no misleading average', () => {
  const month = spendingAveragesByDayType([], '2026-11-01', '2026-11-30', '2026-11-10')
  assert.deepEqual(month.weekday, { total: 0, days: 0, average: null })
  assert.deepEqual(month.holiday, { total: 0, days: 0, average: null })
  assert.deepEqual(spendingAverageOnExpenseDays([], '2026-11-01', '2026-11-30', '2026-11-10'),
    { total: 0, days: 0, average: null })
  const future = spendingAveragesByDayType([{ date: '2026-12-03', amount: 400 }],
    '2026-12-01', '2026-12-31', '2026-11-10')
  assert.equal(future.weekday.average, null)
  assert.equal(future.holiday.average, null)
})

test('year: entirely unrecorded months excluded, recorded months include zero-spend days', () => {
  const rows = [{ date: '2026-01-02', amount: 100 }, { date: '2026-05-04', amount: 500 },
    { date: '2026-11-25', amount: 9999 }]
  const result = spendingAveragesByDayType(rows,
    '2026-01-01', '2026-12-31', '2026-05-31', { recordedMonthsOnly: true })
  assert.equal(result.weekday.days + result.holiday.days, 62) // January and May
  assert.equal(result.weekday.total + result.holiday.total, 600)
})

test('year through May includes 151 days when every January-May month has spending', () => {
  const rows = ['2026-01-05','2026-02-05','2026-03-05','2026-04-05','2026-05-05']
    .map(date => ({ date, amount: 100 }))
  const result = spendingAveragesByDayType(rows,
    '2026-01-01', '2026-12-31', '2026-05-31', { recordedMonthsOnly: true })
  assert.equal(result.weekday.days + result.holiday.days, 151)
  assert.equal(result.weekday.total + result.holiday.total, 500)
})

test('year through May 10 counts May 1-10, not full May or full year', () => {
  const rows = [{ date:'2026-01-05',amount:300 },{ date:'2026-05-10',amount:600 }]
  const r = spendingAveragesByDayType(rows,
    '2026-01-01', '2026-12-31', '2026-05-10', { recordedMonthsOnly: true })
  assert.equal(r.weekday.days + r.holiday.days, 41)
  assert.equal(r.weekday.total + r.holiday.total, 900)
})

test('year: an unrecorded current month contributes no days', () => {
  const r = spendingAveragesByDayType([{ date:'2026-01-05',amount:300 }],
    '2026-01-01', '2026-12-31', '2026-05-10', { recordedMonthsOnly:true })
  assert.equal(r.weekday.days + r.holiday.days, 31)
})

test('spend-day average deduplicates multiple expenses on the same day and ignores zero/negative totals', () => {
  const rows = [{ date:'2026-11-02',amount:250 },{ date:'2026-11-02',amount:750 },
    { date:'2026-11-04',amount:0 },{ date:'2026-11-05',amount:-80 }]
  const r = spendingAverageOnExpenseDays(rows,'2026-11-01','2026-11-30','2026-11-10')
  assert.deepEqual(r,{total:1000,days:1,average:1000})
  const calendar = spendingAveragesByDayType(rows,'2026-11-01','2026-11-30','2026-11-10')
  assert.equal(calendar.weekday.days + calendar.holiday.days,10)
  assert.equal(calendar.weekday.total + calendar.holiday.total,920)
})

test('leap year includes February 29 in the monthly calendar denominator', () => {
  const rows = [{date:'2024-02-29',amount:2200}]
  const r = spendingAveragesByDayType(rows,'2024-02-01','2024-02-29','2026-11-01')
  assert.equal(r.weekday.days+r.holiday.days,29)
  assert.equal(r.weekday.total+r.holiday.total,2200)
  assert.equal(isJapanHoliday('2024-02-12'),true)
})
