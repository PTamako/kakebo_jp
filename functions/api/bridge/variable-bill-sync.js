// Document Assistant may stage a reviewed *draft*, never a ledger entry.
// HMAC, actor allowlist and idempotency-key verification are performed by
// the existing /api/bridge/document-assistant boundary before these helpers.
const ok=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}})
const fail=(code,s=400)=>ok({ok:false,error:code},s)
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const month=/^20\d\d-(0[1-9]|1[0-2])$/
const isDate=d=>typeof d==='string'&&/^20\d\d-\d\d-\d\d$/.test(d)&&
 Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d
const isId=x=>typeof x==='string'&&x.length>=8&&x.length<=128&&/^[A-Za-z0-9_:-]+$/.test(x)
function onCycle(p,period){
 if(period<p.start_month)return false
 const a=p.start_month.split('-').map(Number),b=period.split('-').map(Number)
 return ((b[0]-a[0])*12+b[1]-a[1])%p.interval_months===0
}
export async function variableBillOptions(db){
 try{
  const r=await db.prepare("SELECT id,name,payment_source FROM variable_recurring_plans WHERE enabled=1 ORDER BY name LIMIT 60").all()
  return (r.results||[]).map(x=>({value:x.id,label:x.name+' · '+x.payment_source}))
 }catch(e){
  // Existing document-to-ledger integration must continue before the 0109
  // migration is applied. Other failures also fail closed with no bill list.
  return []
 }
}
export async function lookupVariableBill(db,sourceCandidate){
 if(!isId(sourceCandidate))return null
 try{
  const b=await db.prepare("SELECT plan_id,period_month,status FROM variable_recurring_bills WHERE source_candidate_id=? LIMIT 1")
   .bind(sourceCandidate).first()
  return b?{remote_id:'variable-bill:'+b.plan_id+':'+b.period_month,status:b.status}:null
 }catch{return null}
}
export async function importVariableBillDraft(db,requestPayload){
 const p=requestPayload?.payload,sourceCandidate=requestPayload?.source_candidate_id
 const sourceDocument=requestPayload?.source_document_id
 if(!p||!uuid.test(p.planId||'')||!month.test(p.periodMonth||'')||
  !Number.isSafeInteger(p.amount)||p.amount<1||p.amount>10000000||
  !isDate(p.billDate)||!isId(sourceCandidate)||!isId(sourceDocument)||
  typeof p.merchant!=='string'||!p.merchant.trim()||p.merchant.length>120)
  return fail('invalid_variable_bill',400)
 try{
  const existing=await lookupVariableBill(db,sourceCandidate)
  if(existing){
   return existing.remote_id==='variable-bill:'+p.planId+':'+p.periodMonth
    ?ok({ok:true,remote_id:existing.remote_id,reused:true,draft_only:true})
    :fail('variable_bill_candidate_conflict',409)
  }
  const plan=await db.prepare('SELECT start_month,interval_months,enabled FROM variable_recurring_plans WHERE id=?')
   .bind(p.planId).first()
  if(!plan||!plan.enabled||!onCycle(plan,p.periodMonth))
   return fail('variable_bill_plan_changed',409)
  // Never overwrite a manually reviewed draft, another source document or a
  // posted entry. The user can correct an imported draft in Kakeibo itself.
  const inserted=await db.prepare("INSERT INTO variable_recurring_bills "+
   "(plan_id,period_month,amount_jpy,bill_date,source_type,source_document_id,source_candidate_id,updated_at) "+
   "VALUES(?,?,?,?,'document',?,?,?) ON CONFLICT(plan_id,period_month) DO NOTHING")
   .bind(p.planId,p.periodMonth,p.amount,p.billDate,sourceDocument,sourceCandidate,Date.now()).run()
  if(inserted.meta?.changes!==1){
   const current=await lookupVariableBill(db,sourceCandidate)
   if(!current||current.remote_id!=='variable-bill:'+p.planId+':'+p.periodMonth)
    return fail('variable_bill_period_conflict',409)
  }
  return ok({ok:true,remote_id:'variable-bill:'+p.planId+':'+p.periodMonth,
    reused:inserted.meta?.changes!==1,draft_only:true})
 }catch(e){
  if(/no such table: variable_recurring_/i.test(String(e)))return fail('variable_bill_not_ready',503)
  return fail('variable_bill_draft_failed',503)
 }
}
