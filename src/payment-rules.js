import { isStationMerchant } from './station-merchant.js'
export const normalizeMerchant = name => String(name || '').normalize('NFKC').toLowerCase().replace(/[\s　・]/g, '')
export function paymentForDraft({ merchant = '', recognized = '', importSource = '', rules = [], registeredSources = [], defaultSource = '', type = 'expense' }) {
  if (type !== 'expense') return ''
  // An explicitly selected statement card wins. For all other drafts,
  // the user's saved merchant-payment rule overrides OCR payment labels.
  // Only when no rule matches should we trust an identified registered card
  // or fall back to the user's configured default.
  // OCR and stale rules may only select a registered card; cash is special.
  const available = new Set(registeredSources.map(x => String(x).normalize('NFKC').trim()))
  const allowed = name => available.has(name) || name === '現金'
  if (importSource && allowed(importSource)) return importSource
  const key = normalizeMerchant(merchant)
  const rule = [...rules].filter(x => x?.keyword && x?.payment_source)
    .sort((a,b) => normalizeMerchant(b.keyword).length - normalizeMerchant(a.keyword).length)
    .find(x => key && key.includes(normalizeMerchant(x.keyword)))
  // Suica is a default only when already configured. Import cards, personal
  // merchant rules and an explicitly recognized payment keep precedence.
  const suica=registeredSources.find(name=>String(name).normalize('NFKC').trim().toLowerCase()==='suica')
  const savedRule = rule?.payment_source && allowed(rule.payment_source) ? rule.payment_source : ''
  const ocrCard = recognized && allowed(recognized) ? recognized : ''
  return savedRule || ocrCard || (suica && isStationMerchant(merchant) ? suica : '') ||
    (allowed(defaultSource) ? defaultSource : '')
}
