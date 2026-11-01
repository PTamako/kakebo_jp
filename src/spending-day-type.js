import { isJapanHoliday } from './japan-holidays.js'

// Always use the Japanese civil date, even when the browser/device timezone differs.
export function japanTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = kind => parts.find(part => part.type === kind)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

// Include zero-spend days, but do not include dates after today in current periods.
// Input is aggregated expense-only daily amounts from the existing stats API.
export function spendingAveragesByDayType(byDay, start, end, today = japanTodayKey()) {
  const totals = { weekday: { total: 0, days: 0 }, holiday: { total: 0, days: 0 } }
  const limit = end < today ? end : today
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(start) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(limit) || start > limit) {
    return { weekday: { ...totals.weekday, average: null }, holiday: { ...totals.holiday, average: null } }
  }
  const expenseByDate = new Map()
  for (const row of byDay || []) {
    const date = String(row.date || '').slice(0, 10)
    if (date < start || date > limit || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) continue
    const amount = Number(row.amount)
    if (Number.isFinite(amount)) expenseByDate.set(date, (expenseByDate.get(date) || 0) + amount)
  }
  const [year, month, day] = start.split('-').map(Number)
  for (let timestamp = Date.UTC(year, month - 1, day); timestamp <= Date.parse(limit + 'T00:00:00Z'); timestamp += 86400000) {
    const date = new Date(timestamp).toISOString().slice(0, 10)
    const group = isJapanHoliday(date) ? totals.holiday : totals.weekday
    group.days += 1
    group.total += expenseByDate.get(date) || 0
  }
  return {
    weekday: { ...totals.weekday, average: totals.weekday.days ? Math.round(totals.weekday.total / totals.weekday.days) : null },
    holiday: { ...totals.holiday, average: totals.holiday.days ? Math.round(totals.holiday.total / totals.holiday.days) : null },
  }
}
