// Member-only recording of confirmed issuer-side point redemption and its
// independently confirmed prepaid/card/point/SBI counterpart. NEVER calls a
// bank or broker. All internal debits/credits commit in ONE D1 batch, guarded
// by legacy counterpart triggers and an immutable member-only proof.
const text=new TextEncoder(),id=/^[a-f0-9]{32}$/i,hex=/^[a-f0-9]{64}$/i;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const operations={transfer_prepaid:'prepaid',offset_card:'credit_card',
 redeem_asset:'securities',transfer_out:'points',exchange_out:'points'};
const json=(o,status=200)=>Response.json(o,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false,applied:false},status);
const hash=async raw=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',text.encode(raw)))]
 .map(n=>n.toString(16).padStart(2,'0')).join('');
const validDate=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+32400000).toISOString().slice(0,10);
const reference=s=>typeof s==='string'&&s.trim().length>=8&&s.length<=160&&
 [...s].every(c=>c.charCodeAt(0)>=32);
const exact=(o,ks)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join('|')===ks.slice().sort().join('|');
const units=n=>Number.isSafeInteger(n)&&n>=1&&n<=1000000000;
const amount=n=>Number.isSafeInteger(n)&&n>=1&&n<=10000000;
const ratio=(units,rate,amount,denom)=>BigInt(units)*BigInt(rate)===
 BigInt(amount)*BigInt(denom);
async function parse(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const s=await req.text();return s.length<=2700?JSON.parse(s):null}catch{return null}
}
async function member(db,user){
 if(user?.role!=='member'||!user.user_id||!user.household_id)return false;
 return !!await db.prepare("SELECT 1 FROM homeflow_identity_links WHERE user_id=? "+
  "AND household_id=? AND role='member' AND state='active' LIMIT 1")
  .bind(user.user_id,user.household_id).first();
}
async function owned(db,user,id,version,kind){
 return !!await db.prepare("SELECT 1 FROM family_financial_accounts WHERE account_id=? "+
  "AND household_id=? AND owner_user_id=? AND account_kind=? "+
  "AND origin='member_created' AND is_archived=0 AND opening_balance=0 "+
  "AND version=? LIMIT 1").bind(id,user.household_id,user.user_id,kind,version).first();
}
async function purchase(db,user,x){
 const p=await db.prepare('SELECT p.amount_jpy,p.purchase_date,p.requester_user_id,p.account_id,'+
  'COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a '+
   'WHERE a.purchase_request_id=p.homeflow_request_id),0) AS paid,'+
  'COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o '+
   'WHERE o.purchase_request_id=p.homeflow_request_id),0) AS offset,'+
  'COALESCE((SELECT SUM(r.restored_jpy) FROM family_points_card_offset_refunds r '+
   'WHERE r.purchase_request_id=p.homeflow_request_id),0) AS restored '+
  'FROM family_card_purchase_applied p WHERE p.homeflow_request_id=? AND p.household_id=?')
  .bind(x.target_purchase_request_id,user.household_id).first();
 return !!p&&p.requester_user_id===user.user_id&&p.account_id===x.target_account_id&&
  p.purchase_date<=x.effective_date&&amount(p.amount_jpy)&&
  [p.paid,p.offset,p.restored].every(n=>Number.isSafeInteger(n)&&n>=0)&&
  p.amount_jpy-p.paid-p.offset+p.restored>=x.yen_value;
}
async function balance(db,account){
 const b=await db.prepare('SELECT COALESCE((SELECT SUM(delta_units) FROM family_points_journal '+
  'WHERE points_account_id=?),0)+COALESCE((SELECT SUM(target_units) FROM family_points_transfer_credits '+
  'WHERE target_account_id=?),0)-COALESCE((SELECT SUM(debited_target_units) '+
  'FROM family_points_transfer_refunds WHERE target_account_id=?),0) AS units')
  .bind(account,account,account).first();
 return Number.isSafeInteger(b?.units)&&b.units>=0?b.units:null;
}
async function encrypt(secret,requestId,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),c=>parseInt(c,16)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const buf=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:text.encode('kakeibo-points:'+requestId)},key,text.encode(raw));
 const b64=a=>btoa(String.fromCharCode(...a));
 return {cipher:b64(new Uint8Array(buf)),iv:b64(iv)};
}
function acceptable(x,user){
 const type=x?.operation,kind=operations[type],keys=[
  'expected_user_id','idempotency_key','operation','points_account_id','points_version',
  'target_account_id','target_version','units','yen_value','rate_numerator',
  'rate_denominator','effective_date','issuer_reference','counterpart_reference',
  'issuer_confirmed','counterpart_confirmed',
  ...(type==='offset_card'?['target_purchase_request_id']:[]),
  ...(type==='redeem_asset'?['sbi_fund_code','sbi_account_type','sbi_confirmed_units',
   'broker_trade_reference','broker_execution_confirmed']:[]),
  ...(['transfer_out','exchange_out'].includes(type)?[
   'target_units','target_rate_numerator','target_rate_denominator']:[])
 ];
 if(!kind||!exact(x,keys)||x.expected_user_id!==user.user_id||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !id.test(x.points_account_id)||!id.test(x.target_account_id)||
  x.points_account_id===x.target_account_id||
  !Number.isSafeInteger(x.points_version)||x.points_version<1||
  !Number.isSafeInteger(x.target_version)||x.target_version<1||
  !units(x.units)||!amount(x.yen_value)||
  !units(x.rate_numerator)||!units(x.rate_denominator)||
  !ratio(x.units,x.rate_numerator,x.yen_value,x.rate_denominator)||
  !validDate(x.effective_date)||!reference(x.issuer_reference)||
  !reference(x.counterpart_reference)||x.issuer_confirmed!==true||
  x.counterpart_confirmed!==true)return false;
 if(type==='offset_card'&&!uuid.test(x.target_purchase_request_id))return false;
 if(type==='redeem_asset'&&(!/^[A-Z0-9]{8}$/.test(x.sbi_fund_code||'')||
  !['growth','tsumitate'].includes(x.sbi_account_type)||
  !Number.isSafeInteger(x.sbi_confirmed_units)||x.sbi_confirmed_units<1||
  x.sbi_confirmed_units>1000000000000||
  !/^[a-z0-9._:-]{8,128}$/i.test(x.broker_trade_reference||'')||
  x.broker_execution_confirmed!==true))return false;
 if(['transfer_out','exchange_out'].includes(type)&&(
  !units(x.target_units)||!units(x.target_rate_numerator)||!units(x.target_rate_denominator)||
  !ratio(x.target_units,x.target_rate_numerator,x.yen_value,x.target_rate_denominator)||
  (type==='transfer_out'&&(x.target_units!==x.units||
   x.target_rate_numerator!==x.rate_numerator||
   x.target_rate_denominator!==x.rate_denominator))))return false;
 return true;
}
const fields=[
 'request_id','household_id','requester_user_id','points_account_id','expected_version',
 'operation','payload_sha256','payload_cipher','payload_iv','idempotency_hash',
 'status','created_at','expires_at','target_account_id','target_version',
 'target_purchase_request_id','target_units','target_rate_numerator','target_rate_denominator',
 'sbi_fund_code','sbi_account_type','sbi_confirmed_units','sbi_broker_reference_hash'];
function intentValues(x,user,meta){
 const pointsTransfer=['transfer_out','exchange_out'].includes(x.operation);
 return [meta.requestId,user.household_id,user.user_id,x.points_account_id,x.points_version,
  x.operation,meta.sha,meta.cipher,meta.iv,meta.idem,'prepared',meta.at,meta.at+14*86400000,
  x.target_account_id,x.target_version,x.operation==='offset_card'?x.target_purchase_request_id:null,
  pointsTransfer?x.target_units:null,pointsTransfer?x.target_rate_numerator:null,
  pointsTransfer?x.target_rate_denominator:null,
  x.operation==='redeem_asset'?x.sbi_fund_code:null,
  x.operation==='redeem_asset'?x.sbi_account_type:null,
  x.operation==='redeem_asset'?x.sbi_confirmed_units:null,meta.brokerHash];
}
async function counterpart(db,operation,approvalId,owner){
 const t=operation==='transfer_prepaid'?'family_points_prepaid_credits':
  operation==='offset_card'?'family_points_card_offsets':
  operation==='redeem_asset'?'family_sbi_point_lots':'family_points_transfer_credits';
 const col=operation==='redeem_asset'?'owner_user_id':'requester_user_id';
 return db.prepare('SELECT * FROM '+t+' WHERE homeflow_request_id=? AND household_id=? AND '+col+'=? LIMIT 1')
  .bind(approvalId,owner.household_id,owner.user_id).first();
}
async function receipt(db,j,user,replayed=false){
 const c=await counterpart(db,j.operation,j.homeflow_request_id,user);
 if(!c)return fail('POINTS_ASSET_COUNTERPART_UNCONFIRMED',503);
 return json({ok:true,scope:'personal',ledger_changed:false,applied:true,
  issuer_api_verified:false,broker_ordered:false,
  operation:j.operation,journal_id:j.homeflow_request_id,
  delta_units:j.delta_units,balance_after_units:j.balance_after_units,
  target_account_id:j.target_account_id,yen_value:j.yen_value,
  counterpart_confirmed:true,replayed},replayed?200:201);
}
export async function familyMemberPointAssets(req,e,url,user,parts){
 if(e.APP_ENV!=='production'||e.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  e.KAKEIBO_POINTS_ACTIONS_ENABLED!=='true'||!hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')||
  !e.DB?.prepare||typeof e.DB.batch!=='function')
  return fail('PERSONAL_POINTS_ASSET_DISABLED',503);
 if(parts.length!==1)return fail('NOT_FOUND',404);
 const db=e.DB;
 try{
  if(!await member(db,user))return fail('MEMBER_REQUIRED',403);
  if(req.method==='GET'){
   const accounts=(await db.prepare('SELECT account_id,label,account_kind,version FROM family_financial_accounts '+
    "WHERE household_id=? AND owner_user_id=? AND origin='member_created' AND is_archived=0 "+
    "AND opening_balance=0 AND account_kind IN('points','prepaid','credit_card','securities') "+
    'ORDER BY account_kind,label,account_id LIMIT 120')
    .bind(user.household_id,user.user_id).all()).results||[];
   const purchases=(await db.prepare('SELECT p.homeflow_request_id,p.account_id,p.amount_jpy,'+
    'p.purchase_date, p.amount_jpy -'+
    'COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a '+
     'WHERE a.purchase_request_id=p.homeflow_request_id),0) -'+
    'COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o '+
     'WHERE o.purchase_request_id=p.homeflow_request_id),0) +'+
    'COALESCE((SELECT SUM(r.restored_jpy) FROM family_points_card_offset_refunds r '+
     'WHERE r.purchase_request_id=p.homeflow_request_id),0) AS remaining_jpy '+
    'FROM family_card_purchase_applied p '+
    'WHERE p.household_id=? AND p.requester_user_id=? ORDER BY p.applied_at DESC LIMIT 120')
    .bind(user.household_id,user.user_id).all()).results||[];
   const recent=(await db.prepare('SELECT j.homeflow_request_id,j.points_account_id,'+
    'j.target_account_id,j.operation,j.delta_units,j.balance_after_units,'+
    'j.yen_value,j.effective_date FROM family_points_direct_asset_proofs proof '+
    'JOIN family_points_journal j ON j.homeflow_request_id=proof.homeflow_request_id '+
    'WHERE proof.household_id=? AND proof.owner_user_id=? '+
    'ORDER BY j.applied_at DESC,j.homeflow_request_id DESC LIMIT 50')
    .bind(user.household_id,user.user_id).all()).results||[];
   if(accounts.some(a=>!id.test(a.account_id)||!Number.isSafeInteger(a.version))||
    purchases.some(p=>!uuid.test(p.homeflow_request_id)||!Number.isSafeInteger(p.remaining_jpy)))
    return fail('PERSONAL_POINTS_ASSET_PROJECTION_UNSAFE');
   return json({ok:true,scope:'personal',viewer_user_id:user.user_id,
    accounts,purchases:purchases.filter(p=>p.remaining_jpy>0),
    recent,ledger_changed:false,issuer_api_verified:false});
  }
  if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
  const x=await parse(req,url);
  if(x?.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
  if(!acceptable(x,user))return fail('PERSONAL_POINTS_ASSET_INVALID_INPUT',400);
  const kind=operations[x.operation];
  if(!await owned(db,user,x.points_account_id,x.points_version,'points')||
   !await owned(db,user,x.target_account_id,x.target_version,kind))
   return fail('PERSONAL_POINTS_ASSET_OWNER_OR_VERSION_CHANGED');
  if(x.operation==='offset_card'&&!await purchase(db,user,x))
   return fail('PERSONAL_POINTS_CARD_LIABILITY_NOT_CONFIRMED');
  const referenceHash=await hash(user.household_id+'\0'+x.points_account_id+'\0'+
   x.issuer_reference.normalize('NFKC').trim());
  const counterpartHash=await hash(user.household_id+'\0'+x.target_account_id+'\0'+
   x.counterpart_reference.normalize('NFKC').trim());
  const brokerHash=x.operation==='redeem_asset'?
   await hash(user.household_id+'\0sbi-confirmed-trade\0'+x.broker_trade_reference):null;
  const payload={operation:x.operation,points_account_id:x.points_account_id,
   points_version:x.points_version,target_account_id:x.target_account_id,
   target_version:x.target_version,units:x.units,yen_value:x.yen_value,
   rate_numerator:x.rate_numerator,rate_denominator:x.rate_denominator,
   effective_date:x.effective_date,source_reference_hash:referenceHash,
   counterpart_reference_hash:counterpartHash,
   ...(x.operation==='offset_card'?{target_purchase_request_id:x.target_purchase_request_id}:{}),
   ...(x.operation==='redeem_asset'?{sbi_fund_code:x.sbi_fund_code,
    sbi_account_type:x.sbi_account_type,sbi_confirmed_units:x.sbi_confirmed_units,
    sbi_broker_reference_hash:brokerHash}:{}),
   ...(['transfer_out','exchange_out'].includes(x.operation)?{
    target_units:x.target_units,target_rate_numerator:x.target_rate_numerator,
    target_rate_denominator:x.target_rate_denominator}:{})};
  const raw=JSON.stringify(payload),sha=await hash(raw);
  const idem=await hash(user.household_id+'\0'+user.user_id+
   '\0personal-points-assets\0'+x.idempotency_key),requestId=idem.slice(0,32);
  const old=await db.prepare('SELECT p.payload_sha256,p.requester_user_id,p.household_id,'+
   'j.* FROM family_points_intents p LEFT JOIN family_points_journal j '+
   'ON j.proposal_id=p.request_id WHERE p.idempotency_hash=?').bind(idem).first();
  if(old){
   if(old.payload_sha256!==sha||old.requester_user_id!==user.user_id||
    old.household_id!==user.household_id||!old.homeflow_request_id)
    return fail('PERSONAL_POINTS_ASSET_IDEMPOTENCY_CONFLICT');
   return receipt(db,old,user,true);
  }
  const balanceNow=await balance(db,x.points_account_id),balanceAfter=balanceNow-x.units;
  if(balanceNow===null||!Number.isSafeInteger(balanceAfter)||balanceAfter<0)
   return fail('PERSONAL_POINTS_ASSET_INSUFFICIENT');
  // All external issuer/broker actions are user-proven historical facts.
  // The website never performs an issuer redemption, bank charge or buy order.
  const at=Date.now(),approvalId=crypto.randomUUID(),
   {cipher,iv}=await encrypt(e.KAKEIBO_FAMILY_PENDING_KEY,requestId,raw);
  const data=intentValues(x,user,{requestId,sha,cipher,iv,idem,at,brokerHash});
  try{
   const result=await db.batch([
    db.prepare('INSERT INTO family_points_intents ('+fields.join(',')+') VALUES ('+
     fields.map(()=>'?').join(',')+')').bind(...data),
    db.prepare("UPDATE family_points_intents SET status='submitted',homeflow_approval_id=?,"+
     "submitted_at=? WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
     .bind(approvalId,at,requestId,user.household_id,user.user_id),
    db.prepare('INSERT INTO family_points_direct_asset_proofs ('+
     'homeflow_request_id,proposal_id,household_id,owner_user_id,points_account_id,'+
     'account_version,operation,target_account_id,target_version,target_purchase_request_id,'+
     'yen_value,points_units,yen_per_unit_numerator,yen_per_unit_denominator,'+
     'payload_sha256,source_reference_hash,created_at) '+
     'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .bind(approvalId,requestId,user.household_id,user.user_id,
      x.points_account_id,x.points_version,x.operation,x.target_account_id,
      x.target_version,x.operation==='offset_card'?x.target_purchase_request_id:null,
      x.yen_value,x.units,x.rate_numerator,x.rate_denominator,sha,referenceHash,at),
    db.prepare('INSERT INTO family_points_journal ('+
     'homeflow_request_id,proposal_id,household_id,requester_user_id,'+
     'approver_user_id,actor_user_id,points_account_id,account_version,'+
     'operation,delta_units,balance_after_units,yen_value,'+
     'yen_per_unit_numerator,yen_per_unit_denominator,target_account_id,'+
     'linked_entry_id,legacy_entry_id,source_reference_hash,reversed_request_id,'+
     'payload_sha256,effective_date,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .bind(approvalId,requestId,user.household_id,user.user_id,user.user_id,
      user.user_id,x.points_account_id,x.points_version,x.operation,-x.units,
      balanceAfter,x.yen_value,x.rate_numerator,x.rate_denominator,
      x.target_account_id,null,null,referenceHash,null,sha,x.effective_date,at)
   ]);
   if(result.length!==4||result.some(v=>v.meta?.changes!==1))
    return fail('PERSONAL_POINTS_ASSET_BATCH_UNCONFIRMED',503);
  }catch{
   const raced=await db.prepare('SELECT p.payload_sha256,j.* '+
    'FROM family_points_intents p JOIN family_points_journal j ON j.proposal_id=p.request_id '+
    'WHERE p.idempotency_hash=? AND p.household_id=? AND p.requester_user_id=?')
    .bind(idem,user.household_id,user.user_id).first().catch(()=>null);
   return raced?.payload_sha256===sha?receipt(db,raced,user,true):
    fail('PERSONAL_POINTS_ASSET_ATOMIC_ABORT');
  }
  const saved=await db.prepare('SELECT * FROM family_points_journal WHERE homeflow_request_id=?')
   .bind(approvalId).first();
  return saved?receipt(db,saved,user,false):fail('PERSONAL_POINTS_ASSET_RECEIPT_MISSING',503);
 }catch{return fail('PERSONAL_POINTS_ASSET_SERVICE_UNAVAILABLE',503)}
}
