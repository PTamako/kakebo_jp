// Full original statistical data model reused by the HomeFlow household UI.
// All queries aggregate authorized household ledger entries; no personal card
// names, account identifiers or individual portfolio balances are returned.
import {comparisonWindow,calculateSpendingComparison,nextCivilDay} from '../../../src/stats-period-comparison.js'
const json=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}})
const tokyoToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'})
const entryDateBounds=period=>{
 if(typeof period!=='string'||!/^\d{4}(?:-(0[1-9]|1[0-2]))?$/.test(period))return null
 const year=Number(period.slice(0,4))
 if(year<1||year>9998)return null
 const nextYear=String(year+1).padStart(4,'0')
 if(period.length===4)return {start:period+'-01-01',end:nextYear+'-01-01'}
 const m=Number(period.slice(5))
 return {start:period+'-01',end:m===12?nextYear+'-01-01':period.slice(0,5)+String(m+1).padStart(2,'0')+'-01'}
}
export async function familyHouseholdStats(env,url,user){
 const db=env.DB,month=url.searchParams.get('month')||''
 if(!user?.user_id||!user?.household_id)return json({code:'IDENTITY_REQUIRED'},401)
 try{
  // Only one additional, read-only aggregate query per visible statistics period.
        // Existing byDay data supplies the current period, avoiding a duplicate D1 scan.
        const periodComparison = async (rows, options) => {
          const window = comparisonWindow({ ...options, today: tokyoToday() })
          if (!window) return null
          const previous = await db.prepare(
            "SELECT COALESCE(SUM(amount), 0) total FROM entries WHERE type = 'expense' AND date >= ?1 AND date < ?2"
          ).bind(window.previousStart, nextCivilDay(window.previousEnd)).first()
          return calculateSpendingComparison(rows, previous?.total ?? 0, window)
        }
        const year = url.searchParams.get('year') || ''
        if (year) {
          if (!/^\d{4}$/.test(year)) return json({ error: '対象年の形式が正しくありません' }, 400)
          const {start:rangeStart,end:rangeEnd}=entryDateBounds(year)||{}
          if(!rangeStart)return json({error:'対象年の形式が正しくありません'},400)
          const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount, COUNT(*) recordCount FROM entries WHERE date>=?1 AND date<?2").bind(rangeStart,rangeEnd).first()
          const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
          const monthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY substr(date,1,7) ORDER BY month").bind(rangeStart,rangeEnd).all()
          const day = await db.prepare("SELECT substr(date,1,10) date, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY substr(date,1,10) ORDER BY date").bind(rangeStart,rangeEnd).all()
          const incomeMonthRows = await db.prepare("SELECT substr(date,1,7) month, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'income' GROUP BY substr(date,1,7) ORDER BY month").bind(rangeStart,rangeEnd).all()
          const incomeCategoryRows = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'income' GROUP BY category ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
          const incomeMonthCategoryRows = await db.prepare("SELECT substr(date,1,7) month, category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'income' GROUP BY substr(date,1,7), category ORDER BY month, amount DESC").bind(rangeStart,rangeEnd).all()
          const paymentRows = await db.prepare("SELECT CASE WHEN e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7 THEN 'ポイント払い' WHEN e.type='transfer' AND (TRIM(COALESCE(e.payment_source,''))='' OR e.payment_source IN ('その他','其他')) THEN '振替元未指定' WHEN TRIM(COALESCE(e.payment_source,'')) = '' OR e.payment_source = '現金' THEN '現金' WHEN p.stat_group='points' THEN 'ポイント払い' ELSE 'カード・電子決済' END method, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) count, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) amount, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) expenseAmount, COALESCE(SUM(CASE WHEN e.type='transfer' THEN e.amount ELSE 0 END),0) transferAmount, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) expenseCount, SUM(CASE WHEN e.type='transfer' THEN 1 ELSE 0 END) transferCount, COALESCE(SUM(CASE WHEN e.type='income' THEN e.amount ELSE 0 END),0) creditOffsetAmount, SUM(CASE WHEN e.type='income' THEN 1 ELSE 0 END) creditOffsetCount FROM entries e LEFT JOIN payment_sources p ON p.name=e.payment_source WHERE e.date>=?1 AND date<?2 AND (e.type IN ('expense','transfer') OR (e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7)) GROUP BY method ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
          const comparison = await periodComparison(day.results, { year })
          return json({ok:true,ledger_scope:'household',periodComparison: comparison, paymentMethods: paymentRows.results, year: Number(year), total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, recordCount: total.recordCount, byCategory: cat.results, byDay: day.results, byMonth: monthRows.results, incomeByMonth: incomeMonthRows.results, incomeByCategory: incomeCategoryRows.results, incomeByMonthCategory: incomeMonthCategoryRows.results })
        }
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({error:'集計月を確認してください'},400)
        const {start:rangeStart,end:rangeEnd}=entryDateBounds(month)||{}
        if(!rangeStart)return json({error:'集計月を確認してください'},400)
        const total = await db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END),0) t, SUM(CASE WHEN type = 'expense' THEN 1 ELSE 0 END) n, COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN type = 'transfer' THEN amount ELSE 0 END),0) transferTotal, SUM(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END) transferCount, COUNT(*) recordCount FROM entries WHERE date>=?1 AND date<?2").bind(rangeStart,rangeEnd).first()
        const cat = await db.prepare("SELECT category, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY category ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
        const day = await db.prepare("SELECT substr(date,1,10) date, SUM(amount) amount FROM entries WHERE date>=?1 AND date<?2 AND type = 'expense' GROUP BY substr(date,1,10) ORDER BY date").bind(rangeStart,rangeEnd).all()
        const paymentRows = await db.prepare("SELECT CASE WHEN e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7 THEN 'ポイント払い' WHEN e.type='transfer' AND (TRIM(COALESCE(e.payment_source,''))='' OR e.payment_source IN ('その他','其他')) THEN '振替元未指定' WHEN TRIM(COALESCE(e.payment_source,'')) = '' OR e.payment_source = '現金' THEN '現金' WHEN p.stat_group='points' THEN 'ポイント払い' ELSE 'カード・電子決済' END method, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) count, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) amount, COALESCE(SUM(CASE WHEN e.type='expense' THEN e.amount ELSE 0 END),0) expenseAmount, COALESCE(SUM(CASE WHEN e.type='transfer' THEN e.amount ELSE 0 END),0) transferAmount, SUM(CASE WHEN e.type='expense' THEN 1 ELSE 0 END) expenseCount, SUM(CASE WHEN e.type='transfer' THEN 1 ELSE 0 END) transferCount, COALESCE(SUM(CASE WHEN e.type='income' THEN e.amount ELSE 0 END),0) creditOffsetAmount, SUM(CASE WHEN e.type='income' THEN 1 ELSE 0 END) creditOffsetCount FROM entries e LEFT JOIN payment_sources p ON p.name=e.payment_source WHERE e.date>=?1 AND date<?2 AND (e.type IN ('expense','transfer') OR (e.type='income' AND e.category='ポイント還元' AND e.transfer_target LIKE 'credit:%' AND LENGTH(e.transfer_target)>7)) GROUP BY method ORDER BY amount DESC").bind(rangeStart,rangeEnd).all()
        const comparison = await periodComparison(day.results, { month })
        return json({ok:true,ledger_scope:'household',periodComparison: comparison, paymentMethods: paymentRows.results, total: total.t, count: total.n, income: total.income, transferTotal: total.transferTotal, transferCount: total.transferCount, recordCount: total.recordCount, byCategory: cat.results, byDay: day.results })
 }catch{
  return json({code:'FAMILY_STATISTICS_UNAVAILABLE'},503)
 }
}
