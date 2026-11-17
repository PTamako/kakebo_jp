// Immutable two-sided correction ledger for personally confirmed prepaid top-ups.
// No homeflow approval for personal assets; never alters the original transaction.
// Before/after both belong to the authenticated actor and are guarded by D1 trigger.
const response=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>response({ok:false,code,ledger_changed:false},status);
const enc=new TextEncoder(),id=/^[0-9a-f]{32}$/i;
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const day=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 !Number.isNaN(new Date(s+'T00:00:00Z').getTime())&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+32400000).toISOString().slice(0,10);
const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join('|')===expected.sort().join('|');
const state=r=>({request_id:r.request_id,
 prepaid_account_id:r.after_account_id||r.prepaid_account_id,
 amount_jpy:r.after_amount_jpy??r.amount_jpy,
 effective_date:r.after_effective_date||r.effective_date,
 correction_revision:r.revision||0,created_at:r.created_at,applied:true});
const topupProjection='SELECT t.*,c.revision,c.after_account_id,c.after_amount_jpy,c.after_effective_date '+
 'FROM family_member_prepaid_topups t LEFT JOIN family_member_prepaid_topup_corrections c '+
 'ON c.correction_id=(SELECT correction_id FROM family_member_prepaid_topup_corrections '+
 'WHERE topup_request_id=t.request_id ORDER BY revision DESC LIMIT 1) ';
export async function familyMemberPrepaidTopupCorrections(req,env,url,user,parts){
 if(env.APP_ENV!=='production'||env.KAKEIBO_PERSONAL_PREPAID_TOPUPS_ENABLED!=='true'||
  env.KAKEIBO_PERSONAL_PREPAID_TOPUP_CORRECTIONS_ENABLED!=='true'||!env.DB?.prepare)
  return fail('PERSONAL_TOPUP_CORRECTIONS_DISABLED',503);
 if(user.role!=='member')return fail('MEMBER_REQUIRED',403);
 const db=env.DB;
 const active=await db.prepare("SELECT 1 AS yes FROM homeflow_identity_links "+
  "WHERE user_id=? AND household_id=? AND role='member' AND state='active'")
  .bind(user.user_id,user.household_id).first();
 if(!active)return fail('IDENTITY_INACTIVE',403);
 if(req.method==='GET'&&parts.length===1){
  const rows=(await db.prepare(topupProjection+
   'WHERE t.household_id=? AND t.owner_user_id=? ORDER BY t.created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return response({ok:true,scope:'personal',viewer_user_id:user.user_id,
   items:rows.map(state),ledger_changed:false});
 }
 if(req.method!=='POST'||parts.length!==2||!id.test(parts[1]))return fail('NOT_FOUND',404);
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return fail('ORIGIN_REQUIRED',403);
 let x;try{const raw=await req.text();x=raw.length<=1800?JSON.parse(raw):null}
 catch{return fail('INVALID_BODY',400)}
 if(!keys(x,['expected_user_id','expected_revision','idempotency_key','prepaid_account_id',
   'prepaid_version','amount_jpy','effective_date','reason','confirmed'])||
   x.expected_user_id!==user.user_id||
   !Number.isSafeInteger(x.expected_revision)||x.expected_revision<0||x.expected_revision>9999||
   !id.test(x.prepaid_account_id)||!Number.isSafeInteger(x.prepaid_version)||x.prepaid_version<1||
   !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
   !day(x.effective_date)||x.confirmed!==true||typeof x.reason!=='string'||
   x.reason.trim().length<2||x.reason.length>200||
   typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
  return fail('INVALID_CORRECTION',400);
 const h=await hash([user.household_id,user.user_id,'personal-topup-correction',x.idempotency_key].join('\\0'));
 const correctionId=h.slice(0,32);
 const one=()=>db.prepare('SELECT * FROM family_member_prepaid_topup_corrections WHERE idempotency_hash=?').bind(h).first();
 const same=c=>c?.topup_request_id===parts[1]&&c.owner_user_id===user.user_id&&
  c.household_id===user.household_id&&c.revision===x.expected_revision+1&&
  c.after_account_id===x.prepaid_account_id&&c.after_account_version===x.prepaid_version&&
  c.after_amount_jpy===x.amount_jpy&&c.after_effective_date===x.effective_date&&
  c.reason===x.reason.trim();
 const receipt=(row,replayed)=>response({ok:true,scope:'personal',ledger_changed:false,
  correction:{correction_id:row.correction_id,request_id:row.topup_request_id,
   correction_revision:row.revision,prepaid_account_id:row.after_account_id,
   amount_jpy:row.after_amount_jpy,effective_date:row.after_effective_date,
   applied:true},replayed});
 const prior=await one();
 if(prior)return same(prior)?receipt(prior,true):fail('CORRECTION_IDEMPOTENCY_CONFLICT');
 const original=await db.prepare(topupProjection+
  'WHERE t.request_id=? AND t.household_id=? AND t.owner_user_id=?')
  .bind(parts[1],user.household_id,user.user_id).first();
 if(!original)return fail('TOPUP_NOT_OWNED',404);
 const before=state(original);
 if(before.correction_revision!==x.expected_revision)return fail('CORRECTION_VERSION_CONFLICT');
 if(before.prepaid_account_id===x.prepaid_account_id&&
  before.amount_jpy===x.amount_jpy&&before.effective_date===x.effective_date)
  return fail('CORRECTION_NO_CHANGES',400);
 const target=await db.prepare("SELECT account_id FROM family_financial_accounts "+
  "WHERE account_id=? AND household_id=? AND owner_user_id=? "+
  "AND account_kind='prepaid' AND origin='member_created' "+
  "AND is_archived=0 AND version=?")
  .bind(x.prepaid_account_id,user.household_id,user.user_id,x.prepaid_version).first();
 if(!target)return fail('CORRECTION_TARGET_NOT_OWNED');
 try{
  const committed=await db.prepare('INSERT INTO family_member_prepaid_topup_corrections '+
   '(correction_id,topup_request_id,household_id,owner_user_id,revision,'+
   'before_account_id,after_account_id,after_account_version,before_amount_jpy,'+
   'after_amount_jpy,before_effective_date,after_effective_date,reason,idempotency_hash,created_at) '+
   'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(correctionId,parts[1],user.household_id,user.user_id,x.expected_revision+1,
    before.prepaid_account_id,x.prepaid_account_id,x.prepaid_version,before.amount_jpy,
    x.amount_jpy,before.effective_date,x.effective_date,x.reason.trim(),h,Date.now()).run();
  if(committed.meta?.changes!==1)return fail('CORRECTION_COMMIT_UNCONFIRMED',503);
  const done=await one();
  return same(done)?receipt(done,false):fail('CORRECTION_RECEIPT_UNCONFIRMED',503);
 }catch{
  const replay=await one().catch(()=>null);
  if(replay)return same(replay)?receipt(replay,true):fail('CORRECTION_IDEMPOTENCY_CONFLICT');
  const latest=await db.prepare('SELECT MAX(revision) AS revision FROM family_member_prepaid_topup_corrections WHERE topup_request_id=?')
   .bind(parts[1]).first().catch(()=>null);
  return Number(latest?.revision||0)!==x.expected_revision?
   fail('CORRECTION_VERSION_CONFLICT'):fail('CORRECTION_OVERDRAW_OR_RETRY',409);
 }
}
