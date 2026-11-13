// Stage C - per-member account configuration and shared ledger READ ONLY.
// This isolated endpoint cannot create/edit/delete a family ledger entry.
// Requires explicit flag, verified HomeFlow login and matching household.
// IMPORTANT: migration 0023 is unexecuted; do not enable before full backup.
import {onRequest as homeflowIdentity, ssoReady} from '../homeflow-sso/[[path]].js';
import {financePending} from './pending.js';
import {familyAssetSummary} from './assets.js';
import {familyLegacyResourceOwners} from './resource-owners.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}});
const now=()=>new Date().toISOString();
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),
 x=>x.toString(16).padStart(2,'0')).join('');
const validId=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const first=(db,sql,...params)=>db.prepare(sql).bind(...params).first();
const all=async(db,sql,...params)=>(await db.prepare(sql).bind(...params).all()).results||[];
const query=(db,sql,...params)=>db.prepare(sql).bind(...params).run();
function enabled(env,url){
 return env.KAKEIBO_FAMILY_FINANCE_ENABLED==='true' && ssoReady(env,url) &&
  typeof env.KAKEIBO_FAMILY_HOUSEHOLD_ID==='string' &&
  /^[A-Za-z0-9_-]{1,128}$/.test(env.KAKEIBO_FAMILY_HOUSEHOLD_ID);
}
async function identity(request,env){
 // The SSO status probe accepts GET only. Reconstruct a GET with the same
 // origin and cookie; never forward a business POST body to authentication.
 const proofRequest=new Request(request.url,{
  method:'GET',headers:{Cookie:request.headers.get('cookie')||''}
 });
 const response=await homeflowIdentity({request:proofRequest,env,params:{path:['me']}});
 if(response.status!==200)return null;
 const data=await response.json().catch(()=>null);
 const person=data?.identity;
 if(data?.ok!==true||data?.ledger_access!==false||
  !person||typeof person.user_id!=='string'||
  !['owner','member'].includes(person.role)||
  person.household_id!==env.KAKEIBO_FAMILY_HOUSEHOLD_ID)return null;
 return person;
}
async function bodyForMutation(request,url){
 if(request.headers.get('origin')!==url.origin)return null;
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return null;
 try{
  const text=await request.text();
  const value=text.length<=4000?JSON.parse(text):null;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null;}
}
const kinds=new Set(['credit_card','prepaid','cash','bank','points','securities','other']);
const accountFields='account_id,household_id,owner_user_id,label,account_kind,source_type,'+
 'stat_group,closing_day,sort_order,is_default,is_archived,opening_balance,'+
 'opening_date,origin,legacy_source_name,version';
function legalLabel(label){
 return typeof label==='string'&&label.trim().length>0&&label.trim().length<=80;
}
function decimal(value,max=999999999999){
 return Number.isSafeInteger(value)&&value>=0&&value<=max;
}
function validClosing(day){return day===null||(Number.isInteger(day)&&day>=0&&day<=31);}
function validSort(sort){return Number.isInteger(sort)&&sort>=-10000&&sort<=10000;}
async function accounts(request,env,url,user,parts){
 const db=env.DB;
 if(request.method==='GET'&&parts.length===1){
  // All family financial asset summaries are readable by both members.
  // Card numbers, OAuth credentials and private receipts are never returned.
  const rows=await all(db,'SELECT '+accountFields+' FROM family_financial_accounts '+
   'WHERE household_id=? ORDER BY is_archived,sort_order,account_id LIMIT 300',user.household_id);
  return json({ok:true,items:rows,household_scope:true});
 }
 if(request.method==='POST'&&parts.length===1){
  const data=await bodyForMutation(request,url);
  if(!data)return json({code:'BAD_ORIGIN_OR_BODY'},403);
  // A queued iPhone PWA mutation must remain bound to its original
  // HomeFlow user. The actor itself is still the freshly introspected user.
  if(data.expected_user_id!==user.user_id)return json({code:'ACTOR_CHANGED'},403);
  if(!legalLabel(data.label)||!kinds.has(data.account_kind))
   return json({code:'INVALID_ACCOUNT'},400);
  const target=typeof data.owner_user_id==='string'?data.owner_user_id:user.user_id;
  if(target!==user.user_id&&user.role!=='owner')
   return json({code:'NOT_YOUR_ACCOUNT'},403);
  const targetUser=await first(db,"SELECT user_id FROM homeflow_identity_links "+
    "WHERE user_id=? AND household_id=? AND state='active'",target,user.household_id);
  if(!targetUser)return json({code:'OWNER_NOT_IN_HOUSEHOLD'},403);
  const day=data.closing_day===undefined?null:data.closing_day;
  const sort=data.sort_order===undefined?0:data.sort_order;
  const balance=data.opening_balance===undefined?0:data.opening_balance;
  const isDefault=data.is_default===true?1:0;
  if(!validClosing(day)||!validSort(sort)||!decimal(balance)||
    (data.is_default!==undefined&&typeof data.is_default!=='boolean'))
   return json({code:'INVALID_SETTINGS'},400);
  const existing=await first(db,'SELECT COUNT(*) AS count FROM family_financial_accounts '+
    'WHERE household_id=? AND owner_user_id=?',user.household_id,target);
  if(Number(existing?.count||0)>=100)return json({code:'ACCOUNT_LIMIT'},409);
  const kind=data.account_kind,stamp=now(),accountId=id();
  const sourceType=kind==='prepaid'?'prepaid':'standard';
  const statGroup=kind==='points'?'points':'card';
  try{
   const rows=await db.batch([
    db.prepare('INSERT INTO family_financial_accounts '+
     '(account_id,household_id,owner_user_id,label,account_kind,source_type,stat_group,'+
     'closing_day,sort_order,is_default,opening_balance,origin,created_by_user_id,'+
     'updated_by_user_id,created_at,updated_at) '+
     "VALUES(?,?,?,?,?,?,?,?,?,?,?,'member_created',?,?,?,?)")
    .bind(accountId,user.household_id,target,data.label.trim(),kind,sourceType,statGroup,
     day,sort,isDefault,balance,user.user_id,user.user_id,stamp,stamp),
    db.prepare('INSERT INTO family_finance_events '+
     '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
     "VALUES(?,?,?,?,'personal_account_created',?)")
    .bind(id(),user.household_id,user.user_id,accountId,stamp)
   ]);
   if(rows.some(x=>x.meta?.changes!==1))return json({code:'ACCOUNT_NOT_CREATED'},503);
   return json({ok:true,account_id:accountId,owner_user_id:target,ledger_changed:false},201);
  }catch{return json({code:'ACCOUNT_NOT_CREATED'},503);}
 }
 if(request.method==='PATCH'&&parts.length===2&&validId(parts[1])){
  const data=await bodyForMutation(request,url);
  if(!data)return json({code:'BAD_ORIGIN_OR_BODY'},403);
  if(data.expected_user_id!==user.user_id)return json({code:'ACTOR_CHANGED'},403);
  const account=await first(db,'SELECT '+accountFields+
   ' FROM family_financial_accounts WHERE account_id=? AND household_id=?',
   parts[1],user.household_id);
  if(!account)return json({code:'ACCOUNT_NOT_FOUND'},404);
  if(account.owner_user_id!==user.user_id&&user.role!=='owner')
   return json({code:'NOT_YOUR_ACCOUNT'},403);
  // Old payment_sources and card bills remain authoritative until
  // all references are moved with a lossless dedicated migration.
  if(account.origin==='legacy')return json({code:'LEGACY_SETTINGS_NOT_YET_MIGRATED'},409);
  if(!Number.isInteger(data.version)||data.version!==account.version)
   return json({code:'VERSION_CONFLICT'},409);
  const updates=[],values=[];
  const names=[['label',legalLabel],['closing_day',validClosing],
   ['sort_order',validSort],['opening_balance',v=>decimal(v)]];
  for(const [name,valid] of names)if(data[name]!==undefined){
   if(!valid(data[name]))return json({code:'INVALID_SETTINGS'},400);
   updates.push(name+'=?');values.push(name==='label'?data[name].trim():data[name]);
  }
  for(const name of ['is_archived','is_default'])if(data[name]!==undefined){
   if(typeof data[name]!=='boolean')return json({code:'INVALID_SETTINGS'},400);
   updates.push(name+'=?');values.push(data[name]?1:0);
  }
  if(!updates.length)return json({code:'NO_CHANGES'},400);
  const stamp=now(),archiving=data.is_archived===true;
  try{
   const results=await db.batch([
    db.prepare('UPDATE family_financial_accounts SET '+updates.join(',')+
      ',updated_by_user_id=?,updated_at=?,version=version+1 '+
      'WHERE account_id=? AND household_id=? AND version=? AND '+
      '(owner_user_id=? OR ?=\'owner\') AND origin=\'member_created\'')
      .bind(...values,user.user_id,stamp,account.account_id,user.household_id,
       data.version,user.user_id,user.role),
    db.prepare('INSERT INTO family_finance_events '+
      '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
      'SELECT ?,?,?,?, ?,? WHERE changes()=1')
      .bind(id(),user.household_id,user.user_id,account.account_id,
       archiving?'personal_account_archived':'personal_account_updated',stamp)
   ]);
   if(results.some(x=>x.meta?.changes!==1))return json({code:'VERSION_CONFLICT'},409);
   return json({ok:true,version:account.version+1,ledger_changed:false});
  }catch{return json({code:'ACCOUNT_UPDATE_FAILED'},503);}
 }
 return json({code:'NOT_FOUND'},404);
}
async function adoptLegacy(request,env,url,user){
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 if(user.role!=='owner')return json({code:'OWNER_REQUIRED'},403);
 const input=await bodyForMutation(request,url);
 if(!input||input.confirm!==true)return json({code:'EXPLICIT_CONFIRMATION_REQUIRED'},403);
 const db=env.DB;
 const rows=await all(db,'SELECT name,sort_order,is_default,closing_day,source_type,'+
  'stat_group,is_archived,opening_balance,opening_date FROM payment_sources ORDER BY name LIMIT 301');
 if(rows.length>300)return json({code:'LEGACY_ACCOUNT_COUNT_REVIEW_REQUIRED'},409);
 const existing=await all(db,'SELECT owner_user_id,household_id,legacy_source_name '+
  'FROM family_financial_accounts WHERE legacy_source_name IS NOT NULL');
 if(existing.some(x=>x.owner_user_id!==user.user_id||
   x.household_id!==user.household_id))return json({code:'LEGACY_ACCOUNT_OWNER_CONFLICT'},409);
 const done=new Set(existing.map(x=>x.legacy_source_name));
 const remaining=rows.filter(x=>!done.has(x.name));
 if(remaining.some(x=>!legalLabel(x.name)))return json({code:'LEGACY_LABEL_REVIEW_REQUIRED'},409);
 if(!remaining.length)return json({ok:true,adopted:0,already_adopted:true,ledger_changed:false});
 const stamp=now();
 const stmts=remaining.map(x=>{
  const kind=x.stat_group==='points'?'points':
    x.source_type==='prepaid'?'prepaid':x.closing_day===null?'other':'credit_card';
  return db.prepare('INSERT INTO family_financial_accounts '+
   '(account_id,household_id,owner_user_id,label,account_kind,source_type,stat_group,'+
   'closing_day,sort_order,is_default,is_archived,opening_balance,opening_date,'+
   'origin,legacy_source_name,created_by_user_id,updated_by_user_id,created_at,updated_at) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'legacy',?,?,?,?,?)")
   .bind(id(),user.household_id,user.user_id,x.name,kind,x.source_type,
    x.stat_group,x.closing_day,x.sort_order,x.is_default,x.is_archived,
    x.opening_balance,x.opening_date,x.name,user.user_id,user.user_id,stamp,stamp);
 });
 stmts.push(db.prepare('INSERT INTO family_finance_events '+
   '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
   "VALUES(?,?,?,'legacy_account_import','legacy_accounts_adopted',?)")
   .bind(id(),user.household_id,user.user_id,stamp));
 try{
  const changes=await db.batch(stmts);
  if(changes.some(x=>x.meta?.changes!==1))return json({code:'LEGACY_CONFLICT'},409);
  return json({ok:true,adopted:remaining.length,ledger_changed:false});
 }catch{return json({code:'LEGACY_CONFLICT'},409);}
}
async function entries(env,user,url){
 const limit=Math.max(1,Math.min(20,Number(url.searchParams.get('limit'))||5));
 const offset=Math.max(0,Math.min(10000,Number(url.searchParams.get('offset'))||0));
 const rows=await all(env.DB,'SELECT e.id,e.date,e.time,e.type,e.amount,'+
  'e.category,e.merchant,e.note,e.payment_source,e.transfer_target,'+
  'e.transfer_applied,e.transfer_date,e.family_account_id,'+
  'COALESCE(a.label,e.payment_source) AS payment_source_display,'+
  'a.owner_user_id AS payment_account_owner_user_id '+
  'FROM entries e LEFT JOIN family_financial_accounts a '+
  'ON a.account_id=e.family_account_id '+
  'ORDER BY e.date DESC,e.id DESC LIMIT ? OFFSET ?',limit+1,offset);
 return json({ok:true,household_id:user.household_id,items:rows.slice(0,limit),
  next_offset:rows.length>limit?offset+limit:null,ledger_scope:'household'});
}
async function totals(env,user,url){
 const month=url.searchParams.get('month');
 if(!/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(month||''))
  return json({code:'INVALID_MONTH'},400);
 const types=await all(env.DB,'SELECT type,COALESCE(SUM(amount),0) amount,'+
  'COUNT(*) count FROM entries WHERE substr(date,1,7)=? GROUP BY type',month);
 const byType={income:0,expense:0,transfer:0};
 const count={income:0,expense:0,transfer:0};
 for(const x of types)if(Object.hasOwn(byType,x.type)){
  byType[x.type]=Number(x.amount)||0;count[x.type]=Number(x.count)||0;
 }
 return json({ok:true,household_id:user.household_id,month,
  ledger_scope:'household',totals:byType,counts:count,
  net_income_expense:byType.income-byType.expense});
}
// Whole-household historical year statistics. Never filter by owner_user_id:
// financial resource ownership controls settings, not family ledger visibility.
// Aggregate in D1 instead of reading all individual entries to the browser.
async function yearSummary(env,user,url){
 const year=url.searchParams.get('year');
 if(!/^20[0-9]{2}$/.test(year||''))return json({code:'INVALID_YEAR'},400);
 const start=year+'-01-01',end=String(Number(year)+1)+'-01-01';
 const types=['income','expense','transfer'];
 const empty=()=>({income:0,expense:0,transfer:0});
 const emptyCounts=()=>({income:0,expense:0,transfer:0});
 const months=Array.from({length:12},(_,i)=>({
  month:year+'-'+String(i+1).padStart(2,'0'),
  totals:empty(),counts:emptyCounts(),net_income_expense:0
 }));
 // Three small grouped reads, rather than a per-row scan in the client.
 // Transfer values remain separate and never inflate income/expense net.
 const [monthly,byCategory,byPayment]=await Promise.all([
  all(env.DB,`SELECT substr(date,1,7) month,type,
    COALESCE(SUM(amount),0) amount,COUNT(*) count
    FROM entries WHERE date>=? AND date<?
    GROUP BY substr(date,1,7),type ORDER BY month,type`,start,end),
  all(env.DB,`SELECT type,COALESCE(category,'') category,
    COALESCE(SUM(amount),0) amount,COUNT(*) count
    FROM entries WHERE date>=? AND date<? AND type IN ('income','expense')
    GROUP BY type,category ORDER BY type,category`,start,end),
  all(env.DB,`SELECT type,COALESCE(payment_source,'') payment_source,
    COALESCE(SUM(amount),0) amount,COUNT(*) count
    FROM entries WHERE date>=? AND date<? AND type IN ('income','expense')
    GROUP BY type,payment_source ORDER BY type,payment_source`,start,end)
 ]);
 const safeValue=v=>{
  const n=Number(v);
  return Number.isSafeInteger(n)&&n>=0?n:null;
 };
 const totals=empty(),counts=emptyCounts();
 for(const row of monthly){
  if(!types.includes(row.type))return json({code:'LEDGER_TYPE_UNSUPPORTED'},409);
  const m=months.find(x=>x.month===row.month);
  const n=safeValue(row.amount),c=safeValue(row.count);
  if(!m||n===null||c===null)return json({code:'LEDGER_TOTAL_REVIEW_REQUIRED'},409);
  m.totals[row.type]+=n;m.counts[row.type]+=c;
  totals[row.type]+=n;counts[row.type]+=c;
 }
 for(const m of months)m.net_income_expense=m.totals.income-m.totals.expense;
 const group=(rows,key)=>rows.map(row=>{
  const amount=safeValue(row.amount),count=safeValue(row.count);
  if(!['income','expense'].includes(row.type)||amount===null||count===null||
    typeof row[key]!=='string')return null;
  return {type:row.type,[key]:row[key]||'未分类',amount,count};
 });
 const categories=group(byCategory,'category');
 const paymentSources=group(byPayment,'payment_source');
 if(categories.includes(null)||paymentSources.includes(null))
  return json({code:'LEDGER_TOTAL_REVIEW_REQUIRED'},409);
 categories.sort((a,b)=>b.amount-a.amount||a.category.localeCompare(b.category));
 paymentSources.sort((a,b)=>b.amount-a.amount||a.payment_source.localeCompare(b.payment_source));
 return json({ok:true,year,household_id:user.household_id,ledger_scope:'household',
  computed_from:'entries',complete:true,ledger_changed:false,
  totals,counts,net_income_expense:totals.income-totals.expense,
  months,categories,payment_sources:paymentSources});
}
export async function onRequest({request,env,params}){
 const url=new URL(request.url),parts=params.path||[];
 if(parts.length===1&&parts[0]==='status'&&request.method==='GET')
  return json({enabled:enabled(env,url),ledger_access:false});
 if(!enabled(env,url))return json({code:'FAMILY_FINANCE_DISABLED'},503);
 try{
  const user=await identity(request,env);
  if(!user)return json({code:'SSO_NOT_AUTHENTICATED'},401);
  if(parts[0]==='proposals')return financePending(request,env,url,user,parts);
  if(parts[0]==='accounts')return accounts(request,env,url,user,parts);
  if(parts.length===2&&parts[0]==='legacy'&&parts[1]==='resource-owners')
    return familyLegacyResourceOwners(request,env,url,user);
  if(parts[0]==='legacy'&&parts[1]==='adopt')
   return adoptLegacy(request,env,url,user);
  if(request.method==='GET'&&parts.length===2&&parts[0]==='shared'&&
     parts[1]==='asset-summary')
   return familyAssetSummary(env,url,user,request);
  if(request.method==='GET'&&parts[0]==='shared'&&parts[1]==='entries')
   return entries(env,user,url);
  if(request.method==='GET'&&parts[0]==='shared'&&parts[1]==='ledger-totals')
   return totals(env,user,url);
  if(request.method==='GET'&&parts.length===2&&parts[0]==='shared'&&
     parts[1]==='year-summary')
   return yearSummary(env,user,url);
  return json({code:'NOT_FOUND'},404);
 }catch{return json({code:'FAMILY_FINANCE_UNAVAILABLE'},503);}
}
