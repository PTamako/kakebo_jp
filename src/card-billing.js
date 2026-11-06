// Credit-card utilization includes purchases and card-funded asset transfers.
// Point rebates directly credited to a card reduce the same billing period.
export const isCardReward = (entry, cardName) =>
  entry?.type === 'income' && entry.category === 'ポイント還元' &&
  entry.transfer_target === 'credit:' + cardName

export const cardBilledAmount = entry =>
  Number(entry?.amount || 0) * (entry?.type === 'income' ? -1 : 1)

export const isCardBilledEntry = (entry, period, cardName) => {
  if (!entry || !period || !cardName) return false
  if (!entry.date || entry.date < period.start || entry.date > period.end) return false
  if (isCardReward(entry, cardName)) return true
  if (entry.payment_source !== cardName) return false
  if (entry.type === 'expense') return true
  if (entry.type !== 'transfer') return false
  const target = String(entry.transfer_target || '')
  return target === 'sbi' || (target.startsWith('prepaid:') && target.length > 'prepaid:'.length)
}
