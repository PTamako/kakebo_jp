// Identity-owned Kakeibo recurring plan, backed by a real legacy manual fixed
// expense row or a new per-member SBI plan (never the global legacy SBI PK).
// Plan terms are frozen; changing amount/date requires a new authorization.
const enc=new TextEncoder(),id=/^[a-f0-9]{32}$/i,hex=/^[a-f0-9]{64}$/i;
const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,s=409)=>reply({ok:false,code,ledger_applied:false},s);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const month=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(s);
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_RECURRING_FINANCE_PLANS_ENABLED==='true'&&e.DB?.prepare;
async function input(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const r=await req.text();return r.length<=2300?JSON.parse(r):null}catch{return null}
}
const fields=['expected_user_id','idempotency_key','plan_type','source_bank_account_id',
 'source_account_version','securities_account_id','securities_version',
 'amount_jpy','due_day','start_month','end_month','category','merchant',
 'fund_code','fund_name','account_type'];
function valid(x,u){
 if(!exact(x,fields)||x.expected_user_id!==u.user_id||
  !['fixed_cost','sbi_tsumitate'].includes(x.plan_type)||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !id.test(x.source_bank_account_id)||!Number.isSafeInteger(x.source_account_version)||x.source_account_version<1||
  !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
  !Number.isSafeInteger(x.due_day)||x.due_day<1||x.due_day>28||
  !month(x.start_month)||!month(x.end_month)||x.start_month>x.end_month||
  typeof x.merchant!=='string'||!x.merchant.trim()||x.merchant.length>120||
  typeof x.category!=='string'||!x.category.trim()||x.category.length>100)return false;
 const current=new Date(Date.now()+32400000).toISOString().slice(0,7);
 const offset=(a,b)=>{const [y,m]=a.split('-').map(Number),[z,n]=b.split('-').map(Number);return (z-y)*12+n-m};
 if(offset(current,x.start_month)<0||offset(current,x.start_month)>24||
  offset(x.start_month,x.end_month)>24)return false;
 return x.plan_type==='fixed_cost'?
  x.securities_account_id===null&&x.securities_version===null&&
  x.fund_code===null&&x.fund_name===null&&x.account_type===null:
  id.test(x.securities_account_id)&&x.securities_account_id!==x.source_bank_account_id&&
  Number.isSafeInteger(x.securities_version)&&x.securities_version>=1&&
  typeof x.fund_code==='string'&&/^[A-Z0-9]{8}$/.test(x.fund_code)&&
  typeof x.fund_name==='string'&&x.fund_name.trim()&&x.fund_name.length<=120&&
  x.account_type==='tsumitate';
}
const view=r=>({plan_resource_id:r.plan_resource_id,plan_payload_sha256:r.plan_payload_sha256,
 owner_user_id:r.owner_user_id,plan_type:r.plan_type,source_bank_account_id:r.bank_account_id,
 source_account_version:r.bank_version,securities_account_id:r.securities_account_id,
 securities_version:r.securities_version,amount_jpy:r.amount_jpy,due_day:r.due_day,
 start_month:r.start_month,end_month:r.end_month,
 category:r.category,merchant:r.merchant,fund_code:r.fund_code,
 fund_name:r.fund_name,account_type:r.account_type,
 legacy_recurring_plan_id:r.legacy_recurring_plan_id,state:r.status,
 created_at:r.created_at,ledger_applied:false,policy_approved:false});
const one=(db,u,idValue)=>db.prepare('SELECT * FROM family_member_recurring_plans '+
 'WHERE plan_resource_id=? AND household_id=? AND owner_user_id=? LIMIT 1')
 .bind(idValue,u.household_id,u.user_id).first();
async function active(db,u){
 const person=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(u.user_id,u.household_id).first();
 return person?.state==='active'&&['owner','member'].includes(person.role)?person.role:null;
}
async function accounts(db,u,x){
 const a=(await db.prepare('SELECT account_id,owner_user_id,household_id,account_kind,'+
  'origin,is_archived,version FROM family_financial_accounts '+
  'WHERE account_id IN (?,?)').bind(x.source_bank_account_id,
  x.securities_account_id||x.source_bank_account_id).all()).results||[];
 return a.some(r=>r.account_id===x.source_bank_account_id&&r.owner_user_id===u.user_id&&
   r.household_id===u.household_id&&r.account_kind==='bank'&&
   r.origin==='member_created'&&r.is_archived===0&&r.version===x.source_account_version)&&
  (x.plan_type==='fixed_cost'||a.some(r=>r.account_id===x.securities_account_id&&
   r.owner_user_id===u.user_id&&r.household_id===u.household_id&&r.account_kind==='securities'&&
   r.origin==='member_created'&&r.is_archived===0&&r.version===x.securities_version));
}
async function create(req,e,url,u){
 const x=await input(req,url);
 if(!x||x.expected_user_id!==u.user_id)return fail('RECURRING_PLAN_ACTOR_CHANGED',403);
 if(!valid(x,u))return fail('RECURRING_PLAN_INPUT_INVALID',400);
 if(!await accounts(e.DB,u,x))return fail('RECURRING_PLAN_ACCOUNT_CAS_CHANGED');
 const scope=await digest([u.household_id,u.user_id,'member-recurring-plan',x.idempotency_key].join('\0'));
 const resource=scope.slice(0,32),legacy=x.plan_type==='fixed_cost'?resource:null;
 const payload={resource_id:resource,owner_user_id:u.user_id,plan_type:x.plan_type,
  source_bank_account_id:x.source_bank_account_id,source_account_version:x.source_account_version,
  securities_account_id:x.securities_account_id,securities_version:x.securities_version,
  amount_jpy:x.amount_jpy,due_day:x.due_day,start_month:x.start_month,end_month:x.end_month,
  category:x.category.trim(),merchant:x.merchant.trim(),fund_code:x.fund_code,
  fund_name:x.fund_name?.trim()||null,account_type:x.account_type,
  legacy_recurring_plan_id:legacy};
 const sha=await digest(JSON.stringify(payload));
 const existing=await one(e.DB,u,resource);
 if(existing)return existing.plan_payload_sha256===sha?
  reply({ok:true,plan:view(existing),replayed:true}):fail('RECURRING_PLAN_IDEMPOTENCY_CONFLICT');
 const stamp=Date.now();
 const operations=[];
 if(legacy)operations.push(e.DB.prepare('INSERT INTO recurring_plans '+
  '(id,name,amount,day,category,payment_source,start_month,enabled,posting_mode,schedule_type,workday_only,interval_months) '+
  "VALUES(?,?,?,?,?,?,?,1,'manual','monthly',0,1)")
  .bind(legacy,payload.merchant,payload.amount_jpy,payload.due_day,payload.category,
   'bank:'+payload.source_bank_account_id,payload.start_month));
 operations.push(e.DB.prepare('INSERT INTO family_member_recurring_plans '+
  '(plan_resource_id,household_id,owner_user_id,plan_type,bank_account_id,bank_version,'+
  'securities_account_id,securities_version,legacy_recurring_plan_id,fund_code,fund_name,'+
  'account_type,amount_jpy,due_day,start_month,end_month,category,merchant,plan_payload_sha256,'+
  'created_by_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(resource,u.household_id,u.user_id,payload.plan_type,payload.source_bank_account_id,
   payload.source_account_version,payload.securities_account_id,payload.securities_version,legacy,
   payload.fund_code,payload.fund_name,payload.account_type,payload.amount_jpy,payload.due_day,
   payload.start_month,payload.end_month,payload.category,payload.merchant,sha,u.user_id,stamp));
 try{
  const results=await e.DB.batch(operations);
  if(results.some(x=>x.meta?.changes!==1))return fail('RECURRING_PLAN_ATOMIC_CONFIRMATION_UNKNOWN',503);
  return reply({ok:true,plan:view(await one(e.DB,u,resource)),replayed:false},201);
 }catch{
  const raced=await one(e.DB,u,resource).catch(()=>null);
  return raced?.plan_payload_sha256===sha?
    reply({ok:true,plan:view(raced),replayed:true}):fail('RECURRING_PLAN_CREATE_CONFLICT');
 }
}
async function revoke(req,e,url,u,idValue){
 const x=await input(req,url);
 if(!exact(x,['expected_user_id','confirm_resource_id'])||
  x.expected_user_id!==u.user_id||x.confirm_resource_id!==idValue)
  return fail('RECURRING_PLAN_REVOKE_CONFIRM_REQUIRED',428);
 const p=await one(e.DB,u,idValue);
 if(!p)return fail('RECURRING_PLAN_NOT_FOUND',404);
 if(p.status==='revoked')return reply({ok:true,revoked:true,replayed:true});
 try{
  const result=await e.DB.prepare("UPDATE family_member_recurring_plans SET status='revoked',revoked_at=? "+
   "WHERE plan_resource_id=? AND household_id=? AND owner_user_id=? AND status='active'")
   .bind(Date.now(),idValue,u.household_id,u.user_id).run();
  return result.meta?.changes===1?reply({ok:true,revoked:true}):
   fail('RECURRING_PLAN_REVOKE_CONFLICT');
 }catch{return fail('RECURRING_PLAN_REVOKE_FAILED')}
}
export async function familyMemberRecurringPlans(req,e,url,u,parts){
 if(!ready(e))return fail('RECURRING_PLAN_DISABLED',503);
 const r=await active(e.DB,u);
 if(r!=='member')return fail('RECURRING_PLAN_MEMBER_REQUIRED',403);
 if(parts.length===1&&req.method==='POST')return create(req,e,url,u);
 if(parts.length===1&&req.method==='GET'){
  const a=(await e.DB.prepare('SELECT * FROM family_member_recurring_plans '+
   'WHERE household_id=? AND owner_user_id=? ORDER BY created_at DESC LIMIT 60')
   .bind(u.household_id,u.user_id).all()).results||[];
  return reply({ok:true,items:a.map(view)});
 }
 if(parts.length>=2&&!id.test(parts[1]))return fail('NOT_FOUND',404);
 if(parts.length===2&&req.method==='GET'){
  const p=await one(e.DB,u,parts[1]);
  return p?reply({ok:true,plan:view(p)}):fail('RECURRING_PLAN_NOT_FOUND',404);
 }
 if(parts.length===3&&parts[2]==='revoke'&&req.method==='POST')
  return revoke(req,e,url,u,parts[1]);
 return fail('NOT_FOUND',404);
}
