import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { recordScheduledJobStatus,readScheduledJobStatus } from '../functions/api/scheduled-job-status.js'
test('cron heartbeat is monotonic, separate from all financial tables',async()=>{
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE scheduled_job_state(job_key TEXT PRIMARY KEY,scheduled_at TEXT,finished_at TEXT DEFAULT CURRENT_TIMESTAMP,status TEXT,summary_json TEXT);`)
  const db={prepare(sql){return {bind(...args){return {async run(){return sqlite.prepare(sql).run(...args)}}},async all(){return {results:sqlite.prepare(sql).all()}}}}}
  await recordScheduledJobStatus(db,'nav','2026-11-07T10:30:00.000Z','success',{updated:3,amount:900000,failed:['bad']})
  await recordScheduledJobStatus(db,'nav','2026-11-07T09:30:00.000Z','failed')
  const [row]=await readScheduledJobStatus(db)
  assert.equal(row.status,'success')
  assert.deepEqual(row.summary,{failed:1,updated:3})
  assert.equal(JSON.stringify(row).includes('900000'),false)
  await recordScheduledJobStatus(db,'sbi','2026-11-07T00:30:00.000Z','failed')
  assert.equal((await readScheduledJobStatus(db)).length,2)
  await assert.rejects(()=>recordScheduledJobStatus(db,'unknown','2026-11-07T10:30:00.000Z','success'))
  sqlite.close()
})
