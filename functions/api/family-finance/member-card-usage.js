// Read-only, account-scoped card statement projection for the member management UI.
// Never expose a spouse's private account, card bill, or card limit.
import {billingPeriodForMonth} from '../../../src/card-billing.js'
const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}})
const todayMonth=()=>new Date(Date.now()+32400000).toISOString().slice(0,7)
const validMonth=x=>/^20\d\d-(0[1-9]|1[0-2])$/.test(x)
const closingDay=(day,name)=>{
 if(day===0)return '末日'
 if(Number.isInteger(Number(day))&&Number(day)>0&&Number(day)<=31)return String(day)
 const normalized=String(name||'').normalize('NFKC').toLowerCase().replace(/[\s　・（）()_-]/g,'')
 return /セゾン|saison/.test(normalized)?'10':/セブンカード|7card/.test(normalized)?'15':'末日'
}
const safe=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):null
export async function familyMemberCardUsage(req,env,url,user,parts){
 if(req.method!=='GET'||parts.length!==1)return reply({ok:false,code:'METHOD_NOT_ALLOWED'},405)
 const month=url.searchParams.get('month')||todayMonth()
 if(!validMonth(month))return reply({ok:false,code:'CARD_USAGE_BAD_MONTH'},400)
 const db=env.DB
 const accounts=(await db.prepare("SELECT account_id,label,closing_day FROM family_financial_accounts "+
  "WHERE household_id=? AND owner_user_id=? AND account_kind='credit_card' "+
  "AND origin='member_created' AND is_archived=0 ORDER BY sort_order,account_id LIMIT 30")
  .bind(user.household_id,user.user_id).all()).results||[]
 const grants=(await db.prepare("SELECT DISTINCT s.card_name,p.closing_day "+
  "FROM family_legacy_card_shares s JOIN payment_sources p ON p.name=s.card_name "+
  "WHERE s.household_id=? AND s.grantee_user_id=? AND s.owner_user_id<>? "+
  "AND s.is_active=1 AND p.source_type='standard' AND p.is_archived=0 LIMIT 30")
  .bind(user.household_id,user.user_id,user.user_id).all()).results||[]
 const items=[]
 for(const account of accounts){
  const period=billingPeriodForMonth(month,closingDay(account.closing_day,account.label))
  if(!period)continue
  // The current, actually posted physical row is authoritative after approved edits
  // and deletes. Never sum the immutable original intent as a second expense.
  const entries=(await db.prepare("SELECT id,date,merchant,category,amount FROM entries "+
   "WHERE family_account_id=? AND type='expense' AND date>=? AND date<=? "+
   "ORDER BY date DESC,id DESC LIMIT 201")
   .bind(account.account_id,period.start,period.end).all()).results||[]
  const total=await db.prepare("SELECT COUNT(*) count,COALESCE(SUM(amount),0) amount "+
   "FROM entries WHERE family_account_id=? AND type='expense' AND date>=? AND date<=?")
   .bind(account.account_id,period.start,period.end).first()
  const amount=safe(total?.amount),count=safe(total?.count)
  if(amount===null||count===null)return reply({ok:false,code:'CARD_USAGE_INVALID_SUM'},409)
  items.push({key:'personal:'+account.account_id,label:account.label,scope:'personal',
   period,amount_jpy:amount,count,entries:entries.slice(0,200),truncated:count>200})
 }
 for(const grant of grants){
  const period=billingPeriodForMonth(month,closingDay(grant.closing_day,grant.card_name))
  if(!period)continue
  const predicate="e.payment_source=? AND e.type='expense' AND e.date>=? AND e.date<=? "+
   "AND (EXISTS(SELECT 1 FROM family_legacy_card_spends ls "+
   "WHERE ls.entry_id=e.id AND ls.actor_user_id=?) OR "+
   "EXISTS(SELECT 1 FROM family_shared_mutation_applied sm "+
   "WHERE sm.entry_id=e.id AND sm.requester_user_id=? AND sm.action='create'))"
  const args=[grant.card_name,period.start,period.end,user.user_id,user.user_id]
  const entries=(await db.prepare("SELECT e.id,e.date,e.merchant,e.category,e.amount "+
   "FROM entries e WHERE "+predicate+" ORDER BY e.date DESC,e.id DESC LIMIT 201")
   .bind(...args).all()).results||[]
  const total=await db.prepare("SELECT COUNT(*) count,COALESCE(SUM(e.amount),0) amount "+
   "FROM entries e WHERE "+predicate).bind(...args).first()
  const amount=safe(total?.amount),count=safe(total?.count)
  if(amount===null||count===null)return reply({ok:false,code:'CARD_USAGE_INVALID_SUM'},409)
  items.push({key:'shared:'+grant.card_name,label:grant.card_name,scope:'shared-own-usage',
   period,amount_jpy:amount,count,entries:entries.slice(0,200),truncated:count>200})
 }
 return reply({ok:true,scope:'personal-and-own-shared-usage',
  viewer_user_id:user.user_id,month,items,ledger_changed:false})
}
