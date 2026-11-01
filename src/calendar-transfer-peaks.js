// Monthly calendar: rank asset movements by their total transferred
// amount per date. Transfers do not belong to income or expense totals.
// A date can share first place with another date; ignore absent/zero amounts.
export function peakTransferDates(entries) {
  const totals = new Map()
  for (const entry of entries || []) {
    if (entry?.type !== 'transfer') continue
    const date = String(entry?.date || '').slice(0, 10)
    const amount = Number(entry?.amount)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || amount <= 0) continue
    totals.set(date, (totals.get(date) || 0) + amount)
  }
  const maximum = Math.max(0, ...totals.values())
  return new Set(maximum > 0 ? [...totals].filter(([, total]) => total === maximum).map(([date]) => date) : [])
}
