// Stable transfer-target prefix, shared by UI and API.
export const PREPAID_PREFIX = 'prepaid:'
export const prepaidTarget = name => PREPAID_PREFIX + name
export const prepaidName = value => typeof value==='string' && value.startsWith(PREPAID_PREFIX) ? value.slice(PREPAID_PREFIX.length) : ''
// Never guess from チャージ alone; several different services can be charged.
// Only exact distinctive Suica/PASMO names in text AND a recharge verb are eligible.
export function detectPrepaidRecharge(text, names=[]) {
  const value=String(text||'').normalize('NFKC').toLowerCase().replace(/[\s　]/g,'')
  if(!/(?:チャージ|入金|積増し|積み増し|charge|topup)/i.test(value))return ''
  const matching=names.filter(name=>{
    const key=String(name||'').normalize('NFKC').toLowerCase().replace(/[\s　]/g,'')
    if(!/suica|pasmo|スイカ|パスモ/i.test(key))return false
    return value.includes(key) || (/suica|スイカ/i.test(key) && /suica|スイカ/i.test(value)) || (/pasmo|パスモ/i.test(key) && /pasmo|パスモ/i.test(value))
  })
  // Ambiguous names (e.g. Suica and モバイルSuica) require explicit selection.
  return matching.length===1 ? matching[0] : ''
}
export function prepaidBalance({opening_balance=0,charged=0,spent=0}) {
  return Number(opening_balance)+Number(charged)-Number(spent)
}
