// Legacy owner-only variable bill endpoint. Mounted inside the authenticated
// /api catch-all AFTER verifyLegacyOwner/session validation. Never auto-post.
import {validateRegisteredPaymentSource} from './payment-source-validation.js'
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}})
const fail=(msg,status=400)=>json({error:msg},status)
const id=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const month=/^20\d{2}-(0[1-9]|1[0-2])$/
function date(x){
 return typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&
 new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x
}
const optionalDate=v=>v===null||v===''||date(v)
const interval=[1,2,3,6,12]
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const values=(o,k)=>Object.keys(o||{}).every(x=>k.includes(x))
async function parse(request){
 if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')return null
 try{const raw=await request.text();return raw.length<=2600?JSON.parse(raw):null}
 catch{return null}
}
function validPlan(x){
 return x&&values(x,['id','name','category','paymentSource','startMonth','intervalMonths','budgetJpy','enabled'])&&
 id.test(x.id)&&typeof x.name==='string'&&x.name.trim().length>=1&&x.name.trim().length<=120&&
 typeof x.category==='string'&&x.category.trim().length>=1&&x.category.length<=100&&
 typeof x.paymentSource==='string'&&x.paymentSource.length>=1&&x.paymentSource.length<=160&&
 month.test(x.startMonth)&&interval.includes(x.intervalMonths)&&
 (x.budgetJpy===null||x.budgetJpy===undefined||
  (Number.isSafeInteger(x.budgetJpy)&&x.budgetJpy>=1&&x.budgetJpy<=10000000))&&
 typeof x.enabled==='boolean'
}
function validBill(x){
 return x&&values(x,['periodMonth','amountJpy','billDate','expenseDate','paidDate',
  'serviceStart','serviceEnd'])&&month.test(x.periodMonth)&&
 (x.amountJpy===null||(Number.isSafeInteger(x.amountJpy)&&x.amountJpy>=1&&x.amountJpy<=10000000))&&
 [x.billDate,x.expenseDate,x.paidDate,x.serviceStart,x.serviceEnd].every(optionalDate)&&
 (!x.serviceStart||!x.serviceEnd||x.serviceStart<=x.serviceEnd)
}
function cycle(start,period,step){
 if(!month.test(period)||period<start)return false
 const a=start.split('-').map(Number),b=period.split('-').map(Number)
 return ((b[0]-a[0])*12+b[1]-a[1])%step===0
}
// Keep the billed service period in the final ledger detail, not just the draft.
// Never infer a missing period from a calendar month or a card-advance date.
export function variableBillLedgerNote(periodMonth,bill){
 const fragments=['変動固定費・対象月 '+periodMonth]
 const format=d=>d.replaceAll('-','/')
 const start=date(bill?.service_start)?bill.service_start:null
 const end=date(bill?.service_end)?bill.service_end:null
 if(start&&end&&start<=end)fragments.push('利用期間 '+format(start)+'〜'+format(end))
 else{
  if(start)fragments.push('利用開始 '+format(start))
  if(end)fragments.push('利用終了 '+format(end))
 }
 return fragments.join(' ／ ')
}
const fromRow=r=>({id:r.id,name:r.name,category:r.category,
 paymentSource:r.payment_source,startMonth:r.start_month,intervalMonths:r.interval_months,
 budgetJpy:r.budget_jpy,enabled:!!r.enabled})
const billRow=r=>({planId:r.plan_id,periodMonth:r.period_month,amountJpy:r.amount_jpy,
 billDate:r.bill_date,expenseDate:r.expense_date,paidDate:r.paid_date,
 serviceStart:r.service_start,serviceEnd:r.service_end,sourceType:r.source_type,
 sourceDocumentId:r.source_document_id,status:r.status,postedEntryId:r.posted_entry_id})
const planSql='SELECT * FROM variable_recurring_plans WHERE id=?'
export async function handleVariableRecurring(request,db,parts,{scheduledToday}={}){
 const method=request.method,pid=parts[1],action=parts[2]
 // Only an in-process trusted Cron caller can supply its Japan-local date.
 // The public API never obtains this value from request JSON or query params.
 const postingToday=date(scheduledToday)?scheduledToday:today()
 try{
  if(method==='GET'&&parts.length===1){
   const [p,b]=await db.batch([
    db.prepare('SELECT * FROM variable_recurring_plans ORDER BY enabled DESC,name LIMIT 150'),
    db.prepare('SELECT * FROM variable_recurring_bills ORDER BY period_month DESC LIMIT 800')
   ])
   return json({plans:(p.results||[]).map(fromRow),bills:(b.results||[]).map(billRow)})
  }
  if(method==='POST'&&parts.length===1){
   const x=await parse(request)
   if(!validPlan(x)||x.enabled!==true)return fail('変動費の設定を確認してください')
   const paymentError=await validateRegisteredPaymentSource(db,x.paymentSource)
   if(paymentError)return fail(paymentError.error,paymentError.status)
   const now=Date.now(),r=await db.prepare(
    'INSERT OR IGNORE INTO variable_recurring_plans '+
    '(id,name,category,payment_source,start_month,interval_months,budget_jpy,enabled,created_at,updated_at) '+
    'VALUES(?,?,?,?,?,?,?,1,?,?)'
   ).bind(x.id,x.name.trim(),x.category.trim(),x.paymentSource,
    x.startMonth,x.intervalMonths,x.budgetJpy??null,now,now).run()
   if(!r.meta?.changes)return fail('すでに登録されている設定です',409)
   return json({ok:true},201)
  }
  if(!id.test(pid||''))return fail('対象の固定費を確認してください',404)
  const p=await db.prepare(planSql).bind(pid).first()
  if(!p)return fail('固定費が見つかりません',404)
  if(method==='PUT'&&parts.length===2){
   const x=await parse(request)
   if(!validPlan(x)||x.id!==pid)return fail('変動費の設定を確認してください')
   if(!x.enabled){
    await db.prepare('UPDATE variable_recurring_plans SET enabled=0,updated_at=? WHERE id=?')
     .bind(Date.now(),pid).run()
    return json({ok:true})
   }
   if((x.startMonth!==p.start_month||x.intervalMonths!==p.interval_months)&&
      (await db.prepare('SELECT 1 FROM variable_recurring_bills WHERE plan_id=? LIMIT 1')
       .bind(pid).first()))
    return fail('過去の請求がある設定の開始月・周期は変更できません',409)
   const paymentError=await validateRegisteredPaymentSource(db,x.paymentSource)
   if(paymentError)return fail(paymentError.error,paymentError.status)
   await db.prepare('UPDATE variable_recurring_plans SET name=?,category=?,payment_source=?,'+
    'start_month=?,interval_months=?,budget_jpy=?,enabled=1,updated_at=? WHERE id=?')
    .bind(x.name.trim(),x.category.trim(),x.paymentSource,x.startMonth,
     x.intervalMonths,x.budgetJpy??null,Date.now(),pid).run()
   return json({ok:true})
  }
  if(method==='POST'&&action==='bill'&&parts.length===3){
   if(!p.enabled)return fail('停止した固定費は編集できません',409)
   const x=await parse(request)
   if(!validBill(x)||!cycle(p.start_month,x.periodMonth,p.interval_months))
    return fail('請求月・金額・日付を確認してください')
   const old=await db.prepare('SELECT status,source_type FROM variable_recurring_bills WHERE plan_id=? AND period_month=?')
    .bind(pid,x.periodMonth).first()
   if(old?.status==='posted')return fail('記帳済みの請求は変更できません',409)
   await db.prepare('INSERT INTO variable_recurring_bills '+
    '(plan_id,period_month,amount_jpy,bill_date,expense_date,paid_date,service_start,service_end,updated_at) '+
    'VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(plan_id,period_month) DO UPDATE SET '+
    'amount_jpy=excluded.amount_jpy,bill_date=excluded.bill_date,'+
    'expense_date=excluded.expense_date,paid_date=excluded.paid_date,'+
    'service_start=excluded.service_start,service_end=excluded.service_end,updated_at=excluded.updated_at '+
    "WHERE variable_recurring_bills.status='draft'")
    .bind(pid,x.periodMonth,x.amountJpy,x.billDate||null,x.expenseDate||null,
     x.paidDate||null,x.serviceStart||null,x.serviceEnd||null,Date.now()).run()
   return json({ok:true,status:'draft'})
  }
  if(method==='POST'&&action==='confirm'&&parts.length===3){
   const x=await parse(request)
   if(!x||!values(x,['periodMonth'])||!month.test(x.periodMonth))return fail('対象月を確認してください')
   const b=await db.prepare('SELECT * FROM variable_recurring_bills WHERE plan_id=? AND period_month=?')
    .bind(pid,x.periodMonth).first()
   if(!b)return fail('金額がまだ登録されていません',409)
   const reqId='varrec_'+pid.replaceAll('-','')+'_'+x.periodMonth.replace('-','')
   const known=await db.prepare('SELECT id FROM entries WHERE client_request_id=?').bind(reqId).first()
   if(b.status==='posted')return json({ok:true,posted:true,alreadyPosted:true,entryId:b.posted_entry_id})
   if(known)return fail('既に明細が存在します。重複を確認してください',409)
   if(!p.enabled||!cycle(p.start_month,x.periodMonth,p.interval_months)||
    !Number.isSafeInteger(b.amount_jpy)||b.amount_jpy<1||!date(b.expense_date)||
    b.expense_date>postingToday)return fail('金額・実際の利用日を確認してください',409)
   // Existing manually entered or document-assistant expenses are authoritative.
   // Never silently double-post the same merchant, payment source and amount.
   const conflict=await db.prepare("SELECT id FROM entries WHERE type='expense' "+
    'AND merchant=? AND COALESCE(payment_source,?)=? AND amount=? '+
    "AND date>=? AND date<date(?,'+1 month') LIMIT 1")
    .bind(p.name,'',p.payment_source,b.amount_jpy,b.expense_date.slice(0,7)+'-01',b.expense_date.slice(0,7)+'-01').first()
   if(conflict)return json({ok:false,error:'同じ月の明細が存在します。文書助手や手入力の記録を確認してください',
    conflictEntryId:conflict.id},409)
   const stamped=Date.now()
   const ledgerNote=variableBillLedgerNote(x.periodMonth,b)
   const result=await db.batch([
    db.prepare('INSERT OR IGNORE INTO entries '+
     '(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) '+
     "SELECT ?, '', ?, ?, ?, ?, '', 'expense', ?, ? WHERE EXISTS "+
     "(SELECT 1 FROM variable_recurring_bills WHERE plan_id=? AND period_month=? AND status='draft') ")
     .bind(b.expense_date,b.amount_jpy,p.category,p.name,
      ledgerNote,reqId,p.payment_source,pid,x.periodMonth),
    db.prepare("UPDATE variable_recurring_bills SET status='posted',"+
     'posted_entry_id=(SELECT id FROM entries WHERE client_request_id=?),updated_at=? '+
     "WHERE plan_id=? AND period_month=? AND status='draft' "+
     'AND EXISTS(SELECT 1 FROM entries WHERE client_request_id=?)')
     .bind(reqId,stamped,pid,x.periodMonth,reqId)
   ])
   if(result[0].meta?.changes!==1||result[1].meta?.changes!==1)
    return fail('保存結果を確認できません。明細を再読込してください',409)
   const posted=await db.prepare('SELECT posted_entry_id FROM variable_recurring_bills WHERE plan_id=? AND period_month=?')
    .bind(pid,x.periodMonth).first()
   return json({ok:true,posted:true,entryId:posted?.posted_entry_id})
  }
  return fail('対象が見つかりません',404)
 }catch(e){
  if(/no such table: variable_recurring_/i.test(String(e)))return fail('変動費用のDB更新が必要です',503)
  return fail('変動費を保存できませんでした',503)
 }
}
