import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { previewRecurringEntries } from '../src/recurring-check.js'

const fixed = (overrides={}) => ({
  id:'preview-plan-00001',name:'家賃',amount:101500,day:27,
  scheduleType:'monthly',weekday:5,category:'居住',paymentSource:'現金',
  startMonth:'2026-07',enabled:true,postingMode:'auto',...overrides
})

test('November 26 previews November 27 but never November 28',()=>{
  const p=fixed()
  const options={today:new Date(2026,10,26,12),historicalMonths:0}
  assert.deepEqual(previewRecurringEntries([p],[],options).map(x=>x.date),[])
  const entries=previewRecurringEntries([p],[],{...options,previewDaysAhead:1})
  assert.deepEqual(entries.map(x=>[x.date,x.upcoming]),[['2026-11-27',true]])
  assert.equal(entries[0].conflict,false)
})

test('the exact next day crosses December 1 and February month ends correctly',()=>{
  const dec=fixed({startMonth:'2026-12',day:1})
  const end=previewRecurringEntries([dec],[],{today:new Date(2026,10,30,12),previewDaysAhead:1})
  assert.deepEqual(end.map(x=>x.date),['2026-12-01'])
  assert.equal(end[0].upcoming,true)
  const feb=fixed({startMonth:'2028-02',day:31})
  const leap=previewRecurringEntries([feb],[],{today:new Date(2028,1,28,12),previewDaysAhead:1})
  assert.deepEqual(leap.map(x=>x.date),['2028-02-29'])
  assert.deepEqual(previewRecurringEntries([feb],[],{today:new Date(2028,1,27,12),previewDaysAhead:1}),[])
})

test('tomorrow recurring previews respect exclusions, manual existing records and the following week',()=>{
  const p=fixed({scheduleType:'weekly',weekday:5,startMonth:'2026-11'})
  const today=new Date(2026,10,5,12)
  const preview=()=>previewRecurringEntries([p],[],{today,previewDaysAhead:1})
  assert.deepEqual(preview().map(x=>x.date),['2026-11-06'])
  assert.deepEqual(previewRecurringEntries([p],[],{
    today,previewDaysAhead:1,excluded:[{planId:p.id,date:'2026-11-06',month:'2026-11'}]
  }),[])
  const manual=[{date:'2026-11-06',merchant:'家賃',payment_source:'現金',type:'expense',amount:101500}]
  assert.equal(previewRecurringEntries([p],manual,{today,previewDaysAhead:1})[0].conflict,true)
  const nextWeek=previewRecurringEntries([p],[],{
    today:new Date(2026,10,12,12),previewDaysAhead:1,
    excluded:[{planId:p.id,date:'2026-11-06',month:'2026-11'}]
  })
  assert.deepEqual(nextWeek.map(x=>x.date),['2026-11-13'])
})

test('UI clearly separates tomorrow-only exclusion from due entries and keeps mobile/iPad layouts',()=>{
  const ui=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  assert.match(ui, /previewDaysAhead:1/)
  assert.match(ui, /recurringTomorrowEntries/)
  assert.match(ui, /recurringDueEntries/)
  assert.match(ui, /<h4>明日の記帳予定<\/h4>/)
  assert.match(ui, /この回を除外/)
  assert.match(ui, /<h4>未記帳分<\/h4>/)
  assert.match(ui, /v-for="candidate in recurringTomorrowEntries"/)
  assert.match(ui, /v-for="candidate in recurringDueEntries"/)
  assert.match(ui, /selectedRecurring = computed\(\(\) => recurringDueEntries.value.filter/)
  assert.match(ui, /const safe=selectedRecurring.value.filter\(row=>row.date<=today\)/)
  assert.match(ui, /@media\(min-width:680px\)\{\s*\.finance-tools \.recurring-review-panel/)
  assert.match(ui, /\.recurring-upcoming-item\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)
})
