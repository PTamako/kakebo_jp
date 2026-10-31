// Read-only review of scheduled fixed expenses. Never register a debit on app startup.
export function previewRecurringEntries(plans, entries, {today = new Date(), historicalMonths = 0, excluded = []} = {}) {
  const excludedKeys = new Set(excluded.map(item => item.planId + ':' + item.month))
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const earliest = new Date(current.getFullYear(), current.getMonth() - Math.max(0, Math.min(119, historicalMonths)), 1)
  const existing = new Map()
  const idempotency = new Set()
  for (const row of entries || []) {
    if (row.type !== 'expense') continue
    const key = [String(row.date).slice(0,7),row.merchant,row.payment_source || ''].join('|')
    existing.set(key, (existing.get(key) || 0) + 1)
    if (row.client_request_id) idempotency.add(row.client_request_id)
  }
  const candidates = []
  for (const plan of plans || []) {
    if (!plan.enabled || !/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.startMonth || '') ||
      !Number.isInteger(Number(plan.day)) || Number(plan.day) < 1 || Number(plan.day) > 31) continue
    const [sy,sm] = plan.startMonth.split('-').map(Number)
    const start = new Date(Math.max(new Date(sy,sm-1,1).getTime(),earliest.getTime()))
    for (let year = start.getFullYear(), month = start.getMonth() + 1, i=0;
      i < 120 && (year < current.getFullYear() || (year===current.getFullYear() && month <= current.getMonth()+1));
      i++,month++) {
      if (month===13){month=1;year++}
      const d = Math.min(Number(plan.day), new Date(year,month,0).getDate())
      const date = [year,String(month).padStart(2,'0'),String(d).padStart(2,'0')].join('-')
      const m = year+'-'+String(month).padStart(2,'0')
      if(date > [current.getFullYear(),String(current.getMonth()+1).padStart(2,'0'),String(current.getDate()).padStart(2,'0')].join('-')) continue
      if (excludedKeys.has(plan.id + ':' + m)) continue
      const requestId = 'recurring_'+plan.id.replace(/-/g,'')+'_'+m.replace('-','')
      if (idempotency.has(requestId)) continue
      const key = [m,plan.name,plan.paymentSource || ''].join('|')
      candidates.push({planId:plan.id,month:m,date,name:plan.name,amount:Number(plan.amount),
        paymentSource:plan.paymentSource,day:Number(plan.day),category:plan.category,startMonth:plan.startMonth,conflict:existing.has(key)})
    }
  }
  return candidates
}
export async function postApprovedRecurringEntries(api, approved, onConflict = () => {}) {
  let created=0,conflicts=0
  for(const row of approved) {
    const result=await api('recurring-post',{method:'POST',body:JSON.stringify({
      planId:row.planId,month:row.month,
      expected:{name:row.name,amount:row.amount,day:row.day,category:row.category,
        paymentSource:row.paymentSource || '',startMonth:row.startMonth,date:row.date}
    })})
    if(result.created) created++
    if(result.conflict) conflicts++
  }
  if(conflicts) onConflict(conflicts)
  return {created,conflicts}
}
