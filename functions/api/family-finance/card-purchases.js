// Stage D/P0-4: authenticated member private CREDIT CARD PURCHASE intents.
// This is deliberately separate from the cash entry executor and from
// legacy payment-source display names. Submission does NOT post an expense.
const hex=/^[a-f0-9]{64}$/i, id32=/^[a-f0-9]{32}$/i, uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const enc=new TextEncoder();
const fail=(code,status=409)=>Response.json({ok:false,code,applied:false},{status,headers:{'cache-control':'no-store'}});
const reply=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const newid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(x))),x=>x.toString(16).padStart(2,'0')).join('');
const b64=x=>btoa(String.fromCharCode(...x));
const validDate=v=>typeof v==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)&&
 Number.isFinite(Date.parse(v+'T00:00:00.000Z'))&&
 new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v;
const validMoney=v=>Number.isSafeInteger(v)&&v>=1&&v<=10000000;
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===k.slice().sort().join(',');
function enabled(e){
 return e.APP_ENV==='production'&&e.KAKEIBO_CARD_PURCHASES_ENABLED==='true'&&
  e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
  hex.test(e.KAKEIBO_CARD_SUBMISSION_SECRET||'')&&e.DB?.prepare&&
  typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
  typeof e.HOMEFLOW_OAUTH_ORIGIN==='string'&&
  /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN);
}
async function mac(secret,domain,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',k,
  enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join('');
}
async function seal(env,id,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(
  env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-card:'+id)},k,enc.encode(raw));
 return {cipher:b64(new Uint8Array(bytes)),iv:b64(iv)};
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 try{const raw=await req.text();return raw.length<=2000?JSON.parse(raw):null}
 catch{return null}
}
const keys=['expected_user_id','idempotency_key','account_id','account_version',
 'date','amount_jpy','merchant','category','note'];
function valid(x,user){
 return exact(x,keys)&&x.expected_user_id===user.user_id&&id32.test(x.account_id)&&
  typeof x.idempotency_key==='string'&&/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)&&
  Number.isSafeInteger(x.account_version)&&x.account_version>=1&&
  validDate(x.date)&&validMoney(x.amount_jpy)&&
  typeof x.merchant==='string'&&x.merchant.trim().length>0&&x.merchant.length<=160&&
  typeof x.category==='string'&&x.category.trim().length>0&&x.category.length<=40&&
  typeof x.note==='string'&&x.note.length<=300;
}
const publicRow=r=>({
 request_id:r.request_id,operation:'finance.credit_card.purchase',
 account_id:r.account_id,account_version:r.account_version,
 status:r.entry_id?'applied':r.status==='submitted'?'submitted_status_unknown':r.status,
 approval_id:r.homeflow_approval_id||null,entry_id:r.entry_id||null,
 bill_month:r.bill_month||null,expires_at:r.expires_at,
 payload_sha256:r.payload_sha256,applied:!!r.entry_id
});
async function row(db,id,user){
 return db.prepare('SELECT p.*,a.entry_id,a.bill_month FROM family_card_purchase_intents p '+
  'LEFT JOIN family_card_purchase_applied a ON a.proposal_id=p.request_id '+
  'WHERE p.request_id=? AND p.requester_user_id=? AND p.household_id=? LIMIT 1')
  .bind(id,user.user_id,user.household_id).first();
}
async function prepare(req,env,url,user){
 const x=await read(req,url);
 if(x?.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 if(!valid(x,user))return fail('INVALID_CREDIT_PURCHASE',400);
 const a=await env.DB.prepare('SELECT account_id FROM family_financial_accounts '+
  "WHERE account_id=? AND household_id=? AND owner_user_id=? AND account_kind='credit_card' "+
  "AND origin='member_created' AND is_archived=0 AND version=?")
  .bind(x.account_id,user.household_id,user.user_id,x.account_version).first();
 if(!a)return fail('CREDIT_ACCOUNT_VERSION_MISMATCH',409);
 const payload={account_id:x.account_id,account_version:x.account_version,
  type:'expense',date:x.date,amount_jpy:x.amount_jpy,
  merchant:x.merchant.trim(),category:x.category.trim(),note:x.note};
 const raw=JSON.stringify(payload),digest=await hash(raw);
 const scope=await hash(user.household_id+'\u0000'+user.user_id+'\u0000card\u0000'+x.idempotency_key);
 const existing=await env.DB.prepare('SELECT * FROM family_card_purchase_intents WHERE idempotency_hash=?')
  .bind(scope).first();
 if(existing){
  if(existing.payload_sha256!==digest||existing.requester_user_id!==user.user_id||
   existing.household_id!==user.household_id)return fail('CARD_IDEMPOTENCY_CONFLICT');
  const same=await row(env.DB,existing.request_id,user);
  return reply({ok:true,prepared:publicRow(same),replayed:true});
 }
 const id=newid(),now=Date.now(),sealed=await seal(env,id,raw);
 try{
  const result=await env.DB.prepare('INSERT OR IGNORE INTO family_card_purchase_intents '+
   '(request_id,household_id,requester_user_id,account_id,account_version,'+
   "payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,created_at,expires_at) "+
   "SELECT ?,?,?,?,?,?,?,?,?,'prepared',?,? WHERE EXISTS(SELECT 1 FROM family_financial_accounts a "+
   "JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id "+
   "WHERE a.account_id=? AND a.version=? AND a.owner_user_id=? AND a.household_id=? "+
   "AND a.account_kind='credit_card' AND a.origin='member_created' AND a.is_archived=0 "+
   "AND l.role='member' AND l.state='active')")
   .bind(id,user.household_id,user.user_id,x.account_id,x.account_version,
    digest,sealed.cipher,sealed.iv,scope,now,now+14*86400000,
    x.account_id,x.account_version,user.user_id,user.household_id).run();
  if(result.meta?.changes!==1){
   const retry=await env.DB.prepare('SELECT request_id,payload_sha256 FROM family_card_purchase_intents WHERE idempotency_hash=?')
    .bind(scope).first();
   if(retry?.payload_sha256===digest)return reply({ok:true,
    prepared:publicRow(await row(env.DB,retry.request_id,user)),replayed:true});
   return fail('CARD_PREPARE_CONFLICT');
  }
  return reply({ok:true,prepared:publicRow(await row(env.DB,id,user)),replayed:false},201);
 }catch{return fail('CARD_PREPARE_UNAVAILABLE',503)}
}
async function submit(req,env,url,user,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==user.user_id)
  return fail('ACTOR_CHANGED',403);
 const p=await row(env.DB,id,user);
 if(!p)return fail('CARD_PROPOSAL_NOT_FOUND',404);
 if(p.status==='submitted'&&uuid.test(p.homeflow_approval_id))
  return reply({ok:true,status:'submitted_status_unknown',
   approval_id:p.homeflow_approval_id,replayed:true,applied:false});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('CARD_NOT_SUBMITTABLE');
 const account=await env.DB.prepare('SELECT account_id FROM family_financial_accounts '+
  "WHERE account_id=? AND household_id=? AND owner_user_id=? AND version=? "+
  "AND account_kind='credit_card' AND origin='member_created' AND is_archived=0")
  .bind(p.account_id,p.household_id,p.requester_user_id,p.account_version).first();
 if(!account)return fail('CARD_ACCOUNT_VERSION_CHANGED');
 const wire={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,
  expected_version:p.account_version};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 let confirmed;
 try{
  const response=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/card-submit',env.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-card','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(env.KAKEIBO_CARD_SUBMISSION_SECRET,
     'kakeibo-card:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(response.status)||response.headers.has('location'))return fail('CARD_HOMEFLOW_RETRY',503);
  const text=await response.text();if(text.length>1900)return fail('CARD_HOMEFLOW_RETRY',503);
  confirmed=JSON.parse(text);
 }catch{return fail('CARD_HOMEFLOW_RETRY',503)}
 if(confirmed?.ok!==true||!uuid.test(confirmed.approval_id)||
  confirmed.resource_id!==p.request_id||confirmed.payload_sha256!==p.payload_sha256||
  confirmed.household_id!==p.household_id||
  confirmed.requester_user_id!==p.requester_user_id||
  confirmed.expected_version!==p.account_version||confirmed.applied!==false)
  return fail('CARD_SUBMISSION_UNCONFIRMED',503);
 try{
  const result=await env.DB.prepare('UPDATE family_card_purchase_intents SET '+
   "status='submitted',homeflow_approval_id=?,submitted_at=? "+
   "WHERE request_id=? AND requester_user_id=? AND household_id=? AND status='prepared' "+
   "AND expires_at>? AND account_version=?")
   .bind(confirmed.approval_id,Date.now(),id,user.user_id,user.household_id,
    Date.now(),p.account_version).run();
  if(result.meta?.changes!==1){
   const original=await row(env.DB,id,user);
   if(original?.status==='submitted'&&original.homeflow_approval_id===confirmed.approval_id)
    return reply({ok:true,status:'submitted_status_unknown',approval_id:confirmed.approval_id,
     replayed:true,applied:false});
   return fail('CARD_SUBMISSION_RECONCILE',503);
  }
  return reply({ok:true,status:'submitted_status_unknown',
   approval_id:confirmed.approval_id,replayed:false,applied:false});
 }catch{return fail('CARD_SUBMISSION_RECONCILE',503)}
}
async function cancel(req,env,url,user,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==user.user_id)
  return fail('ACTOR_CHANGED',403);
 const p=await row(env.DB,id,user);
 if(!p)return fail('CARD_PROPOSAL_NOT_FOUND',404);
 if(p.status==='cancelled')return reply({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('CARD_CANCEL_IN_HOMEFLOW');
 try{
  const r=await env.DB.prepare("UPDATE family_card_purchase_intents SET status='cancelled' "+
   "WHERE request_id=? AND requester_user_id=? AND household_id=? AND status='prepared'")
   .bind(id,user.user_id,user.household_id).run();
  return r.meta?.changes===1?reply({ok:true,status:'cancelled'}):fail('CARD_CANCEL_CONFLICT');
 }catch{return fail('CARD_CANCEL_CONFLICT')}
}
export async function familyCardPurchases(request,env,url,user,parts){
 if(!enabled(env))return fail('CARD_PURCHASES_DISABLED',503);
 if(user.role!=='member')return fail('ONLY_MEMBER_CAN_PROPOSE',403);
 if(parts.length===1&&request.method==='POST')return prepare(request,env,url,user);
 if(parts.length===1&&request.method==='GET'){
  const rows=(await env.DB.prepare('SELECT p.*,a.entry_id,a.bill_month FROM family_card_purchase_intents p '+
   'LEFT JOIN family_card_purchase_applied a ON a.proposal_id=p.request_id '+
   'WHERE p.household_id=? AND p.requester_user_id=? ORDER BY p.created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return reply({ok:true,items:rows.map(publicRow)});
 }
 if(parts.length===2&&id32.test(parts[1])&&request.method==='GET'){
  const p=await row(env.DB,parts[1],user);
  return p?reply({ok:true,prepared:publicRow(p)}):fail('CARD_PROPOSAL_NOT_FOUND',404);
 }
 if(parts.length===3&&id32.test(parts[1])&&request.method==='POST'){
  if(parts[2]==='submit')return submit(request,env,url,user,parts[1]);
  if(parts[2]==='cancel')return cancel(request,env,url,user,parts[1]);
 }
 return fail('NOT_FOUND',404);
}
