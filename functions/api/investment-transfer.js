// Transfer totals are derived from ledger rows; market valuation is never mutated here.
export function isAppliedSbiTransfer(entry, today) {
  return entry.type === 'transfer' && entry.transferTarget === 'sbi' &&
    Boolean(entry.transferDate || entry.date) && (entry.transferDate || entry.date) <= today
}

export function investedTotal(rows, today) {
  return rows.reduce((total, row) => total + (isAppliedSbiTransfer(row, today) ? Number(row.amount) : 0), 0)
}
