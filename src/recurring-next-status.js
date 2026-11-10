import { recurringDatesForPlanInMonth, recurringRequestId, recurringScheduleType, recurringOccurrencePeriod } from './recurring-posting.js'

// Compact schedule status is scoped to this month and future dates.
// Older omissions remain discoverable in the separate "未記帳分を確認" review.
// Never interpret a Cron trigger itself as evidence that a payment was posted.
export function recurringPlanNextStatus(plan, entries=[], exclusions=[], {
  today, afterAutoWindow=false
}={}) {
  if (!plan?.enabled) return {state:'stopped',date:null}
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(today||'')))
    return {state:'unknown',date:null}
  const start=plan.startMonth||plan.start_month
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(start||'')))
    return {state:'unknown',date:null}
  const type=recurringScheduleType(plan)
  const source=plan.paymentSource??plan.payment_source??''
  const planId=String(plan.id||'')
  const startMonth=today.slice(0,7)
  const excludeMonths=new Set()
  const excludeDates=new Set()
  for(const x of exclusions||[]){
    if(x.planId!==planId)continue
    if(x.date)excludeDates.add(x.date)
    else if(x.month)excludeMonths.add(x.month)
  }
  const expenseRows=(entries||[]).filter(e=>e.type==='expense' && typeof e.date==='string')
  const wasRecorded = (date,month) => {
    const period=recurringOccurrencePeriod(plan,date)
    const id=planId?recurringRequestId(planId,period):''
    return expenseRows.some(e=>{
      if(e.client_request_id && id && e.client_request_id===id)return true
      return e.merchant===plan.name &&
        String(e.payment_source||'')===String(source) &&
        (period===month ? e.date.slice(0,7)===month : e.date===date)
    })
  }
  const [startYear,startNumber]=startMonth.split('-').map(Number)
  for(let offset=0;offset<15;offset++){
    const y=startYear+Math.floor((startNumber-1+offset)/12)
    const number=(startNumber-1+offset)%12+1
    const month=y+'-'+String(number).padStart(2,'0')
    if(month<start || excludeMonths.has(month))continue
    const dates=recurringDatesForPlanInMonth(plan,month)
    for(const date of dates){
      if(excludeDates.has(date)||wasRecorded(date,month))continue
      if(date<today)return {state:'missing',date}
      if(date===today)return {state:plan.postingMode==='auto' || plan.posting_mode==='auto'
        ? (afterAutoWindow?'missing':'today') : 'today',date}
      return {state:'next',date}
    }
  }
  return {state:'unknown',date:null}
}

export function recurringPlanNextLabel(status) {
  if(status?.state==='stopped')return '停止中'
  if(!status?.date)return '確認中'
  const date=status.date.slice(5).replace('-','/')
  const prefix=status.state==='missing'?'未記帳':status.state==='today'?'本日':'次回'
  return prefix+' '+date
}
