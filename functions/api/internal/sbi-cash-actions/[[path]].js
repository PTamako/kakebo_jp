// DRAFT P0-4B: signed HomeFlow approval -> one D1 bank-transfer, SBI lot, evidence, audit.
 // Never executes an external SBI order or imports an old investment holding.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&hex.test(a)&&
 [...a].reduce((n,x,i)=>n|(x.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const newid=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const money=n=>Number.isSafeInteger(n)&&n>=1&&n<=10000000;
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_SBI_CASH_ENABLED==='true'&&e.DB?.prepare&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&hex.test(e.KAKEIBO_SBI_CASH_EXECUTION_SECRET||'')&&
 hex.test(e.KAKEIBO_SBI_CASH_PROOF_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
const core=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
async function signed(req,e,mode){
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||req.headers.get('x-approval-client')!=='homeflow'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 const stamp=req.headers.get('x-approval-timestamp')||'',signature=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!hex.test(signature))return null;
 let raw,b;try{raw=await req.text();if(raw.length>1600)return null;b=JSON.parse(raw)}catch{return null}
 if(!exact(b,mode==='execute'?[...core,'execution_nonce']:core)||
  !uuid.test(b.request_id)||!id.test(b.resource_id)||!hex.test(b.payload_sha256)||
  (mode==='execute'&&!hex.test(b.execution_nonce))||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128)return null;
 return same(signature,await mac(e.KAKEIBO_SBI_CASH_EXECUTION_SECRET,
  'homeflow:sbi-cash-'+mode,stamp,raw))?b:null;
}
const identity=(a,b)=>!!a&&a.homeflow_request_id===b.request_id&&
 a.proposal_id===b.resource_id&&a.household_id===b.household_id&&
 a.requester_user_id===b.requester_user_id&&a.payload_sha256===b.payload_sha256;
async function confirmed(db,a,b,replay){
 const [lot,evidence,audit]=await Promise.all([
  db.prepare('SELECT * FROM family_sbi_cash_lots WHERE homeflow_request_id=?').bind(a.homeflow_request_id).first(),
  db.prepare('SELECT * FROM family_sbi_cash_bank_evidence WHERE evidence_id=?').bind(a.evidence_id).first(),
  db.prepare('SELECT * FROM family_sbi_cash_audit WHERE homeflow_request_id=?').bind(a.homeflow_request_id).first()
 ]);
 if(!identity(a,b)||!lot||!evidence||!audit||
  lot.homeflow_request_id!==a.homeflow_request_id||lot.household_id!==a.household_id||
  lot.owner_user_id!==a.requester_user_id||lot.securities_account_id!==a.securities_account_id||
  lot.acquisition_cost_jpy!==a.amount_jpy||lot.trade_date!==a.trade_date||
  lot.effective_date!==a.effective_date||lot.actor_user_id!==a.actor_user_id||
  evidence.bank_account_id!==a.bank_account_id||evidence.amount_jpy!==a.amount_jpy||
  evidence.debit_date!==a.debit_date||audit.approver_user_id!==a.approver_user_id||
  audit.requester_user_id!==a.requester_user_id||audit.actor_user_id!==a.actor_user_id)
  return fail('SBI_CASH_COUNTERPART_UNCONFIRMED',503);
 return json({ok:true,applied:true,approval_id:a.homeflow_request_id,proposal_id:a.proposal_id,
  household_id:a.household_id,requester_user_id:a.requester_user_id,
  approver_user_id:a.approver_user_id,actor_user_id:a.actor_user_id,
  payload_sha256:a.payload_sha256,bank_account_id:a.bank_account_id,
  bank_version:a.bank_version,securities_account_id:a.securities_account_id,
  securities_version:a.securities_version,kind:a.kind,
  amount_jpy:a.amount_jpy,debit_date:a.debit_date,trade_date:a.trade_date,
  effective_date:a.effective_date,transfer_entry_id:a.transfer_entry_id,
  entry_id:a.transfer_entry_id,fund_code:lot.fund_code,account_type:lot.account_type,
  confirmed_units:lot.confirmed_units,acquisition_cost_jpy:lot.acquisition_cost_jpy,
  broker_reference_hash:lot.broker_reference_hash,
  broker_reconciled:false,included_in_tracked_assets_jpy:false,
  applied_at:a.applied_at,already_applied:replay});
}
async function decode(e,p){
 try{
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0));
  const cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>5000)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
   'AES-GCM',false,['decrypt']);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({
   name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-sbi-cash:'+p.request_id)},key,cipher));
  if(!same(await sha(raw),p.payload_sha256))return null;
  const x=JSON.parse(raw);
  if(!exact(x,['bank_account_id','bank_version','securities_account_id','securities_version',
   'kind','debit_date','trade_date','effective_date','amount_jpy','reference_hash',
   'broker_reference_hash','fund_code','account_type','confirmed_units',
   'evidence_kind','broker_execution_attested'])||
   x.bank_account_id!==p.bank_account_id||x.bank_version!==p.bank_version||
   x.securities_account_id!==p.securities_account_id||x.securities_version!==p.securities_version||
   x.kind!==p.kind||!date(x.debit_date)||!date(x.trade_date)||!date(x.effective_date)||
   x.debit_date>x.trade_date||x.trade_date>x.effective_date||
   x.effective_date>new Date(Date.now()+9*3600000).toISOString().slice(0,10)||
   !money(x.amount_jpy)||!hex.test(x.reference_hash)||!hex.test(x.broker_reference_hash)||
   !/^[A-Z0-9]{8}$/.test(x.fund_code)||!['growth','tsumitate'].includes(x.account_type)||
   !Number.isSafeInteger(x.confirmed_units)||x.confirmed_units<1||x.confirmed_units>1000000000000||
   x.evidence_kind!=='owner_confirmed_statement'||x.broker_execution_attested!==true)return null;
  return x;
 }catch{return null}
}
async function proof(e,b,version,kind){
 const wire={...Object.fromEntries(core.map(k=>[k,b[k]])),
  idempotency_key:'kakeibo:sbi-cash:'+b.resource_id,expected_version:version,
  purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 try{
  const res=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-sbi-cash','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_SBI_CASH_PROOF_SECRET,
     'kakeibo-sbi-cash:execution-proof',stamp,raw)},body:raw}));
  if(res.status!==200||res.headers.has('location'))return null;
  const text=await res.text();if(text.length>1900)return null;
  const x=JSON.parse(text);
  return x?.ok===true&&x.verified===true&&x.execution_authorized===true&&
   x.execution_status==='executing'&&x.source_app==='kakebo'&&x.target_app==='kakebo'&&
   x.resource_type==='sbi_cash_action'&&x.operation==='finance.sbi_cash.'+kind&&
   x.idempotency_key===wire.idempotency_key&&x.expected_version===version&&
   x.request_id===b.request_id&&x.resource_id===b.resource_id&&
   x.household_id===b.household_id&&x.requester_user_id===b.requester_user_id&&
   x.payload_sha256===b.payload_sha256&&x.approver_user_id&&
   x.approver_user_id!==b.requester_user_id&&Number.isSafeInteger(x.approved_at)&&
   Number.isSafeInteger(x.expires_at)&&x.expires_at>Date.now()&&x.applied===false?x:null;
 }catch{return null}
}
export async function approvedSbiCashRoute(req,e,parts){
 if(!ready(e))return fail('SBI_CASH_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt'].includes(parts[0]))return fail('NOT_FOUND',404);
 const mode=parts[0],b=await signed(req,e,mode);
 if(!b)return fail('SBI_CASH_UNAUTHORIZED',403);
 const db=e.DB;
 const old=await db.prepare('SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1')
  .bind(b.request_id,b.resource_id).first();
 if(old)return identity(old,b)?confirmed(db,old,b,true):fail('SBI_CASH_RECEIPT_CONFLICT');
 if(mode==='receipt')return fail('SBI_CASH_RECEIPT_UNKNOWN',404);
 const r=await db.prepare('SELECT p.*,bank.version AS live_bank,bank.is_archived AS bank_archived,'+
  'bank.account_kind AS bank_kind,bank.origin AS bank_origin,bank.owner_user_id AS bank_owner,'+
  'bank.household_id AS bank_household,securities.version AS live_securities,'+
  'securities.is_archived AS securities_archived,securities.account_kind AS securities_kind,'+
  'securities.origin AS securities_origin,securities.owner_user_id AS securities_owner,'+
  'securities.household_id AS securities_household,member.role AS member_role,member.state AS member_state '+
  'FROM family_sbi_cash_intents p JOIN family_financial_accounts bank ON bank.account_id=p.bank_account_id '+
  'JOIN family_financial_accounts securities ON securities.account_id=p.securities_account_id '+
  'JOIN homeflow_identity_links member ON member.user_id=p.requester_user_id '+
  'WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!r||r.status!=='submitted'||r.expires_at<=Date.now()||
  r.household_id!==b.household_id||r.requester_user_id!==b.requester_user_id||
  r.payload_sha256!==b.payload_sha256||r.bank_version!==r.live_bank||
  r.securities_version!==r.live_securities||r.bank_archived!==0||r.securities_archived!==0||
  r.bank_kind!=='bank'||r.securities_kind!=='securities'||
  r.bank_origin!=='member_created'||r.securities_origin!=='member_created'||
  r.bank_owner!==b.requester_user_id||r.securities_owner!==b.requester_user_id||
  r.bank_household!==b.household_id||r.securities_household!==b.household_id||
  r.member_role!=='member'||r.member_state!=='active')
  return fail('SBI_CASH_ACCOUNT_OR_IDENTITY_CHANGED');
 const p=await decode(e,r);
 const authorized=p&&await proof(e,b,r.bank_version,r.kind);
 if(!p||!authorized)return fail('SBI_CASH_APPROVAL_INVALID');
 const at=Date.now(),evidenceId=newid(),clientId='hfsbicash:'+b.request_id;
 const statements=[
  db.prepare('INSERT INTO family_sbi_cash_bank_evidence '+
   '(evidence_id,household_id,bank_account_id,bank_version,reference_hash,debit_date,amount_jpy,evidence_kind,recorded_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?)')
   .bind(evidenceId,b.household_id,r.bank_account_id,r.bank_version,
    p.reference_hash,p.debit_date,p.amount_jpy,p.evidence_kind,at),
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,'+
   'transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,'+
   'family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,'投資・資産移動','SBI証券',?,'','transfer',?,1,?,?,?,?,?)")
   .bind(p.debit_date,p.amount_jpy,p.kind==='tsumitate'?'積立':'追加買付',
    'sbi:'+r.securities_account_id,p.effective_date,clientId,
    'bank:'+r.bank_account_id,r.bank_account_id,r.securities_account_id),
  db.prepare('INSERT INTO family_sbi_cash_applied '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,'+
   'bank_account_id,bank_version,securities_account_id,securities_version,kind,payload_sha256,evidence_id,'+
   'transfer_entry_id,amount_jpy,debit_date,trade_date,effective_date,applied_at) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=? LIMIT 1),?,?,?,?,?)")
   .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
    authorized.approver_user_id,authorized.approver_user_id,
    r.bank_account_id,r.bank_version,r.securities_account_id,r.securities_version,
    r.kind,b.payload_sha256,evidenceId,clientId,p.amount_jpy,p.debit_date,p.trade_date,p.effective_date,at),
  db.prepare('INSERT INTO family_sbi_cash_lots '+
   '(homeflow_request_id,household_id,owner_user_id,securities_account_id,kind,fund_code,'+
   'account_type,confirmed_units,acquisition_cost_jpy,broker_reference_hash,trade_date,effective_date,'+
   'actor_user_id,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(b.request_id,b.household_id,b.requester_user_id,r.securities_account_id,
    r.kind,p.fund_code,p.account_type,p.confirmed_units,p.amount_jpy,
    p.broker_reference_hash,p.trade_date,p.effective_date,authorized.approver_user_id,at),
  db.prepare('INSERT INTO family_sbi_cash_audit '+
   '(event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) '+
   "VALUES(?,?,?,?,?,'sbi_cash_purchase_applied',?)")
   .bind(newid(),b.request_id,b.requester_user_id,authorized.approver_user_id,authorized.approver_user_id,at)
 ];
 try{
  const changed=await db.batch(statements);
  if(changed.length!==statements.length||changed.some(x=>x.meta?.changes!==1))
   return fail('SBI_CASH_TRANSACTION_UNCONFIRMED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return identity(raced,b)?confirmed(db,raced,b,true):fail('SBI_CASH_TRANSACTION_RETRY',503);
 }
 const applied=await db.prepare('SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return identity(applied,b)?confirmed(db,applied,b,false):fail('SBI_CASH_RECEIPT_UNCONFIRMED',503);
}
export const onRequest=({request,env,params})=>approvedSbiCashRoute(request,env,params.path||[]);
