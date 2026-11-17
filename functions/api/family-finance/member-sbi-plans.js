// Personal SBI schedule only. No real broker orders, ledger entries or HomeFlow approvals.
const enc=new TextEncoder(),id=/^[0-9a-f]{32}$/i, fund=/^[A-Z0-9]{8}$/;
const response=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,s=409)=>response({ok:false,code,ledger_changed:false},s);
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const month=x=>typeof x==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(x);
const todayMonth=()=>new Date(Date.now()+32400000).toISOString().slice(0,7);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
async function input(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<1600?JSON.parse(raw):null}catch{return null}
}
const publicPlan=p=>({
 plan_resource_id:p.plan_resource_id,owner_user_id:p.owner_user_id,plan_type:'sbi_tsumitate',
 securities_account_id:p.securities_account_id,securities_version:p.securities_version,
 source_bank_account_id:null,source_account_version:null,amount_jpy:p.amount_jpy,
 due_day:p.due_day,start_month:p.start_month,end_month:p.end_month,
 fund_code:p.fund_code,fund_name:p.fund_name,account_type:p.account_type,
 state:p.status,created_at:p.created_at,ledger_applied:false,policy_approved:false
});
async function owner(db,u){
 const m=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(u.user_id,u.household_id).first();
 return m?.role==='member'&&m.state==='active';
}
export async function familyMemberSbiPlans(req,env,url,user,parts){
 if(env.APP_ENV!=='production'||env.KAKEIBO_MEMBER_SBI_PLANS_ENABLED!=='true'||!env.DB?.prepare)
  return fail('PERSONAL_SBI_PLANS_DISABLED',503);
 if(!await owner(env.DB,user))return fail('MEMBER_IDENTITY_REQUIRED',403);
 const db=env.DB;
 if(req.method==='GET'&&parts.length===1){
  const rows=(await db.prepare('SELECT * FROM family_member_sbi_plans WHERE household_id=? AND owner_user_id=? ORDER BY created_at DESC LIMIT 100')
   .bind(user.household_id,user.user_id).all()).results||[];
  return response({ok:true,scope:'personal',viewer_user_id:user.user_id,items:rows.map(publicPlan),ledger_changed:false});
 }
 if(req.method==='POST'&&parts.length===1){
  const x=await input(req,url);
  const fields=['expected_user_id','idempotency_key','securities_account_id','securities_version',
   'amount_jpy','due_day','start_month','end_month','fund_code','fund_name','account_type'];
  if(!exact(x,fields)||x.expected_user_id!==user.user_id||!id.test(x.securities_account_id)||
    !Number.isSafeInteger(x.securities_version)||x.securities_version<1||
    !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
    !Number.isInteger(x.due_day)||x.due_day<1||x.due_day>28||
    !month(x.start_month)||!month(x.end_month)||x.start_month>x.end_month||
    x.start_month<todayMonth()||x.end_month.slice(0,4)>'2099'||
    !fund.test(x.fund_code)||typeof x.fund_name!=='string'||!x.fund_name.trim()||
    x.fund_name.length>120||x.account_type!=='tsumitate'||
    typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
    return fail('PERSONAL_SBI_PLAN_INVALID',400);
  const s=await db.prepare("SELECT account_id FROM family_financial_accounts WHERE account_id=? AND household_id=? AND owner_user_id=? AND account_kind='securities' AND origin='member_created' AND version=? AND is_archived=0")
   .bind(x.securities_account_id,user.household_id,user.user_id,x.securities_version).first();
  if(!s)return fail('PERSONAL_SBI_ACCOUNT_CHANGED',409);
  const resource=(await sha([user.household_id,user.user_id,'sbi-plan',x.idempotency_key].join('\0'))).slice(0,32);
  const payload=JSON.stringify({resource,...Object.fromEntries(fields.filter(k=>k!=='idempotency_key').map(k=>[k,x[k]]))});
  const checksum=await sha(payload);
  const prior=await db.prepare('SELECT * FROM family_member_sbi_plans WHERE plan_resource_id=?').bind(resource).first();
  if(prior)return prior.owner_user_id===user.user_id&&prior.household_id===user.household_id&&prior.payload_sha256===checksum?
   response({ok:true,plan:publicPlan(prior),replayed:true,ledger_changed:false}):fail('PERSONAL_SBI_IDEMPOTENCY_CONFLICT');
  try{
   const result=await db.prepare('INSERT INTO family_member_sbi_plans (plan_resource_id,household_id,owner_user_id,securities_account_id,securities_version,amount_jpy,due_day,start_month,end_month,fund_code,fund_name,account_type,payload_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(resource,user.household_id,user.user_id,x.securities_account_id,x.securities_version,x.amount_jpy,x.due_day,x.start_month,x.end_month,x.fund_code,x.fund_name.trim(),x.account_type,checksum,Date.now()).run();
   if(result.meta?.changes!==1)return fail('PERSONAL_SBI_CREATE_UNCONFIRMED',503);
   const saved=await db.prepare('SELECT * FROM family_member_sbi_plans WHERE plan_resource_id=?').bind(resource).first();
   return response({ok:true,plan:publicPlan(saved),ledger_changed:false},201);
  }catch{
   const saved=await db.prepare('SELECT * FROM family_member_sbi_plans WHERE plan_resource_id=?').bind(resource).first().catch(()=>null);
   return saved?.payload_sha256===checksum&&saved.owner_user_id===user.user_id?
    response({ok:true,plan:publicPlan(saved),replayed:true,ledger_changed:false}):fail('PERSONAL_SBI_PLAN_CONFLICT');
  }
 }
 if(req.method==='POST'&&parts.length===3&&parts[2]==='revoke'&&id.test(parts[1])){
  const x=await input(req,url);
  if(!exact(x,['expected_user_id','confirm_resource_id'])||x.expected_user_id!==user.user_id||x.confirm_resource_id!==parts[1])
   return fail('PERSONAL_SBI_REVOKE_CONFIRM_REQUIRED',428);
  const p=await db.prepare('SELECT * FROM family_member_sbi_plans WHERE plan_resource_id=? AND household_id=? AND owner_user_id=?')
   .bind(parts[1],user.household_id,user.user_id).first();
  if(!p)return fail('PERSONAL_SBI_PLAN_NOT_FOUND',404);
  if(p.status==='revoked')return response({ok:true,revoked:true,replayed:true,ledger_changed:false});
  const done=await db.prepare("UPDATE family_member_sbi_plans SET status='revoked',revoked_at=? WHERE plan_resource_id=? AND household_id=? AND owner_user_id=? AND status='active'")
   .bind(Date.now(),parts[1],user.household_id,user.user_id).run();
  return done.meta?.changes===1?response({ok:true,revoked:true,ledger_changed:false}):fail('PERSONAL_SBI_REVOKE_CONFLICT');
 }
 return fail('NOT_FOUND',404);
}
