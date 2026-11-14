// Stage D: only the already authenticated HomeFlow MEMBER may submit their
// immutable encrypted finance intent to HomeFlow's review queue. No payload
// decryption, no ledger changes and absolutely no local "approved" state.
// A lost remote response is safe to retry: deterministic HomeFlow key and
// remote idempotency guarantee the same request ID after a network timeout.
import {signApprovalRequest} from './approval-proof.js'
const json=(v,status=200)=>Response.json(v,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}})
const newid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),
 b=>b.toString(16).padStart(2,'0')).join('')
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const hex=/^[a-f0-9]{64}$/i
function enabled(env){
 return env.APP_ENV==='production'&&env.KAKEIBO_APPROVAL_SUBMISSION_ENABLED==='true'&&
  typeof env.KAKEIBO_APPROVAL_VERIFICATION_SECRET==='string'&&
  hex.test(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET)&&
  typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'
}
export async function submitPreparedApproval(request,env,url,user,id){
 if(!enabled(env))return json({code:'APPROVAL_SUBMISSION_DISABLED'},503)
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin||
  request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return json({code:'BAD_ORIGIN_OR_METHOD'},403)
 try{
  const raw=await request.text()
  const input=raw.length<=128?JSON.parse(raw):null
  if(!input||typeof input!=='object'||Array.isArray(input))
   return json({code:'INVALID_SUBMISSION_INPUT'},400)
  // Re-introspected cookie actor must still be the user that opened the
  // original approval action on the device, never a later shared-PWA login.
  if(input.expected_user_id!==user.user_id)
   return json({code:'ACTOR_CHANGED'},403)
  if(Object.keys(input).length!==1)
   return json({code:'INVALID_SUBMISSION_INPUT'},400)
 }catch{return json({code:'INVALID_SUBMISSION_INPUT'},400)}
 const db=env.DB
 const row=await db.prepare('SELECT p.request_id,p.household_id,p.requester_user_id,'+
  'p.account_id,p.payload_sha256,p.state,p.expires_at,p.homeflow_approval_id,'+
  'a.account_kind,a.origin '+
  'FROM family_finance_pending_actions p '+
  'JOIN family_financial_accounts a ON a.account_id=p.account_id '+
  'WHERE p.request_id=? AND p.household_id=? AND p.requester_user_id=? '+
  'AND a.owner_user_id=? AND a.household_id=? AND a.is_archived=0')
  .bind(id,user.household_id,user.user_id,user.user_id,user.household_id).first()
 if(!row)return json({code:'PROPOSAL_NOT_FOUND'},404)
 if(row.state==='submitted'&&uuid.test(row.homeflow_approval_id))
  return json({ok:true,status:'submitted_status_unknown',
   homeflow_approval_id:row.homeflow_approval_id,replayed:true,
   applied:false,ledger_changed:false})
 if(row.state!=='prepared'||Number(row.expires_at)<=Date.now())
  return json({code:'PROPOSAL_NOT_SUBMITTABLE'},409)
 // HomeFlow currently has a signed executor ONLY for member-created cash
 // accounts. Do not solicit an approval that the owner UI would offer to
 // execute but Kakeibo will always reject as unsupported.
 if(row.account_kind!=='cash'||row.origin!=='member_created')
  return json({code:'ACCOUNT_TYPE_NOT_EXECUTABLE',
   applied:false,ledger_changed:false},409)
 const envelope={household_id:row.household_id,
  requester_user_id:row.requester_user_id,resource_id:row.request_id,
  payload_sha256:row.payload_sha256}
 const raw=JSON.stringify(envelope),stamp=String(Date.now())
 const req=new Request(new URL('/api/internal/approvals/submit',env.HOMEFLOW_OAUTH_ORIGIN),{
  method:'POST',redirect:'manual',headers:{
   'content-type':'application/json','accept':'application/json',
   'x-approval-client':'kakeibo','x-approval-timestamp':stamp,
   'x-approval-signature':await signApprovalRequest(env,stamp,raw)
  },body:raw
 })
 let remote
 try{
  const response=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(req)
  if(response.status===409)return json({code:'HOMEFLOW_APPROVAL_CONFLICT'},409)
  if(![200,201].includes(response.status)||response.headers.get('location'))
   return json({code:'HOMEFLOW_APPROVAL_RETRY',safe_to_retry:true},503)
  const text=await response.text()
  if(text.length>1500)return json({code:'HOMEFLOW_APPROVAL_RETRY',safe_to_retry:true},503)
  remote=JSON.parse(text)
 }catch{return json({code:'HOMEFLOW_APPROVAL_RETRY',safe_to_retry:true},503)}
 const homeflowKey='kakeibo:finance:'+row.request_id
 if(!remote||remote.ok!==true||!uuid.test(remote.approval_id)||
  !['pending','approved','rejected','cancelled'].includes(remote.status)||
  remote.resource_id!==row.request_id||
  remote.payload_sha256!==row.payload_sha256||
  remote.household_id!==row.household_id||
  remote.requester_user_id!==row.requester_user_id||
  remote.idempotency_key!==homeflowKey||
  remote.applied!==false||remote.ledger_changed!==false)
  return json({code:'HOMEFLOW_APPROVAL_UNVERIFIED',safe_to_retry:true},503)
 // HomeFlow is authoritative, but target receipt persistence is a separate D1
 // transaction. If this fails or races, retry the exact signed envelope;
 // HomeFlow's unique idempotency key returns the original request.
 const stampNow=Date.now()
 try{
  const rows=await db.batch([
   db.prepare("UPDATE family_finance_pending_actions SET state='submitted',"+
    "homeflow_approval_id=?,submitted_at=? "+
    "WHERE request_id=? AND requester_user_id=? AND household_id=? "+
    "AND state='prepared' AND expires_at>? "+
    "AND EXISTS(SELECT 1 FROM family_financial_accounts a "+
    "WHERE a.account_id=family_finance_pending_actions.account_id "+
    "AND a.owner_user_id=? AND a.is_archived=0)")
    .bind(remote.approval_id,stampNow,id,user.user_id,user.household_id,
     stampNow,user.user_id),
   db.prepare('INSERT INTO family_finance_events '+
    '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
    "SELECT ?,?,?,?,'finance_entry_submitted',? WHERE changes()=1")
    .bind(newid(),user.household_id,user.user_id,id,new Date(stampNow).toISOString())
  ])
  if(rows.some(x=>x.meta?.changes!==1)){
   const raced=await db.prepare('SELECT state,homeflow_approval_id FROM family_finance_pending_actions '+
    'WHERE request_id=? AND requester_user_id=?').bind(id,user.user_id).first()
   if(raced?.state==='submitted'&&raced.homeflow_approval_id===remote.approval_id)
    return json({ok:true,status:'submitted_status_unknown',
     homeflow_approval_id:remote.approval_id,replayed:true,
     applied:false,ledger_changed:false})
   return json({code:'SUBMISSION_RECEIPT_RETRY',safe_to_retry:true},503)
  }
  return json({ok:true,status:'submitted_status_unknown',
   homeflow_approval_id:remote.approval_id,replayed:remote.replayed===true,
   applied:false,ledger_changed:false},201)
 }catch{return json({code:'SUBMISSION_RECEIPT_RETRY',safe_to_retry:true},503)}
}
