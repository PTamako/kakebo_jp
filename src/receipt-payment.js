// Receipt payment methods must map only to cards already registered in D1.
// This never guesses a payment card from the receipt brand or creates new cards.
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/[\s　]/g,'')
// QUICPay is a payment network, not a payment-source card. Merchant payment
// rules, or the configured default, determine its underlying card.
export const isQuicPayReceipt = text =>
  /(?:^|\n)\s*(?:支払方法\s*[:：]\s*QUICPay\b|QUICPay\s*(?:支払|決済))/im.test(String(text||'').normalize('NFKC'))

export function detectRegisteredReceiptPayment(receiptText, paymentSources = [], sourceMeta = {}) {
  const registered = [...new Set(paymentSources.filter(x=>typeof x==='string' && x.trim()))]
    .sort((a,b)=>b.length-a.length)
  // Do not invent a separate QUICPay card or hard-code a Saison mapping.
  if (isQuicPayReceipt(receiptText)) return ''
  const lines=String(receiptText||'').normalize('NFKC').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)
  for(const line of lines) {
    const condensed=normalize(line)
    const colon=condensed.match(/^(?:支払方法|お支払方法|決済方法|決済手段)[:：](.+)$/)
    if(!colon)continue
    const value=colon[1]
    for(const name of registered) {
      const key=normalize(name)
      if(value===key || value.startsWith(key+'(') || value.startsWith(key+'¥') || value.startsWith(key+'円'))
        return name
    }
  }
  for(const line of lines) {
    const condensed=normalize(line)
    for(const name of registered) {
      const key=normalize(name)
      if(condensed.startsWith(key+'支払') || condensed.startsWith(key+'決済') ||
         condensed.startsWith(key+'で支払') || condensed.startsWith(key+'でお支払'))
        return name
    }
  }
  return ''
}
