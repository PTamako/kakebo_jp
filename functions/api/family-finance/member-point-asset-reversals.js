// Reverse an ORIGINAL self-recorded, independently confirmed point asset move
// only after the user confirms BOTH real-world issuer refund and target rollback.
// Never cancels an external broker order or edits a family ledger entry.
const enc=new TextEncoder(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id=/^[a-f0-9]{32}$/i,hex=/^[a-f0-9]{64}$/i;
const json=(x,status=200)=>Response.json(x,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false,applied:false},status);
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))]
 .map(n=>n.toString(16).padStart(2,'0')).join('');
const date=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+32400000).toISOString().slice(0,10);
const reference=s=>typeof s==='string'&&s.trim().length>=8&&s.length<=160&&
 [...s].every(c=>c.charCodeAt(0)>=32);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
async function active(db,u){
 if(u?.role!=='member'||!u.user_id||!u.household_id)return false;
 return !!await db.prepare("SELECT 1 FROM homeflow_identity_links WHERE user_id=? "+
  "AND household_id=? AND role='member' AND state='active' LIMIT 1")
  .bind(u.user_id,u.household_id).first();
}
async function owned(db,u,id,kind){
 return db.prepare("SELECT account_id,version FROM family_financial_accounts "+
  "WHERE account_id=? AND household_id=? AND owner_user_id=? AND origin='member_created' "+
  "AND account_kind=? AND opening_balance=0 AND is_archived=0 LIMIT 1")
  .bind(id,u.household_id,u.user_id,kind).first();
}
const targetKind=op=>op==='transfer_prepaid'?'prepaid':op==='offset_card'?'credit_card':
 op==='redeem_asset'?'securities':'points';
async function original(db,u,id){
 return db.prepare('SELECT j.*,p.target_version AS original_target_version,'+
  'dest.label AS target_label FROM family_points_journal j '+
  'JOIN family_points_direct_asset_proofs p ON p.homeflow_request_id=j.homeflow_request_id '+
  'JOIN family_financial_accounts dest ON dest.account_id=j.target_account_id '+
  'WHERE j.homeflow_request_id=? AND j.household_id=? AND j.requester_user_id=? '+
  'AND p.owner_user_id=? AND p.household_id=? AND p.points_account_id=j.points_account_id '+
  'AND j.operation IN (\'transfer_prepaid\',\'offset_card\',\'redeem_asset\',\'transfer_out\',\'exchange_out\') LIMIT 1')
  .bind(id,u.household_id,u.user_id,u.user_id,u.household_id).first();
}
async function current(db,id){
 const b=await db.prepare('SELECT COALESCE((SELECT SUM(delta_units) FROM family_points_journal '+
  'WHERE points_account_id=?),0)+COALESCE((SELECT SUM(target_units) FROM family_points_transfer_credits '+
  'WHERE target_account_id=?),0)-COALESCE((SELECT SUM(debited_target_units) '+
  'FROM family_points_transfer_refunds WHERE target_account_id=?),0) AS units')
  .bind(id,id,id).first();
 return Number.isSafeInteger(b?.units)&&b.units>=0?b.units:null;
}
async function parse(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const b=await req.text();return b.length<=2800?JSON.parse(b):null}catch{return null}
}
async function encrypt(keyHex,requestId,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(keyHex.match(/.{2}/g),x=>parseInt(x,16)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-points:'+requestId)},key,enc.encode(raw));
 const b64=x=>btoa(String.fromCharCode(...x));
 return {iv:b64(iv),cipher:b64(new Uint8Array(cipher))};
}
async function counterpart(db,r,user){
 const table=r.original_operation==='transfer_prepaid'?'family_points_prepaid_refunds':
  r.original_operation==='offset_card'?'family_points_card_offset_refunds':
  r.original_operation==='redeem_asset'?'family_sbi_point_refunds':'family_points_transfer_refunds';
 return db.prepare('SELECT homeflow_request_id,original_request_id FROM '+table+
  ' WHERE homeflow_request_id=? AND household_id=? AND requester_user_id=?')
  .bind(r.homeflow_request_id,user.household_id,user.user_id).first();
}
async function receipt(db,r,user,replayed){
 const previous=await db.prepare('SELECT p.original_operation FROM family_points_direct_asset_refund_proofs p '+
  'WHERE p.homeflow_request_id=? AND p.household_id=? AND p.owner_user_id=?')
  .bind(r.homeflow_request_id,user.household_id,user.user_id).first();
 if(!previous)return fail('POINTS_ASSET_REFUND_PROOF_NOT_FOUND',503);
 const c=await counterpart(db,{...r,original_operation:previous.original_operation},user);
 if(!c||c.original_request_id!==r.reversed_request_id)
  return fail('POINTS_ASSET_REFUND_COUNTERPART_UNCONFIRMED',503);
 return json({ok:true,scope:'personal',applied:true,ledger_changed:false,
  issuer_api_verified:false,broker_ordered:false,operation:'reversal',
  original_operation:previous.original_operation,original_request_id:r.reversed_request_id,
  journal_id:r.homeflow_request_id,delta_units:r.delta_units,
  yen_value:r.yen_value,balance_after_units:r.balance_after_units,
  counterpart_refunded:true,replayed},replayed?200:201);
}
export async function familyMemberPointAssetReversals(req,e,url,u,parts){
 if(e.APP_ENV!=='production'||e.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  e.KAKEIBO_POINTS_ACTIONS_ENABLED!=='true'||!e.DB?.prepare||
  typeof e.DB.batch!=='function'||!hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||''))
  return fail('PERSONAL_POINT_REFUND_DISABLED',503);
 if(parts.length!==1)return fail('NOT_FOUND',404);
 const db=e.DB;
 try{
  if(!await active(db,u))return fail('MEMBER_REQUIRED',403);
  if(req.method==='GET'){
   const rows=(await db.prepare('SELECT j.homeflow_request_id,j.points_account_id,'+
    'j.target_account_id,j.operation,j.delta_units,j.yen_value,j.effective_date,'+
    'a.label AS target_label FROM family_points_direct_asset_proofs p '+
    'JOIN family_points_journal j ON j.homeflow_request_id=p.homeflow_request_id '+
    'JOIN family_financial_accounts a ON a.account_id=j.target_account_id '+
    'WHERE p.household_id=? AND p.owner_user_id=? '+
    'AND NOT EXISTS(SELECT 1 FROM family_points_journal reversed '+
     'WHERE reversed.reversed_request_id=j.homeflow_request_id) '+
    'ORDER BY j.applied_at DESC,j.homeflow_request_id DESC LIMIT 80')
    .bind(u.household_id,u.user_id).all()).results||[];
   return json({ok:true,scope:'personal',viewer_user_id:u.user_id,
    eligible:rows,ledger_changed:false,read_only:true});
  }
  if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
  const x=await parse(req,url);
  if(x?.expected_user_id!==u.user_id)return fail('ACTOR_CHANGED',403);
  const base=['expected_user_id','idempotency_key','original_request_id',
   'effective_date','issuer_refund_reference','counterpart_reversal_reference',
   'issuer_points_returned_confirmed','counterpart_reverted_confirmed'];
  if(!uuid.test(x.original_request_id||'')||!reference(x.issuer_refund_reference)||
   !reference(x.counterpart_reversal_reference)||!date(x.effective_date)||
   x.issuer_points_returned_confirmed!==true||x.counterpart_reverted_confirmed!==true||
   typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
   return fail('PERSONAL_POINT_REFUND_INVALID_INPUT',400);
  const older=await original(db,u,x.original_request_id);
  if(!older)return fail('PERSONAL_POINT_REFUND_ORIGINAL_NOT_OWNED',403);
  const sbi=older.operation==='redeem_asset';
  if(!exact(x,[...base,...(sbi?['broker_cancel_reference','broker_cancel_date',
   'points_returned_date','broker_cancel_confirmed']:[])]))
   return fail('PERSONAL_POINT_REFUND_INVALID_FIELDS',400);
  if(x.effective_date<older.effective_date||
   !Number.isSafeInteger(older.yen_value)||older.yen_value<1||
   !Number.isSafeInteger(older.delta_units)||older.delta_units>=0)
   return fail('PERSONAL_POINT_REFUND_ORIGINAL_INVALID');
  if(sbi&&(!/^[a-z0-9._:-]{8,128}$/i.test(x.broker_cancel_reference||'')||
   !date(x.broker_cancel_date)||!date(x.points_returned_date)||
   x.broker_cancel_date>x.points_returned_date||
   x.points_returned_date>x.effective_date||
   x.broker_cancel_confirmed!==true))
   return fail('PERSONAL_POINT_REFUND_BROKER_EVIDENCE_INVALID',400);
  const source=await owned(db,u,older.points_account_id,'points'),
   target=await owned(db,u,older.target_account_id,targetKind(older.operation));
  if(!source||!target)return fail('PERSONAL_POINT_REFUND_ACCOUNT_ARCHIVED');
  const refundHash=await digest(u.household_id+'\0'+older.points_account_id+'\0'+
   x.issuer_refund_reference.normalize('NFKC').trim());
  const otherHash=await digest(u.household_id+'\0'+older.target_account_id+'\0'+
   x.counterpart_reversal_reference.normalize('NFKC').trim());
  const brokerHash=sbi?await digest(u.household_id+'\0sbi-cancelled-point-trade\0'+
   x.broker_cancel_reference.trim()):null;
  const payload={operation:'reversal',original_request_id:older.homeflow_request_id,
   original_operation:older.operation,points_account_id:older.points_account_id,
   points_version:source.version,target_account_id:older.target_account_id,
   target_version:target.version,units:-older.delta_units,
   yen_value:older.yen_value,rate_numerator:older.yen_per_unit_numerator,
   rate_denominator:older.yen_per_unit_denominator,
   effective_date:x.effective_date,source_reference_hash:refundHash,
   counterpart_reference_hash:otherHash,
   ...(sbi?{broker_cancel_hash:brokerHash,
    broker_cancel_date:x.broker_cancel_date,
    points_returned_date:x.points_returned_date}:{})};
  const raw=JSON.stringify(payload),sha=await digest(raw),
   idem=await digest(u.household_id+'\0'+u.user_id+'\0personal-asset-refund\0'+
    x.idempotency_key),requestId=idem.slice(0,32);
  const prior=await db.prepare('SELECT p.payload_sha256,j.* FROM family_points_intents p '+
   'LEFT JOIN family_points_journal j ON j.proposal_id=p.request_id WHERE p.idempotency_hash=?')
   .bind(idem).first();
  if(prior)return prior.payload_sha256===sha&&prior.homeflow_request_id?
   receipt(db,prior,u,true):fail('PERSONAL_POINT_REFUND_IDEMPOTENCY_CONFLICT');
  const originalProof=await db.prepare('SELECT original_request_id FROM family_points_direct_asset_refund_proofs '+
   'WHERE original_request_id=?').bind(older.homeflow_request_id).first();
  if(originalProof)return fail('PERSONAL_POINT_REFUND_ALREADY_RECORDED');
  const pointsNow=await current(db,older.points_account_id),restored=-older.delta_units;
  if(pointsNow===null||!Number.isSafeInteger(pointsNow+restored)||pointsNow+restored>1000000000000)
   return fail('PERSONAL_POINT_REFUND_BALANCE_INVALID');
  const at=Date.now(),approvalId=crypto.randomUUID(),
   {cipher,iv}=await encrypt(e.KAKEIBO_FAMILY_PENDING_KEY,requestId,raw);
  const fields=['request_id','household_id','requester_user_id','points_account_id',
   'expected_version','operation','payload_sha256','payload_cipher','payload_iv',
   'idempotency_hash','status','created_at','expires_at','original_request_id',
   'sbi_refund_securities_version','sbi_refund_broker_hash','sbi_refund_points_hash',
   'sbi_refund_broker_date','sbi_refund_points_date'];
  const values=[requestId,u.household_id,u.user_id,older.points_account_id,
   source.version,'reversal',sha,cipher,iv,idem,'prepared',at,at+14*86400000,
   older.homeflow_request_id,sbi?target.version:null,brokerHash,sbi?refundHash:null,
   sbi?x.broker_cancel_date:null,sbi?x.points_returned_date:null];
  try{
   const results=await db.batch([
    db.prepare('INSERT INTO family_points_intents ('+fields.join(',')+') VALUES ('+
     fields.map(()=>'?').join(',')+')').bind(...values),
    db.prepare("UPDATE family_points_intents SET status='submitted',homeflow_approval_id=?,"+
     "submitted_at=? WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
     .bind(approvalId,at,requestId,u.household_id,u.user_id),
    db.prepare('INSERT INTO family_points_direct_asset_refund_proofs '+
     '(homeflow_request_id,proposal_id,original_request_id,household_id,owner_user_id,'+
     'points_account_id,account_version,original_operation,target_account_id,'+
     'target_version,refund_units,yen_value,payload_sha256,source_reference_hash,created_at) '+
     'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .bind(approvalId,requestId,older.homeflow_request_id,u.household_id,u.user_id,
      older.points_account_id,source.version,older.operation,older.target_account_id,
      target.version,restored,older.yen_value,sha,refundHash,at),
    db.prepare('INSERT INTO family_points_journal ('+
     'homeflow_request_id,proposal_id,household_id,requester_user_id,'+
     'approver_user_id,actor_user_id,points_account_id,account_version,operation,'+
     'delta_units,balance_after_units,yen_value,yen_per_unit_numerator,'+
     'yen_per_unit_denominator,target_account_id,linked_entry_id,legacy_entry_id,'+
     'source_reference_hash,reversed_request_id,payload_sha256,effective_date,applied_at) '+
     'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .bind(approvalId,requestId,u.household_id,u.user_id,u.user_id,u.user_id,
      older.points_account_id,source.version,'reversal',restored,pointsNow+restored,
      older.yen_value,older.yen_per_unit_numerator,older.yen_per_unit_denominator,
      older.target_account_id,older.linked_entry_id,null,refundHash,
      older.homeflow_request_id,sha,x.effective_date,at)
   ]);
   if(results.length!==4||results.some(z=>z.meta?.changes!==1))
    return fail('PERSONAL_POINT_REFUND_BATCH_NOT_CONFIRMED',503);
  }catch{
   const raced=await db.prepare('SELECT p.payload_sha256,j.* '+
    'FROM family_points_intents p JOIN family_points_journal j '+
    'ON j.proposal_id=p.request_id WHERE p.idempotency_hash=? '+
    'AND p.household_id=? AND p.requester_user_id=?')
    .bind(idem,u.household_id,u.user_id).first().catch(()=>null);
   return raced?.payload_sha256===sha?receipt(db,raced,u,true):
    fail('PERSONAL_POINT_REFUND_ATOMIC_ABORT');
  }
  const done=await db.prepare('SELECT * FROM family_points_journal '+
   'WHERE homeflow_request_id=?').bind(approvalId).first();
  return done?receipt(db,done,u,false):fail('PERSONAL_POINT_REFUND_RECEIPT_MISSING',503);
 }catch{return fail('PERSONAL_POINT_REFUND_SERVICE_UNAVAILABLE',503)}
}
