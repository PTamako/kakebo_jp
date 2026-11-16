// Target-only cross-member bank execution from EXISTING signed HomeFlow bank channel.
// Called after the homeflow:bank-transfer-* HMAC envelope was validated upstream.
// Two independently posted bank statements are user attestation, NOT bank API proof.
const enc=new TextEncoder(),h64=/^[a-f0-9]{64}$/i;
const response=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const deny=(code,status=409)=>response({ok:false,code,applied:false},status);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const fresh=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const iso=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_CROSS_MEMBER_BANK_ENABLED==='true'&&e.KAKEIBO_BANK_TRANSFER_ENABLED==='true'&&
 h64.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 h64.test(e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET||'')&&
 h64.test(e.KAKEIBO_CROSS_MEMBER_PROOF_SECRET||'')&&
 e.DB?.prepare&&typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
 {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function remote(e,path,client,secret,domain,body){
 const raw=JSON.stringify(body),stamp=String(Date.now());
 try{
  const res=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(new URL(path,e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
   'x-approval-client':client,'x-approval-timestamp':stamp,
   'x-approval-signature':await mac(secret,domain,stamp,raw)},body:raw}));
  if(res.status!==200||res.headers.has('location'))return null;
  const txt=await res.text();return txt.length<=2400?JSON.parse(txt):null;
 }catch{return null}
}
async function payload(e,p){
 try{
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0));
  const cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>3000)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(
   e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),'AES-GCM',false,['decrypt']);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({
   name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-cross-bank:'+p.request_id)},key,cipher));
  if(await hash(raw)!==p.payload_sha256)return null;
  const x=JSON.parse(raw);
  if(!exact(x,['source_user_id','recipient_user_id','source_account_id','source_version',
    'target_account_id','target_version','debit_date','amount_jpy',
    'source_reference_hash','bank_debit_posted','evidence_kind'])||
    x.source_user_id!==p.requester_user_id||x.recipient_user_id!==p.recipient_user_id||
    x.source_account_id!==p.source_account_id||x.target_account_id!==p.target_account_id||
    x.source_version!==p.source_version||x.target_version!==p.target_version||
    x.debit_date!==p.debit_date||x.amount_jpy!==p.amount_jpy||
    x.source_reference_hash!==p.source_reference_hash||
    x.bank_debit_posted!==true||x.evidence_kind!=='source_attested_posted_debit')return null;
  return x;
 }catch{return null}
}
const match=(j,b)=>j&&j.homeflow_request_id===b.request_id&&
 j.proposal_id===b.resource_id&&j.household_id===b.household_id&&
 j.requester_user_id===b.requester_user_id&&j.payload_sha256===b.payload_sha256;
async function receipt(db,j,b,replayed){
 const [entry,r,a,source,target]=await Promise.all([
  db.prepare('SELECT * FROM entries WHERE id=?').bind(j.transfer_entry_id).first(),
  db.prepare('SELECT * FROM family_cross_bank_recipient_evidence WHERE request_id=?').bind(j.proposal_id).first(),
  db.prepare('SELECT * FROM family_cross_bank_actor_audit WHERE homeflow_request_id=?').bind(j.homeflow_request_id).first(),
  db.prepare('SELECT owner_user_id FROM family_financial_accounts WHERE account_id=?').bind(j.source_account_id).first(),
  db.prepare('SELECT owner_user_id FROM family_financial_accounts WHERE account_id=?').bind(j.target_account_id).first()]);
 if(!match(j,b)||!entry||!r||!a||!source||!target||
  source.owner_user_id!==j.requester_user_id||target.owner_user_id!==j.recipient_user_id||
  r.recipient_user_id!==j.recipient_user_id||r.credit_reference_hash!==j.credit_reference_hash||
  r.credit_date!==j.credit_date||r.amount_jpy!==j.amount_jpy||r.credit_posted!==1||
  entry.client_request_id!=='hfcrossbank:'+j.homeflow_request_id||
  entry.type!=='transfer'||entry.amount!==j.amount_jpy||
  entry.date!==j.debit_date||entry.transfer_date!==j.credit_date||
  entry.transfer_applied!==1||entry.payment_source!=='bank:'+j.source_account_id||
  entry.transfer_target!=='bank:'+j.target_account_id||
  entry.family_account_id!==j.source_account_id||
  entry.family_transfer_target_account_id!==j.target_account_id||
  a.source_actor_user_id!==j.requester_user_id||
  a.recipient_actor_user_id!==j.recipient_user_id||
  a.owner_authorizer_user_id!==j.approver_user_id||
  a.execute_actor_user_id!==j.actor_user_id||a.created_at!==j.applied_at)
  return deny('CROSS_BANK_DOUBLE_JOURNAL_RECEIPT_INVALID',503);
 return response({ok:true,applied:true,approval_id:j.homeflow_request_id,proposal_id:j.proposal_id,
  household_id:j.household_id,requester_user_id:j.requester_user_id,
  approver_user_id:j.approver_user_id,actor_user_id:j.actor_user_id,
  payload_sha256:j.payload_sha256,source_account_id:j.source_account_id,
  source_version:j.source_version,target_account_id:j.target_account_id,
  target_version:j.target_version,amount_jpy:j.amount_jpy,
  debit_date:j.debit_date,credit_date:j.credit_date,
  source_reference_hash:j.source_reference_hash,target_reference_hash:j.credit_reference_hash,
  entry_type:'transfer',transfer_applied:true,balance_conserving:true,
  transfer_entry_id:j.transfer_entry_id,entry_id:j.transfer_entry_id,
  applied_at:j.applied_at,already_applied:replayed,
  cross_member:true,consent_id:j.consent_id,recipient_user_id:j.recipient_user_id,
  source_owner_user_id:j.requester_user_id,target_owner_user_id:j.recipient_user_id,
  owner_authorizer_user_id:j.approver_user_id,
  bank_statements_verified_by_institution:false});
}
async function executionProof(e,b,version){
 const body={...b,idempotency_key:'kakeibo:bank-transfer:'+b.resource_id,
  expected_version:version,purpose:'execute'};
 const r=await remote(e,'/api/internal/approvals/verify','kakeibo-bank-transfer',
  e.KAKEIBO_BANK_TRANSFER_PROOF_SECRET,'kakeibo-bank-transfer:execution-proof',body);
 return r?.ok===true&&r.verified===true&&r.execution_authorized===true&&
  r.execution_status==='executing'&&r.source_app==='kakebo'&&r.target_app==='kakebo'&&
  r.operation==='finance.asset_transfer.bank_to_bank'&&r.resource_type==='bank_transfer_posted'&&
  r.idempotency_key===body.idempotency_key&&r.request_id===b.request_id&&
  r.resource_id===b.resource_id&&r.household_id===b.household_id&&
  r.requester_user_id===b.requester_user_id&&r.payload_sha256===b.payload_sha256&&
  r.expected_version===version&&r.approved_at>0&&r.expires_at>Date.now()&&
  r.approver_user_id&&r.approver_user_id!==b.requester_user_id&&
  r.applied===false?r:null;
}
async function independentConsent(e,p){
 const body={consent_id:p.consent_id,resource_id:p.request_id,household_id:p.household_id,
  source_user_id:p.requester_user_id,recipient_user_id:p.recipient_user_id,
  payload_sha256:p.payload_sha256,source_account_version:p.source_version,
  recipient_account_version:p.target_version};
 const r=await remote(e,'/api/internal/cross-member/consent-proof','kakeibo-cross-member',
  e.KAKEIBO_CROSS_MEMBER_PROOF_SECRET,'kakeibo-cross-member:consent-proof',body);
 return r?.ok===true&&r.consent_verified===true&&r.ledger_applied===false&&
  r.target_ledger_authorized===false&&r.bank_statements_verified===false&&
  r.consent_id===p.consent_id&&r.resource_id===p.request_id&&
  r.payload_sha256===p.payload_sha256&&r.household_id===p.household_id&&
  r.source_user_id===p.requester_user_id&&r.recipient_user_id===p.recipient_user_id&&
  r.source_account_version===p.source_version&&r.recipient_account_version===p.target_version&&
  r.owner_authorizer_user_id===p.recipient_user_id&&r.consent_version===3&&
  Number.isSafeInteger(r.valid_until)&&r.valid_until>Date.now();
}
export async function crossMemberBankExecution(e,b,mode){
 if(!ready(e))return deny('CROSS_BANK_EXECUTION_DISABLED',503);
 const db=e.DB;
 const prior=await db.prepare('SELECT * FROM family_cross_bank_journal '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1').bind(b.request_id,b.resource_id).first();
 if(prior)return match(prior,b)?receipt(db,prior,b,true):deny('CROSS_BANK_APPROVAL_ID_CONFLICT');
 if(mode==='receipt')return deny('CROSS_BANK_RECEIPT_UNKNOWN',404);
 const p=await db.prepare('SELECT i.*,r.credit_reference_hash,r.credit_date,r.credit_posted,'+
  'r.amount_jpy AS confirmed_amount,src.version AS live_source,src.is_archived AS archived_source,'+
  'dst.version AS live_target,dst.is_archived AS archived_target,'+
  'src.owner_user_id AS source_owner,dst.owner_user_id AS recipient_owner,'+
  'src.account_kind AS source_kind,dst.account_kind AS target_kind,'+
  'src.origin AS source_origin,dst.origin AS target_origin,'+
  'src.household_id AS source_household,dst.household_id AS target_household,'+
  'sender.role AS source_role,sender.state AS source_state,'+
  'recipient.role AS recipient_role,recipient.state AS recipient_state '+
  'FROM family_cross_bank_intents i '+
  'JOIN family_cross_bank_recipient_evidence r ON r.request_id=i.request_id '+
  'JOIN family_financial_accounts src ON src.account_id=i.source_account_id '+
  'JOIN family_financial_accounts dst ON dst.account_id=i.target_account_id '+
  'JOIN homeflow_identity_links sender ON sender.user_id=i.requester_user_id '+
  'JOIN homeflow_identity_links recipient ON recipient.user_id=i.recipient_user_id '+
  'WHERE i.request_id=? AND i.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!p||p.status!=='submitted'||p.expires_at<=Date.now()||
  p.household_id!==b.household_id||p.requester_user_id!==b.requester_user_id||
  p.payload_sha256!==b.payload_sha256||!p.consent_id||
  p.live_source!==p.source_version||p.live_target!==p.target_version||
  p.archived_source!==0||p.archived_target!==0||
  p.source_owner!==p.requester_user_id||p.recipient_owner!==p.recipient_user_id||
  p.source_kind!=='bank'||p.target_kind!=='bank'||
  p.source_origin!=='member_created'||p.target_origin!=='member_created'||
  p.source_household!==p.household_id||p.target_household!==p.household_id||
  p.source_role!=='member'||p.recipient_role!=='owner'||
  p.source_state!=='active'||p.recipient_state!=='active'||
  p.credit_posted!==1||p.confirmed_amount!==p.amount_jpy||
  !iso(p.debit_date)||!iso(p.credit_date)||p.debit_date>p.credit_date||
  p.credit_date>today())
  return deny('CROSS_BANK_MEMBER_ACCOUNT_OR_EVIDENCE_CHANGED');
 const decoded=await payload(e,p);
 if(!decoded)return deny('CROSS_BANK_ENCRYPTED_INTENT_MISMATCH');
 const [approval,consented]=await Promise.all([
  executionProof(e,b,p.source_version),independentConsent(e,p)]);
 if(!approval||!consented||approval.approver_user_id!==p.recipient_user_id)
  return deny('CROSS_BANK_INDEPENDENT_PROOF_MISSING');
 const at=Date.now(),entryId='hfcrossbank:'+b.request_id;
 const actions=[
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,'+
   'transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,'+
   'family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,'資産移動','銀行振替','双方確認済振替','','transfer',?,1,?,?,?,?,?)")
   .bind(p.debit_date,p.amount_jpy,'bank:'+p.target_account_id,p.credit_date,
    entryId,'bank:'+p.source_account_id,p.source_account_id,p.target_account_id),
  db.prepare('INSERT INTO family_cross_bank_journal '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,recipient_user_id,'+
   'approver_user_id,actor_user_id,consent_id,source_account_id,source_version,'+
   'target_account_id,target_version,amount_jpy,debit_date,credit_date,source_reference_hash,'+
   'credit_reference_hash,payload_sha256,transfer_entry_id,applied_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'+
   '(SELECT id FROM entries WHERE client_request_id=?),?)')
   .bind(b.request_id,b.resource_id,b.household_id,b.requester_user_id,p.recipient_user_id,
    approval.approver_user_id,approval.approver_user_id,p.consent_id,
    p.source_account_id,p.source_version,p.target_account_id,p.target_version,
    p.amount_jpy,p.debit_date,p.credit_date,p.source_reference_hash,p.credit_reference_hash,
    p.payload_sha256,entryId,at),
  db.prepare('INSERT INTO family_cross_bank_actor_audit '+
   '(event_id,homeflow_request_id,source_actor_user_id,recipient_actor_user_id,'+
   'owner_authorizer_user_id,execute_actor_user_id,action,created_at) '+
   "VALUES(?,?,?,?,?,?,'cross_member_posted_bank_transfer',?)")
   .bind(fresh(),b.request_id,b.requester_user_id,p.recipient_user_id,
    approval.approver_user_id,approval.approver_user_id,at)
 ];
 try{
  const changes=await db.batch(actions);
  if(changes.length!==3||changes.some(x=>x.meta?.changes!==1))
   return deny('CROSS_BANK_ATOMIC_CONFIRMATION_REQUIRED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_cross_bank_journal WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return match(raced,b)?receipt(db,raced,b,true):deny('CROSS_BANK_TRANSACTION_RETRY',503);
 }
 const saved=await db.prepare('SELECT * FROM family_cross_bank_journal WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return match(saved,b)?receipt(db,saved,b,false):deny('CROSS_BANK_RECEIPT_UNCONFIRMED',503);
}
