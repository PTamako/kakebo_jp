// Stage D: signed backchannel only. NEVER accept a browser HomeFlow cookie,
// client 'approved' flag, arbitrary SQL or sensitive unapproved payload.
// Limited first rollout: member-created CASH accounts only. Cards/prepaid,
// points, SBI and transfers require separate stable-account reconciliation.
const enc=new TextEncoder()
const hex=/^[a-f0-9]{64}$/i
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id32=/^[a-f0-9]{32}$/i
const reply=(body,status=200)=>Response.json(body,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}})
const refuse=(code,status=409)=>reply({ok:false,code,applied:false},status)
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),
 x=>x.toString(16).padStart(2,'0')).join('')
const sha=async raw=>Array.from(new Uint8Array(
 await crypto.subtle.digest('SHA-256',enc.encode(raw))),x=>x.toString(16).padStart(2,'0')).join('')
function same(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length||
  !hex.test(a)||!hex.test(b))return false
 let diff=0
 for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i)
 return diff===0
}
function enabled(env){
 return env.APP_ENV==='production'&&
  env.KAKEIBO_FAMILY_EXECUTION_ENABLED==='true'&&
  env.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
  env.KAKEIBO_APPROVAL_PROOF_ENABLED==='true'&&
  hex.test(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET)&&
  hex.test(env.KAKEIBO_FAMILY_PENDING_KEY)&&
  typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
  typeof env.DB?.prepare==='function'&&
  typeof env.HOMEFLOW_OAUTH_ORIGIN==='string'&&
  /^https:\/\/[A-Za-z0-9.-]+$/.test(env.HOMEFLOW_OAUTH_ORIGIN)
}
async function hmac(secret,client,stamp,raw){
 const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16))
 const key=await crypto.subtle.importKey('raw',bytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const result=await crypto.subtle.sign('HMAC',key,
  enc.encode(client+'\n'+stamp+'\n'+raw))
 return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('')
}
async function decodePayload(env,row){
 try{
  const iv=Uint8Array.from(atob(row.payload_iv),x=>x.charCodeAt(0))
  const cipher=Uint8Array.from(atob(row.payload_cipher),x=>x.charCodeAt(0))
  if(iv.length!==12||cipher.length>4500||cipher.length<16)return null
  const key=await crypto.subtle.importKey('raw',
   Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
    x=>parseInt(x,16)),'AES-GCM',false,['decrypt'])
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-finance:'+row.request_id)},key,cipher)
  const raw=new TextDecoder().decode(plain)
  if(!same(await sha(raw),row.payload_sha256))return null
  const payload=JSON.parse(raw)
  return {raw,payload}
 }catch{return null}
}
function validDate(v){
 if(typeof v!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v))
  return false
 const stamp=Date.parse(v+'T00:00:00Z')
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===v
}
function validCash(p,row){
 return p&&typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).sort().join(',')===
   ['account_id','amount_jpy','category','date','merchant','note','type'].sort().join(',')&&
  p.account_id===row.account_id&&
  ['expense','income'].includes(p.type)&&
  Number.isSafeInteger(p.amount_jpy)&&p.amount_jpy>=1&&p.amount_jpy<=10000000&&
  validDate(p.date)&&typeof p.merchant==='string'&&
  p.merchant.trim().length>=1&&p.merchant.length<=160&&
  typeof p.category==='string'&&p.category.trim().length>=1&&p.category.length<=40&&
  typeof p.note==='string'&&p.note.length<=300
}
function publicResult(row,already){
 return {ok:true,applied:true,status:already?'already_applied':'applied',
  approval_id:row.homeflow_request_id,proposal_id:row.proposal_id,
  household_id:row.household_id,requester_user_id:row.requester_user_id,
  payload_sha256:row.payload_sha256,entry_id:Number(row.entry_id),
  already_applied:already,applied_at:row.applied_at}
}
function exact(row,body){
 return row&&row.homeflow_request_id===body.request_id&&
  row.proposal_id===body.resource_id&&
  row.household_id===body.household_id&&
  row.requester_user_id===body.requester_user_id&&
  row.payload_sha256===body.payload_sha256
}
export async function approvedActionRoute(request,env,parts){
 if(!enabled(env))return refuse('EXECUTION_DISABLED',503)
 if(parts.length!==1||parts[0]!=='execute'||request.method!=='POST')
  return refuse('NOT_FOUND',404)
 if(request.headers.has('cookie')||request.headers.has('origin')||
  request.headers.has('authorization')||
  request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return refuse('BACKEND_ONLY',403)
 const stamp=request.headers.get('x-approval-timestamp')
 const signature=request.headers.get('x-approval-signature')
 if(request.headers.get('x-approval-client')!=='homeflow'||
  !/^\d{13}$/.test(stamp||'')||
  Math.abs(Date.now()-Number(stamp))>300000||!hex.test(signature))
  return refuse('INVALID_SIGNATURE',403)
 let raw,body
 try{
  raw=await request.text()
  if(raw.length>1600)throw Error('too large')
  body=JSON.parse(raw)
 }catch{return refuse('INVALID_INPUT',400)}
 const mac=await hmac(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET,'homeflow',stamp,raw)
 if(!same(mac,signature))return refuse('INVALID_SIGNATURE',403)
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).sort().join(',')!==[
   'request_id','resource_id','household_id','requester_user_id',
   'payload_sha256','execution_nonce'].sort().join(',')||
  !uuid.test(body.request_id)||!id32.test(body.resource_id)||
  !hex.test(body.payload_sha256)||!hex.test(body.execution_nonce)||
  typeof body.household_id!=='string'||body.household_id.length<1||
  body.household_id.length>128||typeof body.requester_user_id!=='string'||
  body.requester_user_id.length<1||body.requester_user_id.length>128)
  return refuse('INVALID_INPUT',400)
 const db=env.DB
 const existing=await db.prepare('SELECT * FROM family_finance_applied_actions '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1')
  .bind(body.request_id,body.resource_id).first()
 if(existing){
  if(!exact(existing,body))return refuse('APPLIED_IDENTITY_CONFLICT',409)
  return reply(publicResult(existing,true))
 }
 const row=await db.prepare('SELECT p.*,a.account_kind,a.origin,a.owner_user_id,'+
  'a.is_archived,a.household_id AS account_household,l.role AS owner_role,'+
  'l.state AS owner_state FROM family_finance_pending_actions p '+
  'JOIN family_financial_accounts a ON a.account_id=p.account_id '+
  'JOIN homeflow_identity_links l ON l.user_id=p.requester_user_id '+
  'WHERE p.request_id=? AND p.homeflow_approval_id=?')
  .bind(body.resource_id,body.request_id).first()
 if(!row||row.state!=='submitted'||row.operation!=='finance.entry.create'||
  row.requester_user_id!==body.requester_user_id||
  row.household_id!==body.household_id||
  row.payload_sha256!==body.payload_sha256||
  row.owner_user_id!==body.requester_user_id||
  row.account_household!==body.household_id||
  row.owner_role!=='member'||row.owner_state!=='active'||
  row.is_archived!==0||row.origin!=='member_created'||
  row.expires_at<=Date.now())
  return refuse('PROPOSAL_CONFLICT',409)
 if(row.account_kind!=='cash')
  return refuse('ACCOUNT_TYPE_NOT_EXECUTABLE',409)
 const decrypted=await decodePayload(env,row)
 if(!decrypted||!validCash(decrypted.payload,row))
  return refuse('PRIVATE_PAYLOAD_INTEGRITY_FAILED',409)
 const ask={request_id:body.request_id,resource_id:body.resource_id,
  household_id:body.household_id,requester_user_id:body.requester_user_id,
  payload_sha256:body.payload_sha256,
  idempotency_key:'kakeibo:finance:'+body.resource_id,
  expected_version:null,purpose:'execute',execution_nonce:body.execution_nonce}
 const query=JSON.stringify(ask),timestamp=String(Date.now())
 const proofReq=new Request(new URL('/api/internal/approvals/verify',env.HOMEFLOW_OAUTH_ORIGIN),{
  method:'POST',redirect:'manual',headers:{'content-type':'application/json',
   'x-approval-client':'kakeibo','x-approval-timestamp':timestamp,
   'x-approval-signature':await hmac(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET,'kakeibo',timestamp,query)},
  body:query
 })
 let proof
 try{
  const response=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(proofReq)
  if(response.status===409)return refuse('APPROVAL_NOT_EXECUTING',409)
  if(response.status!==200||response.headers.has('location'))
   return refuse('HOMEFLOW_PROOF_UNAVAILABLE',503)
  const raw=await response.text()
  if(raw.length>1800)return refuse('INVALID_HOMEFLOW_PROOF',503)
  proof=JSON.parse(raw)
 }catch{return refuse('HOMEFLOW_PROOF_UNAVAILABLE',503)}
 if(proof?.ok!==true||proof.verified!==true||
  proof.execution_authorized!==true||proof.execution_status!=='executing'||
  proof.request_id!==body.request_id||proof.resource_id!==body.resource_id||
  proof.household_id!==body.household_id||
  proof.requester_user_id!==body.requester_user_id||
  proof.payload_sha256!==body.payload_sha256||
  proof.idempotency_key!==ask.idempotency_key||
  proof.expected_version!==null||
  !proof.approver_user_id||
  proof.approver_user_id===body.requester_user_id||
  !Number.isSafeInteger(proof.expires_at)||proof.expires_at<=Date.now()||
  !Number.isSafeInteger(proof.approved_at)||
  proof.applied!==false)
  return refuse('INVALID_HOMEFLOW_PROOF',503)
 const payload=decrypted.payload,clientRequest='hf:'+body.request_id
 const appliedAt=Date.now(),eventId=randomId()
 try{
  const changes=await db.batch([
   db.prepare('INSERT INTO entries (date,time,amount,category,merchant,note,raw,'+
    'type,transfer_target,transfer_applied,transfer_date,client_request_id,'+
    'payment_source,family_account_id) '+
    "SELECT ?,'',?,?,?,?,?, ?,NULL,0,NULL,?,'',? "+
    'WHERE EXISTS(SELECT 1 FROM family_finance_pending_actions p '+
    'JOIN family_financial_accounts a ON a.account_id=p.account_id '+
    "WHERE p.request_id=? AND p.state='submitted' "+
    'AND p.homeflow_approval_id=? AND p.payload_sha256=? '+
    "AND a.account_kind='cash' AND a.is_archived=0 AND a.owner_user_id=?) "+
    'ON CONFLICT(client_request_id) DO NOTHING')
    .bind(payload.date,payload.amount_jpy,payload.category,payload.merchant,
     payload.note,'',payload.type,clientRequest,payload.account_id,
     body.resource_id,body.request_id,body.payload_sha256,body.requester_user_id),
   db.prepare('INSERT INTO family_finance_applied_actions '+
    '(homeflow_request_id,proposal_id,household_id,requester_user_id,'+
    'approver_user_id,account_id,payload_sha256,client_request_id,entry_id,applied_at) '+
    'VALUES(?,?,?,?,?,?,?,?,('+
    'SELECT e.id FROM entries e WHERE e.client_request_id=? '+
    'AND e.family_account_id=? AND e.date=? AND e.amount=? '+
    'AND e.category=? AND e.merchant=? AND e.note=? '+
    'AND e.type=? AND e.payment_source=? LIMIT 1),?)')
    .bind(body.request_id,body.resource_id,body.household_id,
     body.requester_user_id,proof.approver_user_id,
     payload.account_id,body.payload_sha256,clientRequest,
     clientRequest,payload.account_id,payload.date,payload.amount_jpy,
     payload.category,payload.merchant,payload.note,payload.type,'',appliedAt),
   db.prepare('INSERT INTO family_finance_events '+
    '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
    "SELECT ?,?,?,?,'finance_entry_applied',? "+
    'WHERE changes()=1')
    .bind(eventId,body.household_id,body.requester_user_id,
     body.resource_id,new Date(appliedAt).toISOString())
  ])
  if(changes[1]?.meta?.changes!==1||changes[2]?.meta?.changes!==1){
   const raced=await db.prepare('SELECT * FROM family_finance_applied_actions '+
    'WHERE homeflow_request_id=?').bind(body.request_id).first()
   return exact(raced,body)?reply(publicResult(raced,true)):
    refuse('LEDGER_IDEMPOTENCY_CONFLICT',409)
  }
 }catch{
  // Unique-key races may mean another Worker already committed this exact
  // approval. Reconcile from durable target journal; never post twice.
  const raced=await db.prepare('SELECT * FROM family_finance_applied_actions '+
   'WHERE homeflow_request_id=?').bind(body.request_id).first().catch(()=>null)
  return exact(raced,body)?reply(publicResult(raced,true)):
   refuse('LEDGER_TRANSACTION_RETRY',503)
 }
 const applied=await db.prepare('SELECT * FROM family_finance_applied_actions '+
  'WHERE homeflow_request_id=?').bind(body.request_id).first()
 return applied&&exact(applied,body)?reply(publicResult(applied,false)):
  refuse('LEDGER_COMMIT_RECONCILE',503)
}
export async function onRequest({request,env,params}){
 return approvedActionRoute(request,env,params.path||[])
}
