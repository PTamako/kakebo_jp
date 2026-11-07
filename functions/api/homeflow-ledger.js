// Public Pages ledger projection retired: HomeFlow now uses the internal-only
// kakeibo-homeflow-bridge Worker via KAKEBO_LEDGER_SERVICE.
// No external token/session grants access and this route never queries D1.
const disabled=()=>new Response(JSON.stringify({error:'public_bridge_retired'}),{
  status:410,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}
})
export async function onRequestGet(){return disabled()}
export async function onRequest(){return disabled()}
