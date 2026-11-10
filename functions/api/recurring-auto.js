import { recurringRequestId, recurringOccurrencePeriod, recurringIsPerDate, scheduledRecurringOnDate, tokyoDateAt } from '../../src/recurring-posting.js'
import { recurringManualSlot } from './recurring-collision.js'

// Scheduled Worker writes directly to D1, never merely the device cache.
// Existing manually-entered expenses win. Repeat invocations are idempotent.
export async function postScheduledRecurring(db,{today=tokyoDateAt()}={}) {
  if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(today))throw Error('invalid_tokyo_date')
  const month=today.slice(0,7)
  const {results=[]}=await db.prepare(`SELECT p.id,p.name,p.amount,p.day,p.weekday,p.schedule_type,p.category,p.payment_source,p.start_month,p.enabled,
      p.posting_mode,p.auto_from_month,p.workday_only,p.weekdays_json,p.month_days_json,p.interval_months
    FROM recurring_plans p WHERE p.enabled=1 AND p.posting_mode='auto'
      AND p.start_month<=?1 AND p.auto_from_month<>'' AND p.auto_from_month<=?1
      AND NOT EXISTS(SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id)`).bind(month).all()
  const out={checked:0,created:0,skipped:0,date:today}
  for(const p of results) {
    if(!scheduledRecurringOnDate(p,today) || !Number.isSafeInteger(Number(p.amount))||Number(p.amount)<=0) continue
    out.checked++
    const period=recurringOccurrencePeriod(p,today)
    const requestId=recurringRequestId(p.id,period)
    const manualSlot=await recurringManualSlot(db,p,today,results)
    // The monthly range can use idx_entries_date; substr(e.date,1,7) cannot.
    const samePeriod=!recurringIsPerDate(p)
      ? "e.date >= (?5 || '-01') AND e.date < date(?5 || '-01', '+1 month')"
      : 'e.date=?4'
    const result=await db.prepare(`INSERT INTO entries
      (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
      SELECT ?1,'',p.amount,p.category,p.name,'定期固定費（自動記帳）','','expense',NULL,0,NULL,?3,p.payment_source
      FROM recurring_plans p
      WHERE p.id=?2 AND p.enabled=1 AND p.posting_mode='auto'
        AND p.start_month<=?5 AND p.auto_from_month<>'' AND p.auto_from_month<=?5
        AND p.name=?6 AND p.amount=?7 AND p.day=?8 AND p.weekday=?9
        AND p.schedule_type=?10 AND p.category=?11 AND p.payment_source=?12 AND p.workday_only=?13
        AND p.weekdays_json=?14 AND p.month_days_json=?15 AND p.interval_months=?16
        AND NOT EXISTS(SELECT 1 FROM trash_items t WHERE t.item_type='recurring_plan' AND t.item_id=p.id)
        AND NOT EXISTS(SELECT 1 FROM recurring_candidate_exclusions x WHERE x.plan_id=p.id AND x.month=?5)
        AND NOT EXISTS(SELECT 1 FROM recurring_date_exclusions x WHERE x.plan_id=p.id AND x.date=?4)
        AND (SELECT COUNT(*) FROM entries e WHERE ${samePeriod}
          AND e.type='expense' AND e.merchant=p.name AND COALESCE(e.payment_source,'')=p.payment_source
          AND (e.client_request_id IS NULL OR e.client_request_id NOT LIKE 'recurring_%' OR
          NOT EXISTS(SELECT 1 FROM recurring_plans owner WHERE owner.enabled=1
            AND owner.name=e.merchant AND owner.payment_source=COALESCE(e.payment_source,'')
            AND e.client_request_id=('recurring_'||replace(owner.id,'-','')||'_'||
              CASE WHEN owner.schedule_type='monthly' AND json_array_length(owner.month_days_json)<=1
                THEN replace(substr(e.date,1,7),'-','') ELSE replace(e.date,'-','') END)))) < ?17
      ON CONFLICT(client_request_id) DO NOTHING`)
      .bind(today,p.id,requestId,today,month,p.name,p.amount,p.day,p.weekday,p.schedule_type,p.category,p.payment_source,p.workday_only,p.weekdays_json,p.month_days_json,p.interval_months,manualSlot).run()
    if(result.meta?.changes)out.created++
    else out.skipped++
  }
  return out
}
