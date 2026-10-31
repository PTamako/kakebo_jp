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

const CONFIRMED_DUPLICATES_STORAGE_KEY = 'kakeibo-confirmed-not-duplicates-v1'
const MAX_CONFIRMED_DUPLICATE_GROUPS = 500
const validConfirmation = key => /^v1:[0-9a-f]{16}$/.test(key)

// Bind each confirmation to these exact database entries AND their current
// review-relevant fields. A later edit or a third matching purchase changes
// the signature and surfaces the group for review again.
// Persist a short 64-bit fingerprint instead of merchant names or transaction data.
export function duplicateReviewSignature(group) {
  if (!Array.isArray(group) || group.length < 2 ||
      group.some(row => !Number.isSafeInteger(Number(row?.id)) || Number(row.id) <= 0)) return ''
  const rows = group.map(row => [
    Number(row.id), String(row.date || ''), String(row.time || ''),
    row.type || 'expense', Number(row.amount), duplicateMerchantName(row.merchant),
    String(row.payment_source || ''), String(row.transfer_target || '')
  ]).sort((a, b) => a[0] - b[0])
  const data = JSON.stringify(rows)
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < data.length; i++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(data.charCodeAt(i))) * 0x100000001b3n)
  }
  return 'v1:' + hash.toString(16).padStart(16, '0')
}

export function readConfirmedDuplicateGroups(storage = null) {
  try {
    const saved = JSON.parse(storage?.getItem(CONFIRMED_DUPLICATES_STORAGE_KEY) || '[]')
    return new Set(Array.isArray(saved)
      ? saved.filter(key => typeof key === 'string' && validConfirmation(key)).slice(-MAX_CONFIRMED_DUPLICATE_GROUPS)
      : [])
  } catch { return new Set() }
}

export function saveConfirmedDuplicateGroups(keys, storage = null) {
  if (!storage) return false
  try {
    const values = [...keys].filter(key => typeof key === 'string' && validConfirmation(key))
      .slice(-MAX_CONFIRMED_DUPLICATE_GROUPS)
    storage.setItem(CONFIRMED_DUPLICATES_STORAGE_KEY, JSON.stringify(values))
    return true
  } catch { return false }
}
