export const normalizeMerchant = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[\s　・]/g, '')
export function paymentForDraft({ merchant = '', recognized = '', importSource = '', rules = [], defaultSource = '', type = 'expense' }) {
  if (type !== 'expense') return ''
  if (importSource) return importSource
  if (recognized) return recognized
  const key = normalizeMerchant(merchant)
  const rule = [...rules].filter(x => x?.keyword && x?.payment_source)
    .sort((a,b) => normalizeMerchant(b.keyword).length - normalizeMerchant(a.keyword).length)
    .find(x => key && key.includes(normalizeMerchant(x.keyword)))
  return rule?.payment_source || defaultSource || ''
}
