// Cloudflare Pages Function: POST /api/bridge/document-assistant
// The bridge never consumes browser cookies; enable only with scoped secrets and an explicit actor allowlist.
import { validateRegisteredPaymentSource } from '../payment-source-validation.js'
import { validateLedgerTextFields } from '../ledger-input-validation.js'
const enc=new TextEncoder()
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})
async function verified(secret,raw,stamp,signature){
  if(!/^[0-9a-f]{64}$/i.test(signature||''))return false
  const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(`${stamp}\n${raw}`)))
  const supplied=Uint8Array.from(signature.match(/.{2}/g),h=>parseInt(h,16))
  let diff=0;for(let i=0;i<32;i++)diff|=expected[i]^supplied[i]
  return diff===0
}
async function stableRequestId(value){
  const hash=await crypto.subtle.digest('SHA-256',enc.encode(value))
  return 'jda_'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('').slice(0,60)
}
export async function onRequestPost({request,env}){
  if(env.JPDA_BRIDGE_ENABLED!=='true')return json({ok:false,error:'bridge_disabled'},404)
  if(!env.JPDA_BRIDGE_SECRET||env.JPDA_BRIDGE_SECRET.length<32)return json({ok:false,error:'bridge_not_configured'},503)
  const stamp=request.headers.get('X-DA-Timestamp')||''
  if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000)return json({ok:false,error:'expired_signature'},401)
  const raw=await request.text()
  if(raw.length>8000)return json({ok:false,error:'too_large'},413)
  if(!await verified(env.JPDA_BRIDGE_SECRET,raw,stamp,request.headers.get('X-DA-Signature')))
    return json({ok:false,error:'invalid_signature'},401)
  let body;try{body=JSON.parse(raw)}catch{return json({ok:false,error:'invalid_json'},400)}
  const key=body?.idempotency_key
  if(body?.source!=='jp-document-assistant'||body?.payload?.operation!=='entry'||
    typeof key!=='string'||!/^jda:kakebo:[a-f0-9]{16,64}$/i.test(key)||
    request.headers.get('Idempotency-Key')!==key)return json({ok:false,error:'invalid_source'},400)
  const actor=body.actor_user_id
  if(!env.JPDA_BRIDGE_ALLOWED_USER||actor!==env.JPDA_BRIDGE_ALLOWED_USER)return json({ok:false,error:'actor_not_allowed'},403)
  const p=body.payload
  const date=p.date,amount=p.amount,source=p.paymentSource
  if(!['income','expense'].includes(p.type)||!Number.isSafeInteger(amount)||amount<=0||
    typeof date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(date)||
    !Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||
    typeof p.category!=='string'||!p.category.trim()||p.category.length>80||
    typeof source!=='string'||source.length>80)return json({ok:false,error:'invalid_entry'},400)
  const field={type:p.type,date,amount,category:p.category.trim(),paymentSource:source.trim(),
    note:typeof p.note==='string'?p.note.slice(0,180):'',merchant:'文书助手'}
  const fieldErr=validateLedgerTextFields(field)
  if(fieldErr)return json({ok:false,error:'invalid_text'},400)
  const paymentErr=await validateRegisteredPaymentSource(env.DB,field.paymentSource)
  if(paymentErr)return json({ok:false,error:paymentErr.code||'invalid_source'},paymentErr.status||400)
  const requestId=await stableRequestId(key)
  // One D1 unique index ensures a lost response never creates a second transaction.
  try{
    const result=await env.DB.prepare(`INSERT INTO entries
      (date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,transfer_date,client_request_id,payment_source)
      VALUES(?1,'',?2,?3,?4,?5,'',?6,NULL,0,NULL,?7,?8)
      ON CONFLICT(client_request_id) DO NOTHING`)
      .bind(date,amount,field.category,field.merchant,field.note,field.type,requestId,field.paymentSource).run()
    const row=await env.DB.prepare('SELECT id FROM entries WHERE client_request_id=?1').bind(requestId).first()
    if(!row?.id)return json({ok:false,error:'idempotency_lookup_failed'},503)
    return json({ok:true,remote_id:String(row.id),reused:result.meta?.changes===0})
  }catch{return json({ok:false,error:'ledger_write_failed'},503)}
}
