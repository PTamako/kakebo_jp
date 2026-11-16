// DRAFT: execute FULL SBI cash refund only after independent signed owner approval.
// Called exclusively from the existing signed sbi-cash-actions internal route.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&hex.test(a)&&
 [...a].reduce((n,x,i)=>n|(x.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const newid=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const identity=(r,b)=>!!r&&r.homeflow_request_id===b.request_id&&r.proposal_id===b.resource_id&&
 r.household_id===b.household_id&&r.requester_user_id===b.requester_user_id&&r.payload_sha256===b.payload_sha256;
async function receipt(db,r,b,replay){
 const [orig,lot,evidence,audit,transfer]=await Promise.all([
  db.prepare('SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?')
   .bind(r.original_request_id).first(),
  db.prepare('SELECT * FROM family_sbi_cash_lots WHERE homeflow_request_id=?')
   .bind(r.original_request_id).first(),
  db.prepare('SELECT * FROM family_sbi_cash_refund_evidence WHERE evidence_id=?')
   .bind(r.evidence_id).first(),
  db.prepare('SELECT * FROM family_sbi_cash_reversal_audit WHERE homeflow_request_id=?')
   .bind(r.homeflow_request_id).first(),
  db.prepare('SELECT * FROM entries WHERE id=?').bind(r.reversal_entry_id).first()
 ]);
 if(!identity(r,b)||!orig||!lot||!evidence||!audit||!transfer||
  orig.household_id!==r.household_id||orig.requester_user_id!==r.requester_user_id||
  orig.bank_account_id!==r.bank_account_id||orig.securities_account_id!==r.securities_account_id||
  orig.amount_jpy!==r.amount_jpy||lot.confirmed_units!==r.reversed_units||
  lot.acquisition_cost_jpy!==r.reversed_cost_jpy||r.reversed_cost_jpy!==r.amount_jpy||
  evidence.original_request_id!==r.original_request_id||
  evidence.amount_jpy!==r.amount_jpy||evidence.bank_refund_confirmed!==1||
  evidence.broker_cancel_confirmed!==1||evidence.bank_refund_date!==r.bank_refund_date||
  evidence.broker_cancel_date!==r.broker_cancel_date||
  audit.original_request_id!==r.original_request_id||audit.actor_user_id!==r.actor_user_id||
  audit.approver_user_id!==r.approver_user_id||audit.requester_user_id!==r.requester_user_id||
  transfer.type!=='transfer'||transfer.amount!==r.amount_jpy||
  transfer.family_account_id!==r.securities_account_id||
  transfer.family_transfer_target_account_id!==r.bank_account_id||
  transfer.client_request_id!=='hfsbicashrefund:'+r.homeflow_request_id)
  return fail('SBI_REFUND_COUNTERPART_UNCONFIRMED',503);
 return json({ok:true,applied:true,approval_id:r.homeflow_request_id,proposal_id:r.proposal_id,
  household_id:r.household_id,requester_user_id:r.requester_user_id,
  approver_user_id:r.approver_user_id,actor_user_id:r.actor_user_id,
  payload_sha256:r.payload_sha256,kind:'reversal',original_request_id:r.original_request_id,
  bank_account_id:r.bank_account_id,bank_version:r.bank_version,
  securities_account_id:r.securities_account_id,securities_version:r.securities_version,
  amount_jpy:r.amount_jpy,confirmed_units:r.reversed_units,
  acquisition_cost_jpy:r.reversed_cost_jpy,fund_code:lot.fund_code,account_type:lot.account_type,
  broker_reference_hash:lot.broker_reference_hash,
  debit_date:orig.debit_date,trade_date:orig.trade_date,effective_date:orig.effective_date,
  bank_refund_date:r.bank_refund_date,broker_cancel_date:r.broker_cancel_date,
  bank_refund_hash:evidence.bank_refund_hash,broker_cancel_hash:evidence.broker_cancel_hash,
  original_transfer_entry_id:orig.transfer_entry_id,
  reversal_entry_id:r.reversal_entry_id,transfer_entry_id:r.reversal_entry_id,entry_id:r.reversal_entry_id,
  broker_reconciled:false,included_in_tracked_assets_jpy:false,
  applied_at:r.applied_at,already_applied:replay});
}
async function decode(e,p){
 try{
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0));
  const cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>5000)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(
   e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),'AES-GCM',false,['decrypt']);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({
   name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-sbi-cash-reversal:'+p.request_id)},key,cipher));
  if(!same(await hash(raw),p.payload_sha256))return null;
  const x=JSON.parse(raw);
  if(!exact(x,['original_request_id','bank_account_id','bank_version',
   'securities_account_id','securities_version','bank_refund_hash','broker_cancel_hash',
   'bank_refund_date','broker_cancel_date','amount_jpy','confirmed_units',
   'acquisition_cost_jpy','fund_code','account_type','bank_refund_confirmed',
   'broker_cancel_confirmed'])||x.original_request_id!==p.original_request_id||
   x.bank_account_id!==p.bank_account_id||x.bank_version!==p.bank_version||
   x.securities_account_id!==p.securities_account_id||x.securities_version!==p.securities_version||
   !hex.test(x.bank_refund_hash)||!hex.test(x.broker_cancel_hash)||
   !date(x.bank_refund_date)||!date(x.broker_cancel_date)||
   x.bank_refund_date<x.broker_cancel_date||
   x.bank_refund_date>new Date(Date.now()+9*3600000).toISOString().slice(0,10)||
   !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
   !Number.isSafeInteger(x.confirmed_units)||x.confirmed_units<1||x.confirmed_units>1000000000000||
   x.acquisition_cost_jpy!==x.amount_jpy||!/^[A-Z0-9]{8}$/.test(x.fund_code)||
   !['growth','tsumitate'].includes(x.account_type)||
   x.bank_refund_confirmed!==true||x.broker_cancel_confirmed!==true)return null;
  return x;
 }catch{return null}
}
export async function approvedSbiCashReversalInternal(db,e,b,mode,verifyProof){
 if(e.KAKEIBO_SBI_CASH_REVERSALS_ENABLED!=='true')return fail('SBI_REFUND_DISABLED',503);
 const existing=await db.prepare('SELECT * FROM family_sbi_cash_reversals WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1')
  .bind(b.request_id,b.resource_id).first();
 if(existing)return identity(existing,b)?receipt(db,existing,b,true):fail('SBI_REFUND_RECEIPT_CONFLICT');
 if(mode==='receipt')return fail('SBI_REFUND_RECEIPT_UNKNOWN',404);
 const r=await db.prepare('SELECT i.*,bank.version AS live_bank,bank.is_archived AS bank_archived,'+
  'bank.origin AS bank_origin,bank.account_kind AS bank_kind,bank.owner_user_id AS bank_owner,'+
  'bank.household_id AS bank_household,sec.version AS live_securities,sec.is_archived AS sec_archived,'+
  'sec.origin AS sec_origin,sec.account_kind AS sec_kind,sec.owner_user_id AS sec_owner,'+
  'sec.household_id AS sec_household,member.state AS member_state,member.role AS member_role '+
  'FROM family_sbi_cash_reversal_intents i '+
  'JOIN family_financial_accounts bank ON bank.account_id=i.bank_account_id '+
  'JOIN family_financial_accounts sec ON sec.account_id=i.securities_account_id '+
  'JOIN homeflow_identity_links member ON member.user_id=i.requester_user_id '+
  'WHERE i.request_id=? AND i.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!r||r.status!=='submitted'||r.expires_at<=Date.now()||
  r.household_id!==b.household_id||r.requester_user_id!==b.requester_user_id||
  r.payload_sha256!==b.payload_sha256||r.bank_version!==r.live_bank||
  r.securities_version!==r.live_securities||r.bank_archived!==0||r.sec_archived!==0||
  r.bank_origin!=='member_created'||r.sec_origin!=='member_created'||
  r.bank_kind!=='bank'||r.sec_kind!=='securities'||
  r.bank_owner!==b.requester_user_id||r.sec_owner!==b.requester_user_id||
  r.bank_household!==b.household_id||r.sec_household!==b.household_id||
  r.member_state!=='active'||r.member_role!=='member')
  return fail('SBI_REFUND_IDENTITY_OR_ACCOUNT_CHANGED');
 const [original,lot]=await Promise.all([
  db.prepare('SELECT * FROM family_sbi_cash_applied WHERE homeflow_request_id=?')
   .bind(r.original_request_id).first(),
  db.prepare('SELECT * FROM family_sbi_cash_lots WHERE homeflow_request_id=?')
   .bind(r.original_request_id).first()
 ]);
 const p=await decode(e,r),authorized=p&&await verifyProof(e,b,r.bank_version,'reversal');
 if(!p||!authorized||!original||!lot||
  original.household_id!==r.household_id||original.requester_user_id!==r.requester_user_id||
  original.bank_account_id!==r.bank_account_id||original.securities_account_id!==r.securities_account_id||
  original.amount_jpy!==p.amount_jpy||lot.confirmed_units!==p.confirmed_units||
  lot.acquisition_cost_jpy!==p.acquisition_cost_jpy||lot.fund_code!==p.fund_code||
  lot.account_type!==p.account_type||p.broker_cancel_date<original.trade_date||
  p.bank_refund_date<original.effective_date)
  return fail('SBI_REFUND_ORIGINAL_OR_APPROVAL_INVALID');
 const at=Date.now(),eid=newid(),clientId='hfsbicashrefund:'+b.request_id;
 const statements=[
  db.prepare('INSERT INTO family_sbi_cash_refund_evidence '+
   '(evidence_id,household_id,original_request_id,bank_account_id,bank_version,'+
   'bank_refund_hash,broker_cancel_hash,bank_refund_date,broker_cancel_date,amount_jpy,'+
   "bank_refund_confirmed,broker_cancel_confirmed,evidence_kind,recorded_at) "+
   "VALUES(?,?,?,?,?,?,?,?,?,?,1,1,'owner_attested_posted_refund',?)")
   .bind(eid,b.household_id,r.original_request_id,r.bank_account_id,r.bank_version,
    p.bank_refund_hash,p.broker_cancel_hash,p.bank_refund_date,p.broker_cancel_date,p.amount_jpy,at),
  db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,'+
   'transfer_target,transfer_applied,transfer_date,client_request_id,payment_source,'+
   'family_account_id,family_transfer_target_account_id) '+
   "VALUES(?,'',?,'投資・資産移動','SBI証券','買付取消・返金','','transfer',?,1,?,?,?,?,?)")
   .bind(p.bank_refund_date,p.amount_jpy,'bank:'+r.bank_account_id,
    p.bank_refund_date,clientId,'sbi:'+r.securities_account_id,
    r.securities_account_id,r.bank_account_id),
  db.prepare('INSERT INTO family_sbi_cash_reversals '+
   '(homeflow_request_id,proposal_id,original_request_id,household_id,requester_user_id,'+
   'approver_user_id,actor_user_id,bank_account_id,bank_version,securities_account_id,'+
   'securities_version,payload_sha256,evidence_id,reversal_entry_id,amount_jpy,reversed_units,'+
   'reversed_cost_jpy,bank_refund_date,broker_cancel_date,applied_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT id FROM entries WHERE client_request_id=?),?,?,?,?,?,?)')
   .bind(b.request_id,b.resource_id,r.original_request_id,b.household_id,b.requester_user_id,
    authorized.approver_user_id,authorized.approver_user_id,r.bank_account_id,r.bank_version,
    r.securities_account_id,r.securities_version,b.payload_sha256,eid,clientId,p.amount_jpy,
    p.confirmed_units,p.acquisition_cost_jpy,p.bank_refund_date,p.broker_cancel_date,at),
  db.prepare('INSERT INTO family_sbi_cash_reversal_audit '+
   '(event_id,homeflow_request_id,original_request_id,requester_user_id,approver_user_id,'+
   "actor_user_id,action,created_at) VALUES(?,?,?,?,?,?,'sbi_cash_full_refund_applied',?)")
   .bind(newid(),b.request_id,r.original_request_id,b.requester_user_id,
    authorized.approver_user_id,authorized.approver_user_id,at)
 ];
 try{
  const changed=await db.batch(statements);
  if(changed.length!==statements.length||changed.some(x=>x.meta?.changes!==1))
   return fail('SBI_REFUND_TRANSACTION_UNCONFIRMED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_sbi_cash_reversals WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return identity(raced,b)?receipt(db,raced,b,true):fail('SBI_REFUND_TRANSACTION_RETRY',503);
 }
 const saved=await db.prepare('SELECT * FROM family_sbi_cash_reversals WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return identity(saved,b)?receipt(db,saved,b,false):fail('SBI_REFUND_RECEIPT_UNCONFIRMED',503);
}
