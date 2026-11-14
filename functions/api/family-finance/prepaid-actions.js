// P0-4: member-created prepaid account actions.
// Bank→prepaid topup is a TRANSFER, prepaid spending is an EXPENSE.
// No legacy prepaid balances are implicitly imported/claimed.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i;
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const makeId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(raw))),
 x=>x.toString(16).padStart(2,'0')).join('');
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join(',')===keys.slice().sort().join(',');
const amount=x=>Number.isSafeInteger(x)&&x>=1&&x<=10000000;
const validDate=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const enabled=env=>env.APP_ENV==='production'&&env.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 env.KAKEIBO_PREPAID_ACTIONS_ENABLED==='true'&&hex.test(env.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(env.KAKEIBO_PREPAID_SUBMISSION_SECRET||'')&&env.DB?.prepare&&
 typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(env.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
}
async function seal(env,id,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
 'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-prepaid:'+id)},key,enc.encode(raw));
 const b64=b=>btoa(String.fromCharCode(...b));
 return {cipher:b64(new Uint8Array(cipher)),iv:b64(iv)};
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=5000?JSON.parse(raw):null}catch{return null}
}
function valid(x,user){
 if(!x||!['topup','spend'].includes(x.action))return false;
 if(x.action==='topup'){
  if(!exact(x,['expected_user_id','idempotency_key','prepaid_account_id','prepaid_version',
   'action','bank_account_id','bank_version','date','amount_jpy','bank_reference','statement_confirmed'])||
   !id32.test(x.bank_account_id)||x.bank_account_id===x.prepaid_account_id||
   !Number.isSafeInteger(x.bank_version)||x.bank_version<1||x.statement_confirmed!==true||
   typeof x.bank_reference!=='string'||x.bank_reference.trim().length<4||
   x.bank_reference.length>160)return false;
 }else{
  if(!exact(x,['expected_user_id','idempotency_key','prepaid_account_id','prepaid_version',
   'action','date','amount_jpy','merchant','category','note'])||
   typeof x.merchant!=='string'||!x.merchant.trim()||x.merchant.length>160||
   typeof x.category!=='string'||!x.category.trim()||x.category.length>40||
   typeof x.note!=='string'||x.note.length>300)return false;
 }
 return x.expected_user_id===user.user_id&&id32.test(x.prepaid_account_id)&&
  Number.isSafeInteger(x.prepaid_version)&&x.prepaid_version>=1&&
  typeof x.idempotency_key==='string'&&/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)&&
  amount(x.amount_jpy)&&validDate(x.date);
}
async function checkAccounts(db,user,x){
 const rows=(await db.prepare('SELECT account_id,account_kind,version FROM family_financial_accounts '+
  "WHERE household_id=? AND owner_user_id=? AND origin='member_created' AND is_archived=0 "+
  'AND account_id IN ('+(x.action==='topup'?'?,?':'?')+')')
  .bind(user.household_id,user.user_id,x.prepaid_account_id,...(x.action==='topup'?[x.bank_account_id]:[])).all()).results||[];
 return rows.length===(x.action==='topup'?2:1)&&
  rows.some(r=>r.account_id===x.prepaid_account_id&&r.account_kind==='prepaid'&&r.version===x.prepaid_version)&&
  (x.action==='spend'||rows.some(r=>r.account_id===x.bank_account_id&&r.account_kind==='bank'&&r.version===x.bank_version));
}
async function balance(db,prepaidId){
 const r=await db.prepare('SELECT (COALESCE((SELECT SUM(delta_jpy) FROM family_prepaid_balance_journal WHERE prepaid_account_id=?),0) '+
  '+COALESCE((SELECT SUM(amount_jpy) FROM family_points_prepaid_credits WHERE prepaid_account_id=?),0)'+
  '-COALESCE((SELECT SUM(debited_prepaid_jpy) FROM family_points_prepaid_refunds WHERE prepaid_account_id=?),0)) total')
  .bind(prepaidId,prepaidId,prepaidId).first();
 return Number.isSafeInteger(r?.total)&&r.total>=0?r.total:null;
}
const visible=r=>({request_id:r.request_id,action:r.action,prepaid_account_id:r.prepaid_account_id,
 prepaid_version:r.prepaid_version,bank_account_id:r.bank_account_id,
 bank_version:r.bank_version,status:r.entry_id?'applied':
 r.status==='submitted'?'submitted_status_unknown':r.status,
 approval_id:r.homeflow_approval_id||null,entry_id:r.entry_id||null,
 balance_after_jpy:r.balance_after_jpy??null,expires_at:r.expires_at,applied:!!r.entry_id});
const one=(db,id,u)=>db.prepare('SELECT p.*,a.entry_id,a.balance_after_jpy '+
 'FROM family_prepaid_action_intents p LEFT JOIN family_prepaid_actions_applied a '+
 'ON a.proposal_id=p.request_id WHERE p.request_id=? AND p.household_id=? '+
 'AND p.requester_user_id=?').bind(id,u.household_id,u.user_id).first();
async function prepare(req,env,url,user){
 const x=await read(req,url);
 if(x?.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 if(!valid(x,user))return fail('INVALID_PREPAID_ACTION',400);
 if(!await checkAccounts(env.DB,user,x))return fail('PREPAID_ACCOUNT_CHANGED');
 if(x.action==='spend'){
  const available=await balance(env.DB,x.prepaid_account_id);
  if(available===null||available<x.amount_jpy)return fail('PREPAID_INSUFFICIENT_BALANCE');
 }
 const raw=JSON.stringify(x.action==='topup'?{
  action:'topup',prepaid_account_id:x.prepaid_account_id,prepaid_version:x.prepaid_version,
  bank_account_id:x.bank_account_id,bank_version:x.bank_version,
  date:x.date,amount_jpy:x.amount_jpy,
  reference_hash:await hash('bank-prepaid:'+x.bank_account_id+'\u0000'+x.bank_reference.trim())
 }:{
  action:'spend',prepaid_account_id:x.prepaid_account_id,prepaid_version:x.prepaid_version,
  date:x.date,amount_jpy:x.amount_jpy,merchant:x.merchant.trim(),
  category:x.category.trim(),note:x.note.trim()
 });
 const digest=await hash(raw),idem=await hash(user.household_id+'\u0000'+user.user_id+
  '\u0000prepaid\u0000'+x.idempotency_key);
 const previous=await env.DB.prepare('SELECT request_id,payload_sha256,requester_user_id,household_id '+
  'FROM family_prepaid_action_intents WHERE idempotency_hash=?').bind(idem).first();
 if(previous){
  if(previous.payload_sha256!==digest||previous.requester_user_id!==user.user_id||
   previous.household_id!==user.household_id)return fail('PREPAID_IDEMPOTENCY_CONFLICT');
  return json({ok:true,prepared:visible(await one(env.DB,previous.request_id,user)),replayed:true});
 }
 const id=makeId(),at=Date.now(),encrypted=await seal(env,id,raw);
 try{
  const response=await env.DB.prepare('INSERT OR IGNORE INTO family_prepaid_action_intents '+
   '(request_id,household_id,requester_user_id,prepaid_account_id,prepaid_version,'+
   'action,bank_account_id,bank_version,payload_sha256,payload_cipher,payload_iv,'+
   'idempotency_hash,status,created_at,expires_at) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)")
   .bind(id,user.household_id,user.user_id,x.prepaid_account_id,x.prepaid_version,
    x.action,x.action==='topup'?x.bank_account_id:null,x.action==='topup'?x.bank_version:null,
    digest,encrypted.cipher,encrypted.iv,idem,at,at+14*86400000).run();
  if(response.meta?.changes!==1)return fail('PREPAID_PREPARE_CONFLICT');
  return json({ok:true,prepared:visible(await one(env.DB,id,user)),replayed:false},201);
 }catch{return fail('PREPAID_PREPARE_UNAVAILABLE',503)}
}
async function submit(req,env,url,user,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await one(env.DB,id,user);
 if(!p)return fail('NOT_FOUND',404);
 if(p.status==='submitted')return json({ok:true,approval_id:p.homeflow_approval_id,
  status:'submitted_status_unknown',applied:false,replayed:true});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('PREPAID_NOT_SUBMITTABLE');
 if(!await checkAccounts(env.DB,user,p))return fail('PREPAID_ACCOUNT_CHANGED');
 const input={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,expected_version:p.prepaid_version,
  action:p.action};
 const raw=JSON.stringify(input),stamp=String(Date.now());let response;
 try{
  const r=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/prepaid-submit',env.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-prepaid','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(env.KAKEIBO_PREPAID_SUBMISSION_SECRET,
     'kakeibo-prepaid:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(r.status)||r.headers.has('location'))return fail('PREPAID_HOMEFLOW_RETRY',503);
  const text=await r.text();if(text.length>1700)return fail('PREPAID_HOMEFLOW_RETRY',503);
  response=JSON.parse(text);
 }catch{return fail('PREPAID_HOMEFLOW_RETRY',503)}
 if(response?.ok!==true||typeof response.approval_id!=='string'||
  !/^[a-f0-9-]{36}$/i.test(response.approval_id)||response.resource_id!==p.request_id||
  response.payload_sha256!==p.payload_sha256||response.household_id!==p.household_id||
  response.requester_user_id!==p.requester_user_id||response.expected_version!==p.prepaid_version||
  response.operation!=='finance.prepaid.'+p.action||response.applied!==false)
  return fail('PREPAID_SUBMIT_UNCONFIRMED',503);
 try{
  const result=await env.DB.prepare("UPDATE family_prepaid_action_intents SET status='submitted',"+
   "homeflow_approval_id=?,submitted_at=? WHERE request_id=? AND household_id=? "+
   "AND requester_user_id=? AND status='prepared' AND expires_at>?")
   .bind(response.approval_id,Date.now(),id,user.household_id,user.user_id,Date.now()).run();
  if(result.meta?.changes!==1){
   const prior=await one(env.DB,id,user);
   if(prior?.status!=='submitted'||prior.homeflow_approval_id!==response.approval_id)
    return fail('PREPAID_SUBMIT_RECONCILE',503);
  }
  return json({ok:true,status:'submitted_status_unknown',approval_id:response.approval_id,
   applied:false});
 }catch{return fail('PREPAID_SUBMIT_RECONCILE',503)}
}
async function cancel(req,env,url,user,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await one(env.DB,id,user);if(!p)return fail('NOT_FOUND',404);
 if(p.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('PREPAID_ALREADY_SUBMITTED');
 const r=await env.DB.prepare("UPDATE family_prepaid_action_intents SET status='cancelled' "+
  "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
  .bind(id,user.household_id,user.user_id).run();
 return r.meta?.changes===1?json({ok:true,status:'cancelled'}):fail('PREPAID_CANCEL_CONFLICT');
}
export async function familyPrepaidActions(req,env,url,user,parts){
 if(!enabled(env))return fail('PREPAID_ACTIONS_DISABLED',503);
 if(user.role!=='member')return fail('ONLY_MEMBER_CAN_PROPOSE',403);
 if(req.method==='GET'&&parts.length===2&&parts[1]==='balances'){
  const rows=(await env.DB.prepare('SELECT a.account_id,a.label,'+
   'COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j '+
   'WHERE j.prepaid_account_id=a.account_id),0) '+
   '+COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c '+
   'WHERE c.prepaid_account_id=a.account_id),0) '+
   '-COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r '+
   'WHERE r.prepaid_account_id=a.account_id),0) balance_jpy '+
   "FROM family_financial_accounts a WHERE a.household_id=? AND a.owner_user_id=? "+
   "AND a.origin='member_created' AND a.account_kind='prepaid' AND a.is_archived=0 "+
   'ORDER BY a.created_at DESC LIMIT 100')
   .bind(user.household_id,user.user_id).all()).results||[];
  if(rows.some(r=>!Number.isSafeInteger(r.balance_jpy)||r.balance_jpy<0))
   return fail('PREPAID_BALANCE_CORRUPT');
  return json({ok:true,items:rows});
 }
 if(req.method==='GET'&&parts.length===1){
  const rows=(await env.DB.prepare('SELECT p.*,a.entry_id,a.balance_after_jpy '+
   'FROM family_prepaid_action_intents p LEFT JOIN family_prepaid_actions_applied a '+
   'ON a.proposal_id=p.request_id WHERE p.household_id=? AND p.requester_user_id=? '+
   'ORDER BY p.created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return json({ok:true,items:rows.map(visible)});
 }
 if(req.method==='POST'&&parts.length===1)return prepare(req,env,url,user);
 if(req.method==='POST'&&parts.length===3&&id32.test(parts[1])){
  if(parts[2]==='submit')return submit(req,env,url,user,parts[1]);
  if(parts[2]==='cancel')return cancel(req,env,url,user,parts[1]);
 }
 if(req.method==='GET'&&parts.length===2&&id32.test(parts[1])){
  const p=await one(env.DB,parts[1],user);
  return p?json({ok:true,action:visible(p)}):fail('NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
