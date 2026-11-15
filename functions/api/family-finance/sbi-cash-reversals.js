// DRAFT 0045: SBI full cash purchase refund, strictly after POSTED bank credit and broker cancellation.
// Never sends a broker order, never guesses from legacy screenshots or a pending refund.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,uuid=/^[a-f0-9-]{36}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const uid=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_SBI_CASH_ENABLED==='true'&&e.KAKEIBO_SBI_CASH_REVERSALS_ENABLED==='true'&&e.DB?.prepare&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&hex.test(e.KAKEIBO_SBI_CASH_SUBMISSION_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function seal(e,requestId,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({
  name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-sbi-cash-reversal:'+requestId)},key,enc.encode(raw));
 const b64=x=>btoa(String.fromCharCode(...x));
 return {payload_cipher:b64(new Uint8Array(data)),payload_iv:b64(iv)};
}
async function body(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=3000?JSON.parse(raw):null}catch{return null}
}
async function original(db,id,u){
 return db.prepare('SELECT a.*,l.fund_code,l.account_type,l.confirmed_units,l.acquisition_cost_jpy,'+
  'l.broker_reference_hash,bank.version AS live_bank,bank.is_archived AS archived_bank,'+
  'sec.version AS live_securities,sec.is_archived AS archived_securities '+
  'FROM family_sbi_cash_applied a JOIN family_sbi_cash_lots l ON l.homeflow_request_id=a.homeflow_request_id '+
  'JOIN family_financial_accounts bank ON bank.account_id=a.bank_account_id '+
  'JOIN family_financial_accounts sec ON sec.account_id=a.securities_account_id '+
  'WHERE a.homeflow_request_id=? AND a.household_id=? AND a.requester_user_id=? '+
  "AND bank.household_id=? AND sec.household_id=? AND bank.owner_user_id=? AND sec.owner_user_id=? "+
  "AND bank.origin='member_created' AND sec.origin='member_created' "+
  "AND bank.account_kind='bank' AND sec.account_kind='securities' LIMIT 1")
  .bind(id,u.household_id,u.user_id,u.household_id,u.household_id,u.user_id,u.user_id).first();
}
const safe=x=>({request_id:x.request_id,original_request_id:x.original_request_id,
 payload_sha256:x.payload_sha256,bank_account_id:x.bank_account_id,
 securities_account_id:x.securities_account_id,status:x.reversal_entry_id?'applied':x.status==='submitted'?'submitted_status_unknown':x.status,
 approval_id:x.homeflow_approval_id||null,applied:!!x.reversal_entry_id,
 reversal_entry_id:x.reversal_entry_id||null,expires_at:x.expires_at});
const one=(db,id,u)=>db.prepare('SELECT i.*,r.reversal_entry_id FROM family_sbi_cash_reversal_intents i '+
 'LEFT JOIN family_sbi_cash_reversals r ON r.proposal_id=i.request_id '+
 'WHERE i.request_id=? AND i.household_id=? AND i.requester_user_id=? LIMIT 1')
 .bind(id,u.household_id,u.user_id).first();
async function prepare(req,e,url,u){
 const x=await body(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('SBI_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','idempotency_key','original_request_id',
  'bank_version','securities_version','bank_refund_reference','broker_cancel_reference',
  'bank_refund_date','broker_cancel_date','bank_refund_confirmed','broker_cancel_confirmed'])||
  !uuid.test(x.original_request_id)||!Number.isSafeInteger(x.bank_version)||x.bank_version<1||
  !Number.isSafeInteger(x.securities_version)||x.securities_version<1||
  x.bank_refund_confirmed!==true||x.broker_cancel_confirmed!==true||
  !date(x.bank_refund_date)||!date(x.broker_cancel_date)||x.bank_refund_date>today()||
  typeof x.bank_refund_reference!=='string'||x.bank_refund_reference.trim().length<4||
  x.bank_refund_reference.length>160||
  typeof x.broker_cancel_reference!=='string'||x.broker_cancel_reference.trim().length<4||
  x.broker_cancel_reference.length>160||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
  return fail('SBI_REFUND_POSTED_EVIDENCE_REQUIRED',400);
 const old=await original(e.DB,x.original_request_id,u);
 if(!old||old.live_bank!==x.bank_version||old.live_securities!==x.securities_version||
  old.archived_bank!==0||old.archived_securities!==0||
  x.broker_cancel_date<old.trade_date||x.bank_refund_date<x.broker_cancel_date||
  x.bank_refund_date<old.effective_date)return fail('SBI_REFUND_ORIGINAL_OR_VERSION');
 const refunded=await e.DB.prepare('SELECT homeflow_request_id FROM family_sbi_cash_reversals WHERE original_request_id=?')
  .bind(x.original_request_id).first();
 if(refunded)return fail('SBI_REFUND_ALREADY_APPLIED');
 const refundHash=await hash('bank-statement:'+old.bank_account_id+'\0'+x.bank_refund_reference.trim());
 const cancelHash=await hash(u.household_id+'\0sbi-cancelled-trade\0'+x.broker_cancel_reference.trim());
 const payload={original_request_id:x.original_request_id,bank_account_id:old.bank_account_id,
  bank_version:x.bank_version,securities_account_id:old.securities_account_id,
  securities_version:x.securities_version,bank_refund_hash:refundHash,
  broker_cancel_hash:cancelHash,bank_refund_date:x.bank_refund_date,
  broker_cancel_date:x.broker_cancel_date,amount_jpy:old.amount_jpy,
  confirmed_units:old.confirmed_units,acquisition_cost_jpy:old.acquisition_cost_jpy,
  fund_code:old.fund_code,account_type:old.account_type,
  bank_refund_confirmed:true,broker_cancel_confirmed:true};
 const raw=JSON.stringify(payload),digest=await hash(raw),
  scope=await hash(u.household_id+'\0'+u.user_id+'\0sbi-cash-reversal\0'+x.idempotency_key);
 const repeat=await e.DB.prepare('SELECT request_id,payload_sha256 FROM family_sbi_cash_reversal_intents WHERE idempotency_hash=?')
  .bind(scope).first();
 if(repeat)return repeat.payload_sha256===digest?
  json({ok:true,prepared:safe(await one(e.DB,repeat.request_id,u)),replayed:true}):
  fail('SBI_REFUND_IDEMPOTENCY_CONFLICT');
 const requestId=uid(),at=Date.now(),sealed=await seal(e,requestId,raw);
 try{
  const result=await e.DB.prepare('INSERT INTO family_sbi_cash_reversal_intents '+
   '(request_id,original_request_id,household_id,requester_user_id,bank_account_id,bank_version,'+
   'securities_account_id,securities_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,'+
   'created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(requestId,x.original_request_id,u.household_id,u.user_id,
    old.bank_account_id,x.bank_version,old.securities_account_id,x.securities_version,
    digest,sealed.payload_cipher,sealed.payload_iv,scope,at,at+14*86400000).run();
  return result.meta?.changes===1?
   json({ok:true,prepared:safe(await one(e.DB,requestId,u)),replayed:false},201):
   fail('SBI_REFUND_PREPARE_CONFLICT');
 }catch{return fail('SBI_REFUND_ORIGINAL_ALREADY_RESERVED_OR_INVALID',409)}
}
async function submit(req,e,url,u,id){
 const x=await body(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)
  return fail('SBI_ACTOR_CHANGED',403);
 const p=await one(e.DB,id,u);
 if(!p)return fail('SBI_REFUND_NOT_FOUND',404);
 if(p.status==='submitted'&&p.homeflow_approval_id)
  return json({ok:true,status:'submitted_status_unknown',approval_id:p.homeflow_approval_id,
   applied:false,replayed:true});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('SBI_REFUND_NOT_SUBMITTABLE');
 const live=await original(e.DB,p.original_request_id,u);
 if(!live||live.live_bank!==p.bank_version||live.live_securities!==p.securities_version||
  live.archived_bank!==0||live.archived_securities!==0)
  return fail('SBI_REFUND_VERSION_CHANGED');
 const envelope={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,expected_version:p.bank_version,
  kind:'reversal'};
 const raw=JSON.stringify(envelope),stamp=String(Date.now());let remote;
 try{
  const res=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/sbi-cash-submit',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-sbi-cash','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_SBI_CASH_SUBMISSION_SECRET,
     'kakeibo-sbi-cash:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(res.status)||res.headers.has('location'))return fail('SBI_REFUND_HOMEFLOW_RETRY',503);
  const text=await res.text();if(text.length>1900)return fail('SBI_REFUND_HOMEFLOW_RETRY',503);
  remote=JSON.parse(text);
 }catch{return fail('SBI_REFUND_HOMEFLOW_RETRY',503)}
 if(remote?.ok!==true||!uuid.test(remote.approval_id)||remote.resource_id!==p.request_id||
  remote.payload_sha256!==p.payload_sha256||remote.household_id!==p.household_id||
  remote.requester_user_id!==p.requester_user_id||remote.expected_version!==p.bank_version||
  remote.operation!=='finance.sbi_cash.reversal'||remote.applied!==false)
  return fail('SBI_REFUND_HOMEFLOW_UNCONFIRMED',503);
 try{
  const row=await e.DB.prepare("UPDATE family_sbi_cash_reversal_intents SET status='submitted',"+
   "homeflow_approval_id=?,submitted_at=? WHERE request_id=? AND household_id=? AND requester_user_id=? "+
   "AND status='prepared' AND expires_at>? AND bank_version=?")
   .bind(remote.approval_id,Date.now(),id,u.household_id,u.user_id,Date.now(),p.bank_version).run();
  if(row.meta?.changes!==1){
   const after=await one(e.DB,id,u);
   if(after?.status==='submitted'&&after.homeflow_approval_id===remote.approval_id)
    return json({ok:true,status:'submitted_status_unknown',approval_id:remote.approval_id,replayed:true,applied:false});
   return fail('SBI_REFUND_SUBMISSION_RECONCILE',503);
  }
  return json({ok:true,status:'submitted_status_unknown',approval_id:remote.approval_id,applied:false});
 }catch{return fail('SBI_REFUND_SUBMISSION_RECONCILE',503)}
}
export async function familySbiCashReversals(req,e,url,u,parts){
 if(!ready(e))return fail('SBI_REFUND_DISABLED',503);
 if(u.role!=='member')return fail('SBI_REFUND_MEMBER_REQUIRED',403);
 if(parts.length===1&&req.method==='POST')return prepare(req,e,url,u);
 if(parts.length===1&&req.method==='GET'){
  const list=(await e.DB.prepare('SELECT i.*,r.reversal_entry_id FROM family_sbi_cash_reversal_intents i '+
   'LEFT JOIN family_sbi_cash_reversals r ON r.proposal_id=i.request_id '+
   'WHERE i.household_id=? AND i.requester_user_id=? ORDER BY i.created_at DESC LIMIT 50')
   .bind(u.household_id,u.user_id).all()).results||[];
  return json({ok:true,items:list.map(safe)});
 }
 if(parts.length===3&&id.test(parts[1])&&req.method==='POST'){
  if(parts[2]==='submit')return submit(req,e,url,u,parts[1]);
  if(parts[2]==='cancel'){
   const x=await body(req,url);
   if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)return fail('SBI_ACTOR_CHANGED',403);
   const p=await one(e.DB,parts[1],u);
   if(!p)return fail('SBI_REFUND_NOT_FOUND',404);
   if(p.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
   if(p.status!=='prepared')return fail('SBI_REFUND_CANCEL_IN_HOMEFLOW');
   const r=await e.DB.prepare("UPDATE family_sbi_cash_reversal_intents SET status='cancelled' "+
    "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
    .bind(parts[1],u.household_id,u.user_id).run();
   return r.meta?.changes===1?json({ok:true,status:'cancelled'}):fail('SBI_REFUND_CANCEL_CONFLICT');
  }
 }
 if(parts.length===2&&id.test(parts[1])&&req.method==='GET'){
  const r=await one(e.DB,parts[1],u);
  return r?json({ok:true,action:safe(r)}):fail('SBI_REFUND_NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
