// Run due recurring entries on app open. Existing records remain untouched.
export async function checkRecurringEntries(api) {
  // Normalized D1 plan records are the only source of recurring schedules.\n  const plans = await api('recurring-plans')\n  if (!Array.isArray(plans) || !plans.length) return 0
  const now = new Date()
  const today = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')
  let checked = 0
  for (const p of plans) {
    if (!p || !p.enabled || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.startMonth || '') || !/^\d+$/.test(String(p.day)) || Number(p.day)<1 || Number(p.day)>31 || !p.id || !Number.isFinite(Number(p.amount)) || Number(p.amount)<=0) continue
    let [year,month] = p.startMonth.split('-').map(Number)
    for (let i=0;i<120 && (year<now.getFullYear() || (year===now.getFullYear() && month<=now.getMonth()+1));i++) {
      const last = new Date(year,month,0).getDate()
      const date = [year,String(month).padStart(2,'0'),String(Math.min(Number(p.day),last)).padStart(2,'0')].join('-')
      if (date<=today) {
        const clientRequestId = 'recurring_'+String(p.id).replace(/-/g,'')+'_'+year+String(month).padStart(2,'0')
        await api('entries',{method:'POST',body:JSON.stringify({date,time:'',amount:Number(p.amount),type:'expense',category:p.category||'その他',merchant:p.name,note:'毎月の固定支出（自動記録）',paymentSource:p.paymentSource||'',clientRequestId})})
        checked++
      }
      month++;if(month===13){month=1;year++}
    }
  }
  return checked
}
