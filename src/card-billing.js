// Credit-card utilization includes purchases and card-funded asset transfers.
// Point rebates directly credited to a card reduce the same billing period.
export const isCardReward = (entry, cardName) =>
  entry?.type === 'income' && entry.category === 'ポイント還元' &&
  entry.transfer_target === 'credit:' + cardName

export const cardBilledAmount = entry =>
  Number(entry?.amount || 0) * (entry?.type === 'income' ? -1 : 1)

// Billing period calculation is shared with card management and test cases.
export function billingPeriodForMonth(closingMonth, closingDay) {
  const match=/^(\\d{4})-(\\d{2})$/.exec(String(closingMonth||''))
  if(!match || closingDay==null || closingDay==='')return null
  const year=Number(match[1]),month=Number(match[2])
  if(month<1||month>12)return null
  if(closingDay!=='末日' && (!Number.isInteger(Number(closingDay))||Number(closingDay)<1||Number(closingDay)>31))return null
  const last=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate()
  const cutoff=(y,m)=>closingDay==='末日'?last(y,m):Math.min(Number(closingDay),last(y,m))
  const previous=new Date(Date.UTC(year,month-2,1))
  const py=previous.getUTCFullYear(),pm=previous.getUTCMonth()+1
  const start=new Date(Date.UTC(py,pm-1,cutoff(py,pm)+1)).toISOString().slice(0,10)
  const end=[year,String(month).padStart(2,'0'),String(cutoff(year,month)).padStart(2,'0')].join('-')
  return {start,end}
}

export const isCardBilledEntry = (entry, period, cardName) => {
  if (!entry || !period || !cardName) return false
  if (!entry.date || entry.date < period.start || entry.date > period.end) return false
  if (isCardReward(entry, cardName)) return true
  if (entry.payment_source !== cardName) return false
  if (entry.type === 'expense') return true
  if (entry.type !== 'transfer') return false
  const target = String(entry.transfer_target || '')
  return target === 'sbi' || (target.startsWith('prepaid:') && target.length > 'prepaid:'.length)
}
