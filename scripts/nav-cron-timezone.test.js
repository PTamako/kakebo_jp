import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import navWorker from '../workers/fund-nav-cron.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('NAV Cron runs at 19:30 and retries missing MUFG NAV at 23:15 JST', () => {
  const config=read('wrangler.nav.toml')
  const docs=read('scripts/deploy-nav-worker.md')
  assert.match(config,/crons = \["30 15 \* \* \*", "30 0 \* \* \*", "30 10 \* \* \*", "15 14 \* \* \*"\]/)
  assert.match(config,/DAIWA_CSV_EXPERIMENT = "false"/)
  assert.match(docs,/日本時間19:30（UTC10:30）/)
  assert.match(docs,/23:15（UTC14:15）/)
  assert.doesNotMatch(config,/30 11 \* \* \*/)
})

test('NAV job reuses D1 prices and never creates a fresh database or changes transactions', () => {
  const config = read('wrangler.nav.toml')
  const worker = read('workers/fund-nav-cron.js')
  assert.match(config, /name = "kakeibo-nav-sync"/)
  assert.match(config, /database_name = "kakeibo"/)
  assert.match(worker, /syncFundNav\(env\.DB,/)
  assert.doesNotMatch(worker, /DELETE\s+FROM|DROP\s+TABLE|investment_holdings\s+SET/i)
})


test('the one-per-day Worker always persists logs and captures every scheduled invocation', () => {
  const config=read('wrangler.nav.toml')
  const worker=read('workers/fund-nav-cron.js')
  assert.match(config,/\[observability\]\s+enabled = true\s+head_sampling_rate = 1/)
  assert.match(worker,/console\.log\('NAV sync started'/)
  assert.match(worker,/console\.log\('NAV sync',JSON\.stringify\(result\)\)/)
  assert.match(worker,/console\.error\('NAV sync failed'/)
  assert.match(worker,/throw error/)
})

test('scheduled event prints start and successful summary even when there are no supported holdings', async () => {
  const output=[]
  const original=console.log
  console.log=(...args)=>output.push(args)
  try{
    let job
    const ctx={waitUntil(promise){job=promise}}
    const db={prepare(){return{all:async()=>({results:[]})}}}
    await navWorker.scheduled({cron:'30 10 * * *',scheduledTime:Date.parse('2026-10-30T10:30:00Z')},{DB:db},ctx)
    assert.ok(job,'Worker must keep async sync task alive via waitUntil')
    await job
    const started=output.find(([name])=>name==='NAV sync started')
    const complete=output.find(([name])=>name==='NAV sync')
    assert.ok(started)
    assert.equal(JSON.parse(started[1]).cron,'30 10 * * *')
    assert.equal(JSON.parse(started[1]).scheduledAt,'2026-10-30T10:30:00.000Z')
    assert.ok(complete)
    assert.deepEqual(JSON.parse(complete[1]),{checked:0,updated:[],unchanged:[],failed:[],unsupported:[]})
  }finally{console.log=original}
})

test('scheduled failures log an explicit error and remain observable as failed invocations',async()=>{
  const originalLog=console.log
  const originalError=console.error
  const events=[]
  console.log=(...args)=>events.push(args)
  console.error=(...args)=>events.push(args)
  try{
    let job
    await navWorker.scheduled({cron:'30 10 * * *',scheduledTime:Date.parse('2026-10-30T10:30:00Z')},{DB:null},{waitUntil(p){job=p}})
    assert.ok(job)
    await assert.rejects(job,/missing_d1_binding/)
    assert.ok(events.some(args=>args[0]==='NAV sync started'))
    assert.ok(events.some(args=>args[0]==='NAV sync failed'&&String(args[1]).includes('missing_d1_binding')))
  }finally{console.log=originalLog;console.error=originalError}
})

test('existing NAV Worker handles scheduled fixed-expense dates without running NAV sync', async () => {
  const calls=[]
  const output=[]
  const originalLog=console.log
  console.log=(...args)=>output.push(args)
  try {
    for(const [cron,time,date] of [
      ['30 15 * * *','2026-11-01T15:30:00Z','2026-11-02'],
      ['30 0 * * *','2026-11-02T00:30:00Z','2026-11-02']
    ]) {
      let job
      const db={prepare(sql){
        calls.push(sql)
        if(!sql.includes('FROM recurring_plans p')) throw Error('unexpected NAV query during recurring job')
        return {bind(...args){assert.equal(args[0], '2026-11');return this},all:async()=>({results:[]})}
      }}
      await navWorker.scheduled({cron,scheduledTime:Date.parse(time)},{DB:db},
        {waitUntil(p){job=p}})
      assert.ok(job)
      await job
      const summary=output.filter(x=>x[0]==='Recurring fixed-expense sync').at(-1)
      assert.equal(JSON.parse(summary[1]).date,date)
    }
    assert.equal(calls.length,2)
    assert.equal(output.filter(x=>x[0]==='NAV sync').length,0)
  } finally { console.log=originalLog }
})

test('unknown cron does not create entries or modify fund prices', async () => {
  const originalWarn=console.warn
  console.warn=()=>{}
  try {
    let invoked=false
    await navWorker.scheduled({cron:'1 1 * * *',scheduledTime:Date.now()},
      {DB:{prepare(){invoked=true;throw Error('should not query database')}}},
      {waitUntil(){invoked=true}})
    assert.equal(invoked,false)
  }finally{console.warn=originalWarn}
})

test('fixed-expense job failure is logged independently of the NAV job', async () => {
  const events=[]
  const originalLog=console.log, originalError=console.error
  console.log=(...args)=>events.push(args)
  console.error=(...args)=>events.push(args)
  try {
    let job
    await navWorker.scheduled({cron:'30 15 * * *',scheduledTime:Date.parse('2026-11-01T15:30:00Z')},
      {DB:null},{waitUntil(p){job=p}})
    await assert.rejects(job)
    assert.ok(events.some(args=>args[0]==='Recurring fixed-expense sync failed'))
    assert.ok(!events.some(args=>args[0]==='NAV sync started'))
  }finally{console.log=originalLog;console.error=originalError}
})
