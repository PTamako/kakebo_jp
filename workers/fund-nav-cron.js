import { syncFundNav } from '../functions/api/fund-nav-sync.js'
import { postScheduledRecurring } from '../functions/api/recurring-auto.js'
import { applyDueSbiTransfers } from '../functions/api/investment-transfer.js'
import { tokyoDateAt } from '../src/recurring-posting.js'
import { isJapanHoliday } from '../src/japan-holidays.js'
import { recordScheduledJobStatus } from '../functions/api/scheduled-job-status.js'

// Two daily UTC triggers handle all jobs without changing any financial schema.
// 00:30 JST: due recurring/SBI, plus previous trading day's missing NAV.
// 19:30 JST: first NAV fetch, plus same-day recurring/SBI recovery.
// Both financial operations are idempotent; NAV retry skips already-fresh quotes.
const EARLY_CRON='30 15 * * *' // 00:30 JST, previous UTC day
const EVENING_CRON='30 10 * * *' // 19:30 JST
const ACTIVE_CRONS=new Set([EARLY_CRON,EVENING_CRON])
const previousCivilDate=date=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10)

export default {
  async scheduled(event, env, ctx) {
    const cron = event?.cron || 'unknown'
    const scheduledTime = Number.isFinite(event?.scheduledTime)
      ? event.scheduledTime : Date.now()
    const scheduledAt = new Date(scheduledTime).toISOString()
    // Monitoring is best-effort: an unavailable heartbeat table must never
    // block booking or updating NAV. Financial work retains its own errors.
    const heartbeat = async (job,status,summary={}) => {
      if(env?.HEARTBEAT_ENABLED!=='true')return
      try { await recordScheduledJobStatus(env.DB,job,scheduledAt,status,summary) }
      catch(error) { console.warn('Cron heartbeat unavailable',job,String(error?.message||error)) }
    }

    if(!ACTIVE_CRONS.has(cron)) {
      // Unknown schedules must never change funds or financial transactions.
      console.warn('Scheduled trigger skipped: unknown cron', JSON.stringify({cron, scheduledAt}))
      return
    }
    const today=tokyoDateAt(scheduledTime)
    const isMorning=cron===EARLY_CRON
    // Primary posting at 00:30; a second idempotent chance at 19:30.
    console.log('Recurring fixed-expense sync started', JSON.stringify({cron,scheduledAt,today}))
    ctx.waitUntil((async () => {
      try {
        const result=await postScheduledRecurring(env.DB,{today})
        console.log('Recurring fixed-expense sync',JSON.stringify(result))
        await heartbeat('recurring','success',result)
      }catch(error){
        await heartbeat('recurring','failed')
        console.error('Recurring fixed-expense sync failed',String(error?.message||error))
        throw error
      }
    })())
    // Keep the SBI task independent from recurring, NAV and their failures.
    ctx.waitUntil((async () => {
      try {
        const result=await applyDueSbiTransfers(env.DB,today)
        console.log('SBI due-transfer sync',JSON.stringify(result))
        await heartbeat('sbi','success',result)
      }catch(error){
        await heartbeat('sbi','failed')
        console.error('SBI due-transfer sync failed',String(error?.message||error))
        throw error
      }
    })())
    const targetNavDate=isMorning?previousCivilDate(today):today
    // Morning retry belongs to the PREVIOUS JST trading day. It must still
    // run on Saturday for Friday NAV, but skip Sunday/public holidays.
    if (isJapanHoliday(targetNavDate)) {
      console.log('NAV sync skipped: Japan non-trading day',JSON.stringify({cron,targetNavDate}))
      ctx.waitUntil(heartbeat('nav','skipped',{skipped:1}))
      return
    }
    console.log('NAV sync started',JSON.stringify({cron,scheduledAt,targetNavDate,retry:isMorning}))
    ctx.waitUntil((async () => {
      try{
        const result=await syncFundNav(env.DB,{
          enableDaiwaCsv:env?.DAIWA_CSV_EXPERIMENT==='true'&&!isMorning,
          retryPendingNav:isMorning,
          ...(isMorning?{retryForDate:targetNavDate}:{})
        })
        console.log('NAV sync',JSON.stringify(result))
        if(result.failed.length)throw Error('some fund quotes could not be refreshed')
        await heartbeat('nav','success',result)
      }catch(error){
        await heartbeat('nav','failed')
        console.error('NAV sync failed',String(error?.message||error))
        throw error
      }
    })())
    return
  },
  async fetch() {
    return new Response('Not found', {status:404})
  }
}
