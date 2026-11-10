import { isJapanHoliday } from './japan-holidays.js'

// Japanese civil dates, independent of the device's time zone.
// Keep the single-day monthly YYYYMM request keys for old posted entries.
const validMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||''))
const monthOrdinal = month => Number(month.slice(0,4))*12+Number(month.slice(5,7))-1
const nextMonth = month => {
  const [y,m]=month.split('-').map(Number)
  return m===12?(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0')
}
const parseArray = value => {
  if(Array.isArray(value))return value
  if(typeof value!=='string')return []
  try {const arr=JSON.parse(value);return Array.isArray(arr)?arr:[]}catch{return []}
}
const normalizedDays = (values,min,max,fallback) => {
  const valid=[...new Set(parseArray(values).map(Number)
    .filter(n=>Number.isInteger(n)&&n>=min&&n<=max))].sort((a,b)=>a-b)
  return valid.length?valid:[Number(fallback)]
}
export const recurringMonthDays = plan => normalizedDays(
  plan?.monthDays ?? plan?.month_days_json,1,31,plan?.day??1)
export const recurringWeekdays = plan => normalizedDays(
  plan?.weekdays ?? plan?.weekdays_json,0,6,plan?.weekday??0)
export const recurringIntervalMonths = plan => Number(plan?.intervalMonths??plan?.interval_months??1)
export function scheduledRecurringDate(month, day) {
  if (!validMonth(month)) return null
  const [year, number] = month.split('-').map(Number)
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  return month + '-' + String(Math.min(day,new Date(Date.UTC(year,number,0)).getUTCDate())).padStart(2,'0')
}
export function recurringScheduleType(plan) {
  return plan?.workdayOnly || Number(plan?.workday_only) === 1 ? 'workday'
    : (plan?.scheduleType || plan?.schedule_type || 'monthly')
}
export const recurringIsPerDate = plan => recurringScheduleType(plan) !== 'monthly' || recurringMonthDays(plan).length>1
export function recurringOccurrencePeriod(plan,date) {
  return recurringIsPerDate(plan)?date:date.slice(0,7)
}
export function recurringDatesInMonth(month, {
  scheduleType='monthly', day=1,weekday=0,weekdays=null,monthDays=null,
  intervalMonths=1,startMonth=''
}={}) {
  if (!validMonth(month)) return []
  if(scheduleType==='monthly'){
    if(!Number.isInteger(Number(intervalMonths))||Number(intervalMonths)<1||Number(intervalMonths)>24)return []
    if(startMonth && (!validMonth(startMonth) || month<startMonth ||
      (monthOrdinal(month)-monthOrdinal(startMonth))%Number(intervalMonths)!==0))return []
    const days=normalizedDays(monthDays,1,31,day)
    return [...new Set(days.map(d=>scheduledRecurringDate(month,d)).filter(Boolean))].sort()
  }
  const [year,number]=month.split('-').map(Number)
  const last=new Date(Date.UTC(year,number,0)).getUTCDate()
  if(scheduleType==='workday'){
    const dates=[]
    for(let d=1;d<=last;d++){
      const date=month+'-'+String(d).padStart(2,'0')
      if(!isJapanHoliday(date))dates.push(date)
    }
    return dates
  }
  if(scheduleType!=='weekly')return []
  const selected=normalizedDays(weekdays,0,6,weekday)
  const first=new Date(Date.UTC(year,number-1,1)).getUTCDay()
  const dates=[]
  for(let d=1;d<=last;d++)
    if(selected.includes((first+d-1)%7))dates.push(month+'-'+String(d).padStart(2,'0'))
  return dates
}
export function recurringDatesForPlanInMonth(plan,month) {
  return recurringDatesInMonth(month,{
    scheduleType:recurringScheduleType(plan),
    day:Number(plan?.day),
    weekday:Number(plan?.weekday||0),
    weekdays:recurringWeekdays(plan),
    monthDays:recurringMonthDays(plan),
    intervalMonths:recurringIntervalMonths(plan),
    startMonth:plan?.startMonth||plan?.start_month||''
  })
}
export function scheduledRecurringOnDate(plan,date) {
  if(!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date))return false
  return recurringDatesForPlanInMonth(plan,date.slice(0,7)).includes(date)
}
// Legacy positional arguments remain supported for older callers/tests.
export function nextAutomaticStartMonth(today,day,startMonth,scheduleType='monthly',weekday=0,scheduleDetails={}) {
  const month=String(today).slice(0,7)
  if(!validMonth(month)||!validMonth(startMonth))return startMonth
  const details={scheduleType,day:Number(day),weekday:Number(weekday),
    ...scheduleDetails,startMonth}
  let candidate=startMonth>month?startMonth:month
  for(let i=0;i<60;i++,candidate=nextMonth(candidate)){
    if(recurringDatesInMonth(candidate,details).some(date=>date>today))return candidate
  }
  return ''
}
export function recurringRequestId(planId, period) {
  return 'recurring_'+planId.replace(/-/g,'')+'_'+period.replace(/-/g,'')
}
export function tokyoDateAt(timestamp=Date.now()) {
  return new Date(timestamp+9*3600000).toISOString().slice(0,10)
}
export const WEEKDAYS_JA=['日','月','火','水','木','金','土']
export function recurringFrequencyLabel(plan) {
  const type=recurringScheduleType(plan)
  if(type==='workday')return '平日（土日祝を除く）'
  if(type==='weekly')return '毎週'+recurringWeekdays(plan).map(d=>WEEKDAYS_JA[d]).join('・')+'曜日'
  const days=recurringMonthDays(plan).join('・')+'日'
  const interval=recurringIntervalMonths(plan)
  if(interval===12){
    const month=Number(String(plan.startMonth||plan.start_month||'').slice(5,7))
    return '毎年'+(month?month+'月':'')+days
  }
  return (interval===1?'毎月':interval+'か月ごと')+days
}
export function nextRecurringDate(plan,today) {
  if(!plan.enabled)return null
  const start=plan.startMonth||plan.start_month
  const current=String(today).slice(0,7)
  if(!validMonth(start)||!validMonth(current))return null
  let month=start>current?start:current
  for(let i=0;i<60;i++,month=nextMonth(month)){
    const next=recurringDatesForPlanInMonth(plan,month).find(x=>x>=today)
    if(next)return next
  }
  return null
}
