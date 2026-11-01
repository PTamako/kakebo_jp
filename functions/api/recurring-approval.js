import { recurringDatesInMonth } from '../../src/recurring-posting.js'

// Validate exact schedule and date against the current D1 plan before posting.
export function resolveRecurringApproval(body,plan) {
  const expected=body?.expected
  if(!expected || typeof expected!=='object')
    return {error:'固定支出の最新内容を再確認してください',code:'preview_required',status:409}
  const fields={name:plan.name,amount:Number(plan.amount),day:Number(plan.day),category:plan.category,
    paymentSource:plan.payment_source||'',startMonth:plan.start_month}
  if(Object.keys(fields).some(key=>expected[key]!==fields[key]))
    return {error:'固定支出が確認後に変更されました。再確認してから登録してください',code:'plan_changed',status:409}
  const scheduleType=plan.schedule_type||'monthly',weekday=Number(plan.weekday||0)
  if ((expected.scheduleType||'monthly')!==scheduleType ||
      Number(expected.weekday||0)!==weekday)
    return {error:'周期が変更されました。再確認してください',code:'plan_changed',status:409}
  const month=body.month
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return {error:'対象月を確認してください',status:400}
  if(month<plan.start_month)
    return {error:'開始月より前の支出は登録できません',code:'before_start',status:400}
  const dates=recurringDatesInMonth(month,{scheduleType,day:Number(plan.day),weekday})
  if(!dates.includes(expected.date))return {error:'予定日が確認時と異なります',code:'plan_changed',status:409}
  return {date:expected.date}
}
