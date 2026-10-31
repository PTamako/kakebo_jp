// A fixed expense starts in its own saved startMonth. The review range is
// automatically wide enough to cover active plans, without registering debits.
const monthNumber = value => Number(value.slice(0,4))*12 + Number(value.slice(5,7))-1
export function validRecurringMonth(value) {
  return typeof value==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}
export function recurringReviewWindow(plans, currentMonth, maxMonths=119) {
  if(!validRecurringMonth(currentMonth))throw Error('現在の月を確認できません')
  const now=monthNumber(currentMonth)
  const starts=(plans||[])
    .filter(plan=>plan?.enabled && validRecurringMonth(plan.startMonth))
    .map(plan=>monthNumber(plan.startMonth))
    .filter(month=>month<=now)
  if(!starts.length)return {historicalMonths:0,clipped:false}
  const range=now-Math.min(...starts)
  return {historicalMonths:Math.min(Math.max(0,range),maxMonths),clipped:range>maxMonths}
}
