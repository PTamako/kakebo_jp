import { isJapanHoliday } from './japan-holidays.js'

// Always use the Japanese civil date, even when the browser/device timezone differs.
export function japanTodayKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = kind => parts.find(part => part.type === kind)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

// Return the elapsed date range, stopping at the current Japanese civil date.
// Selected past months/years cover their entire calendar period.
function elapsedDateRange(start, end, today) {
  const limit = end < today ? end : today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(limit) || start > limit) return null
  return { start, limit }
}

// Aggregates duplicate entries for the same day; both metrics use exactly
// the same expense-only byDay data and exclude dates after today.
function expenseTotalsForRange(byDay, range) {
  const expenseByDate = new Map()
  if (!range) return expenseByDate
  for (const row of byDay || []) {
    const date = String(row?.date || '').slice(0, 10)
    if (date < range.start || date > range.limit || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const amount = Number(row?.amount)
    if (Number.isFinite(amount)) expenseByDate.set(date, (expenseByDate.get(date) || 0) + amount)
  }
  return expenseByDate
}

const summarize = group => ({
  ...group,
  average: group.days ? Math.round(group.total / group.days) : null,
})

// Calendar-day average: include zero-spend weekdays/holidays in the denominator.
// Current periods stop at today; annual views can omit entirely unrecorded months.
export function spendingAveragesByDayType(byDay, start, end, today = japanTodayKey(), { recordedMonthsOnly = false } = {}) {
  const totals = { weekday: { total: 0, days: 0 }, holiday: { total: 0, days: 0 } }
  const range = elapsedDateRange(start, end, today)
  if (!range) return { weekday: summarize(totals.weekday), holiday: summarize(totals.holiday) }
  const expenseByDate = expenseTotalsForRange(byDay, range)
  // A whole unrecorded month is unknown, NOT a month of confirmed zero spending.
  // Monthly views include every elapsed calendar day if the month has expenses.
  // Annual views include calendar days only inside months with actual expenses.
  const recordedMonths = new Set([...expenseByDate]
    .filter(([, amount]) => amount > 0)
    .map(([date]) => date.slice(0, 7)))
  if (recordedMonths.size === 0) {
    return { weekday: summarize(totals.weekday), holiday: summarize(totals.holiday) }
  }
  const [year, month, day] = start.split('-').map(Number)
  const endTimestamp = Date.parse(range.limit + 'T00:00:00Z')
  for (let timestamp = Date.UTC(year, month - 1, day); timestamp <= endTimestamp; timestamp += 86400000) {
    const date = new Date(timestamp).toISOString().slice(0, 10)
    if (recordedMonthsOnly && !recordedMonths.has(date.slice(0, 7))) continue
    const group = isJapanHoliday(date) ? totals.holiday : totals.weekday
    group.days += 1
    group.total += expenseByDate.get(date) || 0
  }
  return { weekday: summarize(totals.weekday), holiday: summarize(totals.holiday) }
}

// Spending-day average: count only dates with a positive actual expense total,
// ignoring zero-spend days and future dates. Used for the monthly right-hand card.
export function spendingAverageOnExpenseDays(byDay, start, end, today = japanTodayKey()) {
  const range = elapsedDateRange(start, end, today)
  const result = { total: 0, days: 0 }
  for (const amount of expenseTotalsForRange(byDay, range).values()) {
    if (amount > 0) {
      result.total += amount
      result.days += 1
    }
  }
  return summarize(result)
}
