import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import navWorker from '../workers/fund-nav-cron.js'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const MORNING='30 15 * * *',EVENING='30 10 * * *'

function fakeDb(queries=[]){
  return {prepare(sql){
    queries.push(sql)
    if(sql.includes('FROM recurring_plans p'))
      return {bind(){return this},all:async()=>({results:[]})}
    if(sql.includes('UPDATE entries SET transfer_applied = 1'))
      return {bind(){return this},run:async()=>({meta:{changes:0}})}
    if(sql.includes('investment_holdings'))
      return {all:async()=>({results:[]})}
    if(sql.includes('INSERT INTO scheduled_job_state'))
      return {bind(){return this},run:async()=>({meta:{changes:1}})}
    throw Error('unexpected cron SQL '+sql)
  }}
}
async function fire({cron,scheduledTime,db,heartbeat=false}){
  const jobs=[]
  const original=console.log,seen=[]
  console.log=(...args)=>seen.push(args)
  try{
    await navWorker.scheduled({cron,scheduledTime:Date.parse(scheduledTime)},
      {DB:db,HEARTBEAT_ENABLED:heartbeat?'true':'false'},
      {waitUntil(p){jobs.push(p)}})
    await Promise.all(jobs)
  }finally{console.log=original}
  return {jobs,seen}
}

test('two production Cron triggers replace four; preserved 00:30/19:30 JST',()=>{
  const config=read('wrangler.nav.toml'),docs=read('scripts/deploy-nav-worker.md')
  assert.match(config,/crons = \["30 15 \* \* \*", "30 10 \* \* \*"\]/)
  assert.doesNotMatch(config,/"30 0 \* \* \*"|"15 14 \* \* \*"/)
  assert.match(config,/DAIWA_CSV_EXPERIMENT = "false"/)
  assert.match(docs,/00:30（UTC前日15:30）/)
  assert.match(docs,/19:30（UTC10:30）/)
  assert.match(docs,/2件/)
})

test('NAV and recurring use the existing D1; no new Worker or migration',()=>{
  const config=read('wrangler.nav.toml'),worker=read('workers/fund-nav-cron.js')
  assert.match(config,/name = "kakeibo-nav-sync"/)
  assert.match(config,/database_name = "kakeibo"/)
  assert.match(worker,/syncFundNav\(env\.DB,/)
  assert.match(worker,/postScheduledRecurring\(env\.DB,/)
  assert.match(worker,/applyDueSbiTransfers\(env\.DB,/)
  assert.doesNotMatch(worker,/DELETE\s+FROM|DROP\s+TABLE|investment_holdings\s+SET/i)
})

test('both daily triggers independently run recurring, SBI and (when trading) NAV',async()=>{
  for(const [cron,time,date,retry] of [
    [MORNING,'2026-11-05T15:30:00Z','2026-11-06','2026-11-05'],
    [EVENING,'2026-11-06T10:30:00Z','2026-11-06','2026-11-06']
  ]){
    const queries=[]
    const {jobs,seen}=await fire({cron,scheduledTime:time,db:fakeDb(queries)})
    assert.equal(jobs.length,3)
    assert.equal(queries.filter(sql=>sql.includes('FROM recurring_plans p')).length,1)
    assert.equal(queries.filter(sql=>sql.includes('UPDATE entries SET transfer_applied = 1')).length,1)
    assert.equal(queries.filter(sql=>sql.includes('investment_holdings')).length,1)
    assert.ok(seen.some(x=>x[0]==='SBI due-transfer sync'))
    assert.ok(seen.some(x=>x[0]==='Recurring fixed-expense sync'))
    const started=seen.find(x=>x[0]==='NAV sync started')
    assert.equal(JSON.parse(started[1]).targetNavDate,retry)
    assert.equal(JSON.parse(started[1]).cron,cron)
    assert.equal(JSON.parse(seen.find(x=>x[0]==='Recurring fixed-expense sync started')[1]).today,date)
  }
})

test('Saturday 00:30 checks Friday NAV while Saturday 19:30 avoids provider calls',async()=>{
  const morning=[]
  const saturdayMorning=await fire({cron:MORNING,scheduledTime:'2026-11-06T15:30:00Z',db:fakeDb(morning)})
  assert.equal(saturdayMorning.jobs.length,3)
  assert.equal(JSON.parse(saturdayMorning.seen.find(x=>x[0]==='NAV sync started')[1]).targetNavDate,'2026-11-06')
  assert.equal(morning.filter(sql=>sql.includes('investment_holdings')).length,1)
  const evening=[]
  const saturdayEvening=await fire({cron:EVENING,scheduledTime:'2026-11-07T10:30:00Z',db:fakeDb(evening)})
  assert.equal(saturdayEvening.jobs.length,3,'two financial tasks plus NAV skip heartbeat')
  assert.equal(evening.filter(sql=>sql.includes('investment_holdings')).length,0)
})

test('after a Japanese holiday only recurring and SBI run; skipped NAV recorded once',async()=>{
  const queries=[]
  const {jobs,seen}=await fire({cron:MORNING,scheduledTime:'2026-11-03T15:30:00Z',db:fakeDb(queries),heartbeat:true})
  assert.equal(jobs.length,3,'two financial tasks plus skip heartbeat')
  assert.ok(seen.some(x=>x[0]==='NAV sync skipped: Japan non-trading day'))
  assert.equal(queries.filter(sql=>sql.includes('investment_holdings')).length,0)
  assert.equal(queries.filter(sql=>sql.includes('INSERT INTO scheduled_job_state')).length,3)
})

test('unknown scheduled expression does not query D1 or write fund prices',async()=>{
  let touched=false
  const originalWarn=console.warn
  console.warn=()=>{}
  try{
    const jobs=[]
    await navWorker.scheduled({cron:'30 0 * * *',scheduledTime:Date.now()},
      {DB:{prepare(){touched=true;throw Error('unexpected')}}},{waitUntil(p){jobs.push(p)}})
    assert.equal(jobs.length,0)
    assert.equal(touched,false)
  }finally{console.warn=originalWarn}
})

test('scheduled work failures are logged independently on the shared Worker',async()=>{
  const errors=[],originalError=console.error,originalLog=console.log
  console.error=(...args)=>errors.push(args)
  console.log=()=>{}
  try{
    const jobs=[]
    await navWorker.scheduled({cron:EVENING,scheduledTime:Date.parse('2026-11-06T10:30:00Z')},
      {DB:null},{waitUntil(p){jobs.push(p)}})
    assert.equal(jobs.length,3)
    assert.equal((await Promise.allSettled(jobs)).filter(x=>x.status==='rejected').length,3)
    assert.ok(errors.some(x=>x[0]==='Recurring fixed-expense sync failed'))
    assert.ok(errors.some(x=>x[0]==='SBI due-transfer sync failed'))
    assert.ok(errors.some(x=>x[0]==='NAV sync failed'))
  }finally{console.error=originalError;console.log=originalLog}
})

test('worker still records each invocation with detailed logs and enabled observability',()=>{
  const config=read('wrangler.nav.toml'),worker=read('workers/fund-nav-cron.js')
  assert.match(config,/\[observability\]\s+enabled = true\s+head_sampling_rate = 1/)
  assert.match(worker,/console\.log\('NAV sync started'/)
  assert.match(worker,/console\.log\('NAV sync',JSON\.stringify\(result\)\)/)
  assert.match(worker,/console\.error\('NAV sync failed'/)
  assert.match(worker,/throw error/)
})
