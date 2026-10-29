// Read-only financial checks and portable backup format. Never mutate ledger records here.
export const backupVersion = 2
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value

// Keep all user-relevant fields: same-day purchases with different payment methods
// or notes are not interchangeable.
export const transactionKey = e => [
  e.date, e.time || '', Number(e.amount), e.type || 'expense',
  (e.merchant || '').trim(), e.category || '', e.note || '', e.payment_source || e.paymentSource || '',
  e.transfer_target || e.transferTarget || '', e.transfer_date || e.transferDate || ''
].join('|')

export function duplicateCandidates(rows, target) {
  return rows.filter(e => transactionKey(e) === transactionKey(target))
}

export function prepareRestoreRows(existing, incoming) {
  const known = new Set(existing.map(transactionKey))
  const seen = new Set()
  const newRows = []
  const conflicts = []
  incoming.forEach((entry, backupIndex) => {
    const key = transactionKey(entry)
    const indexed = { ...entry, backupIndex }
    // Keep every conflict visible for explicit review; never silently discard it.
    if (known.has(key) || seen.has(key)) conflicts.push(indexed)
    else newRows.push(indexed)
    seen.add(key)
  })
  return { newRows, conflicts }
}

export function validateBackup(value) {
  if (!value || value.format !== 'kakeibo-ledger-backup' ||
      ![1, backupVersion].includes(value.version) || !Array.isArray(value.entries)) {
    throw Error('対応していないバックアップ形式です')
  }
  if (value.entries.length > 100000) throw Error('バックアップ件数が多すぎます')
  for (const e of value.entries) {
    if (!validDate(e.date) || !Number.isSafeInteger(Number(e.amount)) ||
        Number(e.amount) <= 0 || !['income','expense','transfer'].includes(e.type)) {
      throw Error('取引データに不正な値があります')
    }
  }
  const arrayNames = ['plans', 'bills', 'investments', 'paymentSources', 'merchantPaymentRules', 'customRules', 'categories']
  for (const name of arrayNames) {
    if (value[name] != null && (!Array.isArray(value[name]) || value[name].length > 10000)) {
      throw Error('バックアップの' + name + 'が不正です')
    }
  }
  if (value.categoryIcons != null && (typeof value.categoryIcons !== 'object' || Array.isArray(value.categoryIcons))) {
    throw Error('バックアップのアイコン情報が不正です')
  }
  if (Array.isArray(value.investments)) for (const item of value.investments) {
    if (!item || typeof item.platform !== 'string' ||
      (item.current_value != null && (!Number.isSafeInteger(item.current_value) || item.current_value < 0)) ||
      (item.pnl != null && !Number.isSafeInteger(item.pnl))) {
      throw Error('資産の評価額を確認してください')
    }
  }
  return value
}

export function restoreMissingByKey(existing, incoming, keyFn) {
  const keys = new Set(existing.map(keyFn))
  return incoming.filter(item => {
    const key = keyFn(item)
    if (!key || keys.has(key)) return false
    keys.add(key)
    return true
  })
}

export function reconcileStatement(rows, total) {
  const sum = rows.filter(e => e.type === 'expense').reduce((n,e) => n + Number(e.amount || 0), 0)
  return { sum, difference: Number(total) - sum }
}

export function nextScheduledDate(day, now = new Date()) {
  const d = Math.max(1,Math.min(31,Number(day) || 1))
  const y=now.getFullYear(),m=now.getMonth()
  const candidate = (year, month) => new Date(year,month,Math.min(d,new Date(year,month+1,0).getDate()))
  const first=candidate(y,m)
  const next=first >= new Date(y,m,now.getDate()) ? first : candidate(y,m+1)
  return [next.getFullYear(),String(next.getMonth()+1).padStart(2,'0'),String(next.getDate()).padStart(2,'0')].join('-')
}
