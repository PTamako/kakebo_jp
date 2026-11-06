// Stable transfer-target prefix, shared by UI and API.
export const PREPAID_PREFIX = 'prepaid:'
export const prepaidTarget = name => PREPAID_PREFIX + name
export const prepaidName = value => typeof value==='string' && value.startsWith(PREPAID_PREFIX) ? value.slice(PREPAID_PREFIX.length) : ''
// Match registered prepaid accounts by their full name or a safe shorthand.
// For example, "nanacoチャージ" can target a registered "nanacoモバイル".
// Multiple matches are deliberately left for manual selection; never create cards.
const normalized = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[\s　]/g,'')
const rechargeAliases = key => {
  const aliases = new Set([key])
  // Strip common form-factor qualifiers only at the edges. Require a meaningful
  // remaining name, so generic "カード" / "モバイル" cannot become a target.
  for (const qualifier of ['モバイル', 'mobile', 'カード', 'card']) {
    if (key.startsWith(qualifier) && key.length-qualifier.length>=4)
      aliases.add(key.slice(qualifier.length))
    if (key.endsWith(qualifier) && key.length-qualifier.length>=4)
      aliases.add(key.slice(0, -qualifier.length))
  }
  return [...aliases]
}
export function detectPrepaidRecharge(text, names=[]) {
  const value=normalized(text)
  if(!/(?:チャージ|入金|積増し|積み増し|charge|topup)/i.test(value))return ''
  const candidates=[...new Set(names.filter(x=>typeof x==='string'&&x.trim()).map(name=>name.trim()))]
    .map(name=>({name,key:normalized(name)})).filter(x=>x.key.length>=2)
    .map(x=>({...x,aliases:rechargeAliases(x.key)}))
  const found=candidates.filter(x=>x.aliases.some(alias=>value.includes(alias)))
  // If more than one registered account could match, don't guess a destination.
  return found.length===1 ? found[0].name : ''
}
export function prepaidBalance({opening_balance=0,charged=0,spent=0,transferred_out=0}) {
  return Number(opening_balance)+Number(charged)-Number(spent)-Number(transferred_out)
}
