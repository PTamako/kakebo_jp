// Pure view-model adaptation for the existing StatisticsPage.vue.
// Both users render the same component, but the member uses family-scoped
// aggregate endpoints and never the original owner's legacy session.
import {ref,computed} from 'vue'
import {startOfSundayWeek} from './calendar-week.js'
import {spendingAveragesByDayType,spendingAverageOnExpenseDays,japanTodayKey} from './spending-day-type.js'
import {annualExpenseAverageByRecordedMonth} from './annual-monthly-average.js'
import {highestSpendingRatioMonth} from './stats-ratio-peak.js'
import {ICON_LIBRARY} from './icon-library.js'
import puppyWorried from './assets/puppy-worried.gif'
import puppyCrying from './assets/puppy-crying.jpg'
export function makeFamilyStatsContext({tab,month,selectedYear,stats,annualStats,entryType}){
 const statsPeriod=ref('month'),selectedRatioMonth=ref('')
 const input=ref('')
 const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
 const categoryIconPath=()=>ICON_LIBRARY.find(x=>x.id==='other')?.path||''
 const categoryLabel=x=>x||'その他'
 const dayRows=computed(()=>[...(stats.value?.byDay||[])].sort((a,b)=>a.date.localeCompare(b.date)))
 const japanToday=ref(japanTodayKey(new Date()))
 const resetMonth=()=>{month.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7)}
 const openCategoryDetails=(category,type,period)=>{if(type==='income'||type==='expense'||type==='transfer')entryType.value=type
  if(period==='year')month.value=String(selectedYear.value)+'-01'
  tab.value='list'}
 const openPaymentMethodDetails=()=>{entryType.value='all';tab.value='list'}
const maxCat = computed(() => Math.max(1, ...(stats.value?.byCategory || []).map(c => c.amount)))
const maxDay = computed(() => Math.max(1, ...(stats.value?.byDay || []).map(c => c.amount)))
const categoryRows = computed(() => [...(stats.value?.byCategory || [])].sort((a, b) => b.amount - a.amount))
const pieGradient = (rows, colors, selected) => {
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.amount) || 0), 0)
  if (!total) return 'conic-gradient(var(--line) 0deg 360deg)'
  let cursor = 0
  return 'conic-gradient(' + rows.map((row, i) => {
    const start = cursor
    cursor += Math.max(0, Number(row.amount) || 0) / total * 360
    const color = colors[i % colors.length]
    return (selected && row.category !== selected ? `color-mix(in srgb, ${color} 42%, var(--card))` : color) + ' ' + start + 'deg ' + cursor + 'deg'
  }).join(', ') + ')'
}
const expensePalette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)', 'var(--chart-9)', 'var(--chart-10)']
const selectedDonut = ref({ month: '', year: '' })
const donutRows = period => period === 'month' ? categoryRows.value : (annualStats.value?.byCategory || [])
const donutSelected = period => donutRows(period).find(c => c.category === selectedDonut.value[period]) || donutRows(period)[0] || null
const donutTotal = period => donutRows(period).reduce((n, c) => n + Number(c.amount || 0), 0)
const donutPercent = period => donutSelected(period) && donutTotal(period) ? (Number(donutSelected(period).amount) / donutTotal(period) * 100).toFixed(1) : '0.0'
const chooseDonut = (period, category) => { selectedDonut.value = { ...selectedDonut.value, [period]: category } }
const selectDonutSlice = (event, period) => {
  const rows = donutRows(period)
  const total = donutTotal(period)
  if (!total) return
  const rect = event.currentTarget.getBoundingClientRect()
  const x = event.clientX - rect.left - rect.width / 2
  const y = event.clientY - rect.top - rect.height / 2
  const radius = Math.hypot(x, y)
  if (radius < rect.width * 0.345 || radius > rect.width * 0.5) return
  const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360
  let cumulative = 0
  for (const row of rows) {
    cumulative += Math.max(0, Number(row.amount) || 0) / total * 360
    if (angle <= cumulative + 0.000001) { chooseDonut(period, row.category); return }
  }
}
const monthlyCategoryPie = computed(() => pieGradient(categoryRows.value, expensePalette, donutSelected('month')?.category))
const annualExpensePie = computed(() => pieGradient(annualStats.value?.byCategory || [], expensePalette, donutSelected('year')?.category))


const weekRows = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const monthStart = new Date(year, monthNumber - 1, 1)
  const monthEnd = new Date(year, monthNumber, 0)
  const groups = new Map()
  for (const day of dayRows.value) {
    const date = new Date(day.date + 'T12:00:00')
    const sunday = startOfSundayWeek(date)
    const key = sunday.toLocaleDateString('sv-SE')
    const current = groups.get(key) || { start: key, end: '', amount: 0, days: 0 }
    current.amount += Number(day.amount || 0)
    current.days += 1
    groups.set(key, current)
  }
  const weeks = []
  const cursor = startOfSundayWeek(monthStart)
  while (cursor <= monthEnd) {
    const sunday = new Date(cursor)
    const saturday = new Date(cursor)
    saturday.setDate(saturday.getDate() + 6)
    const clippedStart = sunday < monthStart ? monthStart : sunday
    const clippedEnd = saturday > monthEnd ? monthEnd : saturday
    const key = sunday.toLocaleDateString('sv-SE')
    const group = groups.get(key)
    weeks.push({
      key,
      label: `${clippedStart.getMonth() + 1}/${clippedStart.getDate()}–${clippedEnd.getMonth() + 1}/${clippedEnd.getDate()}`,
      amount: group?.amount || 0,
      days: group?.days || 0
    })
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
})
const maxWeek = computed(() => Math.max(1, ...weekRows.value.map(w => w.amount)))
const liveNow = ref(new Date())
const japanToday = computed(() => japanTodayKey(liveNow.value))
const monthlyDayTypeAverages = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const lastDay = String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')
  return spendingAveragesByDayType(stats.value?.byDay, month.value + '-01', month.value + '-' + lastDay, japanToday.value)
})
// The right-hand monthly metric counts only actual spending days, independently
// from the weekday/holiday averages that include all elapsed calendar days.
const averageDailySummary = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const lastDay = String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')
  return spendingAverageOnExpenseDays(
    stats.value?.byDay, month.value + '-01', month.value + '-' + lastDay, japanToday.value,
  )
})
const averageDaily = computed(() => averageDailySummary.value.average)
const annualDayTypeAverages = computed(() => spendingAveragesByDayType(
  annualStats.value?.byDay,
  selectedYear.value + '-01-01',
  selectedYear.value + '-12-31',
  japanToday.value,
  { recordedMonthsOnly: true },
))

const monthLabel = computed(() => {
  const [y, m] = month.value.split('-')
  return `${y}年${Number(m)}月`
})
const yearMonthRows = computed(() => {
  const expenses = new Map((annualStats.value?.byMonth || []).map(item => [item.month, Number(item.amount)]))
  const incomes = new Map((annualStats.value?.incomeByMonth || []).map(item => [item.month, Number(item.amount)]))
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${selectedYear.value}-${String(i + 1).padStart(2, '0')}`
    return { month: key, label: `${i + 1}月`, amount: expenses.get(key) || 0, income: incomes.get(key) || 0 }
  })
})
const expenseTrendPoints = computed(() => {
  const max = Math.max(1, ...yearMonthRows.value.map(item => item.amount))
  return yearMonthRows.value.map((item, i) => ({ ...item, x: 16 + i * 26.18, y: 108 - item.amount / max * 82 }))
})
const expenseTrendLine = computed(() => expenseTrendPoints.value.map(point => `${point.x},${point.y}`).join(' '))
const expenseTrendArea = computed(() => expenseTrendPoints.value.length
  ? `16,108 ${expenseTrendLine.value} 304,108`
  : '')
const incomeTrendPoints = computed(() => {
  const max = Math.max(1, ...yearMonthRows.value.map(item => item.income))
  return yearMonthRows.value.map((item, i) => ({ ...item, x: 16 + i * 26.18, y: 108 - item.income / max * 82 }))
})
const incomeTrendLine = computed(() => incomeTrendPoints.value.map(point => `${point.x},${point.y}`).join(' '))
const ratioTrendPoints = computed(() => yearMonthRows.value.map((item, i) => {
  const ratio = item.income > 0 ? item.amount / item.income : null
  return { ...item, ratio, x: 16 + i * 26.18, y: ratio === null ? null : 108 - Math.min(1.5, ratio) / 1.5 * 82 }
}))
const ratioTrendSegments = computed(() => {
  const segments = []
  let segment = []
  for (const point of ratioTrendPoints.value) {
    if (point.ratio === null) {
      if (segment.length > 1) segments.push(segment.map(p => p.x + ',' + p.y).join(' '))
      segment = []
    } else segment.push(point)
  }
  if (segment.length > 1) segments.push(segment.map(p => p.x + ',' + p.y).join(' '))
  return segments
})
const incomeTrendMax = computed(() => Math.max(0, ...yearMonthRows.value.map(item => item.income)))
const highestIncomeMonth = computed(() => yearMonthRows.value.reduce((best, item) => item.income > best.income ? item : best, { month: '', label: 'データなし', income: 0 }))
const highestRatioMonth = computed(() => highestSpendingRatioMonth(ratioTrendPoints.value))
const ratioTrendMax = computed(() => highestRatioMonth.value?.ratio ?? 0)
const maxYearMonth = computed(() => Math.max(1, ...yearMonthRows.value.map(item => item.amount)))
const highestSpendMonth = computed(() => yearMonthRows.value.reduce((best, item) => item.amount > best.amount ? item : best, { month: '', label: 'データなし', amount: 0 }))
const annualAverageSummary = computed(() => annualExpenseAverageByRecordedMonth(annualStats.value, selectedYear.value))
const annualIncomeCategories = computed(() => (annualStats.value?.incomeByCategory || [])
  .map(item => ({ category: item.category || '其他收入', amount: Number(item.amount || 0) }))
  .sort((a, b) => b.amount - a.amount))
const maxAnnualIncomeCategory = computed(() => Math.max(1, ...annualIncomeCategories.value.map(item => item.amount)))
function openMonthDetails(point,type){
 if(!point?.month||!['income','expense'].includes(type))return
 month.value=point.month;entryType.value=type;tab.value='list'
}
function selectRatioMonth(point) {
  // Tapping the currently selected month again closes its breakdown.
  selectedRatioMonth.value = selectedRatioMonth.value === point.month ? '' : point.month
}
const selectedRatioMonthRow = computed(() => yearMonthRows.value.find(item => item.month === selectedRatioMonth.value) || null)
const selectedRatio = computed(() => selectedRatioMonthRow.value && selectedRatioMonthRow.value.income > 0 ? selectedRatioMonthRow.value.amount / selectedRatioMonthRow.value.income : null)
const monthlyRatio = computed(() => Number(stats.value?.income || 0) > 0 ? Number(stats.value?.total || 0) / Number(stats.value.income) : null)
const annualRatio = computed(() => Number(annualStats.value?.income || 0) > 0 ? Number(annualStats.value?.total || 0) / Number(annualStats.value.income) : null)
const pigState = ratio => ratio === null ? 'empty' : ratio >= 1 ? 'broken' : ratio >= .8 ? 'sweating' : 'happy'
// Statistical illustrations are bundled local assets; do not rely on image CDNs.
const puppyExpression = ratio => ratio >= 1 ? puppyCrying : puppyWorried
function puppyFallback(event) { event.target.onerror = null; event.target.src = puppyWorried }
const pigLabel = ratio => ratio === null ? 'お財布、収入の登場を待機中…🪙' : ratio >= 1 ? 'お財布が大泣き！収入より使ってるよ💸' : ratio >= .8 ? 'ちょっと使いすぎ？お財布に汗が…💦' : 'お財布、ごきげん♪ この調子！'
const ratioLabel = ratio => ratio === null ? '収入データなし' : Math.round(ratio * 100) + '%'


 return {tab,month,selectedYear,stats,annualStats,statsPeriod,selectedRatioMonth,input,
  categoryIconPath,categoryLabel,yen,categoryRows,expensePalette,donutSelected,
  donutPercent,selectDonutSlice,monthlyCategoryPie,annualExpensePie,
  openPaymentMethodDetails,openCategoryDetails,weekRows,maxWeek,averageDaily,
  averageDailySummary,yearMonthRows,expenseTrendPoints,expenseTrendLine,
  expenseTrendArea,incomeTrendPoints,incomeTrendLine,ratioTrendPoints,
  ratioTrendSegments,incomeTrendMax,highestIncomeMonth,ratioTrendMax,
  highestRatioMonth,highestSpendMonth,annualAverageSummary,
  annualIncomeCategories,maxAnnualIncomeCategory,monthlyDayTypeAverages,
  annualDayTypeAverages,openMonthDetails,selectRatioMonth,selectedRatioMonthRow,
  selectedRatio,monthLabel,monthlyRatio,annualRatio,pigState,puppyExpression,
  puppyFallback,pigLabel,ratioLabel,resetMonth}
}
