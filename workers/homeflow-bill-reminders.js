// Private read-only Service Binding projection: one active HomeFlow owner per item.
// Never copies invoice data to HomeFlow or exposes a public Pages endpoint.
import {previewRecurringEntries} from '../src/recurring-check.js'
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}})
const date=x=>typeof x==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x)&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x
const userId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x)
const householdId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x)
const plusOne=x=>new Date(Date.parse(x+'T00:00:00Z')+86400000).toISOString().slice(0,10)
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[]
const view=p=>({id:p.id,name:p.name,amount:Number(p.amount??p.amount_jpy),
  paymentSource:p.payment_source,startMonth:p.start_month,enabled:true,
  day:Number(p.day||1),weekday:Number(p.weekday||0),scheduleType:p.schedule_type,
  workdayOnly:Number(p.workday_only||0)===1,weekdays:p.weekdays_json,
  monthDays:p.month_days_json,intervalMonths:Number(p.interval_months||1)})
export async function projectBillConfirmationReminders(db,{day,recipientUserId,householdId:hid}){
 if(!date(day)||!userId(recipientUserId)||!householdId(hid))return null
 const owner=await db.prepare(`SELECT role FROM homeflow_identity_links
  WHERE user_id=?1 AND household_id=?2 AND state='active'
    AND role IN ('owner','member') LIMIT 1`).bind(recipientUserId,hid).first()
 if(!owner)return {householdId:hid,recipientId:recipientUserId,items:[]}
 const due=plusOne(day),month=due.slice(0,7)
 const original=owner.role==='owner'
 const raw=original?await all(db,`SELECT id,name,amount,day,weekday,schedule_type,
   workday_only,weekdays_json,month_days_json,interval_months,payment_source,start_month
   FROM recurring_plans WHERE enabled=1 AND posting_mode='manual'
    AND start_month<=?1 AND NOT EXISTS(SELECT 1 FROM trash_items t
    WHERE t.item_type='recurring_plan' AND t.item_id=recurring_plans.id)
   ORDER BY id LIMIT 200`,month):
  await all(db,`SELECT plan_id AS id,name,amount_jpy,month_days_json,weekdays_json,
   schedule_type,interval_months,payment_source,start_month
   FROM family_member_fixed_cost_settings
   WHERE household_id=?1 AND owner_user_id=?2 AND enabled=1 AND start_month<=?3
   ORDER BY plan_id LIMIT 200`,hid,recipientUserId,month)
 const plans=raw.map(view)
 let items=[]
 if(plans.length){
  const [entries,monthSkips,dateSkips]=await Promise.all([
   // Legacy entries belong to the owner. Never treat an owner's same-name
   // expense as proof that a member has already confirmed a personal bill.
   // Only immutable, member-attributed posted finance evidence may consume
   // a member's recurring confirmation slot.
   original
    ?all(db,`SELECT date,merchant,payment_source,amount,type,client_request_id
      FROM entries WHERE type='expense' AND date>=?1 AND date<date(?1,'+1 month')
      ORDER BY date,id LIMIT 1500`,month+'-01')
    :all(db,`SELECT e.date,e.merchant,
      CASE WHEN e.family_account_id IS NOT NULL THEN 'personal:'||e.family_account_id
        WHEN EXISTS(SELECT 1 FROM family_legacy_card_spends s
          WHERE s.entry_id=e.id AND s.household_id=?2 AND s.actor_user_id=?3)
          THEN 'shared:'||e.payment_source
        WHEN e.payment_source IN ('','現金') THEN 'cash'
        ELSE e.payment_source END AS payment_source,
      e.amount,e.type,e.client_request_id FROM entries e
      WHERE e.type='expense' AND e.date>=?1 AND e.date<date(?1,'+1 month')
        AND (
          EXISTS(SELECT 1 FROM family_shared_mutation_applied a
            WHERE a.entry_id=e.id AND a.household_id=?2
              AND a.requester_user_id=?3 AND a.action='create')
          OR EXISTS(SELECT 1 FROM family_card_purchase_applied a
            WHERE a.entry_id=e.id AND a.household_id=?2 AND a.requester_user_id=?3)
          OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied a
            WHERE a.entry_id=e.id AND a.household_id=?2 AND a.requester_user_id=?3)
          OR EXISTS(SELECT 1 FROM family_legacy_card_spends a
            WHERE a.entry_id=e.id AND a.household_id=?2 AND a.actor_user_id=?3)
          OR EXISTS(SELECT 1 FROM family_recurring_execution_applied a
            WHERE a.target_entry_id=e.id AND a.household_id=?2 AND a.member_user_id=?3)
        )
      ORDER BY e.date,e.id LIMIT 1500`,month+'-01',hid,recipientUserId),
   original?all(db,'SELECT plan_id AS planId,month FROM recurring_candidate_exclusions WHERE month=? LIMIT 200',month):[],
   original?all(db,'SELECT plan_id AS planId,date FROM recurring_date_exclusions WHERE date=? LIMIT 200',due):[]
  ])
  items=previewRecurringEntries(plans,entries,{
   today:new Date(due+'T12:00:00Z'),historicalMonths:0,excluded:[...monthSkips,...dateSkips]
  }).filter(x=>x.date===due&&!x.conflict).map(x=>({
    kind:'fixed',planId:x.planId,name:x.name,dueOn:due,amountJpy:x.amount
  }))
 }
 if(original){
  const bills=await all(db,`SELECT b.plan_id AS planId,b.period_month AS periodMonth,
   p.name,p.payment_source AS paymentSource,b.amount_jpy AS amountJpy
   FROM variable_recurring_bills b JOIN variable_recurring_plans p ON p.id=b.plan_id
   WHERE p.enabled=1 AND b.status='draft' AND b.expense_date=?1
   ORDER BY b.plan_id,b.period_month LIMIT 200`,day)
  for(const bill of bills){
   const amt=Number(bill.amountJpy)
   const booked=Number.isSafeInteger(amt)&&amt>0?await db.prepare(`
     SELECT 1 FROM entries WHERE type='expense' AND merchant=?1
      AND COALESCE(payment_source,'')=?2 AND amount=?3
      AND date>=?4 AND date<date(?4,'+1 month') LIMIT 1`)
    .bind(bill.name,bill.paymentSource||'',amt,day.slice(0,7)+'-01').first():null
   if(!booked)items.push({kind:'variable',planId:bill.planId,name:bill.name,
     dueOn:day,periodMonth:bill.periodMonth,amountJpy:bill.amountJpy??null})
  }
 }
 return {householdId:hid,recipientId:recipientUserId,items:items.slice(0,200)}
}
export async function readBillConfirmationReminders(request,db){
 if(!db?.prepare)return json({error:'db_unavailable'},503)
 const q=new URL(request.url).searchParams,allowed=new Set(['day','recipientUserId','householdId'])
 if([...q.keys()].some(k=>!allowed.has(k)||q.getAll(k).length!==1))return json({error:'invalid_query'},400)
 const day=q.get('day'),recipientUserId=q.get('recipientUserId'),hid=q.get('householdId')
 if(!date(day)||!userId(recipientUserId)||!householdId(hid))return json({error:'invalid_query'},400)
 return json(await projectBillConfirmationReminders(db,{day,recipientUserId,householdId:hid}))
}
