// Minimal D1 heartbeat from the existing scheduled Worker.
// Do not store notes, merchants, amounts, fund identifiers or sensitive errors.
export const JOB_KEYS=Object.freeze(['recurring','sbi','nav'])
export async function recordScheduledJobStatus(db,job,scheduledAt,status,summary={}) {
  if(!JOB_KEYS.includes(job) || !['success','failed','skipped'].includes(status) ||
     !Number.isFinite(Date.parse(scheduledAt))) throw Error('invalid_scheduled_job_status')
  const safe={}
  for(const name of ['checked','created','skipped','failed','updated']){
    const value=summary?.[name]
    if(Number.isSafeInteger(value)&&value>=0) safe[name]=value
    else if(Array.isArray(value))safe[name]=value.length
  }
  return db.prepare(`INSERT INTO scheduled_job_state(job_key,scheduled_at,status,summary_json)
    VALUES(?1,?2,?3,?4)
    ON CONFLICT(job_key) DO UPDATE SET
      scheduled_at=excluded.scheduled_at,status=excluded.status,
      summary_json=excluded.summary_json,finished_at=CURRENT_TIMESTAMP
    WHERE excluded.scheduled_at>=scheduled_job_state.scheduled_at`)
    .bind(job,scheduledAt,status,JSON.stringify(safe)).run()
}
export async function readScheduledJobStatus(db) {
  const {results=[]}=await db.prepare(
    'SELECT job_key,scheduled_at,finished_at,status,summary_json FROM scheduled_job_state ORDER BY job_key'
  ).all()
  return results.map(x=>({
    job:x.job_key,scheduledAt:x.scheduled_at,finishedAt:x.finished_at,status:x.status,
    summary:(()=>{try{return JSON.parse(x.summary_json||'{}')}catch{return {}}})()
  }))
}
