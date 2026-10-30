// Stable transfer-target prefix, shared by UI and API.
export const PREPAID_PREFIX = 'prepaid:'
export const prepaidTarget = name => PREPAID_PREFIX + name
export const prepaidName = value => typeof value==='string' && value.startsWith(PREPAID_PREFIX) ? value.slice(PREPAID_PREFIX.length) : ''
// Only registered prepaid cards are candidates; never hard-code card brands.
// Require both a recharge verb and an unambiguous full card name.
// Overlapping names (e.g. one being part of another) require manual selection.
const normalized = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[\s　]/g,'')
export function detectPrepaidRecharge(text, names=[]) {
  const value=normalized(text)
  if(!/(?:チャージ|入金|積増し|積み増し|charge|topup)/i.test(value))return ''
  const candidates=[...new Set(names.filter(x=>typeof x==='string'&&x.trim()).map(name=>name.trim()))]
    .map(name=>({name,key:normalized(name)})).filter(x=>x.key.length>=2)
  const found=candidates.filter(x=>value.includes(x.key))
  if(found.length!==1)return ''
  const candidate=found[0]
  // Even a uniquely matched short name may refer to a longer registered card.
  if(candidates.some(x=>x.name!==candidate.name && x.key.includes(candidate.key)))return ''
  return candidate.name
}
export function prepaidBalance({opening_balance=0,charged=0,spent=0,transferred_out=0}) {
  return Number(opening_balance)+Number(charged)-Number(spent)-Number(transferred_out)
}
