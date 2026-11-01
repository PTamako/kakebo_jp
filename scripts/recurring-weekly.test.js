import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recurringDatesInMonth, recurringRequestId, nextAutomaticStartMonth, nextRecurringDate, scheduledRecurringOnDate } from '../src/recurring-posting.js'
import { previewRecurringEntries, postApprovedRecurringEntries } from '../src/recurring-check.js'
import { resolveRecurringApproval } from '../functions/api/recurring-approval.js'
import { postScheduledRecurring } from '../functions/api/recurring-auto.js'

const source = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const weekly = (extra={}) => ({ id:'plan-00000001',name:'習い事',day:27,scheduleType:'weekly',weekday:5,postingMode:'manual',amount:1000,category:'教育',paymentSource:'現金',startMonth:'2026-11',enabled:true,...extra })

test('monthly dates preserve 27th, including February end-of-month clipping',()=>{
  assert.deepEqual(recurringDatesInMonth('2026-11',{day:27}),['2026-11-27'])
  assert.deepEqual(recurringDatesInMonth('2027-02',{day:31}),['2027-02-28'])
})
test('weekly Friday in November produces four distinct due dates and 5-week months can produce five',()=>{
  assert.deepEqual(recurringDatesInMonth('2026-11',{scheduleType:'weekly',weekday:5}),['2026-11-06','2026-11-13','2026-11-20','2026-11-27'])
  assert.equal(recurringDatesInMonth('2026-10',{scheduleType:'weekly',weekday:5}).length,5)
  assert.equal(recurringDatesInMonth('2026-11',{scheduleType:'weekly',weekday:7}).length,0)
})
test('weekly request keys differ per occurrence, monthly identifiers remain backward compatible',()=>{
  assert.notEqual(recurringRequestId('plan-00000001','2026-11-06'),recurringRequestId('plan-00000001','2026-11-13'))
  assert.equal(recurringRequestId('plan-00000001','2026-11'),'recurring_plan00000001_202611')
})
test('weekly mode starts on a future due date without backfilling earlier months',()=>{
  assert.equal(nextAutomaticStartMonth('2026-11-02',27,'2026-07','weekly',5),'2026-11')
  assert.equal(nextAutomaticStartMonth('2026-11-27',27,'2026-07','weekly',5),'2026-12')
  assert.equal(nextRecurringDate(weekly(),'2026-11-07'),'2026-11-13')
  assert.ok(scheduledRecurringOnDate(weekly(),'2026-11-13'))
  assert.equal(scheduledRecurringOnDate(weekly(),'2026-11-14'),false)
})
test('weekly confirmation previews and excludes each occurrence individually',()=>{
  const plan=weekly()
  const rows=previewRecurringEntries([plan],[],{today:new Date(2026,10,29),excluded:[{planId:plan.id,date:'2026-11-13'}]})
  assert.deepEqual(rows.map(x=>x.date),['2026-11-06','2026-11-20','2026-11-27'])
  assert.equal(rows.every(x=>x.scheduleType==='weekly'),true)
  const existing=[{type:'expense',date:'2026-11-20',merchant:'習い事',payment_source:'現金'}]
  const after=previewRecurringEntries([plan],existing,{today:new Date(2026,10,29)})
  assert.deepEqual(after.map(x=>x.conflict),[false,false,true,false])
})
test('approval validates each weekday and prevents arbitrary manually supplied dates',()=>{
  const plan={id:'plan-00000001',name:'習い事',amount:1000,day:27,weekday:5,schedule_type:'weekly',category:'教育',payment_source:'現金',start_month:'2026-11',enabled:1}
  const expected={name:plan.name,amount:plan.amount,day:plan.day,weekday:5,scheduleType:'weekly',category:plan.category,paymentSource:'現金',startMonth:plan.start_month,date:'2026-11-13'}
  assert.equal(resolveRecurringApproval({month:'2026-11',expected},plan).date,'2026-11-13')
  assert.equal(resolveRecurringApproval({month:'2026-11',expected:{...expected,date:'2026-11-14'}},plan).code,'plan_changed')
})
test('weekly preview post sends exact date and recurrence for server verification',async()=>{
  const input=previewRecurringEntries([weekly()],[],{today:new Date(2026,10,13)})
  const seen=[]
  await postApprovedRecurringEntries(async(_,options)=>{seen.push(JSON.parse(options.body));return {created:true}},input)
  assert.deepEqual(seen.map(x=>x.expected.date),['2026-11-06','2026-11-13'])
  assert.deepEqual(seen.map(x=>x.expected.weekday),[5,5])
})
test('D1 Worker writes one weekly occurrence with unique date key, and repeat run is idempotent',async()=>{
  const inserted=new Set(),queries=[]
  const row={id:'plan-00000001',name:'習い事',day:27,weekday:5,schedule_type:'weekly',amount:1000,category:'教育',payment_source:'現金',start_month:'2026-11',posting_mode:'auto',auto_from_month:'2026-11',enabled:1}
  const db={prepare(sql){queries.push(sql);return {bind(...args){this.args=args;return this},async all(){return {results:[row]}},async run(){const key=this.args[2];if(inserted.has(key))return {meta:{changes:0}};inserted.add(key);return {meta:{changes:1}}}}}}
  const a=await postScheduledRecurring(db,{today:'2026-11-06'})
  const b=await postScheduledRecurring(db,{today:'2026-11-06'})
  const c=await postScheduledRecurring(db,{today:'2026-11-13'})
  assert.deepEqual([a.created,b.created,c.created],[1,0,1])
  assert.equal(inserted.size,2)
  assert.ok(queries.some(sql=>sql.includes('recurring_date_exclusions')))
})
test('D1 migrations, UI, API and backups persist weekly schedule and exclude date-specific rows',()=>{
  const migration=source('migrations/0013_recurring_posting_mode.sql')
  const ui=source('src/FinanceTools.vue')
  const api=source('functions/api/[[path]].js')
  const backup=source('functions/api/restore-atomic.js')
  const schema=source('schema.sql')
  assert.match(migration,/ALTER TABLE recurring_plans ADD COLUMN schedule_type/)
  assert.match(migration,/CREATE TABLE IF NOT EXISTS recurring_date_exclusions/)
  assert.match(ui,/v-model="plan.scheduleType"/)
  assert.match(ui,/v-model.number="plan.weekday"/)
  assert.match(ui,/recurringFrequencyLabel\(p\)/)
  assert.match(api,/recurringDateExclusions:/)
  assert.match(backup,/archive.recurringDateExclusions/)
  assert.match(schema,/schedule_type TEXT NOT NULL DEFAULT 'monthly'/)
})
