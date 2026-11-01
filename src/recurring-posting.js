// Pure helpers shared by Pages API and the scheduled Worker.
// Switching an old plan to auto never backfills previous scheduled months.
export function scheduledRecurringDate(month, day) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const [year, number] = month.split('-').map(Number)
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  return month + '-' + String(Math.min(day, new Date(Date.UTC(year, number, 0)).getUTCDate())).padStart(2,'0')
}
export function nextAutomaticStartMonth(today, day, startMonth) {
  const currentMonth = String(today).slice(0,7)
  const nextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number)
    return m === 12 ? (y+1)+'-01' : y+'-'+String(m+1).padStart(2,'0')
  }
  const base = scheduledRecurringDate(currentMonth, day) >= today ? currentMonth : nextMonth()
  return startMonth > base ? startMonth : base
}
export function recurringRequestId(planId, month) {
  return 'recurring_' + planId.replace(/-/g,'') + '_' + month.replace('-','')
}
export function tokyoDateAt(timestamp = Date.now()) {
  return new Date(timestamp + 9*3600000).toISOString().slice(0,10)
}
