import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../functions/api/_middleware.js'
import cronWorker from '../workers/fund-nav-cron.js'
import { validateBackup, chunkRestoreSettings } from '../src/finance-tools.js'

const backup=()=>({format:'kakeibo-ledger-backup',version:4,entries:[],plans:[],customRules:[]})
test('authenticated D1 snapshot contains exact default matching rules, not internal markers',async()=>{
  let calls=0
  const res=await onRequest({
    request:new Request('https://example.test/api/backup-snapshot'),
    next:async()=>Response.json(backup()),
    env:{DB:{prepare(sql){
      assert.match(sql,/FROM rules/)
      return {all:async()=>{calls++;return {results:[{keyword:'test-store',category:'日用品'}]}}}
    }}}
  })
  assert.equal(res.status,200)
  assert.deepEqual((await res.json()).defaultRules,[{keyword:'test-store',category:'日用品'}])
  assert.equal(calls,1)
})
test('backup middleware never queries D1 after authentication failure',async()=>{
  let used=false
  const res=await onRequest({
    request:new Request('https://example.test/api/backup-snapshot'),
    next:async()=>Response.json({error:'unauthorized'},{status:401}),
    env:{DB:{prepare(){used=true;throw Error('must not read')}}}
  })
  assert.equal(res.status,401)
  assert.equal(used,false)
})
test('empty D1 dictionary fails closed rather than exporting an incomplete backup',async()=>{
  const res=await onRequest({
    request:new Request('https://example.test/api/backup-snapshot'),
    next:async()=>Response.json(backup()),
    env:{DB:{prepare:()=>({all:async()=>({results:[]})})}}
  })
  assert.equal(res.status,503)
})
test('unrelated API routes bypass dictionary backup work',async()=>{
  const res=await onRequest({request:new Request('https://example.test/api/rules'),next:async()=>Response.json({ok:true}),env:{}})
  assert.equal((await res.json()).ok,true)
})
test('NAV on a public holiday skips vendor calls while recurring and SBI still run',async()=>{
  const queries=[],pending=[]
  const db={prepare(sql){
    queries.push(sql)
    if(sql.includes('FROM recurring_plans p'))return {bind(){return this},all:async()=>({results:[]})}
    if(sql.includes('UPDATE entries SET transfer_applied = 1'))
      return {bind(){return this},run:async()=>({meta:{changes:0}})}
    if(sql.includes('INSERT INTO scheduled_job_state'))
      return {bind(){return this},run:async()=>({meta:{changes:1}})}
    throw Error('holiday Cron should not read holdings: '+sql)
  }}
  await cronWorker.scheduled({cron:'30 10 * * *',scheduledTime:Date.parse('2026-11-03T10:30:00Z')},
    {DB:db,HEARTBEAT_ENABLED:'true'},{waitUntil(p){pending.push(p)}})
  await Promise.all(pending)
  assert.equal(queries.filter(sql=>/investment_holdings/.test(sql)).length,0)
  assert.equal(queries.filter(sql=>/INSERT INTO scheduled_job_state/.test(sql)).length,3)
})

test('weekend NAV is skipped at 19:30 but prior Friday can be retried on Saturday 00:30',async()=>{
  const queries=[],pending=[]
  const db={prepare(sql){
    queries.push(sql)
    if(sql.includes('FROM recurring_plans p'))return {bind(){return this},all:async()=>({results:[]})}
    if(sql.includes('UPDATE entries SET transfer_applied = 1'))
      return {bind(){return this},run:async()=>({meta:{changes:0}})}
    if(sql.includes('investment_holdings'))return {all:async()=>({results:[]})}
    if(sql.includes('INSERT INTO scheduled_job_state'))
      return {bind(){return this},run:async()=>({meta:{changes:1}})}
    throw Error('unexpected Cron SQL '+sql)
  }}
  const ctx={waitUntil(p){pending.push(p)}}
  await cronWorker.scheduled({cron:'30 10 * * *',scheduledTime:Date.parse('2026-11-07T10:30:00Z')},
    {DB:db,HEARTBEAT_ENABLED:'true'},ctx)
  await Promise.all(pending.splice(0))
  assert.equal(queries.filter(sql=>/investment_holdings/.test(sql)).length,0)
  queries.length=0
  await cronWorker.scheduled({cron:'30 15 * * *',scheduledTime:Date.parse('2026-11-06T15:30:00Z')},
    {DB:db,HEARTBEAT_ENABLED:'true'},ctx)
  await Promise.all(pending.splice(0))
  assert.equal(queries.filter(sql=>/investment_holdings/.test(sql)).length,1)
})

test('full 775-keyword dictionary remains intact across bounded restore stages',()=>{
  const defaults=Array.from({length:775},(_,i)=>({keyword:'fallback-'+i,category:'日用品'}))
  const archive=validateBackup({...backup(),defaultRules:defaults})
  const chunks=chunkRestoreSettings(archive,80)
  assert.ok(chunks.every(c=>(c.defaultRules||[]).length<=80))
  assert.equal(chunks.flatMap(c=>c.defaultRules||[]).length,775)
  assert.deepEqual(chunks.flatMap(c=>c.defaultRules||[]),defaults)
})
test('backup rejects internal migration marker masquerading as a matching rule',()=>{
  assert.throws(()=>validateBackup({...backup(),defaultRules:[{keyword:'__category__:通信',category:'通信'}]}))
})
