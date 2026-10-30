// One source of truth for ledger calendar, day headers and annual group totals.
// In the "all" tab, transfers are movements between assets, not income or expense.
export function ledgerEntryAmount(entry, filter = 'all') {
  const amount = Number(entry?.amount ?? 0)
  if (!Number.isFinite(amount)) return 0
  const type = entry?.type || 'expense'
  if (filter === 'income') return type === 'income' ? amount : 0
  if (filter === 'expense') return type === 'expense' ? amount : 0
  if (filter === 'transfer') return type === 'transfer' ? amount : 0
  if (type === 'income') return amount
  if (type === 'transfer') return 0
  return -amount
}

export function ledgerEntriesTotal(entries, filter = 'all') {
  return (entries || []).reduce((sum, entry) => sum + ledgerEntryAmount(entry, filter), 0)
}

// Net results use a clear +/- sign; single-type tabs show positive amounts.
export function formatLedgerTotal(value, filter = 'all') {
  const amount = Math.round(Number(value) || 0)
  const yen = '¥' + Math.abs(amount).toLocaleString('ja-JP')
  if (filter !== 'all') return yen
  return amount < 0 ? '−' + yen : amount > 0 ? '+' + yen : yen
}
