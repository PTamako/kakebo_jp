// P0-4: independently signed, approved card bank SETTLEMENT. No expense insert.
// The transfer is sourced from an explicit, user-confirmed bank statement date.
// A successful target D1 batch creates immutable evidence/transfer/allocation/audit.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[89ab][a-f0-9]{12}$/i;
const goodUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const response=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>response({ok:false,code,applied:false},status);
const makeId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(raw))),
 x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&hex.test(a)&&hex.test(b)&&
 Array.from(a).reduce((n,c,i)=>n|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const exact=(obj,keys)=>!!obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join(',')===keys.slice().sort().join(',');
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const money=n=>Number.isSafeInteger(n)&&n>=1&&n<=10000000;
function enabled(e){
 return e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_CARD_SETTLEMENTS_ENABLED==='true'&&hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(e.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SECRET||'')&&
 hex.test(e.KAKEIBO_CARD_SETTLEMENT_PROOF_SECRET||'')&&e.DB?.prepare&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
}
async function mac(secret,domain,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const s=await crypto.subtle.sign('HMAC',k,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(s),x=>x.toString(16).padStart(2,'0')).join('');
}
const core=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
async function signed(req,env,mode){
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||req.headers.get('x-approval-client')!=='homeflow'||
  req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return null;
 const stamp=req.headers.get('x-approval-timestamp')||'',
  signature=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!hex.test(signature))return null;
 let raw,b;try{raw=await req.text();if(raw.length>1600)return null;b=JSON.parse(raw)}catch{return null}
 if(!exact(b,mode==='execute'?[...core,'execution_nonce']:core)||
  !goodUuid.test(b.request_id)||!id32.test(b.resource_id)||!hex.test(b.payload_sha256)||
  (mode==='execute'&&!hex.test(b.execution_nonce))||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128)return null;
 const expected=await mac(env.KAKEIBO_CARD_SETTLEMENT_EXECUTION_SECRET,
  'homeflow:card-settlement-'+mode,stamp,raw);
 return same(expected,signature)?b:null;
}
const identity=(r,b)=>!!r&&r.homeflow_request_id===b.request_id&&
 r.proposal_id===b.resource_id&&r.household_id===b.household_id&&
 r.requester_user_id===b.requester_user_id&&r.payload_sha256===b.payload_sha256;
const shape=(r,replayed)=>({
 ok:true,applied:true,approval_id:r.homeflow_request_id,proposal_id:r.proposal_id,
 household_id:r.household_id,requester_user_id:r.requester_user_id,
 payload_sha256:r.payload_sha256,approver_user_id:r.approver_user_id,
 actor_user_id:r.actor_user_id,card_account_id:r.card_account_id,
 card_version:r.card_version,bank_account_id:r.bank_account_id,bank_version:r.bank_version,
 amount_jpy:r.amount_jpy,debit_date:r.debit_date,
 entry_id:r.transfer_entry_id,transfer_entry_id:r.transfer_entry_id,
 applied_at:r.applied_at,already_applied:replayed
});
async function decode(env,row){
 try{
  const iv=Uint8Array.from(atob(row.payload_iv),x=>x.charCodeAt(0)),
   cipher=Uint8Array.from(atob(row.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>5500)return null;
  const k=await crypto.subtle.importKey('raw',Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
   'AES-GCM',false,['decrypt']);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-card-settlement:'+row.request_id)},k,cipher);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!same(await hash(raw),row.payload_sha256))return null;
  const p=JSON.parse(raw);
  if(!exact(p,['card_account_id','card_version','bank_account_id','bank_version',
    'debit_date','amount_jpy','reference_hash','evidence_kind','allocations'])||
   p.card_account_id!==row.card_account_id||p.bank_account_id!==row.bank_account_id||
   p.card_version!==row.card_version||p.bank_version!==row.bank_version||
   !date(p.debit_date)||!money(p.amount_jpy)||!hex.test(p.reference_hash)||
   p.evidence_kind!=='owner_confirmed_statement'||
   !Array.isArray(p.allocations)||p.allocations.length<1||p.allocations.length>30||
   !p.allocations.every(a=>exact(a,['purchase_request_id','amount_jpy'])&&
    goodUuid.test(a.purchase_request_id)&&money(a.amount_jpy))||
   new Set(p.allocations.map(a=>a.purchase_request_id)).size!==p.allocations.length||
   p.allocations.reduce((n,a)=>n+a.amount_jpy,0)!==p.amount_jpy)return null;
  return p;
 }catch{return null}
}
async function proof(env,b,version){
 const wire={...Object.fromEntries(core.map(k=>[k,b[k]])),
  idempotency_key:'kakeibo:cardsettle:'+b.resource_id,expected_version:version,
  purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 try{
  const r=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',env.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
   'x-approval-client':'kakeibo-card-settlement','x-approval-timestamp':stamp,
   'x-approval-signature':await mac(env.KAKEIBO_CARD_SETTLEMENT_PROOF_SECRET,
    'kakeibo-card-settlement:execution-proof',stamp,raw)},body:raw}));
  if(r.status!==200||r.headers.has('location'))return null;
  const text=await r.text();if(text.length>1900)return null;
  const p=JSON.parse(text);
  return p?.ok===true&&p.verified===true&&p.execution_authorized===true&&
   p.execution_status==='executing'&&p.source_app==='kakebo'&&
   p.target_app==='kakebo'&&p.operation==='finance.credit_card.settlement'&&
   p.resource_type==='credit_card_settlement'&&
   p.request_id===b.request_id&&p.resource_id===b.resource_id&&
   p.household_id===b.household_id&&p.requester_user_id===b.requester_user_id&&
   p.payload_sha256===b.payload_sha256&&p.idempotency_key===wire.idempotency_key&&
   p.expected_version===version&&p.approver_user_id&&
   p.approver_user_id!==b.requester_user_id&&
   Number.isSafeInteger(p.approved_at)&&Number.isSafeInteger(p.expires_at)&&
   p.expires_at>Date.now()&&p.applied===false?p:null;
 }catch{return null}
}
export async function approvedCardSettlementRoute(req,env,parts){
 if(!enabled(env))return fail('CARD_SETTLEMENT_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt'].includes(parts[0]))return fail('NOT_FOUND',404);
 const mode=parts[0],b=await signed(req,env,mode);
 if(!b)return fail('CARD_SETTLEMENT_UNAUTHORIZED',403);
 const db=env.DB;
 const existing=await db.prepare('SELECT * FROM family_card_settlements_applied '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1').bind(b.request_id,b.resource_id).first();
 if(existing)return identity(existing,b)?response(shape(existing,true)):fail('SETTLEMENT_RECEIPT_CONFLICT');
 if(mode==='receipt')return fail('SETTLEMENT_RECEIPT_UNKNOWN',404);
 const row=await db.prepare('SELECT p.*,c.account_kind AS card_kind,c.origin AS card_origin,'+
  'c.version AS card_live,c.is_archived AS card_archived,c.owner_user_id AS card_owner,'+
  'c.household_id AS card_household,b.account_kind AS bank_kind,b.origin AS bank_origin,'+
  'b.version AS bank_live,b.is_archived AS bank_archived,b.owner_user_id AS bank_owner,'+
  'b.household_id AS bank_household,u.role AS requester_role,u.state AS requester_state '+
  'FROM family_card_settlement_intents p '+
  'JOIN family_financial_accounts c ON c.account_id=p.card_account_id '+
  'JOIN family_financial_accounts b ON b.account_id=p.bank_account_id '+
  'JOIN homeflow_identity_links u ON u.user_id=p.requester_user_id '+
  'WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!row||row.status!=='submitted'||row.requester_user_id!==b.requester_user_id||
  row.household_id!==b.household_id||row.payload_sha256!==b.payload_sha256||
  row.expires_at<=Date.now()||row.card_kind!=='credit_card'||row.bank_kind!=='bank'||
  row.card_origin!=='member_created'||row.bank_origin!=='member_created'||
  row.card_archived!==0||row.bank_archived!==0||row.card_owner!==b.requester_user_id||
  row.bank_owner!==b.requester_user_id||row.card_household!==b.household_id||
  row.bank_household!==b.household_id||row.card_version!==row.card_live||
  row.bank_version!==row.bank_live||row.requester_role!=='member'||row.requester_state!=='active')
  return fail('SETTLEMENT_SOURCE_OR_ACCOUNT_CHANGED');
 const payload=await decode(env,row);
 const authorized=payload&&await proof(env,b,row.card_version);
 if(!payload||!authorized)return fail('SETTLEMENT_SOURCE_OR_APPROVAL_INVALID');
 const at=Date.now(),evidenceId=makeId(),clientId='hfcardsettle:'+b.request_id;
 const commands=[
  db.prepare('INSERT INTO family_card_bank_debit_evidence '+
   '(evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,evidence_kind,recorded_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(evidenceId,b.household_id,row.bank_account_id,row.bank_version,
    payload.reference_hash,payload.debit_date,payload.amount_jpy,payload.evidence_kind,at),
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,'+
   'type,transfer_target,transfer_applied,transfer_date,client_request_id,'+
   'payment_source,family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,'投資・資産移動','カード引落','','','transfer',?,1,?,?,?,?,?)")
   .bind(payload.debit_date,payload.amount_jpy,'cc:'+row.card_account_id,
    payload.debit_date,clientId,'bank:'+row.bank_account_id,row.bank_account_id,row.card_account_id),
  db.prepare('INSERT INTO family_card_settlements_applied '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,'+
   'card_account_id,card_version,bank_account_id,bank_version,payload_sha256,evidence_id,transfer_entry_id,'+
   'amount_jpy,debit_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,('+
   'SELECT id FROM entries WHERE client_request_id=? AND type=\'transfer\' LIMIT 1),?,?,?)')
   .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
    authorized.approver_user_id,authorized.approver_user_id,row.card_account_id,row.card_version,
    row.bank_account_id,row.bank_version,b.payload_sha256,evidenceId,
    clientId,payload.amount_jpy,payload.debit_date,at),
  ...payload.allocations.map(a=>db.prepare('INSERT INTO family_card_settlement_allocations '+
   '(homeflow_request_id,purchase_request_id,amount_jpy) VALUES(?,?,?)')
   .bind(b.request_id,a.purchase_request_id,a.amount_jpy)),
  db.prepare('INSERT INTO family_card_settlement_audit '+
   '(event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) '+
   "VALUES(?,?,?,?,?,'credit_card_bank_settlement_applied',?)")
   .bind(makeId(),b.request_id,b.requester_user_id,authorized.approver_user_id,
    authorized.approver_user_id,at)
 ];
 try{
  const changes=await db.batch(commands);
  if(changes.length!==commands.length||changes.some(x=>x.meta?.changes!==1))
   return fail('SETTLEMENT_TRANSACTION_UNCONFIRMED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_card_settlements_applied WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return identity(raced,b)?response(shape(raced,true)):fail('SETTLEMENT_TRANSACTION_RETRY',503);
 }
 const applied=await db.prepare('SELECT * FROM family_card_settlements_applied WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return identity(applied,b)?response(shape(applied,false)):fail('SETTLEMENT_RECEIPT_UNCONFIRMED',503);
}
export const onRequest=({request,env,params})=>approvedCardSettlementRoute(request,env,params.path||[]);
