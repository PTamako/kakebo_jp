// Keep full-month summaries while rendering only the requested page of entries.
export function groupAnnualEntries(entries, visibleCounts, pageSize = 20) {
  const groups = new Map()
  for (const entry of entries) {
    const month = String(entry.date || '').slice(0, 7)
    if (!groups.has(month)) groups.set(month, { month, all: [], total: 0 })
    const group = groups.get(month)
    group.all.push(entry)
    group.total += Number(entry.amount || 0)
  }
  return [...groups.values()].map(({ month, all, total }) => ({
    month, total, count: all.length, items: all.slice(0, visibleCounts[month] ?? pageSize)
  }))
}
