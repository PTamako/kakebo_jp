// P0-4: signed HomeFlow-approved member credit-card purchase.
// A card charge is a shared EXPENSE plus a separate account-scoped LIABILITY,
// NOT a cash debit, card settlement, prepaid deposit, points credit or SBI buy.
// No browser cookies, approvals booleans, or unversioned accounts accepted.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,
 id32=/^[a-f0-9]{32}$/i;
const reply=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>reply({ok:false,code,applied:false},status);
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),
 x=>x.toString(16).padStart(2,'0')).join('');
const newid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&
 hex.test(a)&&hex.test(b)&&a.length===b.length&&
 Array.from(a).reduce((d,x,i)=>d|(x.charCodeAt(0)^b.charCodeAt(i)),0)===0;
function enabled(e){
 return e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
  e.KAKEIBO_CARD_PURCHASES_ENABLED==='true'&&hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
  hex.test(e.KAKEIBO_CARD_EXECUTION_SECRET||'')&&
  hex.test(e.KAKEIBO_CARD_PROOF_SECRET||'')&&
  typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
  /^https:\/\/[A-Za-z0-9.-]+$/.test(e.HOMEFLOW_OAUTH_ORIGIN||'')&&!!e.DB?.prepare;
}
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const b=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}
export function cardClosingMonth(date,closingDay){
 if(typeof date!=='string'||!/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date))return null;
 const stamp=new Date(date+'T00:00:00.000Z');
 if(!Number.isFinite(stamp.getTime())||stamp.toISOString().slice(0,10)!==date)return null;
 const year=stamp.getUTCFullYear(),month=stamp.getUTCMonth()+1,day=stamp.getUTCDate();
 if(closingDay!==null&&(!Number.isInteger(closingDay)||closingDay<0||closingDay>31))return null;
 const last=new Date(Date.UTC(year,month,0)).getUTCDate();
 const cutoff=closingDay===null||closingDay===0?last:Math.min(closingDay,last);
 const closeDate=day>cutoff?new Date(Date.UTC(year,month,1)):
  new Date(Date.UTC(year,month-1,1));
 return closeDate.toISOString().slice(0,7);
}
async function sealed(env,row){
 try{
  const iv=Uint8Array.from(atob(row.payload_iv),x=>x.charCodeAt(0));
  const cipher=Uint8Array.from(atob(row.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length>3500||cipher.length<16)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(
   env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
   'AES-GCM',false,['decrypt']);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-card:'+row.request_id)},key,cipher);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!equal(await hash(raw),row.payload_sha256))return null;
  const p=JSON.parse(raw);
  if(!exact(p,['account_id','account_version','type','date','amount_jpy','merchant','category','note'])||
   p.account_id!==row.account_id||p.account_version!==row.account_version||
   p.type!=='expense'||cardClosingMonth(p.date,row.closing_day)===null||
   !Number.isSafeInteger(p.amount_jpy)||p.amount_jpy<1||p.amount_jpy>10000000||
   typeof p.merchant!=='string'||!p.merchant.trim()||p.merchant.length>160||
   typeof p.category!=='string'||!p.category.trim()||p.category.length>40||
   typeof p.note!=='string'||p.note.length>300)return null;
  return p;
 }catch{return null}
}
const core=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
async function signed(req,env,mode){
 if(req.method!=='POST'||req.headers.has('cookie')||req.headers.has('origin')||
  req.headers.has('authorization')||
  req.headers.get('x-approval-client')!=='homeflow'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 const timestamp=req.headers.get('x-approval-timestamp')||'';
 const sig=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000||!hex.test(sig))
  return null;
 let raw,b;try{raw=await req.text();if(raw.length>1800)return null;b=JSON.parse(raw)}
 catch{return null}
 if(!exact(b,mode==='execute'?[...core,'execution_nonce']:core)||
  !uuid.test(b.request_id)||!id32.test(b.resource_id)||!hex.test(b.payload_sha256)||
  (mode==='execute'&&!hex.test(b.execution_nonce))||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128)return null;
 const expected=await mac(env.KAKEIBO_CARD_EXECUTION_SECRET,
  'homeflow:card-'+mode,timestamp,raw);
 return equal(expected,sig)?b:null;
}
const shape=(row,replay)=>({
 ok:true,applied:true,approval_id:row.homeflow_request_id,
 proposal_id:row.proposal_id,household_id:row.household_id,
 requester_user_id:row.requester_user_id,payload_sha256:row.payload_sha256,
 entry_id:row.entry_id,approver_user_id:row.approver_user_id,
 account_id:row.account_id,account_version:row.account_version,
 amount_jpy:row.amount_jpy,bill_month:row.bill_month,
 applied_at:row.applied_at,already_applied:replay
});
const identity=(r,b)=>!!r&&r.homeflow_request_id===b.request_id&&
 r.proposal_id===b.resource_id&&r.household_id===b.household_id&&
 r.requester_user_id===b.requester_user_id&&r.payload_sha256===b.payload_sha256;
async function proof(env,b,version){
 const query={...Object.fromEntries(core.map(k=>[k,b[k]])),
  idempotency_key:'kakeibo:card:'+b.resource_id,expected_version:version,
  purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(query),stamp=String(Date.now());
 try{
  const response=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',env.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-card','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(env.KAKEIBO_CARD_PROOF_SECRET,
     'kakeibo-card:execution-proof',stamp,raw)},body:raw}));
  if(response.status!==200||response.headers.has('location'))return null;
  const text=await response.text();if(text.length>1900)return null;
  const p=JSON.parse(text);
  return p?.ok===true&&p.verified===true&&p.execution_authorized===true&&
   p.execution_status==='executing'&&p.source_app==='kakebo'&&
   p.target_app==='kakebo'&&p.operation==='finance.credit_card.purchase'&&
   p.resource_type==='credit_card_purchase'&&
   p.request_id===b.request_id&&p.resource_id===b.resource_id&&
   p.household_id===b.household_id&&p.requester_user_id===b.requester_user_id&&
   p.payload_sha256===b.payload_sha256&&p.idempotency_key===query.idempotency_key&&
   p.expected_version===version&&p.approver_user_id&&
   p.approver_user_id!==b.requester_user_id&&
   Number.isSafeInteger(p.approved_at)&&Number.isSafeInteger(p.expires_at)&&
   p.expires_at>Date.now()&&p.applied===false?p:null;
 }catch{return null}
}
export async function approvedCardPurchaseRoute(req,env,parts){
 if(!enabled(env))return fail('CARD_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt'].includes(parts[0]))return fail('NOT_FOUND',404);
 const mode=parts[0],b=await signed(req,env,mode);
 if(!b)return fail('CARD_UNAUTHORIZED',403);
 const db=env.DB;
 const existing=await db.prepare('SELECT * FROM family_card_purchase_applied '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1')
  .bind(b.request_id,b.resource_id).first();
 if(existing)return identity(existing,b)?reply(shape(existing,true)):
  fail('CARD_RECEIPT_CONFLICT');
 if(mode==='receipt')return fail('CARD_RECEIPT_UNKNOWN',404);
 const row=await db.prepare('SELECT p.*,a.account_kind,a.version AS live_version,'+
  'a.owner_user_id,a.household_id AS account_household,a.is_archived,a.origin,a.closing_day,'+
  'm.role AS requester_role,m.state AS requester_state FROM family_card_purchase_intents p '+
  'JOIN family_financial_accounts a ON a.account_id=p.account_id '+
  'JOIN homeflow_identity_links m ON m.user_id=p.requester_user_id '+
  'WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!row||row.status!=='submitted'||row.requester_user_id!==b.requester_user_id||
  row.household_id!==b.household_id||row.payload_sha256!==b.payload_sha256||
  row.owner_user_id!==b.requester_user_id||row.account_household!==b.household_id||
  row.account_kind!=='credit_card'||row.origin!=='member_created'||row.is_archived!==0||
  row.account_version!==row.live_version||row.requester_role!=='member'||
  row.requester_state!=='active'||row.expires_at<=Date.now())
  return fail('CARD_SOURCE_OR_VERSION_CHANGED');
 const p=await sealed(env,row),approved=p&&await proof(env,b,row.account_version);
 if(!p||!approved)return fail('CARD_SOURCE_OR_APPROVAL_INVALID');
 const billMonth=cardClosingMonth(p.date,row.closing_day),
  clientId='hfcard:'+b.request_id,at=Date.now();
 if(!billMonth)return fail('CARD_BILL_PERIOD_INVALID');
 try{
  const changes=await db.batch([
   db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,'+
    'type,transfer_target,transfer_applied,transfer_date,client_request_id,'+
    'payment_source,family_account_id) '+
    "SELECT ?,'',?,?,?,?,?,'expense',NULL,0,NULL,?,?,? "+
    "WHERE EXISTS(SELECT 1 FROM family_financial_accounts a "+
    "JOIN family_card_purchase_intents p ON p.account_id=a.account_id "+
    "JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id "+
    "WHERE p.request_id=? AND p.status='submitted' AND p.homeflow_approval_id=? "+
    "AND p.payload_sha256=? AND a.version=? AND a.is_archived=0 "+
    "AND a.owner_user_id=? AND a.account_kind='credit_card' "+
    "AND a.origin='member_created' AND l.state='active' AND l.role='member') "+
    'ON CONFLICT(client_request_id) DO NOTHING')
    .bind(p.date,p.amount_jpy,p.category,p.merchant,p.note,'',
     clientId,'cc:'+row.account_id,row.account_id,b.resource_id,b.request_id,
     b.payload_sha256,row.account_version,b.requester_user_id),
   db.prepare('INSERT INTO family_card_purchase_applied('+
    'homeflow_request_id,proposal_id,household_id,requester_user_id,'+
    'approver_user_id,account_id,account_version,payload_sha256,client_request_id,'+
    'entry_id,amount_jpy,purchase_date,bill_month,applied_at) '+
    'VALUES(?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=? '+
    "AND family_account_id=? AND payment_source=? AND type='expense' "+
    'AND date=? AND amount=? AND category=? AND merchant=? AND note=? LIMIT 1),?,?,?,?)')
    .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
     approved.approver_user_id,row.account_id,row.account_version,
     b.payload_sha256,clientId,clientId,row.account_id,
     'cc:'+row.account_id,p.date,p.amount_jpy,p.category,p.merchant,p.note,
     p.amount_jpy,p.date,billMonth,at),
   db.prepare('INSERT INTO family_card_purchase_audit('+
    'event_id,homeflow_request_id,requester_user_id,approver_user_id,action,created_at) '+
    "SELECT ?,?,?,?,'credit_card_purchase_applied',? "+
    'WHERE changes()=1')
    .bind(newid(),b.request_id,b.requester_user_id,approved.approver_user_id,at)
  ]);
  if(changes.length!==3||changes.some(x=>x.meta?.changes!==1))
   return fail('CARD_TRANSACTION_UNCONFIRMED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_card_purchase_applied WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return identity(raced,b)?reply(shape(raced,true)):fail('CARD_TRANSACTION_RETRY',503);
 }
 const recorded=await db.prepare('SELECT * FROM family_card_purchase_applied WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return identity(recorded,b)?reply(shape(recorded,false)):
  fail('CARD_RECEIPT_UNCONFIRMED',503);
}
export const onRequest=({request,env,params})=>approvedCardPurchaseRoute(request,env,params.path||[]);
