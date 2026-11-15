// P0-4C DRAFT: member -> owner BANK accounts, not an external bank wire.
// Separate SSO recipient evidence, HomeFlow consent proof, and existing approval.
const enc=new TextEncoder(),h64=/^[0-9a-f]{64}$/i,h32=/^[0-9a-f]{32}$/i,
 uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const deny=(code,status=409)=>reply({ok:false,code,applied:false},status);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const hexhash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const newId=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const iso=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED==='true'&&e.KAKEIBO_BANK_TRANSFER_ENABLED==='true'&&
 e.DB?.prepare&&h64.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 h64.test(e.KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET||'')&&
 h64.test(e.KAKEIBO_CROSS_MEMBER_PROOF_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=2400?JSON.parse(raw):null}catch{return null}
}
async function seal(e,id,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const buf=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-cross-bank:'+id)},key,enc.encode(raw));
 const b64=v=>btoa(String.fromCharCode(...v));
 return {cipher:b64(new Uint8Array(buf)),iv:b64(iv)};
}
const visible=r=>({request_id:r.request_id,resource_id:r.request_id,
 payload_sha256:r.payload_sha256,source_user_id:r.requester_user_id,
 recipient_user_id:r.recipient_user_id,source_account_id:r.source_account_id,
 source_account_version:r.source_version,target_account_id:r.target_account_id,
 recipient_account_version:r.target_version,recipient_confirmed:!!r.credit_reference_hash,
 status:r.transfer_entry_id?'applied':r.status==='submitted'?'submitted_status_unknown':r.status,
 consent_id:r.consent_id||null,approval_id:r.homeflow_approval_id||null,
 applied:!!r.transfer_entry_id,expires_at:r.expires_at});
const SELECT='SELECT i.*,r.credit_reference_hash,r.credit_date,j.transfer_entry_id '+
 'FROM family_cross_bank_intents i LEFT JOIN family_cross_bank_recipient_evidence r ON r.request_id=i.request_id '+
 'LEFT JOIN family_cross_bank_journal j ON j.proposal_id=i.request_id ';
const readOne=(db,id,u)=>db.prepare(SELECT+'WHERE i.request_id=? AND i.household_id=? '+
 'AND (i.requester_user_id=? OR i.recipient_user_id=?) LIMIT 1')
 .bind(id,u.household_id,u.user_id,u.user_id).first();
async function versions(db,row){
 const items=(await db.prepare('SELECT account_id,household_id,owner_user_id,account_kind,origin,is_archived,version FROM family_financial_accounts '+
 'WHERE account_id IN(?,?)').bind(row.source_account_id,row.target_account_id).all()).results||[];
 return items.length===2&&items.some(a=>a.account_id===row.source_account_id&&
 a.household_id===row.household_id&&a.owner_user_id===row.requester_user_id&&
 a.account_kind==='bank'&&a.origin==='member_created'&&a.is_archived===0&&a.version===row.source_version)&&
 items.some(a=>a.account_id===row.target_account_id&&a.household_id===row.household_id&&
 a.owner_user_id===row.recipient_user_id&&a.account_kind==='bank'&&
 a.origin==='member_created'&&a.is_archived===0&&a.version===row.target_version);
}
async function prepare(req,e,url,u){
 if(u.role!=='member')return deny('CROSS_BANK_MEMBER_SOURCE_REQUIRED',403);
 const x=await read(req,url);
 if(!x||x.expected_user_id!==u.user_id)return deny('CROSS_BANK_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','recipient_user_id','idempotency_key','source_account_id',
  'source_version','target_account_id','target_version','debit_date','amount_jpy',
  'source_bank_reference','bank_debit_posted'])||
  x.recipient_user_id===u.user_id||typeof x.recipient_user_id!=='string'||
  !h32.test(x.source_account_id)||!h32.test(x.target_account_id)||
  x.source_account_id===x.target_account_id||
  !Number.isSafeInteger(x.source_version)||x.source_version<1||
  !Number.isSafeInteger(x.target_version)||x.target_version<1||
  !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
  !iso(x.debit_date)||x.debit_date>today()||x.bank_debit_posted!==true||
  typeof x.source_bank_reference!=='string'||x.source_bank_reference.trim().length<8||
  x.source_bank_reference.length>160||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
  return deny('CROSS_BANK_POSTED_DEBIT_REQUIRED',400);
 const row={household_id:u.household_id,requester_user_id:u.user_id,...x};
 if(!await versions(e.DB,row))return deny('CROSS_BANK_OWNER_OR_CAS_CHANGED');
 const recipient=await e.DB.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?')
  .bind(x.recipient_user_id,u.household_id).first();
 if(recipient?.state!=='active'||recipient?.role!=='owner')return deny('CROSS_BANK_RECIPIENT_INACTIVE',403);
 const sourceRef=await hexhash('bank-statement:'+x.source_account_id+'\0'+x.source_bank_reference.trim());
 const payload={source_user_id:u.user_id,recipient_user_id:x.recipient_user_id,
  source_account_id:x.source_account_id,source_version:x.source_version,
  target_account_id:x.target_account_id,target_version:x.target_version,
  debit_date:x.debit_date,amount_jpy:x.amount_jpy,source_reference_hash:sourceRef,
  bank_debit_posted:true,evidence_kind:'source_attested_posted_debit'};
 const raw=JSON.stringify(payload),digest=await hexhash(raw);
 const scoped=await hexhash([u.household_id,u.user_id,'cross-bank',x.idempotency_key].join('\0'));
 const prev=await e.DB.prepare('SELECT request_id,payload_sha256 FROM family_cross_bank_intents WHERE idempotency_hash=?')
  .bind(scoped).first();
 if(prev)return prev.payload_sha256===digest?reply({ok:true,prepared:visible(await readOne(e.DB,prev.request_id,u)),replayed:true}):deny('CROSS_BANK_IDEMPOTENCY_CONFLICT');
 const id=newId(),at=Date.now(),sealed=await seal(e,id,raw);
 try{
  const result=await e.DB.prepare('INSERT INTO family_cross_bank_intents '+
   '(request_id,household_id,requester_user_id,recipient_user_id,source_account_id,source_version,'+
   'target_account_id,target_version,amount_jpy,debit_date,source_reference_hash,payload_sha256,'+
   'payload_cipher,payload_iv,idempotency_hash,created_at,expires_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,u.household_id,u.user_id,x.recipient_user_id,x.source_account_id,x.source_version,
   x.target_account_id,x.target_version,x.amount_jpy,x.debit_date,sourceRef,digest,
   sealed.cipher,sealed.iv,scoped,at,at+86400000).run();
  return result.meta?.changes===1?
    reply({ok:true,prepared:visible(await readOne(e.DB,id,u)),replayed:false},201):
    deny('CROSS_BANK_PREPARE_UNCONFIRMED',503);
 }catch{return deny('CROSS_BANK_PREPARE_CONFLICT')}
}
async function recipient(req,e,url,u,id){
 const x=await read(req,url);
 if(!x||x.expected_user_id!==u.user_id)return deny('CROSS_BANK_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','credit_date','amount_jpy','target_bank_reference','bank_credit_posted'])||
   !iso(x.credit_date)||x.credit_date>today()||
   !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||
   x.bank_credit_posted!==true||typeof x.target_bank_reference!=='string'||
   x.target_bank_reference.trim().length<8||x.target_bank_reference.length>160)
  return deny('CROSS_BANK_INDEPENDENT_CREDIT_REQUIRED',400);
 const p=await readOne(e.DB,id,u);
 if(!p)return deny('CROSS_BANK_NOT_FOUND',404);
 if(p.recipient_user_id!==u.user_id||u.role!=='owner')return deny('CROSS_BANK_RECIPIENT_ONLY',403);
 if(p.status!=='prepared'||p.expires_at<=Date.now()||!await versions(e.DB,p))
  return deny('CROSS_BANK_INTENT_OR_CAS_CHANGED');
 if(x.amount_jpy!==p.amount_jpy||x.credit_date<p.debit_date)
  return deny('CROSS_BANK_POSTED_CREDIT_MISMATCH');
 const ref=await hexhash('bank-statement:'+p.target_account_id+'\0'+x.target_bank_reference.trim());
 if(p.credit_reference_hash)return p.credit_reference_hash===ref&&p.credit_date===x.credit_date?
  reply({ok:true,recipient_confirmed:true,replayed:true,applied:false}):
  deny('CROSS_BANK_RECIPIENT_EVIDENCE_IMMUTABLE');
 try{
  const result=await e.DB.prepare('INSERT INTO family_cross_bank_recipient_evidence '+
   '(request_id,household_id,recipient_user_id,target_account_id,target_version,'+
   'credit_reference_hash,credit_date,amount_jpy,credit_posted,confirmed_at) VALUES(?,?,?,?,?,?,?,?,1,?)')
   .bind(id,u.household_id,u.user_id,p.target_account_id,p.target_version,
    ref,x.credit_date,x.amount_jpy,Date.now()).run();
  return result.meta?.changes===1?reply({ok:true,recipient_confirmed:true,replayed:false,applied:false},201):
   deny('CROSS_BANK_RECIPIENT_UNCONFIRMED',503);
 }catch{return deny('CROSS_BANK_RECIPIENT_CONFLICT')}
}
async function callHomeflow(e,path,client,domain,secret,body){
 const raw=JSON.stringify(body),stamp=String(Date.now());
 try{
  const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL(path,e.HOMEFLOW_OAUTH_ORIGIN),{method:'POST',redirect:'manual',
    headers:{'content-type':'application/json','x-approval-client':client,
     'x-approval-timestamp':stamp,'x-approval-signature':await mac(secret,domain,stamp,raw)},
    body:raw}));
  if(![200,201].includes(response.status)||response.headers.has('location'))return null;
  const text=await response.text();return text.length<=2400?JSON.parse(text):null;
 }catch{return null}
}
async function consent(e,p,id){
 return callHomeflow(e,'/api/internal/cross-member/consent-proof','kakeibo-cross-member',
  'kakeibo-cross-member:consent-proof',e.KAKEIBO_CROSS_MEMBER_PROOF_SECRET,
  {consent_id:id,resource_id:p.request_id,household_id:p.household_id,
   source_user_id:p.requester_user_id,recipient_user_id:p.recipient_user_id,
   payload_sha256:p.payload_sha256,source_account_version:p.source_version,
   recipient_account_version:p.target_version});
}
async function submit(req,e,url,u,id){
 const x=await read(req,url);
 if(!x||x.expected_user_id!==u.user_id)return deny('CROSS_BANK_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','consent_id'])||!uuid.test(x.consent_id))
  return deny('CROSS_BANK_CONSENT_ID_REQUIRED',400);
 const p=await readOne(e.DB,id,u);
 if(!p)return deny('CROSS_BANK_NOT_FOUND',404);
 if(p.requester_user_id!==u.user_id||u.role!=='member')return deny('CROSS_BANK_SOURCE_ONLY',403);
 if(p.status==='submitted'&&p.consent_id===x.consent_id&&uuid.test(p.homeflow_approval_id))
  return reply({ok:true,approval_id:p.homeflow_approval_id,status:'submitted_status_unknown',replayed:true,applied:false});
 if(p.status!=='prepared'||p.expires_at<=Date.now()||!p.credit_reference_hash||
  !await versions(e.DB,p))return deny('CROSS_BANK_NOT_SUBMITTABLE');
 const validated=await consent(e,p,x.consent_id);
 if(validated?.ok!==true||validated.consent_verified!==true||validated.ledger_applied!==false||
  validated.target_ledger_authorized!==false||
  validated.consent_id!==x.consent_id||validated.resource_id!==p.request_id||
  validated.payload_sha256!==p.payload_sha256||validated.household_id!==p.household_id||
  validated.source_user_id!==p.requester_user_id||validated.recipient_user_id!==p.recipient_user_id||
  validated.source_account_version!==p.source_version||
  validated.recipient_account_version!==p.target_version||
  validated.owner_authorizer_user_id!==p.recipient_user_id||validated.consent_version!==3||
  !Number.isSafeInteger(validated.valid_until)||validated.valid_until<=Date.now())
  return deny('CROSS_BANK_CONSENT_NOT_CURRENT');
 const remote=await callHomeflow(e,'/api/internal/approvals/bank-transfer-submit',
  'kakeibo-bank-transfer','kakeibo-bank-transfer:submit',
  e.KAKEIBO_BANK_TRANSFER_SUBMISSION_SECRET,
  {household_id:p.household_id,requester_user_id:p.requester_user_id,
   resource_id:p.request_id,payload_sha256:p.payload_sha256,expected_version:p.source_version});
 if(remote?.ok!==true||!uuid.test(remote.approval_id)||remote.applied!==false||
  remote.resource_id!==p.request_id||remote.payload_sha256!==p.payload_sha256||
  remote.household_id!==p.household_id||remote.requester_user_id!==p.requester_user_id||
  remote.expected_version!==p.source_version||
  remote.operation!=='finance.asset_transfer.bank_to_bank')
  return deny('CROSS_BANK_APPROVAL_SUBMISSION_UNKNOWN',503);
 try{
  const changed=await e.DB.prepare("UPDATE family_cross_bank_intents SET status='submitted',"+
   'consent_id=?,homeflow_approval_id=?,submitted_at=? WHERE request_id=? AND household_id=? '+
   "AND requester_user_id=? AND status='prepared' AND expires_at>?")
   .bind(x.consent_id,remote.approval_id,Date.now(),id,u.household_id,u.user_id,Date.now()).run();
  if(changed.meta?.changes!==1){
   const race=await readOne(e.DB,id,u);
   return race?.status==='submitted'&&race.consent_id===x.consent_id&&race.homeflow_approval_id===remote.approval_id?
    reply({ok:true,approval_id:remote.approval_id,status:'submitted_status_unknown',replayed:true,applied:false}):
    deny('CROSS_BANK_SUBMISSION_RECONCILIATION_REQUIRED',503);
  }
  return reply({ok:true,approval_id:remote.approval_id,status:'submitted_status_unknown',applied:false});
 }catch{return deny('CROSS_BANK_SUBMISSION_RECONCILIATION_REQUIRED',503)}
}
async function cancel(req,e,url,u,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)return deny('CROSS_BANK_ACTOR_CHANGED',403);
 const p=await readOne(e.DB,id,u);
 if(!p)return deny('CROSS_BANK_NOT_FOUND',404);
 if(p.requester_user_id!==u.user_id)return deny('CROSS_BANK_SOURCE_ONLY',403);
 if(p.status==='cancelled')return reply({ok:true,status:'cancelled',replayed:true,applied:false});
 if(p.status!=='prepared')return deny('CROSS_BANK_CANCEL_VIA_HOMEFLOW');
 try{
  const result=await e.DB.prepare("UPDATE family_cross_bank_intents SET status='cancelled' "+
   "WHERE request_id=? AND requester_user_id=? AND status='prepared'")
   .bind(id,u.user_id).run();
  return result.meta?.changes===1?reply({ok:true,status:'cancelled',applied:false}):
   deny('CROSS_BANK_CANCEL_CONFLICT');
 }catch{return deny('CROSS_BANK_CANCEL_CONFLICT')}
}
export async function familyCrossMemberBankTransfers(req,e,url,u,parts){
 if(!ready(e))return deny('CROSS_BANK_DISABLED',503);
 if(parts.length===1&&req.method==='POST')return prepare(req,e,url,u);
 if(req.method==='GET'&&parts.length===1){
  const result=(await e.DB.prepare(SELECT+'WHERE i.household_id=? AND (i.requester_user_id=? OR i.recipient_user_id=?) '+
   'ORDER BY i.created_at DESC LIMIT 30').bind(u.household_id,u.user_id,u.user_id).all()).results||[];
  return reply({ok:true,items:result.map(visible)});
 }
 if(parts.length>=2&&!h32.test(parts[1]))return deny('CROSS_BANK_NOT_FOUND',404);
 if(parts.length===2&&req.method==='GET'){
  const p=await readOne(e.DB,parts[1],u);
  return p?reply({ok:true,action:visible(p)}):deny('CROSS_BANK_NOT_FOUND',404);
 }
 if(parts.length===3&&req.method==='POST'){
  if(parts[2]==='recipient')return recipient(req,e,url,u,parts[1]);
  if(parts[2]==='submit')return submit(req,e,url,u,parts[1]);
  if(parts[2]==='cancel')return cancel(req,e,url,u,parts[1]);
 }
 return deny('NOT_FOUND',404);
}
