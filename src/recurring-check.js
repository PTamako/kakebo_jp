import { recurringDatesInMonth, recurringRequestId } from './recurring-posting.js'

// Read-only schedule preview. All writes require explicit confirmation.
export function previewRecurringEntries(plans,entries,{today=new Date(),historicalMonths=0,excluded=[]}={}) {
  const excludedKeys=new Set(excluded.flatMap(x=>[x.planId+':'+(x.date||x.month)]))
  const current=new Date(today.getFullYear(),today.getMonth(),today.getDate())
  const currentKey=[current.getFullYear(),String(current.getMonth()+1).padStart(2,'0'),String(current.getDate()).padStart(2,'0')].join('-')
  const earliest=new Date(current.getFullYear(),current.getMonth()-Math.max(0,Math.min(119,historicalMonths)),1)
  const existing=new Set(),idempotency=new Set()
  for(const entry of entries||[]){
    if(entry.type!=='expense')continue
    const date=String(entry.date||'').slice(0,10)
    const base=[entry.merchant,entry.payment_source||''].join('|')
    existing.add(date+'|'+base)
    existing.add(date.slice(0,7)+'|'+base)
    if(entry.client_request_id)idempotency.add(entry.client_request_id)
  }
  const candidates=[]
  for(const plan of plans||[]){
    if(!plan.enabled || !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.startMonth||''))continue
    const scheduleType=plan.scheduleType||'monthly'
    if(!['monthly','weekly'].includes(scheduleType))continue
    const [sy,sm]=plan.startMonth.split('-').map(Number)
    const start=new Date(Math.max(new Date(sy,sm-1,1).getTime(),earliest.getTime()))
    for(let year=start.getFullYear(),month=start.getMonth()+1,i=0;
      i<120 && (year<current.getFullYear() || (year===current.getFullYear()&&month<=current.getMonth()+1));
      i++,month++){
      if(month===13){month=1;year++}
      const m=year+'-'+String(month).padStart(2,'0')
      for(const date of recurringDatesInMonth(m,{scheduleType,day:Number(plan.day),weekday:Number(plan.weekday||0)})){
        if(date>currentKey || excludedKeys.has(plan.id+':'+m) || excludedKeys.has(plan.id+':'+date))continue
        const requestId=recurringRequestId(plan.id,scheduleType==='weekly'?date:m)
        if(idempotency.has(requestId))continue
        const base=[plan.name,plan.paymentSource||''].join('|')
        const conflictKey=(scheduleType==='weekly'?date:m)+'|'+base
        candidates.push({planId:plan.id,month:m,date,name:plan.name,amount:Number(plan.amount),
          paymentSource:plan.paymentSource,day:Number(plan.day),scheduleType,weekday:Number(plan.weekday||0),
          category:plan.category,startMonth:plan.startMonth,conflict:existing.has(conflictKey)})
      }
    }
  }
  return candidates
}
export async function postApprovedRecurringEntries(api,approved,onConflict=()=>{}) {
  let created=0,conflicts=0
  for(const row of approved){
    const result=await api('recurring-post',{method:'POST',body:JSON.stringify({
      planId:row.planId,month:row.month,
      expected:{name:row.name,amount:row.amount,day:row.day,category:row.category,
        paymentSource:row.paymentSource||'',startMonth:row.startMonth,date:row.date,
        scheduleType:row.scheduleType||'monthly',weekday:row.weekday||0}
    })})
    if(result.created)created++
    if(result.conflict)conflicts++
  }
  if(conflicts)onConflict(conflicts)
  return {created,conflicts}
}
