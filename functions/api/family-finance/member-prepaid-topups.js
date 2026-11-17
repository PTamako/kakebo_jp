// Personal prepaid top-ups: manually confirmed asset credit. No shared entry or admin review.
const enc=new TextEncoder(),id=/^[a-f0-9]{32}$/i;
const reply=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const deny=(code,status=409)=>reply({ok:false,code,ledger_changed:false},status);
const digest=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(raw))))
 .map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(b,k)=>b&&typeof b==='object'&&!Array.isArray(b)&&
 Object.keys(b).sort().join(',')===k.sort().join(',');
function date(s){
 if(typeof s!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s))return false;
 const d=new Date(s+'T00:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s&&
  s<=new Date(Date.now()+32400000).toISOString().slice(0,10);
}
const item=r=>({request_id:r.request_id,prepaid_account_id:r.prepaid_account_id,
 amount_jpy:r.amount_jpy,effective_date:r.effective_date,created_at:r.created_at,applied:true});
export async function familyMemberPrepaidTopups(request,env,url,user,parts){
 if(env.APP_ENV!=='production'||env.KAKEIBO_PERSONAL_PREPAID_TOPUPS_ENABLED!=='true'||!env.DB?.prepare)
  return deny('PERSONAL_PREPAID_TOPUPS_DISABLED',503);
 if(user.role!=='member')return deny('MEMBER_REQUIRED',403);
 const db=env.DB;
 const active=await db.prepare("SELECT 1 AS yes FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='member' AND state='active'")
  .bind(user.user_id,user.household_id).first();
 if(!active)return deny('IDENTITY_INACTIVE',403);
 if(request.method==='GET'&&parts.length===1){
  const rows=(await db.prepare('SELECT * FROM family_member_prepaid_topups WHERE household_id=? AND owner_user_id=? ORDER BY created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return reply({ok:true,scope:'personal',viewer_user_id:user.user_id,items:rows.map(item),ledger_changed:false});
 }
 if(request.method==='POST'&&parts.length===1){
  if(request.headers.get('origin')!==url.origin||
   request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
   return deny('ORIGIN_REQUIRED',403);
  let x;try{const raw=await request.text();x=raw.length<=1200?JSON.parse(raw):null}
  catch{return deny('INVALID_BODY',400)}
  if(!exact(x,['expected_user_id','idempotency_key','prepaid_account_id','prepaid_version',
    'amount_jpy','effective_date','confirmed'])||
   x.expected_user_id!==user.user_id||!id.test(x.prepaid_account_id)||
   !Number.isSafeInteger(x.prepaid_version)||x.prepaid_version<1||
   !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
   !date(x.effective_date)||x.confirmed!==true||
   typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
   return deny('INVALID_TOPUP',400);
  const owned=await db.prepare("SELECT 1 AS yes FROM family_financial_accounts WHERE account_id=? AND household_id=? AND owner_user_id=? AND account_kind='prepaid' AND origin='member_created' AND is_archived=0 AND version=?")
   .bind(x.prepaid_account_id,user.household_id,user.user_id,x.prepaid_version).first();
  if(!owned)return deny('PREPAID_ACCOUNT_CHANGED');
  const h=await digest([user.household_id,user.user_id,'personal-topup',x.idempotency_key].join('\0'));
  const requestId=h.slice(0,32),one=()=>db.prepare('SELECT * FROM family_member_prepaid_topups WHERE request_id=?').bind(requestId).first();
  const consistent=p=>p?.household_id===user.household_id&&p.owner_user_id===user.user_id&&
   p.prepaid_account_id===x.prepaid_account_id&&p.prepaid_version===x.prepaid_version&&
   p.idempotency_hash===h&&p.amount_jpy===x.amount_jpy&&p.effective_date===x.effective_date;
  const prior=await one();
  if(prior)return consistent(prior)?reply({ok:true,topup:item(prior),replayed:true,ledger_changed:false}):deny('TOPUP_IDEMPOTENCY_CONFLICT');
  try{
   const result=await db.prepare('INSERT INTO family_member_prepaid_topups (request_id,household_id,owner_user_id,prepaid_account_id,prepaid_version,idempotency_hash,amount_jpy,effective_date,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(requestId,user.household_id,user.user_id,x.prepaid_account_id,x.prepaid_version,h,
     x.amount_jpy,x.effective_date,Date.now()).run();
   if(result.meta?.changes!==1)return deny('TOPUP_COMMIT_UNCONFIRMED',503);
   const posted=await one();
   return consistent(posted)?reply({ok:true,topup:item(posted),ledger_changed:false},201):deny('TOPUP_RECEIPT_UNCONFIRMED',503);
  }catch{
   const r=await one().catch(()=>null);
   return consistent(r)?reply({ok:true,topup:item(r),replayed:true,ledger_changed:false}):deny('TOPUP_RETRY_REQUIRED',503);
  }
 }
 return deny('NOT_FOUND',404);
}
