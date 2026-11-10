import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {isJapanHoliday} from '../src/japan-holidays.js'
import {recurringDatesInMonth,scheduledRecurringOnDate,recurringFrequencyLabel,
  nextAutomaticStartMonth,recurringRequestId,nextRecurringDate} from '../src/recurring-posting.js'
import {previewRecurringEntries} from '../src/recurring-check.js'
import {resolveRecurringApproval} from '../functions/api/recurring-approval.js'

const plan={
 id:'12345678-9999-4444-8888-111111111111',name:'通勤交通費',amount:240,
 day:1,weekday:1,scheduleType:'workday',category:'交通',paymentSource:'Suica',
 startMonth:'2026-11',postingMode:'auto',enabled:true
}
test('Japanese workday schedule excludes weekends, national and substitute holidays',()=>{
 const days=recurringDatesInMonth('2026-11',{scheduleType:'workday'})
 assert.equal(days.includes('2026-11-02'),true)
 for(const date of ['2026-11-01','2026-11-03','2026-11-07','2026-11-08','2026-11-23','2026-11-28'])
   assert.equal(days.includes(date),false,date)
 for(const date of days){
   assert.equal(isJapanHoliday(date),false,date)
   assert.equal(scheduledRecurringOnDate({...plan,workday_only:1,schedule_type:'weekly'},date),true,date)
 }
 assert.equal(scheduledRecurringOnDate({...plan,workday_only:1,schedule_type:'weekly'},'2026-11-03'),false)
 assert.equal(recurringFrequencyLabel(plan),'平日（土日祝を除く）')
 assert.equal(recurringFrequencyLabel({workday_only:1, schedule_type:'weekly'}),'平日（土日祝を除く）')
})
test('workday next date is after the Sunday/holiday run; period keys are daily',()=>{
 assert.equal(nextRecurringDate(plan,'2026-11-02'),'2026-11-02')
 assert.equal(nextRecurringDate(plan,'2026-11-03'),'2026-11-04')
 assert.equal(nextAutomaticStartMonth('2026-11-27',1,'2026-11','workday',1),'2026-11')
 assert.notEqual(recurringRequestId(plan.id,'2026-11-04'),recurringRequestId(plan.id,'2026-11-05'))
})
test('workday tomorrow preview can be excluded on one date without hiding later weekdays',()=>{
 const dates=previewRecurringEntries([plan],[],{today:new Date(2026,10,2),previewDaysAhead:1})
 assert.deepEqual(dates.map(x=>x.date),['2026-11-02'],'tomorrow is holiday and not displayed')
 const normal=previewRecurringEntries([plan],[],{today:new Date(2026,10,3),previewDaysAhead:1})
 assert.deepEqual(normal.map(x=>[x.date,x.upcoming]),[['2026-11-02',false],['2026-11-04',true]])
 const excluded=previewRecurringEntries([plan],[],{
   today:new Date(2026,10,4),previewDaysAhead:1,excluded:[{planId:plan.id,date:'2026-11-04'}]
 })
 assert.equal(excluded.some(row=>row.date==='2026-11-04'),false)
 assert.equal(excluded.some(row=>row.date==='2026-11-05'),true)
})
test('manual posting validates exact workday and cannot fabricate a holiday record',()=>{
 const row={...plan,schedule_type:'weekly',workday_only:1,payment_source:'Suica',start_month:'2026-11'}
 const expected={name:plan.name,amount:plan.amount,day:plan.day,weekday:plan.weekday,scheduleType:'workday',
   category:plan.category,paymentSource:plan.paymentSource,startMonth:plan.startMonth,date:'2026-11-04'}
 assert.equal(resolveRecurringApproval({month:'2026-11',expected},row).date,'2026-11-04')
 assert.equal(resolveRecurringApproval({month:'2026-11',expected:{...expected,date:'2026-11-03'}},row).code,'plan_changed')
})
test('mobile UI, cloud Worker and backup understand workday cadence without adding cron',()=>{
 const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
 const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
 const worker=readFileSync(new URL('../functions/api/recurring-auto.js',import.meta.url),'utf8')
 const migration=readFileSync(new URL('../migrations/0014_recurring_business_days.sql',import.meta.url),'utf8')
 assert.match(finance,/value:'workday',label:'平日（土日祝を除く）'/)
 assert.match(finance, /row.scheduleType!=='monthly'/)
 assert.match(api,/workday_only/)
 assert.match(worker,/p.workday_only/)
 assert.match(migration,/ALTER TABLE recurring_plans/)
 assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|UPDATE recurring_plans|INSERT INTO recurring_plans/)
})
