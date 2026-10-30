// Credit-card utilization is not the same as household spending.
// Both ordinary card purchases and card-funded transfers to SBI / registered
// prepaid wallets consume card limit; transfers remain outside expense stats.
export const isCardBilledEntry = (entry, period, cardName) => {
  if (!entry || !period || !cardName || entry.payment_source !== cardName) return false
  if (!entry.date || entry.date < period.start || entry.date > period.end) return false
  if (entry.type === 'expense') return true
  if (entry.type !== 'transfer') return false
  const target = String(entry.transfer_target || '')
  return target === 'sbi' || (target.startsWith('prepaid:') && target.length > 'prepaid:'.length)
}
