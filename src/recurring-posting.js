// Japanese civil-date recurrence helpers: 0=Sunday through 6=Saturday.
export function scheduledRecurringDate(month, day) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null
  const [year, number] = month.split('-').map(Number)
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  return month + '-' + String(Math.min(day, new Date(Date.UTC(year, number, 0)).getUTCDate())).padStart(2,'0')
}
export function recurringDatesInMonth(month, {scheduleType='monthly', day=1, weekday=0}={}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return []
  if (scheduleType === 'monthly') return [scheduledRecurringDate(month, Number(day))].filter(Boolean)
  if (scheduleType !== 'weekly' || !Number.isInteger(Number(weekday)) || Number(weekday)<0 || Number(weekday)>6) return []
  const [year, number] = month.split('-').map(Number)
  const first = new Date(Date.UTC(year,number-1,1)).getUTCDay()
  const offset=(Number(weekday)-first+7)%7
  const last=new Date(Date.UTC(year,number,0)).getUTCDate()
  const dates=[]
  for(let d=1+offset;d<=last;d+=7)dates.push(month+'-'+String(d).padStart(2,'0'))
  return dates
}
export function scheduledRecurringOnDate(plan,date) {
  if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date))return false
  return recurringDatesInMonth(date.slice(0,7),{
    scheduleType:plan.scheduleType||plan.schedule_type||'monthly',
    day:plan.day,
    weekday:plan.weekday
  }).includes(date)
}
export function nextAutomaticStartMonth(today, day, startMonth, scheduleType='monthly', weekday=0) {
  const month=String(today).slice(0,7)
  const dates=recurringDatesInMonth(month,{scheduleType,day:Number(day),weekday:Number(weekday)})
  const next = dates.some(date=>date>today) ? month : (() => {
    const [y,m]=month.split('-').map(Number);return m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0')
  })()
  return startMonth>next?startMonth:next
}
export function recurringRequestId(planId, period) {
  return 'recurring_'+planId.replace(/-/g,'')+'_'+period.replace(/-/g,'')
}
export function tokyoDateAt(timestamp=Date.now()) {
  return new Date(timestamp+9*3600000).toISOString().slice(0,10)
}
export const WEEKDAYS_JA=['日','月','火','水','木','金','土']
export function recurringFrequencyLabel(plan) {
  return (plan.scheduleType||plan.schedule_type)==='weekly'
    ? '毎週'+WEEKDAYS_JA[Number(plan.weekday)]+'曜日'
    : '毎月'+plan.day+'日'
}
