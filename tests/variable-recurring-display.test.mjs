import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {selectPendingBill} from '../src/variable-recurring-display.js'
const plan={id:'octopus',startMonth:'2026-10',intervalMonths:1}
const draft=(periodMonth,amountJpy)=>({planId:'octopus',periodMonth,amountJpy,status:'draft'})
test('synced October draft remains visible in November',()=>{
 assert.deepEqual(selectPendingBill(plan,[draft('2026-10',1987)]),draft('2026-10',1987))
})
test('latest outstanding draft wins over posted bills and other plans',()=>{
 const bills=[draft('2026-09',1000),draft('2026-10',1987),
  {planId:'octopus',periodMonth:'2026-11',amountJpy:1990,status:'posted'},
  {planId:'other',periodMonth:'2026-12',amountJpy:900,status:'draft'}]
 assert.deepEqual(selectPendingBill(plan,bills),draft('2026-10',1987))
 assert.equal(selectPendingBill(plan,bills.filter(b=>b.status==='posted')),null)
})
test('variable-cost list and review button both use the pending service month',()=>{
 const component=readFileSync(new URL('../src/VariableRecurringCosts.vue',import.meta.url),'utf8')
 assert.match(component,/const displayedPeriod=p=>selectPendingBill\(p,bills\.value\)\?\.periodMonth\|\|latestPeriod\(p\)/)
 assert.match(component,/const periodMonth=displayedPeriod\(p\)/)
 assert.match(component,/<span class="plan-month">\{\{displayedPeriod\(p\)\}\}/)
})
