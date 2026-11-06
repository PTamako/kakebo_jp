// Share the same D1-authoritative grouping semantics as /api/stats.
// Cash or missing source -> cash; explicitly marked points -> points;
// all other payment sources (including prepaid IC wallets) -> card/e-payment.
export const PAYMENT_STAT_METHODS = Object.freeze(['カード・電子決済','現金','ポイント払い'])

export function paymentMethodForEntry(entry, sourceMeta = {}) {
  const source = String(entry?.payment_source ?? entry?.paymentSource ?? '').trim()
  if (!source || source === '現金') return '現金'
  return sourceMeta[source]?.stat_group === 'points' ? 'ポイント払い' : 'カード・電子決済'
}
export function matchesPaymentStatMethod(entry, method, sourceMeta = {}) {
  return entry?.type === 'expense' && PAYMENT_STAT_METHODS.includes(method)
    && paymentMethodForEntry(entry, sourceMeta) === method
}
