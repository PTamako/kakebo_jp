// Personal fixed-cost settings are not bank orders and do not write family
// entries. The HomeFlow household-ledger approval is checked later, when a
// member explicitly submits a due expense through shared-mutation-requests.
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}})
const reject=(code,status=409)=>json({ok:false,code,ledger_applied:false},status)
const id=/^[a-f0-9]{32}$/
const allowTypes=new Set(['monthly','weekly','workday'])
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|')
const fields=['name','amount_jpy','schedule_type','interval_months','month_days',
 'weekdays','category','payment_source','start_month','posting_mode']
const month=/^20\d{2}-(0[1-9]|1[0-2])$/
const safe=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max
const uniqueDays=(x,lo,hi)=>Array.isArray(x)&&x.length>=1&&x.length<=hi-lo+1&&
 x.every(n=>Number.isInteger(n)&&n>=lo&&n<=hi)&&new Set(x).size===x.length
const valid=(x)=>{
 if(!x||!safe(x.name,120)||!Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||
 x.amount_jpy>10000000||!allowTypes.has(x.schedule_type)||
 ![1,2,3,6,12].includes(x.interval_months)||
 (x.schedule_type!=='monthly'&&x.interval_months!==1)||
 !uniqueDays(x.month_days,1,31)||!uniqueDays(x.weekdays,0,6)||
 !safe(x.category,100)||!safe(x.payment_source,160)||!month.test(x.start_month)||
 x.posting_mode!=='manual')return false
 return x.payment_source==='cash'||
 (x.payment_source.startsWith('personal:')&&id.test(x.payment_source.slice(9)))||
 (x.payment_source.startsWith('shared:')&&
 x.payment_source.slice(7).length>0&&x.payment_source.slice(7).length<=80)
}
const canonical=x=>({
 name:x.name.trim(),amount_jpy:x.amount_jpy,schedule_type:x.schedule_type,
 interval_months:x.interval_months,month_days_json:JSON.stringify([...x.month_days].sort((a,b)=>a-b)),
 weekdays_json:JSON.stringify([...x.weekdays].sort((a,b)=>a-b)),
 category:x.category.trim(),payment_source:x.payment_source,
 start_month:x.start_month,posting_mode:'manual'
})
const view=x=>({plan_id:x.plan_id,owner_user_id:x.owner_user_id,name:x.name,
 amount:x.amount_jpy,scheduleType:x.schedule_type,intervalMonths:x.interval_months,
 monthDays:JSON.parse(x.month_days_json),weekdays:JSON.parse(x.weekdays_json),
 category:x.category,paymentSource:x.payment_source,startMonth:x.start_month,
 postingMode:x.posting_mode,enabled:!!x.enabled,version:x.version,
 created_at:x.created_at,updated_at:x.updated_at,ledger_applied:false})
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first()
async function body(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null
 try{const raw=await req.text();return raw.length<=2700?JSON.parse(raw):null}
 catch{return null}
}
async function sourceValid(db,user,source){
 if(source==='cash')return true
 if(source.startsWith('personal:')){
  return !!await first(db,"SELECT 1 FROM family_financial_accounts "+
   "WHERE account_id=? AND household_id=? AND owner_user_id=? "+
   "AND origin='member_created' AND account_kind IN('credit_card','prepaid') "+
   "AND is_archived=0",source.slice(9),user.household_id,user.user_id)
 }
 if(source.startsWith('shared:')){
  return !!await first(db,"SELECT 1 FROM family_legacy_card_shares s "+
   "JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id "+
   "WHERE s.card_name=? AND s.grantee_user_id=? AND s.household_id=? "+
   "AND s.is_active=1 AND o.state='active' AND o.role='owner'",
   source.slice(7),user.user_id,user.household_id)
 }
 return false
}
const get=(db,user,pid)=>first(db,
 'SELECT * FROM family_member_fixed_cost_settings WHERE plan_id=? AND household_id=? AND owner_user_id=?',
 pid,user.household_id,user.user_id)
const cryptoid=async(user,key)=>{
 const raw=new TextEncoder().encode(user.household_id+'\\0'+user.user_id+'\\0'+key)
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))]
  .map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32)
}
export async function familyMemberFixedCosts(req,env,url,user,parts){
 if(env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||env.APP_ENV!=='production'||!env.DB?.prepare)
  return reject('FIXED_COST_NOT_READY',503)
 if(user?.role!=='member'||!user.user_id||!user.household_id)
  return reject('FIXED_COST_MEMBER_REQUIRED',403)
 const active=await first(env.DB,"SELECT 1 FROM homeflow_identity_links "+
  "WHERE user_id=? AND household_id=? AND role='member' AND state='active'",
  user.user_id,user.household_id)
 if(!active)return reject('FIXED_COST_SESSION_REVOKED',403)
 if(parts.length===1&&req.method==='GET'){
  const result=await env.DB.prepare('SELECT * FROM family_member_fixed_cost_settings '+
   'WHERE household_id=? AND owner_user_id=? ORDER BY updated_at DESC LIMIT 200')
   .bind(user.household_id,user.user_id).all()
  return json({ok:true,scope:'personal',items:(result.results||[]).map(view),ledger_applied:false})
 }
 if(parts.length===1&&req.method==='POST'){
  const x=await body(req,url)
  if(!x||!exact(x,['expected_user_id','idempotency_key',...fields])||
   x.expected_user_id!==user.user_id||
   typeof x.idempotency_key!=='string'||!/^member-fixed:[a-f0-9-]{36}$/.test(x.idempotency_key)||
   !valid(x))return reject('FIXED_COST_INPUT_INVALID',400)
  if(!await sourceValid(env.DB,user,x.payment_source))return reject('PAYMENT_SOURCE_NOT_ALLOWED',403)
  const p=canonical(x),pid=await cryptoid(user,x.idempotency_key)
  const old=await get(env.DB,user,pid)
  if(old)return JSON.stringify(canonical({
   ...view(old),name:old.name,amount_jpy:old.amount_jpy,
   schedule_type:old.schedule_type,interval_months:old.interval_months,
   month_days:JSON.parse(old.month_days_json),weekdays:JSON.parse(old.weekdays_json),
   category:old.category,payment_source:old.payment_source,start_month:old.start_month
  }))===JSON.stringify(p)?
   json({ok:true,plan:view(old),replayed:true}):reject('FIXED_COST_REPLAY_CONFLICT')
  const at=Date.now()
  try{
   const result=await env.DB.prepare('INSERT INTO family_member_fixed_cost_settings '+
    '(plan_id,household_id,owner_user_id,name,amount_jpy,schedule_type,interval_months,'+
    'month_days_json,weekdays_json,category,payment_source,start_month,posting_mode,created_at,updated_at) '+
    'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(pid,user.household_id,user.user_id,p.name,p.amount_jpy,p.schedule_type,
     p.interval_months,p.month_days_json,p.weekdays_json,p.category,p.payment_source,
     p.start_month,p.posting_mode,at,at).run()
   if(result.meta?.changes!==1)return reject('FIXED_COST_NOT_CONFIRMED',503)
   return json({ok:true,plan:view(await get(env.DB,user,pid)),ledger_applied:false},201)
  }catch{return reject('FIXED_COST_CREATE_FAILED',503)}
 }
 if(parts.length===2&&id.test(parts[1])&&req.method==='PATCH'){
  const x=await body(req,url)
  if(!x||!exact(x,['expected_user_id','version',...fields])||
   x.expected_user_id!==user.user_id||!Number.isInteger(x.version)||x.version<1||!valid(x))
   return reject('FIXED_COST_INPUT_INVALID',400)
  if(!await sourceValid(env.DB,user,x.payment_source))return reject('PAYMENT_SOURCE_NOT_ALLOWED',403)
  const p=canonical(x),at=Date.now(),pid=parts[1]
  const res=await env.DB.prepare('UPDATE family_member_fixed_cost_settings '+
   'SET name=?,amount_jpy=?,schedule_type=?,interval_months=?,month_days_json=?,'+
   'weekdays_json=?,category=?,payment_source=?,start_month=?,posting_mode=?,'+
   'version=version+1,updated_at=? WHERE plan_id=? AND household_id=? AND owner_user_id=? AND version=?')
   .bind(p.name,p.amount_jpy,p.schedule_type,p.interval_months,p.month_days_json,
    p.weekdays_json,p.category,p.payment_source,p.start_month,p.posting_mode,at,
    pid,user.household_id,user.user_id,x.version).run()
  if(res.meta?.changes!==1)return reject('FIXED_COST_VERSION_OR_OWNER_CHANGED')
  return json({ok:true,plan:view(await get(env.DB,user,pid)),ledger_applied:false})
 }
 if(parts.length===2&&id.test(parts[1])&&req.method==='DELETE'){
  const x=await body(req,url)
  if(!exact(x,['expected_user_id','version'])||
   x.expected_user_id!==user.user_id||!Number.isInteger(x.version)||x.version<1)
   return reject('FIXED_COST_INPUT_INVALID',400)
  const result=await env.DB.prepare('DELETE FROM family_member_fixed_cost_settings '+
   'WHERE plan_id=? AND household_id=? AND owner_user_id=? AND version=?')
   .bind(parts[1],user.household_id,user.user_id,x.version).run()
  if(result.meta?.changes!==1)return reject('FIXED_COST_VERSION_OR_OWNER_CHANGED')
  return json({ok:true,removed:true,ledger_applied:false})
 }
 if(parts.length===3&&id.test(parts[1])&&parts[2]==='toggle'&&req.method==='POST'){
  const x=await body(req,url)
  if(!exact(x,['expected_user_id','version','enabled'])||
   x.expected_user_id!==user.user_id||!Number.isInteger(x.version)||typeof x.enabled!=='boolean')
   return reject('FIXED_COST_INPUT_INVALID',400)
  const res=await env.DB.prepare('UPDATE family_member_fixed_cost_settings '+
   'SET enabled=?,version=version+1,updated_at=? '+
   'WHERE plan_id=? AND household_id=? AND owner_user_id=? AND version=?')
   .bind(x.enabled?1:0,Date.now(),parts[1],user.household_id,user.user_id,x.version).run()
  if(res.meta?.changes!==1)return reject('FIXED_COST_VERSION_OR_OWNER_CHANGED')
  return json({ok:true,plan:view(await get(env.DB,user,parts[1])),ledger_applied:false})
 }
 return reject('NOT_FOUND',404)
}
