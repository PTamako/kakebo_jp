// DRAFT P0-4B. Owner-reviewed, already occurred SBI CASH purchase; never places a broker order.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const unique=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const amount=n=>Number.isSafeInteger(n)&&n>=1&&n<=10000000;
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_SBI_CASH_ENABLED==='true'&&hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(e.KAKEIBO_SBI_CASH_SUBMISSION_SECRET||'')&&e.DB?.prepare&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function seal(e,requestId,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-sbi-cash:'+requestId)},key,enc.encode(raw));
 const b64=x=>btoa(String.fromCharCode(...x));
 return {payload_cipher:b64(new Uint8Array(data)),payload_iv:b64(iv)};
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=5000?JSON.parse(raw):null}catch{return null}
}
function valid(x,u){
 return exact(x,['expected_user_id','idempotency_key','bank_account_id','bank_version',
  'securities_account_id','securities_version','kind','debit_date','trade_date','effective_date',
  'amount_jpy','bank_reference','broker_trade_reference','fund_code','account_type',
  'confirmed_units','bank_debit_confirmed','broker_execution_attested'])&&
  x.expected_user_id===u.user_id&&id.test(x.bank_account_id)&&id.test(x.securities_account_id)&&
  x.bank_account_id!==x.securities_account_id&&Number.isSafeInteger(x.bank_version)&&x.bank_version>=1&&
  Number.isSafeInteger(x.securities_version)&&x.securities_version>=1&&
  ['tsumitate','additional'].includes(x.kind)&&
  date(x.debit_date)&&date(x.trade_date)&&date(x.effective_date)&&
  x.debit_date<=x.trade_date&&x.trade_date<=x.effective_date&&x.effective_date<=today()&&
  amount(x.amount_jpy)&&x.bank_debit_confirmed===true&&x.broker_execution_attested===true&&
  typeof x.bank_reference==='string'&&x.bank_reference.trim().length>=4&&x.bank_reference.length<=160&&
  typeof x.broker_trade_reference==='string'&&x.broker_trade_reference.trim().length>=4&&
  x.broker_trade_reference.length<=160&&/^[A-Z0-9]{8}$/.test(x.fund_code)&&
  ['growth','tsumitate'].includes(x.account_type)&&Number.isSafeInteger(x.confirmed_units)&&
  x.confirmed_units>=1&&x.confirmed_units<=1000000000000&&
  typeof x.idempotency_key==='string'&&/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key);
}
async function accountVersions(db,u,x){
 const rows=(await db.prepare('SELECT account_id,account_kind,version,opening_balance FROM family_financial_accounts '+
  "WHERE household_id=? AND owner_user_id=? AND origin='member_created' AND is_archived=0 "+
  'AND account_id IN (?,?)').bind(u.household_id,u.user_id,x.bank_account_id,x.securities_account_id).all()).results||[];
 return rows.length===2&&rows.some(a=>a.account_id===x.bank_account_id&&a.account_kind==='bank'&&a.version===x.bank_version)&&
  rows.some(a=>a.account_id===x.securities_account_id&&a.account_kind==='securities'&&a.version===x.securities_version);
}
const visible=r=>({request_id:r.request_id,operation:'finance.sbi_cash.'+r.kind,
 bank_account_id:r.bank_account_id,bank_version:r.bank_version,
 securities_account_id:r.securities_account_id,securities_version:r.securities_version,
 payload_sha256:r.payload_sha256,status:r.transfer_entry_id?'applied':r.status==='submitted'?'submitted_status_unknown':r.status,
 approval_id:r.homeflow_approval_id||null,transfer_entry_id:r.transfer_entry_id||null,
 expires_at:r.expires_at,applied:!!r.transfer_entry_id});
const one=(db,requestId,u)=>db.prepare('SELECT i.*,a.transfer_entry_id FROM family_sbi_cash_intents i '+
 'LEFT JOIN family_sbi_cash_applied a ON a.proposal_id=i.request_id '+
 'WHERE i.request_id=? AND i.household_id=? AND i.requester_user_id=? LIMIT 1')
 .bind(requestId,u.household_id,u.user_id).first();
async function prepare(req,e,url,u){
 const x=await read(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('SBI_ACTOR_CHANGED',403);
 if(!valid(x,u))return fail('SBI_CASH_INVALID_INPUT',400);
 if(!await accountVersions(e.DB,u,x))return fail('SBI_CASH_ACCOUNT_CHANGED');
 const reference_hash=await hash('bank-statement:'+x.bank_account_id+'\0'+x.bank_reference.trim());
 const broker_reference_hash=await hash(u.household_id+'\0sbi-confirmed-trade\0'+x.broker_trade_reference.trim());
 const payload={bank_account_id:x.bank_account_id,bank_version:x.bank_version,
  securities_account_id:x.securities_account_id,securities_version:x.securities_version,
  kind:x.kind,debit_date:x.debit_date,trade_date:x.trade_date,effective_date:x.effective_date,
  amount_jpy:x.amount_jpy,reference_hash,broker_reference_hash,fund_code:x.fund_code,
  account_type:x.account_type,confirmed_units:x.confirmed_units,
  evidence_kind:'owner_confirmed_statement',broker_execution_attested:true};
 const raw=JSON.stringify(payload),digest=await hash(raw),scope=await hash(
  u.household_id+'\0'+u.user_id+'\0sbi-cash\0'+x.idempotency_key);
 const old=await e.DB.prepare('SELECT request_id,payload_sha256 FROM family_sbi_cash_intents WHERE idempotency_hash=?').bind(scope).first();
 if(old)return old.payload_sha256===digest?
  json({ok:true,prepared:visible(await one(e.DB,old.request_id,u)),replayed:true}):
  fail('SBI_CASH_IDEMPOTENCY_CONFLICT');
 const requestId=unique(),now=Date.now(),sealed=await seal(e,requestId,raw);
 try{
  const result=await e.DB.prepare('INSERT OR IGNORE INTO family_sbi_cash_intents '+
   '(request_id,household_id,requester_user_id,bank_account_id,bank_version,'+
   'securities_account_id,securities_version,kind,payload_sha256,payload_cipher,payload_iv,'+
   "idempotency_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)")
   .bind(requestId,u.household_id,u.user_id,x.bank_account_id,x.bank_version,
    x.securities_account_id,x.securities_version,x.kind,digest,
    sealed.payload_cipher,sealed.payload_iv,scope,now,now+14*86400000).run();
  if(result.meta?.changes!==1)return fail('SBI_CASH_PREPARE_CONFLICT');
  return json({ok:true,prepared:visible(await one(e.DB,requestId,u)),replayed:false},201);
 }catch{return fail('SBI_CASH_PREPARE_FAILED',503)}
}
async function submit(req,e,url,u,requestId){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)return fail('SBI_ACTOR_CHANGED',403);
 const p=await one(e.DB,requestId,u);
 if(!p)return fail('SBI_CASH_NOT_FOUND',404);
 if(p.status==='submitted'&&uuid.test(p.homeflow_approval_id))
  return json({ok:true,status:'submitted_status_unknown',approval_id:p.homeflow_approval_id,replayed:true,applied:false});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('SBI_CASH_NOT_SUBMITTABLE');
 if(!await accountVersions(e.DB,u,p))return fail('SBI_CASH_ACCOUNT_CHANGED');
 const envelope={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,expected_version:p.bank_version,
  kind:p.kind};
 const raw=JSON.stringify(envelope),stamp=String(Date.now());let remote;
 try{
  const res=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/sbi-cash-submit',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-sbi-cash','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_SBI_CASH_SUBMISSION_SECRET,
     'kakeibo-sbi-cash:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(res.status)||res.headers.has('location'))return fail('SBI_CASH_HOMEFLOW_RETRY',503);
  const text=await res.text();if(text.length>1900)return fail('SBI_CASH_HOMEFLOW_RETRY',503);
  remote=JSON.parse(text);
 }catch{return fail('SBI_CASH_HOMEFLOW_RETRY',503)}
 if(remote?.ok!==true||!uuid.test(remote.approval_id)||remote.resource_id!==p.request_id||
  remote.payload_sha256!==p.payload_sha256||remote.household_id!==p.household_id||
  remote.requester_user_id!==p.requester_user_id||remote.expected_version!==p.bank_version||
  remote.operation!=='finance.sbi_cash.'+p.kind||remote.applied!==false)
  return fail('SBI_CASH_HOMEFLOW_UNCONFIRMED',503);
 try{
  const result=await e.DB.prepare("UPDATE family_sbi_cash_intents SET status='submitted',homeflow_approval_id=?,submitted_at=? "+
   "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared' AND expires_at>? AND bank_version=?")
   .bind(remote.approval_id,Date.now(),requestId,u.household_id,u.user_id,Date.now(),p.bank_version).run();
  if(result.meta?.changes!==1){
   const raced=await one(e.DB,requestId,u);
   if(raced?.status==='submitted'&&raced.homeflow_approval_id===remote.approval_id)
    return json({ok:true,status:'submitted_status_unknown',approval_id:remote.approval_id,replayed:true,applied:false});
   return fail('SBI_CASH_SUBMISSION_RECONCILE',503);
  }
  return json({ok:true,status:'submitted_status_unknown',approval_id:remote.approval_id,replayed:false,applied:false});
 }catch{return fail('SBI_CASH_SUBMISSION_RECONCILE',503)}
}
async function cancel(req,e,url,u,requestId){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)return fail('SBI_ACTOR_CHANGED',403);
 const p=await one(e.DB,requestId,u);
 if(!p)return fail('SBI_CASH_NOT_FOUND',404);
 if(p.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('SBI_CASH_CANCEL_IN_HOMEFLOW');
 const r=await e.DB.prepare("UPDATE family_sbi_cash_intents SET status='cancelled' WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
  .bind(requestId,u.household_id,u.user_id).run();
 return r.meta?.changes===1?json({ok:true,status:'cancelled'}):fail('SBI_CASH_CANCEL_CONFLICT');
}
export async function familySbiCashActions(req,e,url,u,parts){
 if(!ready(e))return fail('SBI_CASH_DISABLED',503);
 if(u.role!=='member')return fail('SBI_CASH_MEMBER_REQUIRED',403);
 if(parts.length===1&&req.method==='POST')return prepare(req,e,url,u);
 if(parts.length===1&&req.method==='GET'){
  const result=(await e.DB.prepare('SELECT i.*,a.transfer_entry_id FROM family_sbi_cash_intents i '+
   'LEFT JOIN family_sbi_cash_applied a ON a.proposal_id=i.request_id '+
   'WHERE i.household_id=? AND i.requester_user_id=? ORDER BY i.created_at DESC LIMIT 50')
   .bind(u.household_id,u.user_id).all()).results||[];
  return json({ok:true,items:result.map(visible)});
 }
 if(parts.length===3&&id.test(parts[1])&&req.method==='POST'){
  if(parts[2]==='submit')return submit(req,e,url,u,parts[1]);
  if(parts[2]==='cancel')return cancel(req,e,url,u,parts[1]);
 }
 if(parts.length===2&&id.test(parts[1])&&req.method==='GET'){
  const r=await one(e.DB,parts[1],u);
  return r?json({ok:true,action:visible(r)}):fail('SBI_CASH_NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
