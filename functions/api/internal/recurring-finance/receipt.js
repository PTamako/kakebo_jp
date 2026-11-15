// Backend-only immutable monthly Kakeibo journal receipt for HomeFlow's
// independent read-back. The original ledger is NEVER written by this route.
import {recurringFinanceReceipt} from '../../family-finance/recurring-ledger.js'
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const deny=(code,s=403)=>Response.json({ok:false,code,ledger_applied:false},
 {status:s,headers:{'cache-control':'no-store'}})
const fields=['occurrence_id','policy_id','household_id','member_user_id',
 'plan_resource_id','plan_payload_sha256','source_account_version','period_key',
 'due_date','amount_jpy','entry_intent_sha256']
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',')
async function sign(secret,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const sig=await crypto.subtle.sign('HMAC',key,enc.encode(
  'homeflow:recurring-finance-receipt\n'+stamp+'\n'+raw))
 return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')
}
export async function recurringFinanceIndependentReceipt(req,env){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_RECURRING_EXECUTION_ENABLED!=='true'||!env.DB?.prepare||
  !hex.test(env.KAKEIBO_RECURRING_RECEIPT_SECRET||''))
  return deny('RECURRING_RECEIPT_DISABLED',503)
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||
  req.headers.get('x-approval-client')!=='homeflow-recurring-finance'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('RECURRING_RECEIPT_BACKEND_ONLY')
 const stamp=req.headers.get('x-approval-timestamp')||'',sig=req.headers.get('x-approval-signature')||''
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!hex.test(sig))
  return deny('RECURRING_RECEIPT_EXPIRED_SIGNATURE')
 let data,raw
 try{raw=await req.text();data=raw.length<=1400?JSON.parse(raw):null}catch{return deny('RECURRING_RECEIPT_BODY',400)}
 if(!exact(data,fields)||!id.test(data.occurrence_id)||!uuid.test(data.policy_id)||
  !id.test(data.plan_resource_id)||!hex.test(data.plan_payload_sha256)||
  !hex.test(data.entry_intent_sha256)||typeof data.household_id!=='string'||
  typeof data.member_user_id!=='string'||!Number.isSafeInteger(data.source_account_version)||
  data.source_account_version<1||!Number.isSafeInteger(data.amount_jpy)||
  data.amount_jpy<1||data.amount_jpy>10000000)
  return deny('RECURRING_RECEIPT_BODY',400)
 const expected=await sign(env.KAKEIBO_RECURRING_RECEIPT_SECRET,stamp,raw)
 // Constant-time comparison with mismatched signatures rejected before lookup.
 let equal=0;for(let i=0;i<64;i++)equal|=expected.charCodeAt(i)^sig.toLowerCase().charCodeAt(i)
 if(equal)return deny('RECURRING_RECEIPT_INVALID_SIGNATURE')
 return recurringFinanceReceipt(env.DB,data,true)
}
export async function onRequest({request,env}){
 return recurringFinanceIndependentReceipt(request,env)
}
