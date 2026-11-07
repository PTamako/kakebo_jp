// Shared validation for financial writes. Historical orphaned sources must not
// be reintroduced by an old PWA or direct API calls.
const unassigned = new Set(['', '現金', 'その他', '其他'])
export async function validateRegisteredPaymentSource(db, value, {allowArchived=false, currentSource=''} = {}) {
  if (typeof value !== 'string' || value.length > 80) {
    return {error:'支払方法を確認してください', code:'payment_source_invalid', status:400}
  }
  const name=value.trim()
  if (unassigned.has(name)) return null
  const row=await db.prepare('SELECT name,is_archived FROM payment_sources WHERE name=?1').bind(name).first()
  if (!row) return {error:'登録されていない支払方法です。カード設定を更新してください',code:'payment_source_missing',status:400}
  if (Number(row.is_archived)===1 && !allowArchived && name!==currentSource)
    return {error:'アーカイブ済みの支払方法は新しい記帳に使用できません',code:'payment_source_archived',status:409}
  return null
}
