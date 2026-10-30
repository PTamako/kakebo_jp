import { syncFundNav } from '../functions/api/fund-nav-sync.js'

// This is a standalone Worker, not a Pages Function.
// It has no public HTTP endpoints and cannot edit customer transactions.
export default {
  async scheduled(event,env,ctx) {
    // Log at invocation time, not only after the NAV provider responds.
    console.log('NAV sync started',JSON.stringify({
      cron:event?.cron||'unknown',
      scheduledAt:Number.isFinite(event?.scheduledTime)
        ?new Date(event.scheduledTime).toISOString():new Date().toISOString()
    }))
    ctx.waitUntil((async()=>{
      try{
        const result=await syncFundNav(env.DB)
        console.log('NAV sync',JSON.stringify(result))
        if(result.failed.length)throw Error('some fund quotes could not be refreshed')
      }catch(error){
        console.error('NAV sync failed',String(error?.message||error))
        throw error
      }
    })())
  },
  async fetch(){
    return new Response('Not found',{status:404})
  }
}
