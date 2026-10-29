import { syncFundNav } from '../functions/api/fund-nav-sync.js'

// This is a standalone Worker, not a Pages Function.
// It has no public HTTP endpoints and cannot edit customer transactions.
export default {
  async scheduled(_event,env,ctx) {
    ctx.waitUntil((async()=>{
      const result=await syncFundNav(env.DB)
      console.log('NAV sync',JSON.stringify(result))
      if(result.failed.length)throw Error('some fund quotes could not be refreshed')
    })())
  },
  async fetch(){
    return new Response('Not found',{status:404})
  }
}
