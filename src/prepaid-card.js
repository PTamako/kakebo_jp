// Stable transfer-target prefix, shared by UI and API.
export const PREPAID_PREFIX = 'prepaid:'
export const prepaidTarget = name => PREPAID_PREFIX + name
export const prepaidName = value => typeof value==='string' && value.startsWith(PREPAID_PREFIX) ? value.slice(PREPAID_PREFIX.length) : ''
// Match any registered prepaid account, not a hard-coded brand list.
// A shorter statement name must cover a majority of the registered name and
// touch the recharge word. E.g. "nanacoチャージ" -> "nanacoモバイル",
// "PayPayマネーチャージ" -> "PayPay マネーライト".
// A generic "PayPayチャージ" is too short to identify マネーライト safely.
// Exact matching still supports other receipt text around the account name.
const normalized = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[\s　]/g,'')
const rechargeWord = /チャージ|入金|積増し|積み増し|charge|topup/i
function isAbbreviatedRecharge(accountKey, before, after) {
  // At least five characters and strictly more than half the registered
  // name must match contiguously at the edge of the recharge instruction.
  // This supports prefixes AND suffixes (e.g. モバイルSuica -> Suica)
  // without assuming any particular card brand or suffix vocabulary.
  const minLength = Math.max(5, Math.floor(accountKey.length / 2) + 1)
  for (let length = accountKey.length - 1; length >= minLength; length--) {
    const prefix = accountKey.slice(0, length)
    const suffix = accountKey.slice(-length)
    if (before.endsWith(prefix) || before.endsWith(suffix) ||
        after.startsWith(prefix) || after.startsWith(suffix)) return true
  }
  return false
}
export function detectPrepaidRecharge(text, names=[]) {
  const value=normalized(text)
  const recharge=rechargeWord.exec(value)
  if(!recharge)return ''
  const before=value.slice(0,recharge.index)
  const after=value.slice(recharge.index+recharge[0].length)
  const candidates=[...new Set(names.filter(x=>typeof x==='string'&&x.trim()).map(name=>name.trim()))]
    .map(name=>({name,key:normalized(name)})).filter(x=>x.key.length>=2)
  const found=candidates.filter(x=>value.includes(x.key) || isAbbreviatedRecharge(x.key,before,after))
  // Never choose between similar registered cards without user confirmation.
  if(found.length!==1)return ''
  const candidate=found[0]
  if(candidates.some(x=>x.name!==candidate.name &&
      (x.key.includes(candidate.key) || candidate.key.includes(x.key))))return ''
  return candidate.name
}
export function prepaidBalance({opening_balance=0,charged=0,earned=0,spent=0,transferred_out=0}) {
  return Number(opening_balance)+Number(charged)+Number(earned)-Number(spent)-Number(transferred_out)
}
