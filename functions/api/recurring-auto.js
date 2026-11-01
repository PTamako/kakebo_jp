import { scheduledRecurringDate, recurringRequestId, tokyoDateAt } from '../../src/recurring-posting.js'

// Direct D1 scheduled posting: no user cookie, browser state or UI session.
// Existing manually-entered purchases have priority; never rewrite history.
export async function postScheduledRecurring(db, {today = tokyoDateAt()} = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(today)) throw Error('invalid_tokyo_date')
  const month = today.slice(0,7)
  const { results = [] } = await db.prepare(`SELECT p.id,p.name,p.amount,p.day,p.category,p.payment_source,p.start_month,
      p.posting_mode,p.auto_from_month
    FROM recurring_plans p
    WHERE p.enabled=1 AND p.posting_mode='auto' AND p.start_month<=?1
      AND p.auto_from_month<>'' AND p.auto_from_month<=?1
      AND NOT EXISTS (SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id)`).bind(month).all()
  const output = {checked:0, created:0, skipped:0, date:today}
  for(const p of results) {
    // The Worker only writes the due day. No historical catch-up during activation.
    if (scheduledRecurringDate(month,Number(p.day)) !== today || !Number.isSafeInteger(Number(p.amount)) || Number(p.amount)<=0) continue
    output.checked++
    const requestId = recurringRequestId(p.id,month)
    const insert = await db.prepare(`INSERT INTO entries
      (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
      SELECT ?1,'',p.amount,p.category,p.name,'毎月の固定支出（自動記帳）','','expense',NULL,0,NULL,?3,p.payment_source
      FROM recurring_plans p
      WHERE p.id=?2 AND p.enabled=1 AND p.posting_mode='auto'
        AND p.start_month<=?4 AND p.auto_from_month<>'' AND p.auto_from_month<=?4
        AND p.name=?5 AND p.amount=?6 AND p.day=?7
        AND p.category=?8 AND p.payment_source=?9
        AND NOT EXISTS (SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM recurring_candidate_exclusions x WHERE x.plan_id=p.id AND x.month=?4)
        AND NOT EXISTS (SELECT 1 FROM entries e WHERE substr(e.date,1,7)=?4
          AND e.type='expense' AND e.merchant=p.name AND COALESCE(e.payment_source,'')=p.payment_source)
      ON CONFLICT(client_request_id) DO NOTHING`)
      .bind(today,p.id,requestId,month,p.name,p.amount,p.day,p.category,p.payment_source).run()
    if (insert.meta?.changes) output.created++
    else output.skipped++
  }
  return output
}
