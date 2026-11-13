// Stage D. A user-initiated read-only reconciliation with the HomeFlow
// approval journal. It NEVER marks a proposal approved, NEVER decrypts the
// pending payload, and NEVER writes to shared entries / card bills / assets.
// The later idempotent executor must recheck independently before a POST.
const respond=(v,status=200)=>Response.json(v,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[a-f0-9]{64}$/i;
const enc=new TextEncoder();
function enabled(env){
 return env.APP_ENV==='production'&&
  env.KAKEIBO_APPROVAL_PROOF_ENABLED==='true'&&
  typeof env.KAKEIBO_APPROVAL_VERIFICATION_SECRET==='string'&&
  hex.test(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET)&&
  typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function';
}
export async function signApprovalRequest(env,stamp,raw){
 const bytes=Uint8Array.from(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET.match(/.{2}/g),
  x=>parseInt(x,16));
 const key=await crypto.subtle.importKey('raw',bytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,
  enc.encode('kakeibo\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(signature),
  b=>b.toString(16).padStart(2,'0')).join('');
}
export async function verifyPreparedApproval(request,env,url,user,id){
 if(!enabled(env))return respond({code:'APPROVAL_PROOF_DISABLED'},503);
 if(request.method!=='POST'||request.headers.get('origin')!==url.origin||
  request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return respond({code:'BAD_ORIGIN_OR_METHOD'},403);
 let form;
 try{
  const raw=await request.text();
  if(raw.length>200)throw Error('bad request');
  form=JSON.parse(raw);
 }catch{return respond({code:'INVALID_APPROVAL_ID'},400)}
 if(!form||typeof form!=='object'||Array.isArray(form)||
  Object.keys(form).length!==1||!uuid.test(form.homeflow_request_id))
  return respond({code:'INVALID_APPROVAL_ID'},400);
 const row=await env.DB.prepare(
  "SELECT p.request_id,p.household_id,p.requester_user_id,p.account_id,"+
  "p.payload_sha256,p.state,p.expires_at,p.homeflow_approval_id "+
  "FROM family_finance_pending_actions p "+
  "JOIN family_financial_accounts a ON a.account_id=p.account_id "+
  "WHERE p.request_id=? AND p.household_id=? AND p.requester_user_id=? "+
  "AND a.owner_user_id=? AND a.household_id=? AND a.is_archived=0"
 ).bind(id,user.household_id,user.user_id,user.user_id,user.household_id).first();
 if(!row)return respond({code:'PROPOSAL_NOT_FOUND'},404);
 if(row.state!=='submitted'||Number(row.expires_at)<=Date.now()||
  row.homeflow_approval_id!==form.homeflow_request_id)
  return respond({code:'PROPOSAL_NOT_EXECUTABLE'},409);
 // The only valid future HomeFlow approval idempotency key is deterministic
 // from the immutable Kakeibo pending resource ID. No client-generated key.
 const homeflowKey='kakeibo:finance:'+row.request_id;
 const query={request_id:form.homeflow_request_id,resource_id:row.request_id,
  household_id:row.household_id,requester_user_id:row.requester_user_id,
  payload_sha256:row.payload_sha256,idempotency_key:homeflowKey,
  expected_version:null};
 const raw=JSON.stringify(query),stamp=String(Date.now());
 const req=new Request(new URL('/api/internal/approvals/verify',env.HOMEFLOW_OAUTH_ORIGIN),{
  method:'POST',redirect:'manual',
  headers:{'content-type':'application/json','accept':'application/json',
   'x-approval-client':'kakeibo','x-approval-timestamp':stamp,
   'x-approval-signature':await signApprovalRequest(env,stamp,raw)},body:raw
 });
 let outcome;
 try{
  const response=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(req);
  if(response.status===409)return respond({code:'APPROVAL_NOT_VERIFIED',
   applied:false,ledger_changed:false},409);
  if(response.status!==200||response.headers.get('location'))
   return respond({code:'APPROVAL_PROOF_UNAVAILABLE'},503);
  const text=await response.text();
  if(text.length>2500)return respond({code:'INVALID_APPROVAL_PROOF'},503);
  outcome=JSON.parse(text);
 }catch{return respond({code:'APPROVAL_PROOF_UNAVAILABLE'},503)}
 if(!outcome||outcome.ok!==true||outcome.verified!==true||
  outcome.request_id!==form.homeflow_request_id||
  outcome.resource_id!==row.request_id||outcome.household_id!==row.household_id||
  outcome.requester_user_id!==row.requester_user_id||
  outcome.payload_sha256!==row.payload_sha256||
  outcome.idempotency_key!==homeflowKey||
  outcome.expected_version!==null||outcome.applied!==false||
  !Number.isSafeInteger(outcome.approved_at)||
  !Number.isSafeInteger(outcome.expires_at)||
  outcome.expires_at<=Date.now())
  return respond({code:'INVALID_APPROVAL_PROOF'},503);
 return respond({ok:true,approval_confirmed:true,
  status:'approved_not_applied',homeflow_request_id:form.homeflow_request_id,
  proposal_id:row.request_id,applied:false,ledger_changed:false})
}
