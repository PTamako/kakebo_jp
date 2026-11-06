// Keep client drill-downs aligned with server /api/stats and D1 payment_sources.
// The three selectable groups represent the source of money, not the recipient.
// Transfers without a real source must never be silently classified as cash.
export const PAYMENT_STAT_METHODS = Object.freeze(['カード・電子決済','現金','ポイント払い'])
export const UNASSIGNED_TRANSFER_METHOD = '振替元未指定'

export function paymentMethodForEntry(entry, sourceMeta = {}) {
  const source = String(entry?.payment_source ?? entry?.paymentSource ?? '').trim()
  if (entry?.type === 'transfer' && (!source || ['その他','其他'].includes(source)))
    return UNASSIGNED_TRANSFER_METHOD
  if (!source || source === '現金') return '現金'
  return sourceMeta[source]?.stat_group === 'points' ? 'ポイント払い' : 'カード・電子決済'
}
export function matchesPaymentStatMethod(entry, method, sourceMeta = {}) {
  return (entry?.type === 'expense' || entry?.type === 'transfer')
    && (PAYMENT_STAT_METHODS.includes(method) || method === UNASSIGNED_TRANSFER_METHOD)
    && paymentMethodForEntry(entry, sourceMeta) === method
}
