import {verifyPreparedApproval} from './approval-proof.js';
import {submitPreparedApproval} from './approval-submit.js';
// Stage C/D member-created finance intents, NOT household approvals.
// Private encrypted storage only. This module NEVER modifies entries,
// card bills, investment tables, balance statistics or R2 objects.
// A later service-bound executor will need a genuine HomeFlow approval ID.
const json=(value,status=200)=>Response.json(value,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}});
const enc=new TextEncoder();
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),
 x=>x.toString(16).padStart(2,'0')).join('');
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),
 x=>x.toString(16).padStart(2,'0')).join('');
const b64=v=>btoa(String.fromCharCode(...v));
const days=14*86400000;
const safeId=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const keyPattern=/^[a-z0-9._:-]{12,128}$/i;
async function key(env){
 const raw=Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),
  x=>parseInt(x,16));
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
}
function ready(env){
 return typeof env.KAKEIBO_FAMILY_PENDING_KEY==='string'&&
  /^[0-9a-fA-F]{64}$/.test(env.KAKEIBO_FAMILY_PENDING_KEY);
}
async function encrypt(env,requestId,raw){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({
  name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-finance:'+requestId)
 },await key(env),enc.encode(raw));
 return {cipher:b64(new Uint8Array(bytes)),iv:b64(iv)};
}
async function readMutation(req,url){
 if(req.headers.get('origin')!==url.origin)return null;
 if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
  return null;
 try{
  const raw=await req.text();
  const value=raw.length<=4096?JSON.parse(raw):null;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null;}
}
function validDate(v){
 if(typeof v!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v))
  return false;
 const ms=Date.parse(v+'T00:00:00Z');
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===v;
}
function validIntent(x){
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 if(!keyPattern.test(x.idempotency_key||'')||!safeId(x.account_id))return false;
 if(!['expense','income'].includes(x.type)||
   !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
   !validDate(x.date))return false;
 if(typeof x.merchant!=='string'||!x.merchant.trim()||x.merchant.trim().length>160)
  return false;
 if(typeof x.category!=='string'||!x.category.trim()||x.category.trim().length>40)
  return false;
 if(x.note!==undefined&&(typeof x.note!=='string'||x.note.length>300))
  return false;
 if(Object.keys(x).some(k=>!['idempotency_key','account_id','type',
  'amount_jpy','date','merchant','category','note'].includes(k)))return false;
 return true;
}
const shape=row=>({request_id:row.request_id,
 operation:'finance.entry.create',
 status:row.state==='cancelled'?'cancelled':
   row.expires_at<=Date.now()?'expired':
   row.state==='submitted'?'submitted_status_unknown':'prepared_not_submitted',
 payload_sha256:row.payload_sha256,expires_at:row.expires_at,
 created_at:row.created_at,account_id:row.account_id,
 homeflow_approval_id:row.homeflow_approval_id||null,ledger_changed:false});
async function prepare(req,env,url,user){
 const data=await readMutation(req,url);
 if(!data)return json({code:'BAD_ORIGIN_OR_BODY'},403);
 if(!validIntent(data))return json({code:'INVALID_FINANCE_PROPOSAL'},400);
 const db=env.DB;
 const account=await db.prepare('SELECT owner_user_id,household_id,is_archived,origin '+
  'FROM family_financial_accounts WHERE account_id=? AND household_id=?')
  .bind(data.account_id,user.household_id).first();
 if(!account||account.owner_user_id!==user.user_id||
   account.is_archived!==0||account.origin!=='member_created')
  return json({code:'ACCOUNT_NOT_OWNED_OR_NOT_READY'},403);
 const payload={account_id:data.account_id,type:data.type,amount_jpy:data.amount_jpy,
  date:data.date,merchant:data.merchant.trim(),category:data.category.trim(),
  note:data.note||''};
 const raw=JSON.stringify(payload);
 const digest=await sha(raw);
 const scope=await sha(user.household_id+'\u0000'+user.user_id+'\u0000'+data.idempotency_key);
 const existing=await db.prepare('SELECT * FROM family_finance_pending_actions '+
  'WHERE idempotency_hash=?').bind(scope).first();
 if(existing){
  if(existing.requester_user_id!==user.user_id||
    existing.household_id!==user.household_id||
    existing.payload_sha256!==digest)
   return json({code:'IDEMPOTENCY_CONFLICT'},409);
  return json({ok:true,prepared:shape(existing),replayed:true});
 }
 const requestId=random(),stamp=Date.now(),sealed=await encrypt(env,requestId,raw);
 try{
  const result=await db.batch([
   db.prepare('INSERT OR IGNORE INTO family_finance_pending_actions '+
    '(request_id,household_id,requester_user_id,account_id,operation,idempotency_hash,'+
    'payload_sha256,payload_cipher,payload_iv,state,created_at,expires_at) '+
    "VALUES(?,?,?,?,'finance.entry.create',?,?,?,?,'prepared',?,?)")
    .bind(requestId,user.household_id,user.user_id,data.account_id,scope,
     digest,sealed.cipher,sealed.iv,stamp,stamp+days),
   db.prepare('INSERT INTO family_finance_events '+
    '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
    "SELECT ?,?,?,?,'finance_entry_prepared',? WHERE changes()=1")
    .bind(random(),user.household_id,user.user_id,requestId,
     new Date(stamp).toISOString())
  ]);
  if(result[0]?.meta?.changes!==1||result[1]?.meta?.changes!==1){
   const raced=await db.prepare('SELECT * FROM family_finance_pending_actions '+
    'WHERE idempotency_hash=?').bind(scope).first();
   if(raced&&raced.payload_sha256===digest&&raced.requester_user_id===user.user_id)
    return json({ok:true,prepared:shape(raced),replayed:true});
   return json({code:'IDEMPOTENCY_CONFLICT'},409);
  }
  return json({ok:true,prepared:{request_id:requestId,
   operation:'finance.entry.create',status:'prepared_not_submitted',
   payload_sha256:digest,expires_at:stamp+days,created_at:stamp,
   account_id:data.account_id,homeflow_approval_id:null,ledger_changed:false},
   replayed:false},201);
 }catch{return json({code:'PROPOSAL_PERSIST_FAILED'},503);}
}
async function list(db,user,url){
 const offset=Math.max(0,Math.min(500,Number(url.searchParams.get('offset'))||0));
 const rows=(await db.prepare('SELECT request_id,account_id,payload_sha256,state,'+
  'created_at,expires_at FROM family_finance_pending_actions '+
  'WHERE household_id=? AND requester_user_id=? '+
  'ORDER BY created_at DESC,request_id DESC LIMIT 6 OFFSET ?')
  .bind(user.household_id,user.user_id,offset).all()).results||[];
 return json({ok:true,items:rows.slice(0,5).map(shape),
  next_offset:rows.length>5?offset+5:null,ledger_changed:false});
}
async function cancel(req,env,url,user,requestId){
 const body=await readMutation(req,url);
 if(!body||Object.keys(body).length!==0)return json({code:'BAD_ORIGIN_OR_BODY'},403);
 const db=env.DB;
 const row=await db.prepare('SELECT * FROM family_finance_pending_actions '+
  'WHERE request_id=? AND requester_user_id=? AND household_id=?')
  .bind(requestId,user.user_id,user.household_id).first();
 if(!row)return json({code:'NOT_FOUND'},404);
 if(row.state==='cancelled')return json({ok:true,prepared:shape(row),replayed:true});
 if(row.state==='submitted')return json({code:'SUBMITTED_MANAGE_IN_HOMEFLOW'},409);
 if(row.expires_at<=Date.now())return json({code:'PROPOSAL_EXPIRED'},409);
 const stamp=Date.now();
 try{
  const result=await db.batch([
   db.prepare("UPDATE family_finance_pending_actions SET state='cancelled',cancelled_at=? "+
    "WHERE request_id=? AND requester_user_id=? AND household_id=? AND state='prepared'")
    .bind(stamp,requestId,user.user_id,user.household_id),
   db.prepare('INSERT INTO family_finance_events '+
    '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
    "SELECT ?,?,?,?,'finance_entry_cancelled',? WHERE changes()=1")
    .bind(random(),user.household_id,user.user_id,requestId,new Date(stamp).toISOString())
  ]);
  if(result.some(x=>x.meta?.changes!==1))return json({code:'PROPOSAL_CONFLICT'},409);
  return json({ok:true,status:'cancelled',ledger_changed:false});
 }catch{return json({code:'PROPOSAL_CONFLICT'},409);}
}
export async function financePending(req,env,url,user,parts){
 // An unconfigured encryption key means absolutely NO new proposal writes.
 if(!ready(env))return json({code:'PENDING_ENCRYPTION_NOT_CONFIGURED'},503);
 if(user.role!=='member')return json({code:'ONLY_MEMBER_CAN_PREPARE'},403);
 if(parts.length===1&&req.method==='POST')return prepare(req,env,url,user);
 if(parts.length===1&&req.method==='GET')return list(env.DB,user,url);
 if(parts.length===3&&parts[2]==='submit'&&safeId(parts[1])&&req.method==='POST')
  return submitPreparedApproval(req,env,url,user,parts[1]);
 if(parts.length===3&&parts[2]==='approval-proof'&&safeId(parts[1])&&req.method==='POST')
  return verifyPreparedApproval(req,env,url,user,parts[1]);
 if(parts.length===3&&parts[2]==='cancel'&&safeId(parts[1])&&req.method==='POST')
  return cancel(req,env,url,user,parts[1]);
 return json({code:'NOT_FOUND'},404);
}
