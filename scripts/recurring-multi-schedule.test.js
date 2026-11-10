import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {recurringDatesForPlanInMonth,recurringDatesInMonth,recurringFrequencyLabel,
  nextAutomaticStartMonth,recurringOccurrencePeriod,scheduledRecurringOnDate} from '../src/recurring-posting.js'
import {previewRecurringEntries,postApprovedRecurringEntries} from '../src/recurring-check.js'
import {resolveRecurringApproval} from '../functions/api/recurring-approval.js'

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const base={id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',name:'定期テスト',day:1,weekday:5,
  startMonth:'2026-11',enabled:true,amount:500,category:'日用品',paymentSource:'現金',
  scheduleType:'monthly',postingMode:'manual'}

test('every Friday + Saturday in November emits eight distinct due dates',()=>{
  const plan={...base,scheduleType:'weekly',weekdays:[5,6]}
  const dates=recurringDatesForPlanInMonth(plan,'2026-11')
  assert.deepEqual(dates,['2026-11-06','2026-11-07','2026-11-13','2026-11-14',
    '2026-11-20','2026-11-21','2026-11-27','2026-11-28'])
  assert.ok(scheduledRecurringOnDate(plan,'2026-11-07'))
  assert.equal(scheduledRecurringOnDate(plan,'2026-11-08'),false)
  assert.match(recurringFrequencyLabel(plan),/金・土/)
})

test('multiple monthly days each get their own key; February clipping is deduplicated',()=>{
  const plan={...base,monthDays:[1,15,31]}
  assert.deepEqual(recurringDatesForPlanInMonth(plan,'2027-02'),
    ['2027-02-01','2027-02-15','2027-02-28'])
  assert.equal(recurringOccurrencePeriod(plan,'2027-02-01'),'2027-02-01')
  assert.equal(recurringOccurrencePeriod(plan,'2027-02-15'),'2027-02-15')
  assert.equal(recurringOccurrencePeriod(base,'2027-02-01'),'2027-02')
  assert.deepEqual(recurringDatesInMonth('2027-02',{monthDays:[30,31]}),['2027-02-28'])
})

test('2/3/6-month and yearly schedules anchor to start month with no intermediate occurrences',()=>{
  for(const interval of [2,3,6,12]){
    const plan={...base,monthDays:[15],intervalMonths:interval}
    assert.deepEqual(recurringDatesForPlanInMonth(plan,'2026-11'),['2026-11-15'])
    assert.deepEqual(recurringDatesForPlanInMonth(plan,'2026-12'),[])
    const next=new Date(Date.UTC(2026,10+interval,1)).toISOString().slice(0,7)
    assert.deepEqual(recurringDatesForPlanInMonth(plan,next),[next+'-15'])
    assert.equal(nextAutomaticStartMonth('2026-11-20',15,'2026-11','monthly',0,
      {intervalMonths:interval,monthDays:[15]}),next)
  }
  assert.equal(recurringFrequencyLabel({...base,intervalMonths:12,monthDays:[15]}),'毎年11月15日')
})

test('manual posting previews multiple occurrences and rejects changed settings',async()=>{
  const plan={...base,monthDays:[1,15],intervalMonths:1}
  const entries=previewRecurringEntries([plan],[],{today:new Date(2026,10,16)})
  assert.deepEqual(entries.map(x=>x.date),['2026-11-01','2026-11-15'])
  assert.deepEqual(entries.map(x=>x.perDate),[true,true])
  const requests=[]
  await postApprovedRecurringEntries(async(_,opts)=>{requests.push(JSON.parse(opts.body));return {created:true}},entries)
  assert.equal(requests.length,2)
  assert.equal(requests[0].expected.monthDays.length,2)
  const dbPlan={...plan,start_month:plan.startMonth,payment_source:plan.paymentSource,
    schedule_type:'monthly',month_days_json:'[1,15]',weekdays_json:'[5]',interval_months:1}
  assert.equal(resolveRecurringApproval(requests[0],dbPlan).date,'2026-11-01')
  const changed={...requests[0],expected:{...requests[0].expected,monthDays:[1,20]}}
  assert.equal(resolveRecurringApproval(changed,dbPlan).code,'plan_changed')
  assert.equal(resolveRecurringApproval({...requests[0],expected:{...requests[0].expected,date:'2026-11-02'}},dbPlan).code,'plan_changed')
})

test('iPhone recurrence form uses short dropdown + multi-select bottom sheets, not expanded buttons',()=>{
  const view=source('src/FinanceTools.vue')
  const sheet=source('src/MobileMultiChoiceSheet.vue')
  const api=source('functions/api/[[path]].js')
  const migration=source('migrations/0020_recurring_multi_schedule.sql')
  assert.match(view,/v-model="planCycleChoice" label="記帳周期"/)
  assert.match(view,/v-model="plan\.weekdays"/)
  assert.match(view,/v-model="plan\.monthDays"/)
  assert.doesNotMatch(view,/<MobileChoiceSegments v-model="plan\.scheduleType"/)
  assert.match(sheet,/role="dialog" aria-modal="true"/)
  assert.match(sheet,/min-height:46px/)
  assert.match(api,/interval_months/)
  assert.match(migration,/ALTER TABLE recurring_plans ADD COLUMN month_days_json/)
})
