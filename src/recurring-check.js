// Run due recurring entries on app open. Existing records remain untouched.
export async function checkRecurringEntries(api) {
  // Normalized D1 plan records are the only source of recurring schedules.
  const plans = await api('recurring-plans')
  if (!Array.isArray(plans) || !plans.length) return 0
  const now = new Date()
  const today = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')
  let created = 0
  let conflicts = 0
  for (const p of plans) {
    if (!p || !p.enabled || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.startMonth || '') || !/^\d+$/.test(String(p.day)) || Number(p.day)<1 || Number(p.day)>31 || !p.id || !Number.isFinite(Number(p.amount)) || Number(p.amount)<=0) continue
    let [year,month] = p.startMonth.split('-').map(Number)
    for (let i=0;i<120 && (year<now.getFullYear() || (year===now.getFullYear() && month<=now.getMonth()+1));i++) {
      const last = new Date(year,month,0).getDate()
      const date = [year,String(month).padStart(2,'0'),String(Math.min(Number(p.day),last)).padStart(2,'0')].join('-')
      if (date<=today) {
        const result = await api('recurring-post',{method:'POST',body:JSON.stringify({planId:p.id,month:year+'-'+String(month).padStart(2,'0')})})
        if (result.created) created++
        if (result.conflict) conflicts++
      }
      month++;if(month===13){month=1;year++}
    }
  }
  if (conflicts) console.warn('既存の明細と一致する固定支出を自動追加しませんでした：'+conflicts+'件')
  return created
}
