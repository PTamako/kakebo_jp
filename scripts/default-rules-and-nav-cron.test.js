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
test('NAV Cron on a public holiday records a skip without querying fund holdings',async()=>{
  const queries=[],pending=[]
  const db={prepare(sql){queries.push(sql);return {bind(){return this},async run(){return {meta:{changes:1}}}}}}
  await cronWorker.scheduled({cron:'30 10 * * *',scheduledTime:Date.parse('2026-11-03T10:30:00Z')},
    {DB:db,HEARTBEAT_ENABLED:'true'},{waitUntil(p){pending.push(p)}})
  await Promise.all(pending)
  assert.equal(queries.length,1)
  assert.match(queries[0],/INSERT INTO scheduled_job_state/)
})
test('NAV Cron on weekends records a skip; trading days still query holdings',async()=>{
  const queries=[],pending=[]
  const ctx={waitUntil(p){pending.push(p)}}
  const db={prepare(sql){queries.push(sql);return {bind(){return this},
    async run(){return {meta:{changes:1}}},async all(){return {results:[]}}}}}
  await cronWorker.scheduled({cron:'15 14 * * *',scheduledTime:Date.parse('2026-11-07T14:15:00Z')},
    {DB:db,HEARTBEAT_ENABLED:'true'},ctx)
  await Promise.all(pending.splice(0))
  assert.equal(queries.length,1)
  assert.match(queries[0],/INSERT INTO scheduled_job_state/)
  queries.length=0
  await cronWorker.scheduled({cron:'30 10 * * *',scheduledTime:Date.parse('2026-11-04T10:30:00Z')},
    {DB:db,HEARTBEAT_ENABLED:'true'},ctx)
  await Promise.all(pending)
  assert.ok(queries.some(sql=>/investment_holdings/.test(sql)))
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
