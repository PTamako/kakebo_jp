// Match a saved merchant rule without making up a payment for unrelated stores.
// Full names take priority. A shortened OCR name may match a longer rule only
// when every matching longer rule agrees on its category and payment source.
export function normalizedMerchantKey(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP')
    .replace(/[\u30a1-\u30f6]/g, char=>String.fromCharCode(char.charCodeAt(0)-0x60))
    .replace(/[\s\u3000・･、,，.．。/／()（）［］\[\]_-]/g, '')
}
export function bestMerchantRule(merchant, rules = []) {
  const name = normalizedMerchantKey(merchant)
  if (!name) return null
  const valid = rules.filter(rule=>rule?.keyword && normalizedMerchantKey(rule.keyword))
  const direct = valid.filter(rule=>name.includes(normalizedMerchantKey(rule.keyword)))
    .sort((a,b)=>normalizedMerchantKey(b.keyword).length-normalizedMerchantKey(a.keyword).length)
  if (direct.length) return direct[0]
  // Do not reverse-match generic two- or three-character merchant fragments.
  if (name.length < 6) return null
  const truncated = valid.filter(rule=>{
    const key = normalizedMerchantKey(rule.keyword)
    return key.length>name.length && key.startsWith(name)
  })
  if (!truncated.length) return null
  const first = truncated[0]
  // Different branches may legitimately have different category/card rules.
  // In that case an OCR-truncated name is ambiguous: retain the default.
  if (truncated.some(rule=>
    (rule.category||'')!==(first.category||'') ||
    (rule.payment_source||'')!==(first.payment_source||''))) return null
  return first
}
