// D1-backed, fail-closed budget for the optional Cloudflare Workers AI OCR.
export const tokyoAiDay = (now = Date.now()) => new Date(now + 9 * 3600000).toISOString().slice(0,10)
export const aiDailyLimit = env => {
  const value = Number(env.AI_OCR_DAILY_LIMIT)
  return env.AI_OCR_DAILY_LIMIT != null && Number.isSafeInteger(value) && value >= 0 ? Math.min(20,value) : 20
}
export async function aiQuotaState(db,env) {
  const day=tokyoAiDay(),limit=aiDailyLimit(env)
  // Fail closed when the migrated table is absent; leave schema and existing data untouched.
  const row=await db.prepare('SELECT attempts FROM ai_ocr_daily_usage WHERE day=?1').bind(day).first()
  return {day,limit,remaining:Math.max(0,limit-Number(row?.attempts || 0))}
}
export async function reserveAiAttempt(db,env) {
  const day=tokyoAiDay(),limit=aiDailyLimit(env)
  if(limit===0)return {allowed:false,limit}
  // Fail closed when the migrated table is absent; leave schema and existing data untouched.
  const results=await db.batch([
    db.prepare('INSERT OR IGNORE INTO ai_ocr_daily_usage(day,attempts) VALUES(?1,0)').bind(day),
    db.prepare('UPDATE ai_ocr_daily_usage SET attempts=attempts+1 WHERE day=?1 AND attempts < ?2').bind(day,limit)
  ])
  return {allowed:!!results[1]?.meta?.changes,limit}
}
