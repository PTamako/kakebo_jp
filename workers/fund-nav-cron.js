import { syncFundNav } from '../functions/api/fund-nav-sync.js'
import { postScheduledRecurring } from '../functions/api/recurring-auto.js'
import { applyDueSbiTransfers } from '../functions/api/investment-transfer.js'
import { tokyoDateAt } from '../src/recurring-posting.js'
import { isJapanHoliday } from '../src/japan-holidays.js'
import { recordScheduledJobStatus } from '../functions/api/scheduled-job-status.js'

// One D1-bound scheduled Worker: independent NAV, recurring-expense and SBI transfer jobs.
// Production redeploy refresh: route each scheduled trigger independently; no D1 migration.
// Keep the original NAV cron behavior and trigger a D1 write only on the
// dedicated fixed-expense times. A NAV provider failure never blocks entries.
const NAV_CRONS = new Set(['30 10 * * *', '15 14 * * *'])
const RECURRING_CRONS = new Set(['30 15 * * *', '30 0 * * *'])

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

    if (RECURRING_CRONS.has(cron)) {
      const today = tokyoDateAt(scheduledTime)
      console.log('Recurring fixed-expense sync started', JSON.stringify({cron, scheduledAt, today}))
      ctx.waitUntil((async () => {
        try {
          const result = await postScheduledRecurring(env.DB, {today})
          console.log('Recurring fixed-expense sync', JSON.stringify(result))
          await heartbeat('recurring','success',result)
        } catch (error) {
          await heartbeat('recurring','failed')
          console.error('Recurring fixed-expense sync failed', String(error?.message || error))
          throw error
        }
      })())
      // Independent task: even if fixed-expense posting fails, due SBI transfers
      // are still processed, and a retry never books them twice.
      ctx.waitUntil((async () => {
        try {
          const result = await applyDueSbiTransfers(env.DB, today)
          console.log('SBI due-transfer sync', JSON.stringify(result))
          await heartbeat('sbi','success',result)
        } catch (error) {
          await heartbeat('sbi','failed')
          console.error('SBI due-transfer sync failed', String(error?.message || error))
          throw error
        }
      })())
      return
    }

    if (NAV_CRONS.has(cron)) {
      // Japan weekends and statutory holidays do not publish new fund NAVs.
      // Avoid redundant HTTP requests; preserve last known D1 quotes unchanged.
      const today = tokyoDateAt(scheduledTime)
      if (isJapanHoliday(today)) {
        console.log('NAV sync skipped: Japan non-trading day', JSON.stringify({cron,today}))
        return
      }
      // Both official NAV cron paths remain unchanged on Japanese trading days.
      console.log('NAV sync started', JSON.stringify({cron, scheduledAt}))
      ctx.waitUntil((async () => {
        try {
          const result = await syncFundNav(env.DB, {
            enableDaiwaCsv: env?.DAIWA_CSV_EXPERIMENT === 'true',
            retryPendingNav: cron === '15 14 * * *'
          })
          console.log('NAV sync',JSON.stringify(result))
          if (result.failed.length) throw Error('some fund quotes could not be refreshed')
          await heartbeat('nav','success',result)
        } catch (error) {
          await heartbeat('nav','failed')
          console.error('NAV sync failed', String(error?.message || error))
          throw error
        }
      })())
      return
    }

    // Unknown schedules must never change funds or financial transactions.
    console.warn('Scheduled trigger skipped: unknown cron', JSON.stringify({cron, scheduledAt}))
  },
  async fetch() {
    return new Response('Not found', {status:404})
  }
}
