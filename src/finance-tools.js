// Read-only financial checks and portable backup format. Never mutate ledger records here.
export const backupVersion = 1
export const transactionKey = e => [e.date, e.time || '', Number(e.amount), e.type || 'expense', (e.merchant || '').trim(), e.category || ''].join('|')
export function duplicateCandidates(rows, target) {
  return rows.filter(e => transactionKey(e) === transactionKey(target))
}
export function validateBackup(value) {
  if (!value || value.format !== 'kakeibo-ledger-backup' || value.version !== backupVersion || !Array.isArray(value.entries)) throw Error('対応していないバックアップ形式です')
  if (value.entries.length > 100000) throw Error('バックアップ件数が多すぎます')
  for (const e of value.entries) {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(e.date) || !Number.isSafeInteger(Number(e.amount)) || Number(e.amount) <= 0 || !['income','expense','transfer'].includes(e.type)) throw Error('取引データに不正な値があります')
  }
  return value
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
