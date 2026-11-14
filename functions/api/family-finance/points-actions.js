// Draft: source-side independent point intent. NEVER writes legacy entries.
// Only the atomically self-contained actions are enabled in this increment.
// Card/prepaid/SBI/exchange counterparts require separately verified executors.
import {pointAccountingPlan} from './point-accounting.js';
const te=new TextEncoder(), id=/^[a-f0-9]{32}$/i, hex=/^[a-f0-9]{64}$/i;
const supported=new Set(['earn_campaign','earn_purchase','redeem_discount','expire']);
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const unique=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const validDate=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const enabled=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_POINTS_ACTIONS_ENABLED==='true'&&e.DB?.prepare&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&hex.test(e.KAKEIBO_POINTS_SUBMISSION_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function hmac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,te.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=5000?JSON.parse(raw):null}catch{return null}
}
const visible=p=>({request_id:p.request_id,points_account_id:p.points_account_id,
 expected_version:p.expected_version,operation:p.operation,status:p.status,
 approval_id:p.homeflow_approval_id||null,created_at:p.created_at,
 applied:p.homeflow_request_id!=null,delta_units:p.delta_units??null,
 balance_after_units:p.balance_after_units??null});
const one=(db,id,user)=>db.prepare('SELECT p.*,j.homeflow_request_id,j.delta_units,j.balance_after_units '+
 'FROM family_points_intents p LEFT JOIN family_points_journal j ON j.proposal_id=p.request_id '+
 'WHERE p.request_id=? AND p.household_id=? AND p.requester_user_id=?')
 .bind(id,user.household_id,user.user_id).first();
async function account(db,user,accountId,version){
 const a=await db.prepare('SELECT a.account_id,a.account_kind,a.version,a.opening_balance FROM family_financial_accounts a '+
  "WHERE a.account_id=? AND a.household_id=? AND a.owner_user_id=? AND a.origin='member_created' AND a.is_archived=0")
  .bind(accountId,user.household_id,user.user_id).first();
 return a?.account_kind==='points'&&a.version===version&&a.opening_balance===0;
}
async function linkedPurchase(db,user,entryId){
 if(entryId===null)return true;
 // Do not authorize another member's expense merely because the ledger is household-shared.
 const e=await db.prepare('SELECT id,type,family_account_id FROM entries WHERE id=?').bind(entryId).first();
 if(!e||e.type!=='expense')return false;
 if(e.family_account_id){
  const a=await db.prepare('SELECT owner_user_id,household_id FROM family_financial_accounts WHERE account_id=?')
   .bind(e.family_account_id).first();
  return a?.owner_user_id===user.user_id&&a.household_id===user.household_id;
 }
 const l=await db.prepare('SELECT a.owner_user_id,l.household_id FROM family_finance_legacy_entry_links l '+
  'JOIN family_financial_accounts a ON a.account_id=l.account_id AND a.household_id=l.household_id '+
  'WHERE l.entry_id=?')
  .bind(entryId).first();
 return l?.owner_user_id===user.user_id&&l.household_id===user.household_id;
}
function valid(x,user){
 const keys=['expected_user_id','idempotency_key','points_account_id','points_version','operation',
  'effective_date','units','yen_value','rate_numerator','rate_denominator',
  'source_reference','linked_entry_id','expense_net_confirmed'];
 if(!exact(x,keys)||x.expected_user_id!==user.user_id||!supported.has(x.operation)||
  !id.test(x.points_account_id)||!Number.isSafeInteger(x.points_version)||x.points_version<1||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !Number.isSafeInteger(x.units)||x.units<1||x.units>1000000000||
  !validDate(x.effective_date)||typeof x.source_reference!=='string'||
  x.source_reference.trim().length<4||x.source_reference.length>160||
  ![true,false].includes(x.expense_net_confirmed))return false;
 const withEntry=x.operation==='earn_purchase'||x.operation==='redeem_discount';
 if((withEntry&&(!Number.isSafeInteger(x.linked_entry_id)||x.linked_entry_id<=0))||
    (!withEntry&&x.linked_entry_id!==null)||
    (x.operation==='redeem_discount'&&x.expense_net_confirmed!==true)||
    (x.operation!=='redeem_discount'&&x.expense_net_confirmed!==false))return false;
 const none=x.yen_value===null&&x.rate_numerator===null&&x.rate_denominator===null;
 return none||pointAccountingPlan({operation:x.operation,units:x.units,yen_value:x.yen_value,
  rate_numerator:x.rate_numerator,rate_denominator:x.rate_denominator,
  linked_entry_id:x.linked_entry_id,source_reference_hash:'a'.repeat(64)}).ok===true;
}
async function seal(e,requestId,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:te.encode('kakeibo-points:'+requestId)},key,te.encode(raw));
 const b64=arr=>btoa(String.fromCharCode(...arr));
 return {payload_cipher:b64(new Uint8Array(bytes)),payload_iv:b64(iv)};
}
async function prepare(req,e,url,user){
 const x=await read(req,url);
 if(!valid(x,user))return fail('POINTS_INVALID_INTENT',400);
 if(!await account(e.DB,user,x.points_account_id,x.points_version))return fail('POINTS_ACCOUNT_CHANGED');
 if(x.linked_entry_id&&!await linkedPurchase(e.DB,user,x.linked_entry_id))return fail('POINTS_ENTRY_OWNER_UNVERIFIED');
 const reference_hash=await hash(user.household_id+'\0'+x.points_account_id+'\0'+x.source_reference.trim());
 const raw=JSON.stringify({operation:x.operation,points_account_id:x.points_account_id,
  points_version:x.points_version,units:x.units,effective_date:x.effective_date,
  yen_value:x.yen_value,rate_numerator:x.rate_numerator,rate_denominator:x.rate_denominator,
  reference_hash,linked_entry_id:x.linked_entry_id,expense_net_confirmed:x.expense_net_confirmed});
 const digest=await hash(raw);
 const idem=await hash(user.household_id+'\0'+user.user_id+'\0points\0'+x.idempotency_key);
 const prior=await e.DB.prepare('SELECT request_id,payload_sha256 FROM family_points_intents WHERE idempotency_hash=?')
  .bind(idem).first();
 if(prior)return prior.payload_sha256===digest?
  json({ok:true,replayed:true,prepared:visible(await one(e.DB,prior.request_id,user))}):
  fail('POINTS_IDEMPOTENCY_CONFLICT');
 const requestId=unique(),now=Date.now(),secret=await seal(e,requestId,raw);
 try{
  const result=await e.DB.prepare('INSERT OR IGNORE INTO family_points_intents '+
   '(request_id,household_id,requester_user_id,points_account_id,expected_version,operation,'+
   'payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,created_at,expires_at) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,'prepared',?,?)")
   .bind(requestId,user.household_id,user.user_id,x.points_account_id,x.points_version,
    x.operation,digest,secret.payload_cipher,secret.payload_iv,idem,now,now+14*86400000).run();
  if(result.meta?.changes!==1)return fail('POINTS_PREPARE_CONFLICT');
  return json({ok:true,replayed:false,prepared:visible(await one(e.DB,requestId,user))},201);
 }catch{return fail('POINTS_PREPARE_FAILED',503)}
}
async function submit(req,e,url,user,requestId){
 const body=await read(req,url);
 if(!exact(body,['expected_user_id'])||body.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await one(e.DB,requestId,user);
 if(!p)return fail('NOT_FOUND',404);
 if(p.status==='submitted')return json({ok:true,approval_id:p.homeflow_approval_id,
  status:'submitted_status_unknown',applied:!!p.homeflow_request_id,replayed:true});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('POINTS_NOT_SUBMITTABLE');
 if(!await account(e.DB,user,p.points_account_id,p.expected_version))return fail('POINTS_ACCOUNT_CHANGED');
 const wire={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,
  expected_version:p.expected_version,action:p.operation};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 let ack;try{
  const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/points-submit',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-points','x-approval-timestamp':stamp,
    'x-approval-signature':await hmac(e.KAKEIBO_POINTS_SUBMISSION_SECRET,
     'kakeibo-points:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(response.status)||response.headers.has('location'))throw Error('http');
  const text=await response.text();if(text.length>2000)throw Error('body');ack=JSON.parse(text);
 }catch{return fail('POINTS_HOMEFLOW_RETRY',503)}
 if(ack?.ok!==true||typeof ack.approval_id!=='string'||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ack.approval_id)||
  ack.resource_id!==p.request_id||ack.household_id!==p.household_id||
  ack.requester_user_id!==p.requester_user_id||ack.payload_sha256!==p.payload_sha256||
  ack.expected_version!==p.expected_version||ack.operation!=='finance.points.'+p.operation||
  ack.applied!==false)return fail('POINTS_SUBMIT_UNCONFIRMED',503);
 try{
  const r=await e.DB.prepare("UPDATE family_points_intents SET status='submitted',"+
   "homeflow_approval_id=?,submitted_at=? WHERE request_id=? AND household_id=? "+
   "AND requester_user_id=? AND status='prepared' AND expires_at>?")
   .bind(ack.approval_id,Date.now(),requestId,user.household_id,user.user_id,Date.now()).run();
  if(r.meta?.changes!==1){
   const latest=await one(e.DB,requestId,user);
   if(latest?.homeflow_approval_id!==ack.approval_id||latest.status!=='submitted')
    return fail('POINTS_SUBMIT_RECONCILE',503);
  }
  return json({ok:true,approval_id:ack.approval_id,status:'submitted_status_unknown',applied:false});
 }catch{return fail('POINTS_SUBMIT_RECONCILE',503)}
}
async function cancel(req,e,url,user,id){
 const body=await read(req,url);
 if(!exact(body,['expected_user_id'])||body.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await one(e.DB,id,user);
 if(!p)return fail('NOT_FOUND',404);
 if(p.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('POINTS_ALREADY_SUBMITTED');
 const r=await e.DB.prepare("UPDATE family_points_intents SET status='cancelled' "+
  "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
  .bind(id,user.household_id,user.user_id).run();
 return r.meta?.changes===1?json({ok:true,status:'cancelled'}):fail('POINTS_CANCEL_CONFLICT');
}
export async function familyPointsActions(req,e,url,user,parts){
 if(!enabled(e))return fail('POINTS_ACTIONS_DISABLED',503);
 if(user.role!=='member')return fail('ONLY_MEMBER_CAN_PROPOSE',403);
 if(req.method==='GET'&&parts.length===1){
  const rows=(await e.DB.prepare('SELECT p.*,j.homeflow_request_id,j.delta_units,j.balance_after_units '+
   'FROM family_points_intents p LEFT JOIN family_points_journal j ON j.proposal_id=p.request_id '+
   'WHERE p.household_id=? AND p.requester_user_id=? ORDER BY p.created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return json({ok:true,items:rows.map(visible)});
 }
 if(req.method==='POST'&&parts.length===1)return prepare(req,e,url,user);
 if(req.method==='POST'&&parts.length===3&&id.test(parts[1])){
  if(parts[2]==='submit')return submit(req,e,url,user,parts[1]);
  if(parts[2]==='cancel')return cancel(req,e,url,user,parts[1]);
 }
 if(req.method==='GET'&&parts.length===2&&id.test(parts[1])){
  const p=await one(e.DB,parts[1],user);
  return p?json({ok:true,item:visible(p)}):fail('NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
