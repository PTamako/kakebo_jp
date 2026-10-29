// Shared server-side guard for an exact user-approved monthly recurring debit.
// A changed plan or edited debit can never silently be replaced by a cached preview.
export function resolveRecurringApproval(body, plan) {
  const expected=body?.expected
  if(!expected || typeof expected!=='object')
    return {error:'固定支出の最新内容を再確認してください',code:'preview_required',status:409}
  const fields={name:plan.name,amount:Number(plan.amount),day:Number(plan.day),category:plan.category,
    paymentSource:plan.payment_source||'',startMonth:plan.start_month}
  if(Object.keys(fields).some(key=>expected[key]!==fields[key]))
    return {error:'固定支出が確認後に変更されました。再確認してから登録してください',code:'plan_changed',status:409}
  const month=body.month
  if(month<plan.start_month)
    return {error:'開始月より前の支出は登録できません',code:'before_start',status:400}
  const [year,m]=month.split('-').map(Number)
  const day=Math.min(Number(plan.day),new Date(Date.UTC(year,m,0)).getUTCDate())
  const date=month+'-'+String(day).padStart(2,'0')
  if(expected.date!==date)return {error:'予定日が確認時と異なります',code:'plan_changed',status:409}
  return {date}
}
