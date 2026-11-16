// Independent signed document.sync.finance execution; never overloads the
// cash proposal executor or legacy payment-source names. Same approval ID
// replay returns the immutable target receipt. All mutation is backend-only.
const hex=/^[a-f0-9]{64}$/i, id32=/^[a-f0-9]{32}$/i;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
const reply=(value,status=200)=>Response.json(value,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff'
}});
const refuse=(code,status=409)=>reply({ok:false,code,applied:false},status);
const exactKeys=(x,ks)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===ks.slice().sort().join(',');
const equal=(a,b)=>{if(!hex.test(a||'')||!hex.test(b||''))return false;
 let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0};
const hash=async value=>Array.from(new Uint8Array(
 await crypto.subtle.digest('SHA-256',encoder.encode(value))),
 x=>x.toString(16).padStart(2,'0')).join('');
async function mac(secret,purpose,stamp,raw){
 const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16));
 const key=await crypto.subtle.importKey('raw',bytes,
 {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,
 encoder.encode(purpose+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join('');
}
function enabled(env){
 return env.APP_ENV==='production'&&
  env.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
  env.KAKEIBO_DOCUMENT_FINANCE_EXECUTION_ENABLED==='true'&&
  env.KAKEIBO_APPROVAL_PROOF_ENABLED==='true'&&
  hex.test(env.KAKEIBO_DOCUMENT_FINANCE_SECRET||'')&&
  hex.test(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET||'')&&
  typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
  typeof env.DOCUMENT_FINANCE_SOURCE_SERVICE?.fetch==='function'&&
  typeof env.DB?.prepare==='function'&&
  typeof env.HOMEFLOW_OAUTH_ORIGIN==='string'&&
  /^https:\/\/[A-Za-z0-9.-]+$/.test(env.HOMEFLOW_OAUTH_ORIGIN);
}
const core=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
const opKeys=['account_id','account_version','type','amount_jpy','date',
 'merchant','category','note','payment_source','operation_sha256','execution_nonce'];
async function input(req,env,receiptOnly){
 if(req.method!=='POST'||req.headers.has('cookie')||req.headers.has('origin')||
  req.headers.has('authorization')||
  req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return null;
 const stamp=req.headers.get('x-approval-timestamp');
 const sig=req.headers.get('x-approval-signature');
 if(req.headers.get('x-approval-client')!=='jp-document-assistant'||
  !/^\d{13}$/.test(stamp||'')||Math.abs(Date.now()-Number(stamp))>300000||
  !hex.test(sig||''))return null;
 let raw,b;try{raw=await req.text();if(raw.length>2000)return null;b=JSON.parse(raw);}
 catch{return null}
 const purpose=receiptOnly?'jpda:finance-receipt':'jpda:finance-execute';
 if(!exactKeys(b,receiptOnly?core:[...core,...opKeys])||
  !equal(await mac(env.KAKEIBO_DOCUMENT_FINANCE_SECRET,purpose,stamp,raw),sig)||
  !uuid.test(b.request_id)||!id32.test(b.resource_id)||
  !hex.test(b.payload_sha256)||typeof b.household_id!=='string'||
  !b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||
  b.requester_user_id.length>128)return null;
 if(!receiptOnly){
  if(!id32.test(b.account_id)||!hex.test(b.operation_sha256)||
   !hex.test(b.execution_nonce)||
   !Number.isSafeInteger(b.account_version)||b.account_version<1||
   !['income','expense'].includes(b.type)||
   !Number.isSafeInteger(b.amount_jpy)||b.amount_jpy<1||b.amount_jpy>10000000||
   typeof b.date!=='string'||!/^20\d\d-\d\d-\d\d$/.test(b.date)||
   !Number.isFinite(Date.parse(b.date+'T00:00:00Z'))||
   new Date(b.date+'T00:00:00Z').toISOString().slice(0,10)!==b.date||
   typeof b.merchant!=='string'||!b.merchant||b.merchant.length>100||
   typeof b.category!=='string'||!b.category||b.category.length>80||
   typeof b.note!=='string'||b.note.length>180||
   typeof b.payment_source!=='string'||!b.payment_source||
   b.payment_source.length>100)return null;
  const op={account_id:b.account_id,account_version:b.account_version,
   type:b.type,amount_jpy:b.amount_jpy,date:b.date,merchant:b.merchant,
   category:b.category,note:b.note,payment_source:b.payment_source};
  if(!equal(await hash(JSON.stringify(op)),b.operation_sha256))return null;
 }
 return b;
}
const receipt=(r,already)=>({ok:true,applied:true,
 status:already?'already_applied':'applied',
 approval_id:r.homeflow_request_id,candidate_id:r.candidate_id,
 household_id:r.household_id,requester_user_id:r.requester_user_id,
 payload_sha256:r.payload_sha256,entry_id:Number(r.entry_id),
 applied_at:Number(r.applied_at),approver_user_id:r.approver_user_id,
 operation_sha256:r.operation_sha256,already_applied:already});
const exact=(r,b)=>r&&r.homeflow_request_id===b.request_id&&
 r.candidate_id===b.resource_id&&r.household_id===b.household_id&&
 r.requester_user_id===b.requester_user_id&&r.payload_sha256===b.payload_sha256&&
 (b.operation_sha256===undefined||b.operation_sha256===r.operation_sha256);
async function homeflowProof(env,b){
 const q={request_id:b.request_id,resource_id:b.resource_id,
  household_id:b.household_id,requester_user_id:b.requester_user_id,
  payload_sha256:b.payload_sha256,
  idempotency_key:'jpda:sync:'+b.resource_id,
  expected_version:null,purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(q),stamp=String(Date.now());
 try{
  const res=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',env.HOMEFLOW_OAUTH_ORIGIN),{
    method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(env.KAKEIBO_APPROVAL_VERIFICATION_SECRET,
      'kakeibo',stamp,raw)},body:raw}));
  if(res.status!==200||res.headers.has('location'))return null;
  const rawResult=await res.text();if(rawResult.length>1900)return null;
  const p=JSON.parse(rawResult);
  return p?.ok===true&&p.verified===true&&p.execution_authorized===true&&
   p.execution_status==='executing'&&p.source_app==='jp-document-assistant'&&
   p.target_app==='kakebo'&&p.operation==='document.sync.finance'&&
   p.resource_type==='document_sync_candidate'&&p.request_id===b.request_id&&
   p.resource_id===b.resource_id&&p.household_id===b.household_id&&
   p.requester_user_id===b.requester_user_id&&p.payload_sha256===b.payload_sha256&&
   p.idempotency_key==='jpda:sync:'+b.resource_id&&p.expected_version===null&&
   p.approver_user_id&&p.approver_user_id!==b.requester_user_id&&
   Number.isSafeInteger(p.approved_at)&&Number.isSafeInteger(p.expires_at)&&
   p.expires_at>Date.now()&&p.applied===false?p:null;
 }catch{return null}
}
async function sourceCheck(env,b){
 const q={request_id:b.request_id,resource_id:b.resource_id,
  household_id:b.household_id,requester_user_id:b.requester_user_id,
  payload_sha256:b.payload_sha256,operation_sha256:b.operation_sha256};
 const raw=JSON.stringify(q),stamp=String(Date.now());
 try{
  const res=await env.DOCUMENT_FINANCE_SOURCE_SERVICE.fetch(new Request(
   'https://jp-document-assistant.internal/api/internal/document-actions/source-check',{
    method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(env.KAKEIBO_DOCUMENT_FINANCE_SECRET,
     'kakeibo:document-source-check',stamp,raw)},body:raw}));
  if(res.status!==200||res.headers.has('location'))return false;
  const data=await res.text();if(data.length>1000)return false;
  const p=JSON.parse(data);
  return p?.ok===true&&p.verified===true&&p.applied===false&&
   p.approval_id===b.request_id&&p.candidate_id===b.resource_id&&
   p.household_id===b.household_id&&
   p.requester_user_id===b.requester_user_id&&
   p.payload_sha256===b.payload_sha256&&
   p.operation_sha256===b.operation_sha256;
 }catch{return false}
}
async function currentAccount(db,b){
 return db.prepare('SELECT a.account_id,a.label,a.account_kind,a.version,'+
  'a.owner_user_id,a.household_id,a.origin,a.is_archived,'+
  'l.role AS member_role,l.state AS member_state '+
  'FROM family_financial_accounts a '+
  'JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id '+
  'AND l.household_id=a.household_id '+
  'WHERE a.account_id=? LIMIT 1')
 .bind(b.account_id).first();
}
function accountMatches(a,b){
 return a&&a.account_id===b.account_id&&
  a.owner_user_id===b.requester_user_id&&a.household_id===b.household_id&&
  a.label===b.payment_source&&a.account_kind==='cash'&&
  a.version===b.account_version&&a.origin==='member_created'&&
  a.is_archived===0&&a.member_role==='member'&&a.member_state==='active';
}
export async function documentFinanceRoute(request,env,parts){
 if(!enabled(env))return refuse('DOCUMENT_FINANCE_EXECUTION_DISABLED',503);
 const receiptOnly=parts.length===1&&parts[0]==='receipt';
 if(parts.length!==1||!['receipt','execute'].includes(parts[0]))
  return refuse('NOT_FOUND',404);
 const b=await input(request,env,receiptOnly);
 if(!b)return refuse('UNAUTHORIZED_OR_INVALID_BODY',403);
 const db=env.DB;
 const stored=await db.prepare('SELECT * FROM document_finance_applied_actions '+
  'WHERE homeflow_request_id=? OR candidate_id=? LIMIT 1')
  .bind(b.request_id,b.resource_id).first();
 if(stored)return exact(stored,b)?reply(receipt(stored,true)):
  refuse('JOURNAL_IDENTITY_CONFLICT',409);
 if(receiptOnly)return refuse('RECEIPT_NOT_FOUND',404);
 const account=await currentAccount(db,b);
 if(!accountMatches(account,b))return refuse('ACCOUNT_CHANGED',409);
 const homeProof=await homeflowProof(env,b);
 if(!homeProof)return refuse('APPROVAL_NOT_EXECUTING',409);
 if(!await sourceCheck(env,b))return refuse('SOURCE_REVOKED_OR_CHANGED',409);
 // A second local account CAS inside the SQL transaction protects account
 // reassignment/archive/version races between checks and actual insertion.
 const clientId='document:'+b.request_id;
 const appliedAt=Date.now();
 const eventId=Array.from(crypto.getRandomValues(new Uint8Array(16)),
  x=>x.toString(16).padStart(2,'0')).join('');
 try{
  const changes=await db.batch([
   db.prepare('INSERT INTO entries (date,time,amount,category,merchant,note,raw,'+
    'type,transfer_target,transfer_applied,transfer_date,client_request_id,'+
    'payment_source,family_account_id) '+
    'SELECT ?,\'\',?,?,?,?,\'\',?,NULL,0,NULL,?,?,? '+
    'WHERE EXISTS(SELECT 1 FROM family_financial_accounts a '+
    'JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id '+
    'AND l.household_id=a.household_id '+
    'WHERE a.account_id=? AND a.version=? AND a.account_kind=\'cash\' '+
    'AND a.owner_user_id=? AND a.household_id=? '+
    'AND a.origin=\'member_created\' AND a.is_archived=0 '+
    'AND a.label=? AND l.role=\'member\' AND l.state=\'active\') '+
    'ON CONFLICT(client_request_id) DO NOTHING')
   .bind(b.date,b.amount_jpy,b.category,b.merchant,b.note,b.type,
    clientId,b.payment_source,b.account_id,b.account_id,b.account_version,
    b.requester_user_id,b.household_id,b.payment_source),
   db.prepare('INSERT INTO document_finance_applied_actions '+
    '(homeflow_request_id,candidate_id,household_id,requester_user_id,'+
    'approver_user_id,account_id,account_version,payload_sha256,'+
    'operation_sha256,client_request_id,entry_id,applied_at) '+
    'VALUES(?,?,?,?,?,?,?,?,?,?,('+
    'SELECT id FROM entries WHERE client_request_id=? AND family_account_id=? '+
    'AND date=? AND amount=? AND category=? AND merchant=? AND note=? '+
    'AND type=? AND payment_source=? LIMIT 1),?)')
   .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
    homeProof.approver_user_id,b.account_id,b.account_version,
    b.payload_sha256,b.operation_sha256,clientId,
    clientId,b.account_id,b.date,b.amount_jpy,b.category,b.merchant,b.note,
    b.type,b.payment_source,appliedAt),
   db.prepare('INSERT INTO family_finance_events '+
    '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
    'VALUES(?,?,?,?,\'finance_entry_applied\',?)')
   .bind(eventId,b.household_id,homeProof.approver_user_id,
    b.resource_id,new Date(appliedAt).toISOString())
  ]);
  if(changes.length!==3||changes.some(x=>x.meta?.changes!==1))
   return refuse('TRANSACTION_RECONCILE_REQUIRED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM document_finance_applied_actions '+
    'WHERE homeflow_request_id=? OR candidate_id=? LIMIT 1')
    .bind(b.request_id,b.resource_id).first().catch(()=>null);
  return exact(raced,b)?reply(receipt(raced,true)):
   refuse('TRANSACTION_RETRY_OR_CONFLICT',503);
 }
 const applied=await db.prepare('SELECT * FROM document_finance_applied_actions WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return exact(applied,b)?reply(receipt(applied,false)):
  refuse('TARGET_RECEIPT_PENDING_RECONCILIATION',503);
}
export async function onRequest({request,env,params}){
 return documentFinanceRoute(request,env,params.path||[]);
}
