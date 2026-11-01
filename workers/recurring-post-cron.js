import { postScheduledRecurring } from '../functions/api/recurring-auto.js'
import { tokyoDateAt } from '../src/recurring-posting.js'

// Dedicated Worker. No public API, no automatic schema migrations or seed data.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async()=>{
      const today = tokyoDateAt(event?.scheduledTime || Date.now())
      const result = await postScheduledRecurring(env.DB,{today})
      console.log('Recurring fixed-expense sync', JSON.stringify(result))
    })().catch(error=>{
      console.error('Recurring fixed-expense sync failed',String(error?.message || error))
      throw error
    }))
  },
  async fetch() { return new Response('Not found',{status:404}) }
}
