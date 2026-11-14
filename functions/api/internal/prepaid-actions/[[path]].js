// P0-4: independent prepaid topup/spend target (not cash or card purchase executor).
// One D1 batch: entry + immutable applied journal + nonnegative balance + audit.
// Never call an external bank or infer an already-completed transfer from bill dates.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const result=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const reject=(code,status=409)=>result({ok:false,code,applied:false},status);
const makeId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),
 x=>x.toString(16).padStart(2,'0')).join('');
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&hex.test(a)&&hex.test(b)&&
 Array.from(a).reduce((n,c,i)=>n|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const exact=(o,k)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===k.slice().sort().join(',');
const money=x=>Number.isSafeInteger(x)&&x>=1&&x<=10000000;
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const enabled=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_PREPAID_ACTIONS_ENABLED==='true'&&hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(e.KAKEIBO_PREPAID_EXECUTION_SECRET||'')&&hex.test(e.KAKEIBO_PREPAID_PROOF_SECRET||'')&&
 e.DB?.prepare&&typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
}
const CORE=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
async function signed(request,env,mode){
 if(request.method!=='POST'||request.headers.has('origin')||request.headers.has('cookie')||
  request.headers.has('authorization')||request.headers.get('x-approval-client')!=='homeflow'||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 const stamp=request.headers.get('x-approval-timestamp')||'',tag=request.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!hex.test(tag))return null;
 let raw,b;try{raw=await request.text();if(raw.length>1600)return null;b=JSON.parse(raw)}catch{return null}
 if(!exact(b,mode==='execute'?[...CORE,'execution_nonce']:CORE)||
  !uuid.test(b.request_id)||!id32.test(b.resource_id)||!hex.test(b.payload_sha256)||
  (mode==='execute'&&!hex.test(b.execution_nonce))||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||
  b.requester_user_id.length>128)return null;
 return eq(tag,await mac(env.KAKEIBO_PREPAID_EXECUTION_SECRET,
  'homeflow:prepaid-'+mode,stamp,raw))?b:null;
}
const match=(r,b)=>!!r&&r.homeflow_request_id===b.request_id&&
 r.proposal_id===b.resource_id&&r.household_id===b.household_id&&
 r.requester_user_id===b.requester_user_id&&r.payload_sha256===b.payload_sha256;
const receipt=(r,replayed)=>({
 ok:true,applied:true,approval_id:r.homeflow_request_id,proposal_id:r.proposal_id,
 household_id:r.household_id,requester_user_id:r.requester_user_id,
 payload_sha256:r.payload_sha256,approver_user_id:r.approver_user_id,
 actor_user_id:r.actor_user_id,prepaid_account_id:r.prepaid_account_id,
 prepaid_version:r.prepaid_version,bank_account_id:r.bank_account_id,
 bank_version:r.bank_version,action:r.action,
 amount_jpy:r.amount_jpy,date:r.date,
 delta_jpy:r.action==='topup'?r.amount_jpy:-r.amount_jpy,
 balance_after_jpy:r.balance_after_jpy,
 entry_id:r.entry_id,applied_at:r.applied_at,already_applied:replayed
});
async function decode(env,p){
 try{
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0)),
   cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>5000)return null;
  const k=await crypto.subtle.importKey('raw',
   Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
   'AES-GCM',false,['decrypt']);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-prepaid:'+p.request_id)},k,cipher);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!eq(await hash(raw),p.payload_sha256))return null;
  const x=JSON.parse(raw);
  if(!['topup','spend'].includes(x.action)||x.action!==p.action||!date(x.date)||
   !money(x.amount_jpy)||x.prepaid_account_id!==p.prepaid_account_id||
   x.prepaid_version!==p.prepaid_version)return null;
  if(x.action==='topup'){
   if(!exact(x,['action','prepaid_account_id','prepaid_version','bank_account_id',
    'bank_version','date','amount_jpy','reference_hash'])||
    x.bank_account_id!==p.bank_account_id||x.bank_version!==p.bank_version||
    !hex.test(x.reference_hash))return null;
  }else{
   if(!exact(x,['action','prepaid_account_id','prepaid_version',
    'date','amount_jpy','merchant','category','note'])||
    p.bank_account_id!==null||p.bank_version!==null||
    typeof x.merchant!=='string'||!x.merchant.trim()||x.merchant.length>160||
    typeof x.category!=='string'||!x.category.trim()||x.category.length>40||
    typeof x.note!=='string'||x.note.length>300)return null;
  }
  return x;
 }catch{return null}
}
async function proof(env,b,p){
 const input={...Object.fromEntries(CORE.map(k=>[k,b[k]])),
  idempotency_key:'kakeibo:prepaid:'+b.resource_id,
  expected_version:p.prepaid_version,purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(input),stamp=String(Date.now());
 try{
  const r=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',env.HOMEFLOW_OAUTH_ORIGIN),{
    method:'POST',redirect:'manual',headers:{'content-type':'application/json',
     'x-approval-client':'kakeibo-prepaid','x-approval-timestamp':stamp,
     'x-approval-signature':await mac(env.KAKEIBO_PREPAID_PROOF_SECRET,
      'kakeibo-prepaid:execution-proof',stamp,raw)},body:raw}));
  if(r.status!==200||r.headers.has('location'))return null;
  const text=await r.text();if(text.length>1800)return null;
  const x=JSON.parse(text);
  return x?.ok===true&&x.verified===true&&x.execution_authorized===true&&
   x.execution_status==='executing'&&x.source_app==='kakebo'&&x.target_app==='kakebo'&&
   x.operation==='finance.prepaid.'+p.action&&x.resource_type==='prepaid_action'&&
   x.request_id===b.request_id&&x.resource_id===b.resource_id&&
   x.household_id===b.household_id&&x.requester_user_id===b.requester_user_id&&
   x.payload_sha256===b.payload_sha256&&x.idempotency_key===input.idempotency_key&&
   x.expected_version===p.prepaid_version&&x.approver_user_id&&
   x.approver_user_id!==b.requester_user_id&&x.expires_at>Date.now()&&
   x.applied===false?x:null;
 }catch{return null}
}
async function currentBalance(db,id){
 const r=await db.prepare('SELECT COALESCE(SUM(delta_jpy),0) amount FROM family_prepaid_balance_journal '+
  'WHERE prepaid_account_id=?').bind(id).first();
 return Number.isSafeInteger(r?.amount)&&r.amount>=0?r.amount:null;
}
export async function approvedPrepaidActionRoute(request,env,parts){
 if(!enabled(env))return reject('PREPAID_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt'].includes(parts[0]))return reject('NOT_FOUND',404);
 const mode=parts[0],b=await signed(request,env,mode);
 if(!b)return reject('PREPAID_UNAUTHORIZED',403);
 const db=env.DB;
 const prior=await db.prepare('SELECT * FROM family_prepaid_actions_applied '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1').bind(b.request_id,b.resource_id).first();
 if(prior)return match(prior,b)?result(receipt(prior,true)):reject('PREPAID_RECEIPT_CONFLICT');
 if(mode==='receipt')return reject('PREPAID_RECEIPT_UNKNOWN',404);
 const row=await db.prepare('SELECT p.*,a.account_kind AS prepaid_kind,a.origin AS prepaid_origin,'+
  'a.version AS prepaid_live,a.is_archived AS prepaid_archived,'+
  'a.owner_user_id AS prepaid_owner,a.household_id AS prepaid_household,'+
  'bank.account_kind AS bank_kind,bank.origin AS bank_origin,bank.version AS bank_live,'+
  'bank.is_archived AS bank_archived,bank.owner_user_id AS bank_owner,'+
  'bank.household_id AS bank_household,link.role AS requester_role,link.state AS requester_state '+
  'FROM family_prepaid_action_intents p '+
  'JOIN family_financial_accounts a ON a.account_id=p.prepaid_account_id '+
  'LEFT JOIN family_financial_accounts bank ON bank.account_id=p.bank_account_id '+
  'JOIN homeflow_identity_links link ON link.user_id=p.requester_user_id '+
  'WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!row||row.status!=='submitted'||row.requester_user_id!==b.requester_user_id||
  row.household_id!==b.household_id||row.payload_sha256!==b.payload_sha256||
  row.expires_at<=Date.now()||row.prepaid_kind!=='prepaid'||row.prepaid_origin!=='member_created'||
  row.prepaid_live!==row.prepaid_version||row.prepaid_archived!==0||
  row.prepaid_owner!==b.requester_user_id||row.prepaid_household!==b.household_id||
  row.requester_role!=='member'||row.requester_state!=='active'||
  (row.action==='topup'&&(row.bank_kind!=='bank'||row.bank_origin!=='member_created'||
   row.bank_live!==row.bank_version||row.bank_archived!==0||
   row.bank_owner!==b.requester_user_id||row.bank_household!==b.household_id)))
  return reject('PREPAID_ACCOUNT_OR_IDENTITY_CHANGED');
 const x=await decode(env,row);const approved=x&&await proof(env,b,row);
 if(!x||!approved)return reject('PREPAID_SOURCE_OR_APPROVAL_INVALID');
 const current=await currentBalance(db,row.prepaid_account_id);
 const delta=x.action==='topup'?x.amount_jpy:-x.amount_jpy;
 const balanceAfter=current===null?null:current+delta;
 if(balanceAfter===null||!Number.isSafeInteger(balanceAfter)||balanceAfter<0||balanceAfter>100000000)
  return reject('PREPAID_INSUFFICIENT_OR_INVALID_BALANCE');
 const at=Date.now(),clientId='hfprepaid:'+b.request_id;
 const entry=x.action==='topup'?
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,'+
   'transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,'+
   'family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,'資産移動','储值卡充值','','','transfer',?,1,?,?,?,?,?)")
   .bind(x.date,x.amount_jpy,'prepaid:'+row.prepaid_account_id,
    x.date,clientId,'bank:'+row.bank_account_id,row.bank_account_id,row.prepaid_account_id):
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,'+
   'transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,'+
   'family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,?,?,?,?,'expense',NULL,NULL,NULL,?,?,?,NULL)")
   .bind(x.date,x.amount_jpy,x.category,x.merchant,x.note,'',
    clientId,'prepaid:'+row.prepaid_account_id,row.prepaid_account_id);
 const commands=[entry,
  db.prepare('INSERT INTO family_prepaid_actions_applied '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,'+
   'actor_user_id,prepaid_account_id,prepaid_version,action,bank_account_id,'+
   'bank_version,bank_reference_hash,payload_sha256,entry_id,amount_jpy,date,balance_after_jpy,applied_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?,?,?,?)')
   .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
    approved.approver_user_id,approved.approver_user_id,row.prepaid_account_id,
    row.prepaid_version,row.action,row.bank_account_id,row.bank_version,
    x.action==='topup'?x.reference_hash:null,row.payload_sha256,clientId,
    x.amount_jpy,x.date,balanceAfter,at),
  db.prepare('INSERT INTO family_prepaid_balance_journal '+
   '(homeflow_request_id,household_id,prepaid_account_id,delta_jpy,balance_after_jpy,effective_date,created_at) '+
   'VALUES(?,?,?,?,?,?,?)')
   .bind(b.request_id,b.household_id,row.prepaid_account_id,delta,balanceAfter,x.date,at),
  db.prepare('INSERT INTO family_prepaid_action_audit '+
   '(event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) '+
   'VALUES(?,?,?,?,?,?,?)')
   .bind(makeId(),b.request_id,b.requester_user_id,approved.approver_user_id,
    approved.approver_user_id,x.action==='topup'?'prepaid_topup_applied':'prepaid_spend_applied',at)
 ];
 try{
  const results=await db.batch(commands);
  if(results.length!==commands.length||results.some(r=>r.meta?.changes!==1))
   return reject('PREPAID_TRANSACTION_UNCONFIRMED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_prepaid_actions_applied WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return match(raced,b)?result(receipt(raced,true)):reject('PREPAID_TRANSACTION_RETRY',503);
 }
 const applied=await db.prepare('SELECT * FROM family_prepaid_actions_applied WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return match(applied,b)?result(receipt(applied,false)):reject('PREPAID_RECEIPT_UNCONFIRMED',503);
}
export const onRequest=({request,env,params})=>approvedPrepaidActionRoute(request,env,params.path||[]);
