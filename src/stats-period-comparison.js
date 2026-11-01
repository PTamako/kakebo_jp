// Pure comparison windows for month-to-date and year-to-date Japanese household spending.
// Date keys use YYYY-MM-DD; callers supply the current date in Asia/Tokyo.
const pad = n => String(n).padStart(2, '0')
const dateKey = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`
const lastDay = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

export function nextCivilDay(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

// Current periods end on today's Tokyo date; completed periods use their full span.
// Previous months are capped at the last existing day (e.g. March 31 vs February 28).
export function comparisonWindow({ month = '', year = '', today }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || '')) return null
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
    const [y, m] = month.split('-').map(Number)
    if (y < 1900 || y > 9999) return null
    const start = dateKey(y, m, 1)
    if (start > today) return null
    const end = dateKey(y, m, lastDay(y, m))
    const currentEnd = end > today ? today : end
    const previousYear = m === 1 ? y - 1 : y
    const previousMonth = m === 1 ? 12 : m - 1
    const previousStart = dateKey(previousYear, previousMonth, 1)
    const previousEnd = dateKey(previousYear, previousMonth,
      Math.min(Number(currentEnd.slice(-2)), lastDay(previousYear, previousMonth)))
    return { currentStart: start, currentEnd, previousStart, previousEnd }
  }
  if (!/^\d{4}$/.test(String(year))) return null
  const y = Number(year)
  if (y < 1900 || y > 9999) return null
  const start = `${year}-01-01`
  if (start > today) return null
  const end = `${year}-12-31`
  const currentEnd = end > today ? today : end
  return {
    currentStart: start,
    currentEnd,
    previousStart: `${y - 1}-01-01`,
    // A leap day has no counterpart in a non-leap prior year.
    previousEnd: dateKey(y - 1, Number(currentEnd.slice(5, 7)),
      Math.min(Number(currentEnd.slice(8, 10)), lastDay(y - 1, Number(currentEnd.slice(5, 7))))),
  }
}

// Annual/monthly byDay is already expense-only, so transfers (e.g. Suica
// recharges and investment movements) cannot leak into these comparisons.
export function calculateSpendingComparison(byDay, previousTotal, window) {
  if (!window || !Number.isFinite(Number(previousTotal))) return null
  let currentTotal = 0
  for (const row of byDay || []) {
    const date = String(row.date || '').slice(0, 10)
    if (date >= window.currentStart && date <= window.currentEnd) {
      const amount = Number(row.amount)
      if (Number.isFinite(amount)) currentTotal += amount
    }
  }
  const previous = Number(previousTotal)
  const percent = previous > 0
    ? (currentTotal - previous) / previous * 100
    : null
  return { ...window, currentTotal, previousTotal: previous, percent }
}
