import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {recurringPlanNextStatus, recurringPlanNextLabel} from '../src/recurring-next-status.js'
import {recurringRequestId} from '../src/recurring-posting.js'

const commute={id:'d5532cff-6474-4bf2-a674-06d886d63fc7',
  name:'京成高砂駅⇄江戸川駅（通勤）',amount:292,paymentSource:'Suica',
  startMonth:'2026-11',scheduleType:'workday',day:1,weekday:1,
  postingMode:'auto',enabled:true}
const booked=(plan,date,overrides={})=>({
  type:'expense',date,merchant:plan.name,payment_source:plan.paymentSource,
  client_request_id:recurringRequestId(plan.id,plan.scheduleType==='monthly'?date.slice(0,7):date),
  ...overrides
})
const status=(plan,entries=[],exclusions=[],today='2026-11-02',afterAutoWindow=true)=>
  recurringPlanNextStatus(plan,entries,exclusions,{today,afterAutoWindow})

test('real Nov 2 commute: already booked at D1, Nov 3 holiday skipped, next Nov 4',()=>{
  const result=status(commute,[booked(commute,'2026-11-02')])
  assert.deepEqual(result,{state:'next',date:'2026-11-04'})
  assert.equal(recurringPlanNextLabel(result),'次回 11/04')
})
test('clock passing 09:30 is NOT proof a Cron created an entry',()=>{
  assert.deepEqual(status(commute),{state:'missing',date:'2026-11-02'})
  assert.deepEqual(status(commute,[],[],'2026-11-02',false),{state:'today',date:'2026-11-02'})
  assert.equal(recurringPlanNextLabel(status(commute)),'未記帳 11/02')
})
test('unbooked earlier workday stays missing, not silently advanced after later Cron',()=>{
  assert.deepEqual(status(commute,[],[],'2026-11-05'),{state:'missing',date:'2026-11-02'})
  assert.deepEqual(status(commute,[booked(commute,'2026-11-02')],[],'2026-11-05'),
    {state:'missing',date:'2026-11-04'})
})
test('prior month rent history is handled separately; the compact next date shows Nov 27',()=>{
  const rent={...commute,id:'rent-uuid',name:'家賃',startMonth:'2026-07',
    scheduleType:'monthly',day:27,paymentSource:'現金'}
  assert.deepEqual(status(rent),{state:'next',date:'2026-11-27'})
  assert.deepEqual(status(rent,[booked(rent,'2026-11-27')]),
    {state:'next',date:'2026-12-27'})
  assert.deepEqual(status(rent,[],[], '2026-11-28'),
    {state:'missing',date:'2026-11-27'})
})
test('manual weekly class next Friday, due today remains today until manually booked',()=>{
  const language={...commute,id:'language',name:'日本語交流会',amount:100,
    scheduleType:'weekly',weekday:5,postingMode:'manual',paymentSource:'現金'}
  assert.deepEqual(status(language),{state:'next',date:'2026-11-06'})
  assert.deepEqual(status(language,[],[],'2026-11-06',true),
    {state:'today',date:'2026-11-06'})
  assert.deepEqual(status(language,[booked(language,'2026-11-06')],[],'2026-11-06'),
    {state:'next',date:'2026-11-13'})
  assert.deepEqual(status(language,[],[],'2026-11-07'),
    {state:'missing',date:'2026-11-06'})
})
test('date and month exclusion skip scheduled dates without writing fake expenses',()=>{
  assert.deepEqual(status(commute,[booked(commute,'2026-11-02')],[{planId:commute.id,date:'2026-11-04'}]),
    {state:'next',date:'2026-11-05'})
  assert.deepEqual(status(commute,[],[{planId:commute.id,month:'2026-11'}]),
    {state:'next',date:'2026-12-01'})
  const rent={...commute,id:'rent-uuid',scheduleType:'monthly',day:27}
  assert.deepEqual(status(rent,[],[{planId:'rent-uuid',month:'2026-11'}]),
    {state:'next',date:'2026-12-27'})
})
test('only exact amount/source? by design matching same name+payment+period, never different card',()=>{
  const wrong=booked(commute,'2026-11-02',{client_request_id:'another',payment_source:'現金'})
  assert.deepEqual(status(commute,[wrong]),{state:'missing',date:'2026-11-02'})
  assert.deepEqual(status(commute,[{...wrong,payment_source:'Suica'}]),
    {state:'next',date:'2026-11-04'})
  assert.deepEqual(status(commute,[booked(commute,'2026-11-02',{merchant:'旧名称'})]),
    {state:'next',date:'2026-11-04'},'stable request ID counts even if plan was renamed')
})
test('stopped plans and incomplete data fail safely',()=>{
  assert.deepEqual(status({...commute,enabled:false}),{state:'stopped',date:null})
  assert.equal(recurringPlanNextLabel(status({...commute,enabled:false})),'停止中')
  assert.deepEqual(status(commute,[],[],undefined),{state:'missing',date:'2026-11-02'})
  assert.equal(recurringPlanNextLabel({state:'unknown',date:null}),'確認中')
})
test('Vue displays ledger-aware status, uses explicit D1-loaded state and refreshes on return',()=>{
  const ui=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  assert.match(ui,/recurringPlanNextStatus\(item,rows\.value,recurringExclusions\.value/)
  assert.match(ui,/recurringExclusionsReady\.value/)
  assert.match(ui,/recurringPlanNextLabel\(recurringStatusFor\(p\)\)/)
  assert.match(ui,/visibilitychange/)
  assert.match(ui,/MANAGEMENT_LEDGER_TTL_MS/)
  assert.doesNotMatch(ui,/nextRecurringDate\(p,new Date\(\)\.toLocaleDateString/)
})
