import { isStationMerchant } from './station-merchant.js'
export const normalizeMerchant = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[\s　・]/g, '')
export function paymentForDraft({ merchant = '', recognized = '', importSource = '', rules = [], registeredSources = [], defaultSource = '', type = 'expense' }) {
  if (type !== 'expense') return ''
  // An explicitly selected statement card wins. For all other drafts,
  // the user's saved merchant-payment rule overrides OCR payment labels.
  // Only when no rule matches should we trust an identified registered card
  // or fall back to the user's configured default.
  if (importSource) return importSource
  const key = normalizeMerchant(merchant)
  const rule = [...rules].filter(x => x?.keyword && x?.payment_source)
    .sort((a,b) => normalizeMerchant(b.keyword).length - normalizeMerchant(a.keyword).length)
    .find(x => key && key.includes(normalizeMerchant(x.keyword)))
  // Suica is a default only when already configured. Import cards, personal
  // merchant rules and an explicitly recognized payment keep precedence.
  const suica=registeredSources.find(name=>String(name).normalize('NFKC').trim().toLowerCase()==='suica')
  return rule?.payment_source || recognized || (suica && isStationMerchant(merchant) ? suica : '') || defaultSource || ''
}
