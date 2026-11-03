// Transfer totals are derived from ledger rows; market valuation is never mutated here.
export function isAppliedSbiTransfer(entry, today) {
  return entry.type === 'transfer' && entry.transferTarget === 'sbi' &&
    Boolean(entry.transferDate || entry.date) && (entry.transferDate || entry.date) <= today
}

export function investedTotal(rows, today) {
  return rows.reduce((total, row) => total + (isAppliedSbiTransfer(row, today) ? Number(row.amount) : 0), 0)
}

// Apply SBI funding transfers only on/after their scheduled Japan date.
// Both the Cron task and the explicit maintenance endpoint use this D1 update.
// Already-applied rows remain unchanged on retries.
export async function applyDueSbiTransfers(db, today) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(today) ||
      new Date(today + 'T00:00:00Z').toISOString().slice(0, 10) !== today) {
    throw Error('invalid_tokyo_date')
  }
  const result = await db.prepare("UPDATE entries SET transfer_applied = 1 WHERE type = 'transfer' AND transfer_target = 'sbi' AND transfer_applied = 0 AND COALESCE(transfer_date, date) <= ?1")
    .bind(today).run()
  return {date:today, applied:Number(result.meta?.changes || 0)}
}
