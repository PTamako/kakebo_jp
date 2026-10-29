// Advisory duplicate review only: never edit, delete or merge ledger records.
// Backup/restore intentionally continues using the stricter transactionKey.
export const duplicateMerchantName = value =>
  String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s\u3000]+/g, '')

const minutes = value => {
  const match = String(value ?? '').match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

const closeInTime = (a, b) => {
  const left = minutes(a.time), right = minutes(b.time)
  // OCR and manual drafts may not carry a purchase time.
  return left === null || right === null || Math.abs(left - right) <= 5
}

export function findLedgerDuplicateGroups(rows) {
  const byPurchase = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) continue
    const merchant = duplicateMerchantName(row.merchant)
    const amount = Number(row.amount)
    if (!merchant || !Number.isSafeInteger(amount) || amount <= 0) continue
    const type = row.type || 'expense'
    if (!['expense', 'income', 'transfer'].includes(type)) continue
    // Amount, date, type and normalized shop identify a possible match.
    // Note, category, imported metadata and payment source can differ.
    const key = JSON.stringify([row.date, type, amount, merchant])
    if (!byPurchase.has(key)) byPurchase.set(key, [])
    byPurchase.get(key).push(row)
  }

  const duplicates = []
  for (const bucket of byPurchase.values()) {
    if (bucket.length < 2) continue
    // Group connected candidates; two distant timed purchases never match
    // directly, but an untimed row can still be flagged for manual review.
    const visited = new Set()
    for (let i = 0; i < bucket.length; i++) {
      if (visited.has(i)) continue
      const component = [], pending = [i]
      visited.add(i)
      while (pending.length) {
        const index = pending.pop()
        component.push(bucket[index])
        for (let j = 0; j < bucket.length; j++) {
          if (!visited.has(j) && closeInTime(bucket[index], bucket[j])) {
            visited.add(j)
            pending.push(j)
          }
        }
      }
      if (component.length > 1) duplicates.push(component.sort((a,b) => String(a.time || '').localeCompare(String(b.time || ''))))
    }
  }
  return duplicates.sort((a,b) => b[0].date.localeCompare(a[0].date))
}
