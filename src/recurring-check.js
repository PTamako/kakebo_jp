import { recurringDatesInMonth, recurringRequestId } from './recurring-posting.js'

// Read-only schedule preview. All writes require explicit confirmation.
export function previewRecurringEntries(plans,entries,{today=new Date(),historicalMonths=0,excluded=[],previewDaysAhead=0}={}) {
  const excludedKeys=new Set(excluded.flatMap(x=>[x.planId+':'+(x.date||x.month)]))
  const current=new Date(today.getFullYear(),today.getMonth(),today.getDate())
  const currentKey=[current.getFullYear(),String(current.getMonth()+1).padStart(2,'0'),String(current.getDate()).padStart(2,'0')].join('-')
  // Only the very next calendar day may be previewed (never auto-registered).
  const end=new Date(current.getFullYear(),current.getMonth(),current.getDate()+(previewDaysAhead===1?1:0))
  const endKey=[end.getFullYear(),String(end.getMonth()+1).padStart(2,'0'),String(end.getDate()).padStart(2,'0')].join('-')
  const earliest=new Date(current.getFullYear(),current.getMonth()-Math.max(0,Math.min(119,historicalMonths)),1)
  const manualCounts=new Map(),idempotency=new Set()
  for(const entry of entries||[]){
    if(entry.type!=='expense')continue
    const date=String(entry.date||'').slice(0,10)
    if(entry.client_request_id)idempotency.add(entry.client_request_id)
    // A confirmed occurrence belongs to its own plan, not every other plan
    // with the same merchant name. Direct manual entries can claim one slot.
    if(String(entry.client_request_id||'').startsWith('recurring_'))continue
    const base=[entry.merchant,entry.payment_source||''].join('|')
    for(const period of [date,date.slice(0,7)]){
      const key=period+'|'+base
      manualCounts.set(key,(manualCounts.get(key)||0)+1)
    }
  }
  const candidates=[]
  for(const plan of plans||[]){
    if(!plan.enabled || !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.startMonth||''))continue
    const scheduleType=plan.scheduleType||'monthly'
    if(!['monthly','weekly','workday'].includes(scheduleType))continue
    const [sy,sm]=plan.startMonth.split('-').map(Number)
    const start=new Date(Math.max(new Date(sy,sm-1,1).getTime(),earliest.getTime()))
    for(let year=start.getFullYear(),month=start.getMonth()+1,i=0;
      i<121 && (year<end.getFullYear() || (year===end.getFullYear()&&month<=end.getMonth()+1));
      i++,month++){
      if(month===13){month=1;year++}
      const m=year+'-'+String(month).padStart(2,'0')
      for(const date of recurringDatesInMonth(m,{scheduleType,day:Number(plan.day),weekday:Number(plan.weekday||0)})){
        if(date>endKey || excludedKeys.has(plan.id+':'+m) || excludedKeys.has(plan.id+':'+date))continue
        const requestId=recurringRequestId(plan.id,scheduleType==='monthly'?m:date)
        if(idempotency.has(requestId))continue
        const base=[plan.name,plan.paymentSource||''].join('|')
        const conflictKey=(scheduleType==='monthly'?m:date)+'|'+base
        candidates.push({planId:plan.id,month:m,date,name:plan.name,amount:Number(plan.amount),
          paymentSource:plan.paymentSource,day:Number(plan.day),scheduleType,weekday:Number(plan.weekday||0),
          category:plan.category,startMonth:plan.startMonth,conflictKey,conflict:false,upcoming:date>currentKey})
      }
    }
  }
  // Allocate identical manually entered expenses deterministically instead of
  // falsely marking ALL matching recurring plans as already paid.
  const seenSlots=new Map()
  for(const row of [...candidates].sort((a,b)=>a.date.localeCompare(b.date)||a.planId.localeCompare(b.planId))){
    const used=seenSlots.get(row.conflictKey)||0
    row.conflict=used<(manualCounts.get(row.conflictKey)||0)
    seenSlots.set(row.conflictKey,used+1)
  }
  return candidates.map(({conflictKey,...row})=>row)
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
