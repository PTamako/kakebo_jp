import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import navWorker from '../workers/fund-nav-cron.js'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('NAV Cron retry is exactly 21:15 JST (12:15 UTC) every day', () => {
  const config = read('wrangler.nav.toml')
  const docs = read('scripts/deploy-nav-worker.md')
  const match = config.match(/^crons\s*=\s*\["(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*"\]/m)
  assert.ok(match, 'expected one daily cron at UTC time')
  const [, minutes, utcHour] = match
  assert.equal(Number(minutes), 15)
  assert.equal(Number(utcHour), 12)
  assert.equal((Number(utcHour) + 9) % 24, 21)
  assert.match(docs, /日本時間21:15（UTC12:15）/)
  assert.doesNotMatch(config, /30 11 \* \* \*/)
})

test('NAV job reuses D1 prices and never creates a fresh database or changes transactions', () => {
  const config = read('wrangler.nav.toml')
  const worker = read('workers/fund-nav-cron.js')
  assert.match(config, /name = "kakeibo-nav-sync"/)
  assert.match(config, /database_name = "kakeibo"/)
  assert.match(worker, /syncFundNav\(env\.DB\)/)
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
    await navWorker.scheduled({cron:'15 12 * * *',scheduledTime:Date.parse('2026-10-30T12:15:00Z')},{DB:db},ctx)
    assert.ok(job,'Worker must keep async sync task alive via waitUntil')
    await job
    const started=output.find(([name])=>name==='NAV sync started')
    const complete=output.find(([name])=>name==='NAV sync')
    assert.ok(started)
    assert.equal(JSON.parse(started[1]).cron,'15 12 * * *')
    assert.equal(JSON.parse(started[1]).scheduledAt,'2026-10-30T12:15:00.000Z')
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
    await navWorker.scheduled({cron:'15 12 * * *',scheduledTime:Date.parse('2026-10-30T12:15:00Z')},{DB:null},{waitUntil(p){job=p}})
    assert.ok(job)
    await assert.rejects(job,/missing_d1_binding/)
    assert.ok(events.some(args=>args[0]==='NAV sync started'))
    assert.ok(events.some(args=>args[0]==='NAV sync failed'&&String(args[1]).includes('missing_d1_binding')))
  }finally{console.log=originalLog;console.error=originalError}
})
