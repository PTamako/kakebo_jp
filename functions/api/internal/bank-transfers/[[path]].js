import {crossMemberBankExecution} from './cross-member.js';
// DRAFT P0-4C: signed HomeFlow approval; posted bank debit+credit -> ONE immutable transfer.
// Internal ledger only. No external bank API or cross-member money movement.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&hex.test(a)&&
 [...a].reduce((n,x,i)=>n|(x.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const unique=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const date=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_BANK_TRANSFER_ENABLED==='true'&&e.DB?.prepare&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(e.KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET||'')&&
 hex.test(e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
const fields=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
async function signed(req,e,mode){
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||req.headers.get('x-approval-client')!=='homeflow'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 const stamp=req.headers.get('x-approval-timestamp')||'',
  signature=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!hex.test(signature))return null;
 let b,raw;try{raw=await req.text();if(raw.length>1300)return null;b=JSON.parse(raw)}catch{return null}
 if(!exact(b,mode==='execute'?[...fields,'execution_nonce']:fields)||
  !uuid.test(b.request_id)||!id.test(b.resource_id)||!hex.test(b.payload_sha256)||
  (mode==='execute'&&!hex.test(b.execution_nonce))||
  typeof b.household_id!=='string'||!b.household_id||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||b.requester_user_id.length>128)
  return null;
 return same(signature,await mac(e.KAKEIBO_BANK_TRANSFER_EXECUTION_SECRET,
  'homeflow:bank-transfer-'+mode,stamp,raw))?b:null;
}
const identity=(r,b)=>!!r&&r.homeflow_request_id===b.request_id&&r.proposal_id===b.resource_id&&
 r.household_id===b.household_id&&r.requester_user_id===b.requester_user_id&&
 r.payload_sha256===b.payload_sha256;
async function receipt(db,r,b,replayed){
 const [evidence,entry,audit]=await Promise.all([
  db.prepare('SELECT * FROM family_bank_transfer_posted_evidence WHERE evidence_id=?')
   .bind(r.evidence_id).first(),
  db.prepare('SELECT * FROM entries WHERE id=?').bind(r.transfer_entry_id).first(),
  db.prepare('SELECT * FROM family_bank_transfer_actor_audit WHERE homeflow_request_id=?')
   .bind(r.homeflow_request_id).first()
 ]);
 if(!identity(r,b)||!evidence||!entry||!audit||
  evidence.household_id!==r.household_id||
  evidence.source_account_id!==r.source_account_id||
  evidence.target_account_id!==r.target_account_id||
  evidence.source_version!==r.source_version||
  evidence.target_version!==r.target_version||
  evidence.amount_jpy!==r.amount_jpy||
  evidence.debit_date!==r.debit_date||evidence.credit_date!==r.credit_date||
  evidence.bank_debit_posted!==1||evidence.bank_credit_posted!==1||
  entry.type!=='transfer'||entry.amount!==r.amount_jpy||
  entry.client_request_id!=='hfbanktransfer:'+r.homeflow_request_id||
  entry.family_account_id!==r.source_account_id||
  entry.family_transfer_target_account_id!==r.target_account_id||
  entry.transfer_target!=='bank:'+r.target_account_id||
  entry.payment_source!=='bank:'+r.source_account_id||
  entry.transfer_applied!==1||entry.date!==r.debit_date||
  entry.transfer_date!==r.credit_date||
  audit.requester_user_id!==r.requester_user_id||
  audit.approver_user_id!==r.approver_user_id||
  audit.actor_user_id!==r.actor_user_id||audit.created_at!==r.applied_at)
  return fail('BANK_TRANSFER_COUNTERPART_UNCONFIRMED',503);
 return json({ok:true,applied:true,approval_id:r.homeflow_request_id,proposal_id:r.proposal_id,
  household_id:r.household_id,requester_user_id:r.requester_user_id,
  approver_user_id:r.approver_user_id,actor_user_id:r.actor_user_id,
  payload_sha256:r.payload_sha256,source_account_id:r.source_account_id,
  source_version:r.source_version,target_account_id:r.target_account_id,
  target_version:r.target_version,amount_jpy:r.amount_jpy,
  debit_date:r.debit_date,credit_date:r.credit_date,
  source_reference_hash:evidence.source_reference_hash,
  target_reference_hash:evidence.target_reference_hash,
  entry_type:'transfer',transfer_applied:true,balance_conserving:true,
  transfer_entry_id:r.transfer_entry_id,entry_id:r.transfer_entry_id,
  applied_at:r.applied_at,already_applied:replayed});
}
async function decode(e,p){
 try{
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0));
  const cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>3000)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(
   e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),'AES-GCM',false,['decrypt']);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({
   name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-bank-transfer:'+p.request_id)},key,cipher));
  if(!same(await hash(raw),p.payload_sha256))return null;
  const x=JSON.parse(raw);
  if(!exact(x,['source_account_id','source_version','target_account_id','target_version',
   'debit_date','credit_date','amount_jpy','source_reference_hash','target_reference_hash',
   'bank_debit_posted','bank_credit_posted','evidence_kind'])||
   x.source_account_id!==p.source_account_id||x.source_version!==p.source_version||
   x.target_account_id!==p.target_account_id||x.target_version!==p.target_version||
   !id.test(x.source_account_id)||!id.test(x.target_account_id)||
   x.source_account_id===x.target_account_id||
   !date(x.debit_date)||!date(x.credit_date)||x.debit_date>x.credit_date||
   x.credit_date>new Date(Date.now()+9*3600000).toISOString().slice(0,10)||
   !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
   !hex.test(x.source_reference_hash)||!hex.test(x.target_reference_hash)||
   x.bank_debit_posted!==true||x.bank_credit_posted!==true||
   x.evidence_kind!=='owner_attested_two_posted_bank_statements')return null;
  return x;
 }catch{return null}
}
async function proof(e,b,version){
 const wire={...Object.fromEntries(fields.map(k=>[k,b[k]])),
  idempotency_key:'kakeibo:bank-transfer:'+b.resource_id,expected_version:version,
  purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 try{
  const res=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-bank-transfer','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET,
     'kakeibo-bank-transfer:execution-proof',stamp,raw)},body:raw}));
  if(res.status!==200||res.headers.has('location'))return null;
  const text=await res.text();if(text.length>1900)return null;
  const x=JSON.parse(text);
  return x?.ok===true&&x.verified===true&&x.execution_authorized===true&&
   x.execution_status==='executing'&&x.source_app==='kakebo'&&x.target_app==='kakebo'&&
   x.operation==='finance.asset_transfer.bank_to_bank'&&x.resource_type==='bank_transfer_posted'&&
   x.idempotency_key===wire.idempotency_key&&x.expected_version===version&&
   x.request_id===b.request_id&&x.resource_id===b.resource_id&&
   x.household_id===b.household_id&&x.requester_user_id===b.requester_user_id&&
   x.payload_sha256===b.payload_sha256&&
   x.approver_user_id&&x.approver_user_id!==b.requester_user_id&&
   Number.isSafeInteger(x.approved_at)&&Number.isSafeInteger(x.expires_at)&&
   x.expires_at>Date.now()&&x.applied===false?x:null;
 }catch{return null}
}
export async function approvedBankTransferRoute(req,e,parts){
 if(!ready(e))return fail('BANK_TRANSFER_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt'].includes(parts[0]))return fail('NOT_FOUND',404);
 const mode=parts[0],b=await signed(req,e,mode);
 if(!b)return fail('BANK_TRANSFER_UNAUTHORIZED',403);
 const db=e.DB;
 const cross=e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED==='true'?
  await db.prepare('SELECT request_id FROM family_cross_bank_intents WHERE request_id=? LIMIT 1')
   .bind(b.resource_id).first():null;
 const crossJournal=e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED==='true'?
  await db.prepare('SELECT homeflow_request_id FROM family_cross_bank_journal WHERE homeflow_request_id=? LIMIT 1')
   .bind(b.request_id).first():null;
 if(cross||crossJournal)return crossMemberBankExecution(e,b,mode);
 const prior=await db.prepare('SELECT * FROM family_bank_transfers_applied WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1')
  .bind(b.request_id,b.resource_id).first();
 if(prior)return identity(prior,b)?receipt(db,prior,b,true):fail('BANK_TRANSFER_RECEIPT_CONFLICT');
 if(mode==='receipt')return fail('BANK_TRANSFER_RECEIPT_UNKNOWN',404);
 const row=await db.prepare('SELECT i.*,src.version AS live_src,src.is_archived AS src_archived,'+
  'src.account_kind AS src_kind,src.origin AS src_origin,src.household_id AS src_hh,'+
  'src.owner_user_id AS src_owner,dst.version AS live_dst,dst.is_archived AS dst_archived,'+
  'dst.account_kind AS dst_kind,dst.origin AS dst_origin,dst.household_id AS dst_hh,'+
  'dst.owner_user_id AS dst_owner,member.role AS member_role,member.state AS member_state '+
  'FROM family_bank_transfer_intents i '+
  'JOIN family_financial_accounts src ON src.account_id=i.source_account_id '+
  'JOIN family_financial_accounts dst ON dst.account_id=i.target_account_id '+
  'JOIN homeflow_identity_links member ON member.user_id=i.requester_user_id '+
  'WHERE i.request_id=? AND i.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!row||row.status!=='submitted'||row.expires_at<=Date.now()||
  row.household_id!==b.household_id||row.requester_user_id!==b.requester_user_id||
  row.payload_sha256!==b.payload_sha256||row.source_account_id===row.target_account_id||
  row.live_src!==row.source_version||row.live_dst!==row.target_version||
  row.src_archived!==0||row.dst_archived!==0||
  row.src_kind!=='bank'||row.dst_kind!=='bank'||
  row.src_origin!=='member_created'||row.dst_origin!=='member_created'||
  row.src_hh!==b.household_id||row.dst_hh!==b.household_id||
  row.src_owner!==b.requester_user_id||row.dst_owner!==b.requester_user_id||
  row.member_role!=='member'||row.member_state!=='active')
  return fail('BANK_TRANSFER_ACCOUNT_OR_MEMBER_CHANGED');
 const payload=await decode(e,row),approved=payload&&await proof(e,b,row.source_version);
 if(!payload||!approved)return fail('BANK_TRANSFER_PAYLOAD_OR_APPROVAL_INVALID');
 const at=Date.now(),evidenceId=unique(),clientId='hfbanktransfer:'+b.request_id;
 const actions=[
  db.prepare('INSERT INTO family_bank_transfer_posted_evidence '+
   '(evidence_id,household_id,source_account_id,source_version,target_account_id,target_version,'+
   'source_reference_hash,target_reference_hash,debit_date,credit_date,amount_jpy,'+
   "bank_debit_posted,bank_credit_posted,evidence_kind,recorded_at) "+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,1,1,'owner_attested_two_posted_bank_statements',?)")
   .bind(evidenceId,b.household_id,row.source_account_id,row.source_version,
    row.target_account_id,row.target_version,payload.source_reference_hash,
    payload.target_reference_hash,payload.debit_date,payload.credit_date,payload.amount_jpy,at),
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,'+
   'transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,'+
   'family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,'資産移動','銀行振替','確認済振替','','transfer',?,1,?,?,?,?,?)")
   .bind(payload.debit_date,payload.amount_jpy,'bank:'+row.target_account_id,
    payload.credit_date,clientId,'bank:'+row.source_account_id,
    row.source_account_id,row.target_account_id),
  db.prepare('INSERT INTO family_bank_transfers_applied '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,'+
   'actor_user_id,source_account_id,source_version,target_account_id,target_version,'+
   'payload_sha256,evidence_id,transfer_entry_id,amount_jpy,debit_date,credit_date,applied_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?,?,?,?)')
   .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,
    approved.approver_user_id,approved.approver_user_id,
    row.source_account_id,row.source_version,row.target_account_id,row.target_version,
    b.payload_sha256,evidenceId,clientId,payload.amount_jpy,
    payload.debit_date,payload.credit_date,at),
  db.prepare('INSERT INTO family_bank_transfer_actor_audit '+
   "(event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,action,created_at) "+
   "VALUES(?,?,?,?,?,'posted_bank_to_bank_transfer_applied',?)")
   .bind(unique(),b.request_id,b.requester_user_id,approved.approver_user_id,
    approved.approver_user_id,at)
 ];
 try{
  const result=await db.batch(actions);
  if(result.length!==actions.length||result.some(x=>x.meta?.changes!==1))
   return fail('BANK_TRANSFER_ATOMIC_CONFIRMATION_REQUIRED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_bank_transfers_applied WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return identity(raced,b)?receipt(db,raced,b,true):fail('BANK_TRANSFER_TRANSACTION_RETRY',503);
 }
 const saved=await db.prepare('SELECT * FROM family_bank_transfers_applied WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return identity(saved,b)?receipt(db,saved,b,false):fail('BANK_TRANSFER_RECEIPT_UNCONFIRMED',503);
}
