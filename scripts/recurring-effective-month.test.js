import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {recurringReviewWindow,validRecurringMonth} from '../src/recurring-review-window.js'
import {previewRecurringEntries,postApprovedRecurringEntries} from '../src/recurring-check.js'
import {resolveRecurringApproval} from '../functions/api/recurring-approval.js'

const schedule=(id,startMonth,extra={})=>({
  id,name:'家賃'+id,amount:101500,day:27,category:'住居費',
  paymentSource:'現金',startMonth,enabled:true,...extra
})
const now=new Date(2026,9,31,12,0,0)
test('new 9月 effective plan automatically reviews Sept and Oct without auto-posting',()=>{
  const plan=schedule('rent','2026-09')
  const window=recurringReviewWindow([plan],'2026-10')
  assert.deepEqual(window,{historicalMonths:1,clipped:false})
  const candidates=previewRecurringEntries([plan],[],{today:now,historicalMonths:window.historicalMonths})
  assert.deepEqual(candidates.map(x=>x.date),['2026-09-27','2026-10-27'])
  assert.ok(candidates.every(x=>x.startMonth==='2026-09'))
})
test('12月 effective plan never generates candidates before December',()=>{
  const plan=schedule('future','2026-12')
  const window=recurringReviewWindow([plan],'2026-10')
  assert.equal(window.historicalMonths,0)
  assert.deepEqual(previewRecurringEntries([plan],[],{today:now,historicalMonths:window.historicalMonths}),[])
  assert.deepEqual(previewRecurringEntries([plan],[],{today:new Date(2026,11,31),historicalMonths:0}).map(x=>x.month),['2026-12'])
})
test('review range tracks earliest enabled effective month, without a manual past-N-month selector',()=>{
  const plans=[schedule('sep','2026-09'),schedule('oct','2026-10'),schedule('paused','2020-01',{enabled:false}),schedule('dec','2026-12')]
  assert.equal(recurringReviewWindow(plans,'2026-10').historicalMonths,1)
  assert.equal(recurringReviewWindow([schedule('old','2010-01')],'2026-10').historicalMonths,119)
  assert.equal(recurringReviewWindow([schedule('old','2010-01')],'2026-10').clipped,true)
  assert.equal(recurringReviewWindow([],'2026-10').historicalMonths,0)
  assert.equal(validRecurringMonth('2026-09'),true)
  assert.equal(validRecurringMonth('2026-13'),false)
})
test('existing manual records remain untouched and matching duplicate fixed expense is not offered',()=>{
  const plan=schedule('rent','2026-09')
  const existing=[{date:'2026-09-27',merchant:plan.name,payment_source:'現金',type:'expense',amount:101500}]
  const window=recurringReviewWindow([plan],'2026-10')
  const candidates=previewRecurringEntries([plan],existing,{today:now,historicalMonths:window.historicalMonths})
  assert.deepEqual(candidates.map(x=>[x.month,x.conflict]),[['2026-09',true],['2026-10',false]])
})
test('server independently rejects pre-effective-month approvals',()=>{
  const p={id:'rent',name:'家賃',amount:101500,day:27,category:'住居費',payment_source:'現金',start_month:'2026-12',enabled:1}
  const result=resolveRecurringApproval({month:'2026-09',expected:{name:p.name,amount:p.amount,day:p.day,
    category:p.category,paymentSource:p.payment_source,startMonth:p.start_month,date:'2026-09-27'}},p)
  assert.equal(result.code,'before_start')
})
test('UI exposes editable effective month, automatic range and still requires explicit confirmation',()=>{
  const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  const source=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(finance,/v-model="plan.startMonth" type="month"/)
  assert.match(finance,/startMonth:plan.value.startMonth/)
  assert.match(finance,/plan.value = \{\.\.\.item, paymentSource:item.paymentSource \|\| '現金',startMonth:item.startMonth/)
  assert.match(finance,/recurringReviewWindow\(plans.value,currentRecurringMonth\(\)\)/)
  assert.match(finance, /@click="reviewRecurring">\{\{recurringListOpen \? '候補を閉じる' : '未記帳分を確認'\}\}<\/button>/)
  assert.match(finance,/postApprovedRecurringEntries\(props.api,safe\)/)
  assert.match(finance,/if\(!confirm\(summary\)\)return/)
  assert.doesNotMatch(finance,/未記帳を確認する期間|過去3か月も確認|過去12か月も確認|過去10年分も確認/)
  assert.match(finance,/今月対象 \{\{currentEligiblePlans.length\}\}件/)
  assert.match(api,/start_month=\?6/)
  assert.doesNotMatch(source,/await postApprovedRecurringEntries\(/)
})
test('review is separate from posting: preview helper makes zero API writes',async()=>{
  const plan=schedule('rent','2026-09')
  const got=previewRecurringEntries([plan],[],{today:now,historicalMonths:recurringReviewWindow([plan],'2026-10').historicalMonths})
  assert.equal(got.length,2)
  const calls=[]
  await postApprovedRecurringEntries(async (path,options)=>{calls.push([path,options]);return {created:true}},[got[0]])
  assert.equal(calls.length,1)
  assert.equal(calls[0][0],'recurring-post')
})

test('excluded recurring months are absent from read-only review, without changing ledger entries',()=>{
  const plan=schedule('rent','2026-07')
  const expense={date:'2026-09-27',merchant:'家賃rent',payment_source:'現金',type:'expense',amount:101500}
  const entries=[expense]
  const window=recurringReviewWindow([plan],'2026-10')
  const excluded=[{planId:plan.id,month:'2026-08'}]
  const preview=previewRecurringEntries([plan],entries,{today:now,historicalMonths:window.historicalMonths,excluded})
  assert.deepEqual(preview.map(row=>row.month),['2026-07','2026-09','2026-10'])
  assert.equal(preview.find(row=>row.month==='2026-09').conflict,true)
  assert.deepEqual(entries,[expense])
})

test('recurring candidate drawer and swipe-to-dismiss are both reversible',()=>{
  const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  assert.match(finance,/recurringListOpen\.value=false/)
  assert.match(finance,/:aria-expanded="recurringListOpen"/)
  assert.match(finance,/@touchstart\.passive="onRecurringTouchStart/)
  assert.match(finance,/@touchend="onRecurringTouchEnd/)
  assert.match(finance,/@click="dismissRecurring\(candidate\)"/)
  assert.match(finance,/@click="restoreRecurringExclusion\(item\)"/)
  assert.match(finance,/<summary>ゴミ箱/)
  assert.doesNotMatch(finance,/<summary>除外済み/)
  assert.match(finance,/recurringPreview\.value=recurringPreview\.value\.filter/)
  assert.match(finance,/recurringExclusions:recurringExclusionsBackup/)
})
