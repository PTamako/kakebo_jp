// Member-only points obtained/expired/corrected from issuer statements.
// This changes ONLY personally owned point units. It never edits household
// entries, transfers money or calls HomeFlow owner approval endpoints.
const json=(x,status=200)=>Response.json(x,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false},status);
const hex32=/^[a-f0-9]{32}$/i,hex64=/^[a-f0-9]{64}$/i;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed=new Set(['earn_campaign','expire','reversal']);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const validDate=x=>typeof x==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x)&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x&&
 x<=new Date(Date.now()+32400000).toISOString().slice(0,10);
async function seal(secret,id,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),v=>parseInt(v,16)),'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:new TextEncoder().encode('kakeibo-points:'+id)},key,new TextEncoder().encode(raw));
 const b64=bytes=>btoa(String.fromCharCode(...bytes));
 return {iv:b64(iv),cipher:b64(new Uint8Array(cipher))};
}
async function body(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=1300?JSON.parse(raw):null}catch{return null}
}
async function active(db,u){
 if(u?.role!=='member'||!u.household_id||!u.user_id)return false;
 const m=await db.prepare("SELECT 1 FROM homeflow_identity_links "+
  "WHERE user_id=? AND household_id=? AND role='member' AND state='active' LIMIT 1")
  .bind(u.user_id,u.household_id).first();
 return !!m;
}
async function account(db,u,id,version){
 return db.prepare("SELECT 1 FROM family_financial_accounts WHERE account_id=? "+
  "AND household_id=? AND owner_user_id=? AND origin='member_created' "+
  "AND account_kind='points' AND is_archived=0 AND opening_balance=0 AND version=? LIMIT 1")
  .bind(id,u.household_id,u.user_id,version).first();
}
async function currentBalance(db,id){
 const row=await db.prepare('SELECT ('+
  'COALESCE((SELECT SUM(delta_units) FROM family_points_journal WHERE points_account_id=?),0)'+
  '+COALESCE((SELECT SUM(target_units) FROM family_points_transfer_credits WHERE target_account_id=?),0)'+
  '-COALESCE((SELECT SUM(debited_target_units) FROM family_points_transfer_refunds WHERE target_account_id=?),0)'+
  ') AS balance').bind(id,id,id).first();
 return Number.isSafeInteger(row?.balance)&&row.balance>=0?row.balance:null;
}
const receipt=j=>({ok:true,scope:'personal',points_balance_changed:true,
 ledger_changed:false,broker_ordered:false,issuer_api_verified:false,
 journal_id:j.homeflow_request_id,operation:j.operation,delta_units:j.delta_units,
 balance_after_units:j.balance_after_units,effective_date:j.effective_date});
export async function familyMemberPersonalPoints(req,e,url,u,parts){
 if(e.APP_ENV!=='production'||e.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  e.KAKEIBO_POINTS_ACTIONS_ENABLED!=='true'||!e.DB?.prepare||
  !hex64.test(e.KAKEIBO_FAMILY_PENDING_KEY||''))return fail('PERSONAL_POINTS_UNAVAILABLE',503);
 if(parts.length!==1)return fail('NOT_FOUND',404);
 const db=e.DB;
 try{
  if(!await active(db,u))return fail('MEMBER_REQUIRED',403);
  if(req.method==='GET'){
   const cursor=url.searchParams.get('before')||'';
   if(cursor&&!/^([1-9][0-9]{10,15})\.([a-f0-9-]{36})$/i.test(cursor))
    return fail('PERSONAL_POINTS_CURSOR_INVALID',400);
   const stamp=cursor?Number(cursor.split('.')[0]):0,pk=cursor?cursor.slice(cursor.indexOf('.')+1):'';
   const records=(await db.prepare('SELECT j.homeflow_request_id,j.points_account_id,j.operation,'+
    'j.delta_units,j.balance_after_units,j.effective_date,j.applied_at '+
    'FROM family_points_direct_personal_proofs p JOIN family_points_journal j '+
    'ON j.homeflow_request_id=p.homeflow_request_id '+
    'WHERE p.household_id=? AND p.owner_user_id=? '+
    "AND (?='' OR j.applied_at<? OR (j.applied_at=? AND j.homeflow_request_id<?)) "+
    'ORDER BY j.applied_at DESC,j.homeflow_request_id DESC LIMIT 51')
    .bind(u.household_id,u.user_id,cursor,stamp,stamp,pk).all()).results||[];
   const items=records.slice(0,50),last=items.at(-1);
   return json({ok:true,scope:'personal',viewer_user_id:u.user_id,items,
    next_cursor:records.length>50&&last?
     String(last.applied_at)+'.'+last.homeflow_request_id:null,
    ledger_changed:false});
  }
  if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
  const x=await body(req,url);
  const keys=['expected_user_id','idempotency_key','points_account_id',
   'points_version','operation','units','effective_date','issuer_reference',
   'issuer_confirmed','original_request_id'];
  if(x?.expected_user_id!==u.user_id)return fail('ACTOR_CHANGED',403);
  if(!exact(x,keys)||!hex32.test(x.points_account_id)||
   !Number.isSafeInteger(x.points_version)||x.points_version<1||
   !allowed.has(x.operation)||!Number.isSafeInteger(x.units)||
   x.units<1||x.units>10000000||!validDate(x.effective_date)||
   x.issuer_confirmed!==true||
   typeof x.issuer_reference!=='string'||x.issuer_reference.trim().length<8||
   x.issuer_reference.length>160||
   [...x.issuer_reference].some(c=>c.charCodeAt(0)<32)||
   typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
   (x.operation==='reversal'?!uuid.test(x.original_request_id||''):x.original_request_id!==null))
   return fail('PERSONAL_POINTS_INVALID_INPUT',400);
  if(!await account(db,u,x.points_account_id,x.points_version))
   return fail('PERSONAL_POINTS_ACCOUNT_CHANGED');
  const reference=await digest(u.household_id+'\0'+x.points_account_id+'\0'+
   x.issuer_reference.normalize('NFKC').trim());
  const payload={operation:x.operation,points_account_id:x.points_account_id,
   points_version:x.points_version,units:x.units,effective_date:x.effective_date,
   source_reference_hash:reference,original_request_id:x.original_request_id};
  const raw=JSON.stringify(payload),sha=await digest(raw);
  const idem=await digest(u.household_id+'\0'+u.user_id+'\0personal-points\0'+x.idempotency_key);
  const requestId=idem.slice(0,32);
  const previous=await db.prepare('SELECT p.*,j.homeflow_request_id AS posted_id,'+
   'j.operation AS applied_operation,j.delta_units,j.balance_after_units,j.effective_date AS applied_date '+
   'FROM family_points_intents p LEFT JOIN family_points_journal j ON j.proposal_id=p.request_id '+
   'WHERE p.idempotency_hash=? LIMIT 1').bind(idem).first();
  if(previous)return previous.request_id===requestId&&
   previous.requester_user_id===u.user_id&&previous.household_id===u.household_id&&
   previous.payload_sha256===sha&&previous.posted_id?
    json({...receipt({homeflow_request_id:previous.posted_id,
     operation:previous.applied_operation,delta_units:previous.delta_units,
     balance_after_units:previous.balance_after_units,effective_date:previous.applied_date}),replayed:true}):
    fail('PERSONAL_POINTS_IDEMPOTENCY_CONFLICT');
  let original=null;
  if(x.operation==='reversal'){
   original=await db.prepare('SELECT old.* FROM family_points_journal old '+
    'JOIN family_points_direct_personal_proofs p ON p.homeflow_request_id=old.homeflow_request_id '+
    'WHERE old.homeflow_request_id=? AND old.household_id=? AND old.requester_user_id=? '+
    "AND old.points_account_id=? AND old.operation IN ('earn_campaign','expire') "+
    'AND NOT EXISTS(SELECT 1 FROM family_points_journal r WHERE r.reversed_request_id=old.homeflow_request_id) LIMIT 1')
    .bind(x.original_request_id,u.household_id,u.user_id,x.points_account_id).first();
   if(!original||x.units!==Math.abs(original.delta_units)||
    x.effective_date<original.effective_date)
    return fail('PERSONAL_POINTS_REVERSAL_ORIGINAL_CHANGED');
  }
  const balance=await currentBalance(db,x.points_account_id);
  if(balance===null)return fail('PERSONAL_POINTS_BALANCE_INVALID');
  const delta=x.operation==='reversal'?-original.delta_units:
   x.operation==='earn_campaign'?x.units:-x.units;
  const after=balance+delta;
  if(!Number.isSafeInteger(after)||after<0||after>1000000000000)
   return fail('PERSONAL_POINTS_BALANCE_INSUFFICIENT');
  const approvalId=crypto.randomUUID(),at=Date.now();
  const sealed=await seal(e.KAKEIBO_FAMILY_PENDING_KEY,requestId,raw);
  try{
   const commands=[
    db.prepare('INSERT INTO family_points_intents '+
     '(request_id,household_id,requester_user_id,points_account_id,expected_version,'+
     'operation,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,'+
     'created_at,expires_at,original_request_id) '+
     "VALUES(?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?)")
     .bind(requestId,u.household_id,u.user_id,x.points_account_id,x.points_version,
      x.operation,sha,sealed.cipher,sealed.iv,idem,at,at+14*86400000,x.original_request_id),
    db.prepare("UPDATE family_points_intents SET status='submitted',homeflow_approval_id=?,"+
     "submitted_at=? WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
     .bind(approvalId,at,requestId,u.household_id,u.user_id),
    db.prepare('INSERT INTO family_points_direct_personal_proofs '+
     '(homeflow_request_id,proposal_id,household_id,owner_user_id,points_account_id,'+
     'account_version,operation,payload_sha256,source_reference_hash,created_at) '+
     'VALUES(?,?,?,?,?,?,?,?,?,?)')
     .bind(approvalId,requestId,u.household_id,u.user_id,x.points_account_id,
      x.points_version,x.operation,sha,reference,at),
    db.prepare('INSERT INTO family_points_journal '+
     '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,'+
     'actor_user_id,points_account_id,account_version,operation,delta_units,'+
     'balance_after_units,yen_value,yen_per_unit_numerator,yen_per_unit_denominator,'+
     'target_account_id,linked_entry_id,legacy_entry_id,source_reference_hash,'+
     'reversed_request_id,payload_sha256,effective_date,applied_at) '+
     'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .bind(approvalId,requestId,u.household_id,u.user_id,u.user_id,u.user_id,
      x.points_account_id,x.points_version,x.operation,delta,after,
      null,null,null,null,null,null,reference,
      x.operation==='reversal'?x.original_request_id:null,sha,x.effective_date,at)
   ];
   const result=await db.batch(commands);
   if(result?.length!==4||result.some(r=>r.meta?.changes!==1))
    return fail('PERSONAL_POINTS_ATOMIC_RESULT_UNKNOWN',503);
   return json({...receipt({homeflow_request_id:approvalId,operation:x.operation,
    delta_units:delta,balance_after_units:after,effective_date:x.effective_date}),replayed:false},201);
  }catch{
   const raced=await db.prepare('SELECT p.payload_sha256,j.homeflow_request_id,'+
    'j.operation,j.delta_units,j.balance_after_units,j.effective_date '+
    'FROM family_points_intents p JOIN family_points_journal j ON j.proposal_id=p.request_id '+
    'WHERE p.idempotency_hash=? AND p.household_id=? AND p.requester_user_id=?')
    .bind(idem,u.household_id,u.user_id).first().catch(()=>null);
   return raced?.payload_sha256===sha?
    json({...receipt(raced),replayed:true}):
    fail('PERSONAL_POINTS_ATOMIC_CONFLICT',409);
  }
 }catch{return fail('PERSONAL_POINTS_SERVICE_UNAVAILABLE',503)}
}
