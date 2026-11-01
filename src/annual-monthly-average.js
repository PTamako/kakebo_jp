// The annual stats API's byMonth rows contain months with expense entries.
// Counting those rows (rather than 12 calendar months) also handles a user
// who starts keeping a ledger partway through the year.
export function annualExpenseAverageByRecordedMonth(stats, year) {
  const monthKeys = new Set()
  const prefix = String(year) + '-'
  for (const row of stats?.byMonth || []) {
    const month = String(row?.month || '')
    if (month.startsWith(prefix) && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) monthKeys.add(month)
  }
  const monthCount = monthKeys.size
  // No expense entries: the average has no valid denominator.
  const total = Number(stats?.total || 0)
  return {
    monthCount,
    average: monthCount && Number.isFinite(total) ? Math.round(total / monthCount) : null,
  }
}
