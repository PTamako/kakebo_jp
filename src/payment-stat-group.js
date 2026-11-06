// Keep client drill-downs aligned with server /api/stats and D1 payment_sources.
// The three selectable groups represent the source of money, not the recipient.
// Transfers without a real source must never be silently classified as cash.
export const PAYMENT_STAT_METHODS = Object.freeze(['カード・電子決済','現金','ポイント払い'])
export const UNASSIGNED_TRANSFER_METHOD = '振替元未指定'

// A point redemption credited directly against a credit-card statement is
// stored as income (it offsets card utilization), but represents points used.
// Count it only in the separate point-utilization breakdown, never as spending.
export const isCreditPointRedemption = entry =>
  entry?.type === 'income' && entry.category === 'ポイント還元' &&
  typeof entry.transfer_target === 'string' && entry.transfer_target.startsWith('credit:') &&
  entry.transfer_target.length > 'credit:'.length

export function paymentMethodForEntry(entry, sourceMeta = {}) {
  const source = String(entry?.payment_source ?? entry?.paymentSource ?? '').trim()
  if (isCreditPointRedemption(entry)) return 'ポイント払い'
  if (entry?.type === 'transfer' && (!source || ['その他','其他'].includes(source)))
    return UNASSIGNED_TRANSFER_METHOD
  if (!source || source === '現金') return '現金'
  return sourceMeta[source]?.stat_group === 'points' ? 'ポイント払い' : 'カード・電子決済'
}
export function matchesPaymentStatMethod(entry, method, sourceMeta = {}) {
  return (entry?.type === 'expense' || entry?.type === 'transfer' || isCreditPointRedemption(entry))
    && (PAYMENT_STAT_METHODS.includes(method) || method === UNASSIGNED_TRANSFER_METHOD)
    && paymentMethodForEntry(entry, sourceMeta) === method
}
