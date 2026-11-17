// Internal-only Cloudflare Service Binding adapter for existing Pages finance
// execution routes. This reuses the SAME Kakeibo production D1, never creates
// another Worker/D1/Preview, and has no public URL.
// CRITICAL: these target handlers still independently verify scoped HMAC,
// HomeFlow approval proof, actor/CAS and immutable D1 journals.
import { onRequest as approvedAction } from '../functions/api/internal/approved-actions/[[path]].js';
import { approvedBankTransferRoute } from '../functions/api/internal/bank-transfers/[[path]].js';
import { onRequest as approvedCardPurchase } from '../functions/api/internal/card-purchases/[[path]].js';
import { onRequest as approvedPoints } from '../functions/api/internal/points-actions/[[path]].js';
import { onRequest as approvedPrepaid } from '../functions/api/internal/prepaid-actions/[[path]].js';
import { onRequest as approvedSbiCash } from '../functions/api/internal/sbi-cash-actions/[[path]].js';
import { onRequest as approvedSharedEntry } from '../functions/api/internal/shared-entries/[[path]].js';
import { onRequest as recurringFinanceReceipt } from '../functions/api/internal/recurring-finance/receipt.js';
import { onRequest as documentFinance } from '../functions/api/internal/document-finance/[[path]].js';

const actionRoutes=Object.freeze({
 'approved-actions':(request,env,action)=>approvedAction({request,env,params:{path:[action]}}),
 'bank-transfers':(request,env,action)=>approvedBankTransferRoute(request,env,[action]),
 'card-purchases':(request,env,action)=>approvedCardPurchase({request,env,params:{path:[action]}}),
 'points-actions':(request,env,action)=>approvedPoints({request,env,params:{path:[action]}}),
 'prepaid-actions':(request,env,action)=>approvedPrepaid({request,env,params:{path:[action]}}),
 'sbi-cash-actions':(request,env,action)=>approvedSbiCash({request,env,params:{path:[action]}}),
 'shared-entries':(request,env,action)=>approvedSharedEntry({request,env,params:{path:[action]}}),
 'document-finance':(request,env,action)=>documentFinance({request,env,params:{path:[action]}})
});
const denied=(code,status=403)=>Response.json({ok:false,code,applied:false},
 {status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function routeInternalFinance(request,env){
 const url=new URL(request.url);
 // Never accept GETs or arbitrary user-chosen routes as a target executor.
 const path=/^\/api\/internal\/([a-z-]+)\/(execute|receipt|preview)$/.exec(url.pathname);
 const recurring=url.pathname==='/api/internal/recurring-finance/receipt';
 if(!path&&!recurring)return null;
 if(request.method!=='POST'||url.search||url.hash||
   request.headers.has('cookie')||request.headers.has('authorization')||
   request.headers.has('origin')||
   request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return denied('INTERNAL_EXECUTION_BACKCHANNEL_ONLY');
 if(!env?.DB?.prepare)return denied('INTERNAL_EXECUTION_DB_UNAVAILABLE',503);
 if(recurring)return recurringFinanceReceipt({request,env});
 const router=Object.hasOwn(actionRoutes,path[1])?actionRoutes[path[1]]:null;
 if(!router||path[2]==='preview'&&path[1]!=='shared-entries')return denied('INTERNAL_EXECUTION_ROUTE_UNKNOWN',404);
 // No privileged actor is fabricated: only target handler can authenticate
 // caller proof + approve execution. Never fallback to Pages HTTP fetch.
 return router(request,env,path[2]);
}
