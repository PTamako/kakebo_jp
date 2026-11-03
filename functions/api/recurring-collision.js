import { recurringRequestId, scheduledRecurringDate, scheduledRecurringOnDate } from '../../src/recurring-posting.js'

// A payment is not globally identified by its merchant name: two valid plans can
// share a merchant, amount, category and payment method. Keep their slots apart.
export function recurringCollisionKey(plan, date) {
  const period = plan.schedule_type === 'monthly' ? date.slice(0, 7) : date
  return JSON.stringify([period, plan.name, plan.payment_source || ''])
}

const planDate = (plan, date) => plan.schedule_type === 'monthly'
  ? scheduledRecurringDate(date.slice(0, 7), Number(plan.day))
  : scheduledRecurringOnDate(plan, date) ? date : null

// Only needed when another plan has the same financial signature. A normal
// uncategorized expense can satisfy ONE unclaimed plan slot, not every plan.
// Already-posted plan request IDs and user exclusions consume no new slot.
// This helper is read-only; the caller's INSERT remains atomic and idempotent.
export async function recurringManualSlot(db, plan, date, knownPlans = null) {
  const month = date.slice(0, 7)
  let plans = knownPlans
  if (!plans) {
    const data = await db.prepare(`SELECT id,name,amount,day,weekday,schedule_type,workday_only,
      category,payment_source,start_month,enabled,posting_mode,auto_from_month
      FROM recurring_plans WHERE enabled=1 AND start_month<=?1
        AND name=?2 AND payment_source=?3`)
      .bind(month, plan.name, plan.payment_source).all()
    plans = data.results || []
  }
  const signature = recurringCollisionKey(plan, date)
  const eligible = plans.filter(other => Number(other.enabled) === 1 &&
    other.start_month <= month &&
    recurringCollisionKey(other, date) === signature &&
    (!knownPlans || (other.posting_mode === 'auto' && other.auto_from_month && other.auto_from_month <= month)) &&
    planDate(other, date) && planDate(other, date) <= date)
  if (eligible.length <= 1) return 1

  const period = plan.schedule_type === 'monthly' ? month : date
  const samePeriod = plan.schedule_type === 'monthly' ? 'substr(date,1,7)=?1' : 'date=?1'
  const { results: rows = [] } = await db.prepare(`SELECT client_request_id FROM entries
    WHERE ${samePeriod} AND type='expense' AND merchant=?2
      AND COALESCE(payment_source,'')=?3`)
    .bind(period, plan.name, plan.payment_source || '').all()
  const existingIds = new Set(rows.map(row => row.client_request_id).filter(Boolean))
  const { results: excludedMonths = [] } = await db.prepare(
    'SELECT plan_id FROM recurring_candidate_exclusions WHERE month=?1').bind(month).all()
  const { results: excludedDates = [] } = await db.prepare(
    'SELECT plan_id FROM recurring_date_exclusions WHERE date=?1').bind(date).all()
  const excluded = new Set([...excludedMonths, ...excludedDates].map(row => row.plan_id))

  const pending = eligible.filter(other => {
    const ownPeriod = other.schedule_type === 'monthly' ? month : date
    return !excluded.has(other.id) && !existingIds.has(recurringRequestId(other.id, ownPeriod))
  }).sort((a, b) => planDate(a, date).localeCompare(planDate(b, date)) || a.id.localeCompare(b.id))

  const rank = pending.findIndex(other => other.id === plan.id)
  return rank < 0 ? 1 : rank + 1
}
