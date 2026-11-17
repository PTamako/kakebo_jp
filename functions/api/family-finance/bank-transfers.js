// P0-4C DRAFT: verified POSTED bank→bank transfer only. Does not initiate bank wire.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const unique=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const date=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_BANK_TRANSFER_ENABLED==='true'&&e.DB?.prepare&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(e.KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function seal(e,requestId,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-bank-transfer:'+requestId)},key,enc.encode(raw));
 const b64=x=>btoa(String.fromCharCode(...x));
 return {payload_cipher:b64(new Uint8Array(data)),payload_iv:b64(iv)};
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 try{const raw=await req.text();return raw.length<=2400?JSON.parse(raw):null}catch{return null}
}
function valid(x,u){
 return exact(x,['expected_user_id','idempotency_key','source_account_id','source_version',
  'target_account_id','target_version','debit_date','credit_date','amount_jpy',
  'source_bank_reference','target_bank_reference','bank_debit_posted','bank_credit_posted'])&&
  x.expected_user_id===u.user_id&&id.test(x.source_account_id)&&id.test(x.target_account_id)&&
  x.source_account_id!==x.target_account_id&&
  Number.isSafeInteger(x.source_version)&&x.source_version>=1&&
  Number.isSafeInteger(x.target_version)&&x.target_version>=1&&
  Number.isSafeInteger(x.amount_jpy)&&x.amount_jpy>=1&&x.amount_jpy<=10000000&&
  date(x.debit_date)&&date(x.credit_date)&&x.debit_date<=x.credit_date&&x.credit_date<=today()&&
  x.bank_debit_posted===true&&x.bank_credit_posted===true&&
  typeof x.source_bank_reference==='string'&&x.source_bank_reference.trim().length>=8&&
  x.source_bank_reference.length<=160&&
  typeof x.target_bank_reference==='string'&&x.target_bank_reference.trim().length>=8&&
  x.target_bank_reference.length<=160&&
  typeof x.idempotency_key==='string'&&/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key);
}
async function accountVersions(db,u,x){
 const r=(await db.prepare('SELECT account_id,account_kind,version FROM family_financial_accounts '+
  "WHERE household_id=? AND owner_user_id=? AND origin='member_created' AND is_archived=0 "+
  'AND account_id IN (?,?)').bind(u.household_id,u.user_id,
   x.source_account_id,x.target_account_id).all()).results||[];
 return r.length===2&&
  r.some(a=>a.account_id===x.source_account_id&&a.account_kind==='bank'&&a.version===x.source_version)&&
  r.some(a=>a.account_id===x.target_account_id&&a.account_kind==='bank'&&a.version===x.target_version);
}
const visible=r=>({request_id:r.request_id,operation:'finance.asset_transfer.bank_to_bank',
 source_account_id:r.source_account_id,source_version:r.source_version,
 target_account_id:r.target_account_id,target_version:r.target_version,
 payload_sha256:r.payload_sha256,status:r.transfer_entry_id?'applied':r.status==='submitted'?
  'submitted_status_unknown':r.status,approval_id:r.homeflow_approval_id||null,
 entry_id:r.transfer_entry_id||null,applied:!!r.transfer_entry_id,expires_at:r.expires_at});
const one=(db,id,u)=>db.prepare('SELECT i.*,a.transfer_entry_id FROM family_bank_transfer_intents i '+
 'LEFT JOIN family_bank_transfers_applied a ON a.proposal_id=i.request_id '+
 'WHERE i.request_id=? AND i.household_id=? AND i.requester_user_id=? LIMIT 1')
 .bind(id,u.household_id,u.user_id).first();
async function prepare(req,e,url,u){
 const x=await read(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('BANK_TRANSFER_ACTOR_CHANGED',403);
 if(!valid(x,u))return fail('BANK_TRANSFER_POSTED_EVIDENCE_REQUIRED',400);
 if(!await accountVersions(e.DB,u,x))return fail('BANK_TRANSFER_OWNER_OR_CAS_CHANGED');
 const source_reference_hash=await hash('bank-statement:'+x.source_account_id+'\0'+x.source_bank_reference.trim());
 const target_reference_hash=await hash('bank-statement:'+x.target_account_id+'\0'+x.target_bank_reference.trim());
 const payload={source_account_id:x.source_account_id,source_version:x.source_version,
  target_account_id:x.target_account_id,target_version:x.target_version,
  debit_date:x.debit_date,credit_date:x.credit_date,amount_jpy:x.amount_jpy,
  source_reference_hash,target_reference_hash,
  bank_debit_posted:true,bank_credit_posted:true,
  evidence_kind:'owner_attested_two_posted_bank_statements'};
 const raw=JSON.stringify(payload),sha256=await hash(raw),
  scope=await hash(u.household_id+'\0'+u.user_id+'\0posted-bank-to-bank\0'+x.idempotency_key);
 const prev=await e.DB.prepare('SELECT request_id,payload_sha256 FROM family_bank_transfer_intents WHERE idempotency_hash=?')
  .bind(scope).first();
 if(prev)return prev.payload_sha256===sha256?
  json({ok:true,prepared:visible(await one(e.DB,prev.request_id,u)),replayed:true}):
  fail('BANK_TRANSFER_IDEMPOTENCY_CONFLICT');
 const requestId=unique(),at=Date.now(),cipher=await seal(e,requestId,raw);
 try{
  const result=await e.DB.prepare('INSERT INTO family_bank_transfer_intents '+
   '(request_id,household_id,requester_user_id,source_account_id,source_version,'+
   'target_account_id,target_version,payload_sha256,payload_cipher,payload_iv,'+
   "idempotency_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .bind(requestId,u.household_id,u.user_id,x.source_account_id,x.source_version,
    x.target_account_id,x.target_version,sha256,cipher.payload_cipher,
    cipher.payload_iv,scope,at,at+14*86400000).run();
  return result.meta?.changes===1?
   json({ok:true,prepared:visible(await one(e.DB,requestId,u)),replayed:false},201):
   fail('BANK_TRANSFER_PREPARE_UNCONFIRMED',503);
 }catch{return fail('BANK_TRANSFER_PREPARE_CONFLICT',409)}
}
async function submit(req,e,url,u,idValue){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)
  return fail('BANK_TRANSFER_ACTOR_CHANGED',403);
 const p=await one(e.DB,idValue,u);
 if(!p)return fail('BANK_TRANSFER_NOT_FOUND',404);
 if(e.KAKEIBO_HOUSEHOLD_LEDGER_ONLY==='true')
  return fail('PERSONAL_BANK_TRANSFER_NO_OWNER_REVIEW',410);
 if(p.status==='submitted'&&uuid.test(p.homeflow_approval_id))
  return json({ok:true,approval_id:p.homeflow_approval_id,status:'submitted_status_unknown',replayed:true,applied:false});
 if(p.status!=='prepared'||p.expires_at<=Date.now())
  return fail('BANK_TRANSFER_NOT_SUBMITTABLE');
 if(!await accountVersions(e.DB,u,p))return fail('BANK_TRANSFER_ACCOUNT_CHANGED');
 const wire={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,expected_version:p.source_version};
 const raw=JSON.stringify(wire),stamp=String(Date.now());let remote;
 try{
  const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/bank-transfer-submit',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-bank-transfer','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET,
      'kakeibo-bank-transfer:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(response.status)||response.headers.has('location'))
   return fail('BANK_TRANSFER_HOMEFLOW_RETRY',503);
  const data=await response.text();if(data.length>1600)return fail('BANK_TRANSFER_HOMEFLOW_RETRY',503);
  remote=JSON.parse(data);
 }catch{return fail('BANK_TRANSFER_HOMEFLOW_RETRY',503)}
 if(remote?.ok!==true||!uuid.test(remote.approval_id)||
  remote.resource_id!==p.request_id||remote.payload_sha256!==p.payload_sha256||
  remote.household_id!==p.household_id||remote.requester_user_id!==p.requester_user_id||
  remote.expected_version!==p.source_version||
  remote.operation!=='finance.asset_transfer.bank_to_bank'||remote.applied!==false)
  return fail('BANK_TRANSFER_REMOTE_UNCONFIRMED',503);
 try{
  const result=await e.DB.prepare("UPDATE family_bank_transfer_intents SET status='submitted',homeflow_approval_id=?,submitted_at=? "+
   "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared' "+
   'AND expires_at>? AND source_version=?')
   .bind(remote.approval_id,Date.now(),idValue,u.household_id,u.user_id,Date.now(),p.source_version).run();
  if(result.meta?.changes!==1){
   const saved=await one(e.DB,idValue,u);
   if(saved?.status==='submitted'&&saved.homeflow_approval_id===remote.approval_id)
    return json({ok:true,approval_id:remote.approval_id,status:'submitted_status_unknown',replayed:true,applied:false});
   return fail('BANK_TRANSFER_SUBMISSION_RECONCILE',503);
  }
  return json({ok:true,approval_id:remote.approval_id,status:'submitted_status_unknown',applied:false});
 }catch{return fail('BANK_TRANSFER_SUBMISSION_RECONCILE',503)}
}
async function cancel(req,e,url,u,idValue){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)
  return fail('BANK_TRANSFER_ACTOR_CHANGED',403);
 const saved=await one(e.DB,idValue,u);
 if(!saved)return fail('BANK_TRANSFER_NOT_FOUND',404);
 if(saved.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
 if(saved.status!=='prepared')return fail('BANK_TRANSFER_CANCEL_IN_HOMEFLOW');
 const result=await e.DB.prepare("UPDATE family_bank_transfer_intents SET status='cancelled' "+
  "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
  .bind(idValue,u.household_id,u.user_id).run();
 return result.meta?.changes===1?json({ok:true,status:'cancelled'}):
  fail('BANK_TRANSFER_CANCEL_CONFLICT',409);
}
export async function familyBankTransfers(req,e,url,u,parts){
 if(!ready(e))return fail('BANK_TRANSFER_DISABLED',503);
 if(u.role!=='member')return fail('BANK_TRANSFER_MEMBER_REQUIRED',403);
 if(parts.length===1&&req.method==='POST')return prepare(req,e,url,u);
 if(parts.length===1&&req.method==='GET'){
  const rows=(await e.DB.prepare('SELECT i.*,a.transfer_entry_id FROM family_bank_transfer_intents i '+
   'LEFT JOIN family_bank_transfers_applied a ON a.proposal_id=i.request_id '+
   'WHERE i.household_id=? AND i.requester_user_id=? ORDER BY i.created_at DESC LIMIT 50')
   .bind(u.household_id,u.user_id).all()).results||[];
  return json({ok:true,items:rows.map(visible)});
 }
 if(parts.length===3&&id.test(parts[1])&&req.method==='POST'){
  if(parts[2]==='submit')return submit(req,e,url,u,parts[1]);
  if(parts[2]==='cancel')return cancel(req,e,url,u,parts[1]);
 }
 if(parts.length===2&&id.test(parts[1])&&req.method==='GET'){
  const saved=await one(e.DB,parts[1],u);
  return saved?json({ok:true,action:visible(saved)}):fail('BANK_TRANSFER_NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
