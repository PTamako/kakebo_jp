<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { parseEntries, ocrImage, CATEGORIES as BASE_CATEGORIES } from './parse.js'

const tab = ref('add')
const theme = ref(localStorage.getItem('kakeibo-theme') || 'pink')
const themes = [{ id: 'pink', label: 'ピンク', color: '#d96f91' }, { id: 'blue', label: 'ブルー', color: '#78a9d6' }, { id: 'yellow', label: 'イエロー', color: '#d9b957' }, { id: 'green', label: 'グリーン', color: '#78ad91' }]
function setTheme(value) { theme.value = value; localStorage.setItem('kakeibo-theme', value) }
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const month = ref(currentMonth())
function resetMonth() { month.value = currentMonth() }
const selectedYear = ref(new Date().getFullYear())
const annualStats = ref(null)
const selectedIncomeMonth = ref('')
const selectedRatioMonth = ref('')
const rules = ref([]), entries = ref([]), stats = ref(null), categories = ref([...BASE_CATEGORIES])
const input = ref(''), busy = ref(''), msg = ref('')
const forms = ref([])
const editingEntry = ref(null)
const INCOME_CATEGORIES = ['工资', '奖金', '副业', '老公生活费', '父母赠与', '亲友赠与', '退款', '其他收入']
const CATEGORY_ICONS = { '餐饮':'🍜', '饮食料品':'🛒', '日用品':'🧻', '交通':'🚃', '购物':'🛍️', '居住':'🏠', '医疗':'💊', '娱乐':'🎮', '宠物':'🐱', '其他':'✨', '工资':'💴', '奖金':'🎁', '副业':'💻', '老公生活费':'🏠', '父母赠与':'💝', '亲友赠与':'🎁', '退款':'↩️', '其他收入':'🌷', '投資・資産移動':'🔄' }
const categoryIcon = name => CATEGORY_ICONS[name] || '🧾'
const CATEGORY_LABELS = { '投資・資産移動':'資産移動', '餐饮':'外食', '饮食料品':'食料品', '日用品':'日用品', '交通':'交通費', '购物':'買い物', '居住':'住居費', '医疗':'医療費', '娱乐':'娯楽', '宠物':'ペット', '其他':'その他', '工资':'給与', '奖金':'賞与', '副业':'副業', '老公生活费':'配偶者からの生活費', '父母赠与':'親からの贈与', '亲友赠与':'親族・友人からの贈与', '退款':'返金', '其他收入':'その他の収入' }
const categoryLabel = name => CATEGORY_LABELS[name] || name

const token = ref(localStorage.getItem('token') || '')

async function api(path, opt = {}) {
  const r = await fetch('/api/' + path, {
    ...opt, headers: { 'content-type': 'application/json', 'x-token': token.value }
  })
  if (r.status === 401) {
    const t = prompt('アクセスコードを入力してください')
    if (t) { token.value = t; localStorage.setItem('token', t); return api(path, opt) }
    throw new Error('アクセスコードが必要です')
  }
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'リクエストに失敗しました')
  return d
}
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
const flash = t => { msg.value = t; setTimeout(() => (msg.value = ''), 3000) }

async function load() {
  try {
    if (!rules.value.length) rules.value = await api('rules')
    categories.value = await api('categories')
    entries.value = await api('entries?month=' + month.value)
    stats.value = await api('stats?month=' + month.value)
  } catch (e) { flash(e.message) }
}
async function loadYear() {
  try { annualStats.value = await api('stats?year=' + selectedYear.value) }
  catch (e) { flash('年間集計の読み込みに失敗しました：' + e.message) }
}
onMounted(() => { load(); loadYear(); loadInvestments(); loadTransfers() })
watch(month, async () => { selectedDay.value = ''; swipedEntryId.value = null; listPage.value = 1; await load(); if (tab.value === 'list' && detailFilter.value?.period === 'month') await openCategoryDetails(detailFilter.value.category, detailFilter.value.type, 'month') })
watch(selectedYear, async () => { listPage.value = 1; await loadYear(); if (tab.value === 'list' && detailFilter.value?.period === 'year') await openCategoryDetails(detailFilter.value.category, detailFilter.value.type, 'year') })
watch(tab, value => {
  if (value === 'year') loadYear()
  if (value === 'list') listPage.value = 1
})

function recognize() {
  if (!input.value.trim()) return
  forms.value = parseEntries(input.value, rules.value).map(f => {
    const transferText = [f.merchant, f.note, f.raw].filter(Boolean).join(' ')
    const transfer = /証券投信積立サービス|投信積立サービス|翌月買付分/.test(transferText) || (/SBI/i.test(transferText) && /投信積立|投資信託積立/.test(transferText))
    return { ...f, type: transfer ? 'transfer' : f.type, category: transfer ? '投資・資産移動' : f.category, transferTarget: f.transferTarget || '', transferDate: f.transferDate || f.date, bindRule: false }
  })
  flash(forms.value.length > 1 ? `${forms.value.length}件の記録を読み取りました。内容を確認して一括保存してください` : '読み取り結果を確認してください')
}
async function onImage(e) {
  const f = e.target.files[0]; e.target.value = ''
  if (!f) return
  busy.value = '読み取り中 0%（初回は日本語データをダウンロードします）'
  try {
    input.value = await ocrImage(f, p => (busy.value = `読み取り中 ${p}%`))
    recognize()
  } catch (err) { flash('画像の読み取りに失敗しました：' + err.message) }
  busy.value = ''
}
function addBlank(type = 'expense') {
  const category = type === 'income' ? '工资' : type === 'transfer' ? '投資・資産移動' : '日用品'
  forms.value.push({ date: new Date().toLocaleDateString('sv-SE'), transferDate: new Date().toLocaleDateString('sv-SE'), transferTarget: '', time: '', amount: 0, type, category, merchant: '', note: '', raw: '', suggested: category, keyword: '', bindRule: false })
}
function setEntryType(form, type) {
  form.type = type
  if (type === 'income') form.category = INCOME_CATEGORIES.includes(form.category) ? form.category : '工资'
  else if (type === 'transfer') form.category = '投資・資産移動'
  else if (INCOME_CATEGORIES.includes(form.category) || form.category === '投資・資産移動') form.category = '日用品'
}
async function addCategory() {
  const name = prompt('新しいカテゴリ名を入力してください（20文字以内）')
  if (!name?.trim()) return
  try {
    await api('categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
    categories.value = await api('categories')
    flash('カテゴリを追加しました')
  } catch (e) { flash('カテゴリの追加に失敗しました：' + e.message) }
}
function removeDraft(i) { forms.value.splice(i, 1) }

async function saveAll() {
  if (!forms.value.length) return flash('保存する記録がありません')
  const invalid = forms.value.findIndex(f => !(Number(f.amount) > 0))
  if (invalid >= 0) return flash(`${invalid + 1}件目の金額が正しくありません。確認してください`)
  try {
    let saved = 0
    for (const f of forms.value) {
      await api('entries', { method: 'POST', body: JSON.stringify({ ...f, amount: Number(f.amount) }) })
      if (f.bindRule && f.merchant && f.merchant.trim().length >= 2) {
        await api('rules', { method: 'POST', body: JSON.stringify({ keyword: f.merchant.trim(), category: f.category }) })
      }
      saved++
    }
    rules.value = await api('rules')
    forms.value = []; input.value = ''
    flash(`${saved}件の記録を保存しました`)
    await load()
    await loadInvestments()
    await loadTransfers()
  } catch (e) { flash(`一部の記録を保存しましたが、残りの保存に失敗しました：${e.message}。重複保存を避けるため、明細を再読み込みして確認してください。`) }
}
async function remove(id) {
  if (!confirm('この記録を削除しますか？')) return
  await api('entries/' + id, { method: 'DELETE' }); await load(); await loadInvestments()
}
function startEdit(entry) {
  editingEntry.value = {
    id: entry.id, date: entry.date, time: entry.time || '',
    amount: Number(entry.amount), type: ['income', 'transfer'].includes(entry.type) ? entry.type : 'expense',
    transferTarget: entry.transfer_target || '', transferDate: entry.transfer_date || entry.date,
    category: entry.category || '日用品', merchant: entry.merchant || '',
    note: entry.note || '', raw: entry.raw || ''
  }
}
function cancelEdit() { editingEntry.value = null }
async function saveEdit() {
  const e = editingEntry.value
  if (!e) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(Number(e.amount) > 0)) {
    flash('日付と金額を確認してください')
    return
  }
  try {
    await api('entries/' + e.id, {
      method: 'PUT',
      body: JSON.stringify({ ...e, amount: Number(e.amount) })
    })
    editingEntry.value = null
    flash('記録を更新しました')
    await load()
    await loadInvestments()
    await loadTransfers()
  } catch (err) { flash('更新に失敗しました：' + err.message) }
}

const pendingTransfers = ref([])
const transferLoading = ref(false)
const transferDue = item => String(item.transfer_date || item.date) <= new Date().toLocaleDateString('sv-SE')
async function loadTransfers() {
  transferLoading.value = true
  try {
    let rows = await api('transfers')
    // 予定日を迎えた未処理の振替は自動反映を試し、失敗したものだけ手動処理を表示する
    const dueTransfers = rows.filter(item => Number(item.transfer_applied) !== 1 && transferDue(item))
    for (const item of dueTransfers) {
      try { await api('transfers/' + item.id, { method: 'POST' }) }
      catch { /* 自動処理に失敗した場合は未処理のまま残し、手動処理を表示 */ }
    }
    if (dueTransfers.length) rows = await api('transfers')
    pendingTransfers.value = rows
  } catch (e) { flash('振替予定を読み込めませんでした：' + e.message) }
  finally { transferLoading.value = false }
}
const transferStatus = item => Number(item.transfer_applied) === 1 ? '処理成功' : (String(item.transfer_date || item.date) > new Date().toLocaleDateString('sv-SE') ? '入金予定' : '未処理')
const transferStatusClass = item => Number(item.transfer_applied) === 1 ? 'transfer-done' : 'transfer-waiting'
async function retryTransfer(item) {
  try {
    await api('transfers/' + item.id, { method: 'POST' })
    await loadTransfers()
    await loadInvestments()
    flash('資産移動を処理しました')
  } catch (e) { flash('処理に失敗しました：' + e.message) }
}
async function deleteTransfer(item) {
  if (!confirm('この待処理事項を削除しますか？家計簿の記録も削除されます。')) return
  try {
    await api('entries/' + item.id, { method: 'DELETE' })
    await loadTransfers()
    await load()
    await loadInvestments()
    flash('記録を削除しました')
  } catch (e) { flash('削除に失敗しました：' + e.message) }
}

const investmentItems = [
  { id: 'sbi', label: 'SBI証券', detail: '投資信託', unit: '円' },
]
const investments = ref({
  sbi: { currentValue: null, pnl: null, updatedAt: '' },
})
const investmentBusy = ref(false)
const investmentReturn = item => {
  const form = investments.value[item.id]
  const value = Number(form.currentValue)
  const pnl = Number(form.pnl)
  if (form.currentValue === null || form.currentValue === '' || form.pnl === null || form.pnl === '' ||
      !Number.isFinite(value) || !Number.isFinite(pnl) || value - pnl <= 0) return null
  return pnl / (value - pnl) * 100
}
async function loadInvestments() {
  try {
    const rows = await api('investments')
    for (const row of rows) {
      if (!investments.value[row.platform]) continue
      investments.value[row.platform] = {
        currentValue: row.current_value === null ? null : Number(row.current_value),
        pnl: row.pnl === null ? null : Number(row.pnl),
        updatedAt: row.updated_at || ''
      }
    }
  } catch (e) { flash('資産データを読み込めませんでした：' + e.message) }
}
async function saveInvestment(item) {
  const form = investments.value[item.id]
  const value = Number(form.currentValue)
  const pnl = Number(form.pnl)
  if (form.currentValue === null || form.currentValue === '' || !Number.isSafeInteger(value) || value < 0 ||
      form.pnl === null || form.pnl === '' || !Number.isSafeInteger(pnl)) {
    flash('現在の評価額と評価損益を整数で入力してください')
    return
  }
  investmentBusy.value = true
  try {
    const row = await api('investments', {
      method: 'PUT',
      body: JSON.stringify({ platform: item.id, currentValue: value, pnl })
    })
    form.updatedAt = row.updated_at || new Date().toISOString()
    flash(item.label + 'の資産情報を更新しました')
  } catch (e) { flash('更新に失敗しました：' + e.message) }
  finally { investmentBusy.value = false }
}

const maxCat = computed(() => Math.max(1, ...(stats.value?.byCategory || []).map(c => c.amount)))
const maxDay = computed(() => Math.max(1, ...(stats.value?.byDay || []).map(c => c.amount)))
const categoryRows = computed(() => [...(stats.value?.byCategory || [])].sort((a, b) => b.amount - a.amount))
const selectedDay = ref('')
const swipedEntryId = ref(null)
const filteredEntries = computed(() => selectedDay.value ? entries.value.filter(e => e.date === selectedDay.value) : entries.value)
const detailFilter = ref(null)
const detailSourceEntries = ref([])
const detailLoading = ref(false)
const listPage = ref(1)
const listPageSize = 50
const displayEntries = computed(() => {
  const source = detailFilter.value ? detailSourceEntries.value : filteredEntries.value
  return detailFilter.value
    ? source.filter(entry => detailFilter.value.type === 'transfer' ? entry.type === 'transfer' : entry.category === detailFilter.value.category && (detailFilter.value.type === 'income' ? entry.type === 'income' : entry.type !== 'income'))
    : source
})
const listPageCount = computed(() => Math.max(1, Math.ceil(displayEntries.value.length / listPageSize)))
const pagedEntries = computed(() => {
  const start = (listPage.value - 1) * listPageSize
  return displayEntries.value.slice(start, start + listPageSize)
})
watch(listPageCount, count => { if (listPage.value > count) listPage.value = count })
async function openCategoryDetails(category, type, period) {
  detailFilter.value = { category, type, period }
  selectedDay.value = ''
  detailSourceEntries.value = []
  listPage.value = 1
  tab.value = 'list'
  detailLoading.value = true
  try {
    const query = period === 'year' ? 'entries?year=' + selectedYear.value : 'entries?month=' + month.value
    detailSourceEntries.value = await api(query)
  } catch (e) {
    flash('明細の読み込みに失敗しました：' + e.message)
  } finally {
    detailLoading.value = false
  }
}
function clearDetailFilter() {
  detailFilter.value = null
  detailSourceEntries.value = []
  listPage.value = 1
}
function changeListPage(page) {
  listPage.value = Math.min(listPageCount.value, Math.max(1, page))
}
const dayRows = computed(() => [...(stats.value?.byDay || [])].sort((a, b) => a.date.localeCompare(b.date)))
let touchStartX = 0
let touchStartY = 0
let suppressRowClick = false
const calendarDays = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const firstDayOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  const amounts = new Map(dayRows.value.map(day => [day.date, Number(day.amount || 0)]))
  const days = Array.from({ length: firstDayOffset }, (_, i) => ({ key: `blank-${i}`, blank: true }))
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    days.push({ key: date, date, day, amount: amounts.get(date) || 0, blank: false })
  }
  while (days.length % 7) days.push({ key: `blank-end-${days.length}`, blank: true })
  return days
})
function toggleDay(date) {
  if (selectedDay.value === date) selectedDay.value = ''
  else selectedDay.value = date
  listPage.value = 1
  swipedEntryId.value = null
}
function startSwipe(event) {
  if (event.touches?.length !== 1) return
  touchStartX = event.touches[0].clientX
  touchStartY = event.touches[0].clientY
}
function endSwipe(event, id) {
  if (!event.changedTouches?.length) return
  const dx = event.changedTouches[0].clientX - touchStartX
  const dy = event.changedTouches[0].clientY - touchStartY
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.25) {
    swipedEntryId.value = dx < 0 ? id : null
    suppressRowClick = true
    setTimeout(() => { suppressRowClick = false }, 350)
  }
}
function handleEntryClick(entry) {
  if (suppressRowClick) return
  if (swipedEntryId.value === entry.id) {
    swipedEntryId.value = null
    return
  }
  swipedEntryId.value = null
  startEdit(entry)
}
// Monthly statistics are grouped into Monday–Sunday weeks, clipped to the selected month.
const weekRows = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const monthStart = new Date(year, monthNumber - 1, 1)
  const monthEnd = new Date(year, monthNumber, 0)
  const groups = new Map()
  for (const day of dayRows.value) {
    const date = new Date(day.date + 'T12:00:00')
    const monday = new Date(date)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const key = monday.toLocaleDateString('sv-SE')
    const current = groups.get(key) || { start: key, end: '', amount: 0, days: 0 }
    current.amount += Number(day.amount || 0)
    current.days += 1
    groups.set(key, current)
  }
  const weeks = []
  const cursor = new Date(monthStart)
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))
  while (cursor <= monthEnd) {
    const monday = new Date(cursor)
    const sunday = new Date(cursor)
    sunday.setDate(sunday.getDate() + 6)
    const clippedStart = monday < monthStart ? monthStart : monday
    const clippedEnd = sunday > monthEnd ? monthEnd : sunday
    const key = monday.toLocaleDateString('sv-SE')
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
const averageDaily = computed(() => dayRows.value.length ? Math.round(Number(stats.value?.total || 0) / dayRows.value.length) : 0)
const todayLabel = computed(() => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日` })
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-')
  return `${y}年${Number(m)}月`
})
const yearOptions = computed(() => Array.from({ length: 31 }, (_, i) => new Date().getFullYear() - i))
const yearMonthRows = computed(() => {
  const expenses = new Map((annualStats.value?.byMonth || []).map(item => [item.month, Number(item.amount)]))
  const incomes = new Map((annualStats.value?.incomeByMonth || []).map(item => [item.month, Number(item.amount)]))
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${selectedYear.value}-${String(i + 1).padStart(2, '0')}`
    return { month: key, label: `${i + 1}月`, amount: expenses.get(key) || 0, income: incomes.get(key) || 0 }
  })
})
const incomeTrendPoints = computed(() => {
  const max = Math.max(1, ...yearMonthRows.value.map(item => item.income))
  return yearMonthRows.value.map((item, i) => ({ ...item, x: 16 + i * 26.18, y: 108 - item.income / max * 82 }))
})
const incomeTrendLine = computed(() => incomeTrendPoints.value.map(point => `${point.x},${point.y}`).join(' '))
const ratioTrendPoints = computed(() => yearMonthRows.value.map((item, i) => {
  const ratio = item.income > 0 ? item.amount / item.income : null
  return { ...item, ratio, x: 16 + i * 26.18, y: ratio === null ? null : 108 - Math.min(1.5, ratio) / 1.5 * 82 }
}))
const ratioTrendLine = computed(() => ratioTrendPoints.value.filter(point => point.ratio !== null).map(point => `${point.x},${point.y}`).join(' '))
const incomeTrendMax = computed(() => Math.max(0, ...yearMonthRows.value.map(item => item.income)))
const ratioTrendMax = computed(() => Math.max(0, ...ratioTrendPoints.value.filter(point => point.ratio !== null).map(point => point.ratio)))
const maxYearMonth = computed(() => Math.max(1, ...yearMonthRows.value.map(item => item.amount)))
const highestSpendMonth = computed(() => yearMonthRows.value.reduce((best, item) => item.amount > best.amount ? item : best, { month: '', label: 'データなし', amount: 0 }))
const annualAverage = computed(() => Math.round(Number(annualStats.value?.total || 0) / 12))
const selectedIncomeMonthRow = computed(() => yearMonthRows.value.find(item => item.month === selectedIncomeMonth.value) || null)
const selectedIncomeCategories = computed(() => (annualStats.value?.incomeByMonthCategory || [])
  .filter(item => item.month === selectedIncomeMonth.value)
  .map(item => ({ category: item.category || '其他收入', amount: Number(item.amount || 0) }))
  .sort((a, b) => b.amount - a.amount))
const annualIncomeCategories = computed(() => (annualStats.value?.incomeByCategory || [])
  .map(item => ({ category: item.category || '其他收入', amount: Number(item.amount || 0) }))
  .sort((a, b) => b.amount - a.amount))
const maxAnnualIncomeCategory = computed(() => Math.max(1, ...annualIncomeCategories.value.map(item => item.amount)))
function selectIncomeMonth(point) {
  // Tapping the currently selected month again closes its breakdown.
  selectedIncomeMonth.value = selectedIncomeMonth.value === point.month ? '' : point.month
}
function selectRatioMonth(point) {
  // Tapping the currently selected month again closes its breakdown.
  selectedRatioMonth.value = selectedRatioMonth.value === point.month ? '' : point.month
}
const selectedRatioMonthRow = computed(() => yearMonthRows.value.find(item => item.month === selectedRatioMonth.value) || null)
const selectedRatio = computed(() => selectedRatioMonthRow.value && selectedRatioMonthRow.value.income > 0 ? selectedRatioMonthRow.value.amount / selectedRatioMonthRow.value.income : null)
const monthlyRatio = computed(() => Number(stats.value?.income || 0) > 0 ? Number(stats.value?.total || 0) / Number(stats.value.income) : null)
const annualRatio = computed(() => Number(annualStats.value?.income || 0) > 0 ? Number(annualStats.value?.total || 0) / Number(annualStats.value.income) : null)
const pigState = ratio => ratio === null ? 'empty' : ratio > 1 ? 'broken' : ratio >= .8 ? 'sweating' : 'happy'
const pigLabel = ratio => ratio === null ? 'まず収入を記録して、収支バランスを確認しましょう' : ratio > 1 ? '大変！支出が収入を上回っています！' : ratio >= .8 ? '予算オーバーに注意しましょう！' : 'いい感じです。この調子でいきましょう'
const ratioLabel = ratio => ratio === null ? '収入データなし' : Math.round(ratio * 100) + '%'
</script>

<template>
  <main :class="`theme-${theme}`">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-label="しろちゃんとちび毛"><img src="https://stickershop.line-scdn.net/stickershop/v1/product/17142161/LINEStorePC/main.png?v=1" alt="しろちゃん" /><img src="https://stickershop.line-scdn.net/stickershop/v1/product/24856095/LINEStorePC/main.png?v=1" alt="ちび毛" /></span>
        <div><strong>家計簿 <span class="brand-heart">♡</span></strong><small>家計をかんたんに記録</small></div>
      </div>
      <span v-if="tab === 'add'" class="today-date">{{ todayLabel }}</span>
      <div v-else-if="tab === 'list' || tab === 'stat'" class="topbar-period"><input type="month" v-model="month" class="month" aria-label="集計月" /><button type="button" class="period-reset" @click="resetMonth" aria-label="今月に戻す" title="今月に戻す">今月</button></div>
      <select v-else-if="tab === 'year'" v-model.number="selectedYear" class="topbar-year" aria-label="集計年"><option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option></select>
    </header>
    <div class="theme-switcher" role="group" aria-label="配色">
      <span>配色</span>
      <button v-for="item in themes" :key="item.id" type="button" :class="{ selected: theme === item.id }" :aria-pressed="theme === item.id" @click="setTheme(item.id)"><i :style="{ background: item.color }"></i>{{ item.label }}</button>
    </div>

    <p v-if="msg" class="toast" role="status">{{ msg }}</p>

    <section v-if="tab === 'add'" class="page-section">
      <div class="page-heading"><div><p class="eyebrow">記録を追加</p><h1>入力</h1></div><button class="button-secondary manage-category" @click="addCategory">＋ カテゴリ追加</button></div>
      <div class="entry-mode-row">
        <button class="button-secondary manual-add-button" aria-label="支出を追加" @click="addBlank('expense')"><span class="entry-mode-icon expense-icon" aria-hidden="true">−</span><span>支出</span></button>
        <button class="button-secondary manual-add-button income-add-button" aria-label="収入を追加" @click="addBlank('income')"><span class="entry-mode-icon income-icon" aria-hidden="true">＋</span><span>収入</span></button>
        <button class="button-secondary manual-add-button" aria-label="資産移動を追加" @click="addBlank('transfer')"><span class="entry-mode-icon transfer-icon" aria-hidden="true">⇄</span><span>資産移動</span></button>
      </div>
      <div class="panel capture-panel">
        <label class="field-label" for="entry-text">テキスト読み取り</label>
        <textarea id="entry-text" v-model="input" rows="4" placeholder="例：昨日 コンビニ 680円&#10;&#10;複数の支出を貼り付けたり、レシート画像をアップロードしたりできます。"></textarea>
        <div class="action-row">
          <button class="button-primary" @click="recognize" :disabled="!!busy || !input.trim()">テキストを読み取る</button>
          <label class="button-secondary upload-button">撮影／画像を選択<input type="file" accept="image/*" @change="onImage" hidden /></label>
        </div>
        <div v-if="busy" class="progress-wrap"><span class="spinner"></span><span>{{ busy }}</span></div>
        <p class="microcopy">画像はこの端末内で処理され、外部のOCRサービスには送信されません。</p>
      </div>

      <div v-if="forms.length" class="draft-heading">
        <div><h2>読み取り結果の確認</h2><p>保存前に金額と店舗名を確認してください</p></div>
        <span class="count-pill">{{ forms.length }}件</span>
      </div>
      <div v-for="(f, i) in forms" :key="i" class="entry-card">
        <div class="entry-card-heading"><span class="entry-number">{{ String(i + 1).padStart(2, '0') }}</span><strong>{{ f.merchant || '新しい記録' }}</strong><button class="icon-button remove-button" @click="removeDraft(i)" aria-label="この記録を削除">×</button></div>
        <div class="type-switch" role="group" aria-label="記録の種類">
          <button type="button" :class="{ selected: (f.type || 'expense') === 'expense' }" @click="setEntryType(f, 'expense')">💸 支出</button>
          <button type="button" :class="{ selected: f.type === 'income' }" @click="setEntryType(f, 'income')">🌷 収入</button>
          <button type="button" :class="{ selected: f.type === 'transfer' }" @click="setEntryType(f, 'transfer')">↗ 資産移動</button>
        </div>
        <label class="form-field amount-field"><span>{{ f.type === 'income' ? '収入金額（円）' : f.type === 'transfer' ? '資産移動額（円）' : '支出金額（円）' }}</span><div class="amount-input-wrap" :class="{ 'income-amount-wrap': f.type === 'income' }"><span>¥</span><input type="number" min="0" inputmode="numeric" v-model.number="f.amount" aria-label="金額（円）" /></div></label>
        <p v-if="!(Number(f.amount) > 0)" class="amount-warning" role="alert">金額を読み取れませんでした。明細を確認して金額を入力してください。</p>
        <div class="field-grid">
          <label class="form-field"><span>日付</span><input type="date" v-model="f.date" /></label>
          <label class="form-field"><span>時刻</span><input type="time" v-model="f.time" /></label>
          <label class="form-field"><span>カテゴリ</span><select v-model="f.category"><option v-for="c in (f.type === 'income' ? INCOME_CATEGORIES : f.type === 'transfer' ? ['投資・資産移動'] : categories)" :key="c" :value="c">{{ categoryLabel(c) }}</option></select></label>
          <label class="form-field"><span>店舗</span><input v-model="f.merchant" /></label>
        </div>
        <div v-if="f.type === 'transfer'" class="field-grid transfer-schedule-fields">
          <label class="form-field"><span>振替先</span><select v-model="f.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option></select></label>
          <label class="form-field"><span>適用日（この日に残高へ反映）</span><input v-model="f.transferDate" type="date" required /></label>
        </div>
        <label class="form-field"><span>メモ</span><input v-model="f.note" placeholder="任意" /></label>
        <label v-if="f.type !== 'income' && f.merchant && f.merchant.trim().length >= 2" class="bind-rule"><input v-model="f.bindRule" type="checkbox" /> <span>この店舗を選択したカテゴリに登録し、次回から自動判定する</span></label>
      </div>
      <div class="batch-actions" :class="{ 'batch-actions-empty': !forms.length }">
        <button class="button-secondary" @click="addBlank('expense')">＋ もう1件追加</button>
        <button class="button-primary" @click="saveAll" :disabled="!forms.length">保存 {{ forms.length }}件</button>
      </div>
    </section>

    <section v-else-if="tab === 'list'" class="page-section">
      <div class="page-heading"><div><p class="eyebrow">収支記録</p><h1>収支明細</h1></div><span class="heading-icon">≡</span></div>
      <section v-if="!detailFilter" class="month-calendar" aria-label="月間支出カレンダー">
        <div class="calendar-heading"><strong>{{ monthLabel }}</strong><button v-if="selectedDay" class="calendar-reset" @click="selectedDay = ''">月全体を表示</button></div>
        <div class="calendar-weekdays"><span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{ weekday }}</span></div>
        <div class="calendar-grid">
          <button v-for="day in calendarDays" :key="day.key" type="button" class="calendar-day" :class="{ 'calendar-blank': day.blank, 'calendar-selected': selectedDay === day.date, 'calendar-has-spend': day.amount > 0 }" :disabled="day.blank" @click="toggleDay(day.date)" :aria-label="day.blank ? undefined : day.date + ' 支出 ' + yen(day.amount)">
            <template v-if="!day.blank"><span class="calendar-day-number">{{ day.day }}</span><small v-if="day.amount > 0">{{ yen(day.amount) }}</small><small v-else class="calendar-no-spend">—</small></template>
          </button>
        </div>
      </section>
      <div class="summary-strip"><span>{{ detailFilter ? (detailFilter.period === 'year' ? selectedYear + '年' : monthLabel) + ' · ' + (detailFilter.type === 'transfer' ? '資産移動' : categoryLabel(detailFilter.category) + 'の' + (detailFilter.type === 'income' ? '収入' : '支出')) : (selectedDay ? selectedDay.replace(/-/g, '/') + ' 当日の明細' : monthLabel) }}</span><strong>{{ displayEntries.length }}件の記録</strong></div>
      <div v-if="detailFilter" class="detail-filter-strip"><span>{{ detailFilter.type === 'transfer' ? '資産移動で絞り込み中' : 'カテゴリで絞り込み中' }}</span><button type="button" class="button-secondary" @click="clearDetailFilter">絞り込みを解除</button></div>
      <p v-if="detailLoading" class="trend-note">明細を読み込み中…</p>
      <div v-if="!detailLoading && !displayEntries.length" class="empty-state"><span class="empty-icon">▤</span><strong>{{ detailFilter ? 'このカテゴリの明細はありません' : 'この期間の記録はありません' }}</strong><p>{{ detailFilter ? '条件に一致する記録はありません。' : '「入力」から最初の記録を追加できます。' }}</p><button v-if="detailFilter" class="button-secondary" @click="clearDetailFilter">絞り込みを解除</button><button v-else class="button-primary" @click="tab = 'add'">記録を追加</button></div>
      
      <ul v-else-if="!detailLoading" class="ledger">
        <li v-for="e in pagedEntries" :key="e.id" :class="{ 'swiped-open': swipedEntryId === e.id }" @touchstart.passive="startSwipe($event)" @touchend="endSwipe($event, e.id)" @touchcancel="swipedEntryId = null">
          <div class="ledger-row-content" role="button" tabindex="0" @click="handleEntryClick(e)" @keydown.enter.prevent="startEdit(e)" @keydown.space.prevent="startEdit(e)">
            <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]">{{ categoryIcon(e.category) }}</span>
            <div class="ledger-info"><b>{{ e.merchant || categoryLabel(e.category) }}</b><small>{{ e.date.slice(5) }}<template v-if="e.time"> · {{ e.time }}</template> · {{ categoryLabel(e.category) }} · {{ e.type === 'income' ? '収入' : e.type === 'transfer' ? '資産移動' : '支出' }}<template v-if="e.type === 'transfer' && e.transfer_target"> · {{ e.transfer_target === 'sbi' ? '→ SBI証券' : '' }}</template></small></div>
            <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income', 'transfer-amount': e.type === 'transfer' }">{{ e.type === 'income' ? '+' : e.type === 'transfer' ? '↗ ' : '−' }}{{ yen(e.amount) }}</span>
          </div>
          <button class="swipe-delete" @click.stop="remove(e.id); swipedEntryId = null" aria-label="記録を削除">削除</button>
        </li>
      </ul>
      <div v-if="displayEntries.length > listPageSize && !detailLoading" class="detail-pagination" aria-label="明細ページ">
        <button type="button" class="button-secondary" :disabled="listPage <= 1" @click="changeListPage(listPage - 1)">前へ</button>
        <span>{{ listPage }} / {{ listPageCount }} ページ（50件ずつ）</span>
        <button type="button" class="button-secondary" :disabled="listPage >= listPageCount" @click="changeListPage(listPage + 1)">次へ</button>
      </div>
      <div v-if="editingEntry" class="edit-overlay" @click.self="cancelEdit">
        <form class="edit-dialog" @submit.prevent="saveEdit">
          <div class="edit-dialog-heading"><h2>記録を編集</h2><button type="button" class="icon-button" @click="cancelEdit" aria-label="閉じる">×</button></div>
          <div class="type-switch" role="group" aria-label="記録の種類">
            <button type="button" :class="{ selected: editingEntry.type === 'expense' }" @click="setEntryType(editingEntry, 'expense')">💸 支出</button>
            <button type="button" :class="{ selected: editingEntry.type === 'income' }" @click="setEntryType(editingEntry, 'income')">🌷 収入</button>
            <button type="button" :class="{ selected: editingEntry.type === 'transfer' }" @click="setEntryType(editingEntry, 'transfer')">↗ 資産移動</button>
          </div>
          <label class="form-field"><span>金額（円）</span><input v-model.number="editingEntry.amount" type="number" min="1" inputmode="numeric" required /></label>
          <div class="field-grid">
            <label class="form-field"><span>日付</span><input v-model="editingEntry.date" type="date" required /></label>
            <label class="form-field"><span>時刻</span><input v-model="editingEntry.time" type="time" /></label>
            <label class="form-field"><span>カテゴリ</span><select v-model="editingEntry.category"><option v-for="c in (editingEntry.type === 'income' ? INCOME_CATEGORIES : editingEntry.type === 'transfer' ? ['投資・資産移動'] : categories)" :key="c" :value="c">{{ categoryLabel(c) }}</option></select></label>
            <label class="form-field"><span>店舗</span><input v-model="editingEntry.merchant" /></label>
          </div>
          <div v-if="editingEntry.type === 'transfer'" class="field-grid transfer-schedule-fields">
            <label class="form-field"><span>振替先</span><select v-model="editingEntry.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option></select></label>
            <label class="form-field"><span>適用日（この日に残高へ反映）</span><input v-model="editingEntry.transferDate" type="date" required /></label>
          </div>
          <label class="form-field"><span>メモ</span><input v-model="editingEntry.note" /></label>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" @click="cancelEdit">キャンセル</button><button type="submit" class="button-primary">変更を保存</button></div>
        </form>
      </div>
    </section>

    <section v-else-if="tab === 'stat'" class="page-section stats-page">
      <div class="page-heading"><div><p class="eyebrow">月間サマリー</p><h1>支出集計</h1><p class="heading-subtitle">{{ monthLabel }} · 支出サマリー</p></div><span class="heading-icon">↗</span></div>
      <div class="hero-total">
        <span>今月の支出合計</span>
        <strong>{{ yen(stats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ stats?.count || 0 }}件の支出記録</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(monthlyRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(monthlyRatio)" aria-label="しろちゃんとちび毛"><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="しろちゃんのスタンプ" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="ちび毛としろちゃんのスタンプ" loading="lazy" /><small>しろちゃん × ちび毛</small></div>
        <div class="piggy-content"><div class="piggy-title">今月の収支バランス</div><div class="piggy-status">{{ pigLabel(monthlyRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (monthlyRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(monthlyRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip"><div><small>今月の収入</small><strong class="income-text">＋{{ yen(stats?.income) }}</strong></div><div><small>今月の支出</small><strong>−{{ yen(stats?.total) }}</strong></div><div><small>差引残高</small><strong :class="Number(stats?.income || 0) - Number(stats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(stats?.income || 0) - Number(stats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>今月の資産移動</small><strong>{{ yen(stats?.transferTotal) }}</strong></div><div><small>件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'month')" aria-label="今月の資産移動明細を表示">{{ stats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div><div><small>生活支出には含めない</small><strong>別集計</strong></div></div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon">▦</span><small>支出件数</small><strong>{{ stats?.count || 0 }}<em>件</em></strong></div>
        <div class="metric-card"><span class="metric-icon">↗</span><small>1日平均支出（支出があった日）</small><strong>{{ yen(averageDaily) }}</strong></div>
      </div>
      <div v-if="!stats?.count" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>集計データがありません</strong><p>支出を記録すると、ここに内訳が表示されます。</p><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div class="stats-card">
          <div class="section-title"><div><h2>カテゴリ支出</h2><p>何にお金を使ったか確認しましょう</p></div><span class="section-mark">01</span></div>
          <div class="category-list">
            <div v-for="(c, i) in categoryRows" :key="c.category" class="category-row category-row-clickable" role="button" tabindex="0" :aria-expanded="categoryDetail?.period === 'month' && categoryDetail?.type === 'expense' && categoryDetail?.category === c.category" @click="openCategoryDetails(c.category, 'expense', 'month')" @keydown.enter.prevent="openCategoryDetails(c.category, 'expense', 'month')" @keydown.space.prevent="openCategoryDetails(c.category, 'expense', 'month')">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span :class="'bar-fill fill-' + (i % 6)" :style="{ width: Math.max(2, (c.amount / maxCat) * 100) + '%' }"></span></div>
              <small class="category-share">{{ stats.total ? Math.round(c.amount / stats.total * 100) : 0 }}%（今月の支出合計に占める割合） · タップして明細を見る</small>
            </div>
          </div>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>週別支出</h2><p>月曜日から日曜日で集計（最初と最後の週は当月の日付で計算）</p></div><span class="section-mark">02</span></div>
          <div class="daily-list">
            <div v-for="(w, i) in weekRows" :key="w.key" class="daily-row weekly-row">
              <div class="daily-date week-index"><strong>第{{ i + 1 }}</strong><span>週</span></div>
              <div class="daily-bar-wrap"><div class="daily-bar-track"><span :style="{ width: Math.max(2, (w.amount / maxWeek) * 100) + '%' }"></span></div><small>{{ w.label }} · {{ w.days }}日間の支出</small></div>
              <strong class="daily-amount">{{ yen(w.amount) }}</strong>
            </div>
          </div>
        </div>
      </template>
    </section>

    <section v-else-if="tab === 'year'" class="page-section stats-page annual-page">
      <div class="page-heading"><div><p class="eyebrow">年間サマリー</p><h1>年間集計</h1><p class="heading-subtitle">年ごとの支出を集計</p></div><span class="heading-icon">⌁</span></div>
      <div class="hero-total annual-hero">
        <span>{{ selectedYear }}年の支出合計</span><strong>{{ yen(annualStats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ annualStats?.count || 0 }}件の支出記録</div>
      </div>
      <div class="income-expense-strip annual-income-strip"><div><small>年間収入</small><strong class="income-text">＋{{ yen(annualStats?.income) }}</strong></div><div><small>年間支出</small><strong>−{{ yen(annualStats?.total) }}</strong></div><div><small>年間収支</small><strong :class="Number(annualStats?.income || 0) - Number(annualStats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(annualStats?.income || 0) - Number(annualStats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>年間の資産移動</small><strong>{{ yen(annualStats?.transferTotal) }}</strong></div><div><small>件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'year')" aria-label="年間の資産移動明細を表示">{{ annualStats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div><div><small>生活支出には含めない</small><strong>別集計</strong></div></div>
      <div class="piggy-card" :class="'piggy-' + pigState(annualRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(annualRatio)" aria-label="しろちゃんとちび毛"><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="しろちゃんのスタンプ" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="ちび毛としろちゃんのスタンプ" loading="lazy" /><small>しろちゃん × ちび毛</small></div>
        <div class="piggy-content"><div class="piggy-title">年間の収支バランス</div><div class="piggy-status">{{ pigLabel(annualRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (annualRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(annualRatio) }}</strong></div></div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon">▦</span><small>月平均支出（12か月で計算）</small><strong>{{ yen(annualAverage) }}</strong></div>
        <div class="metric-card"><span class="metric-icon">↗</span><small>支出が最も多い月</small><strong>{{ highestSpendMonth.amount ? highestSpendMonth.label : 'データなし' }}</strong><em v-if="highestSpendMonth.amount">{{ yen(highestSpendMonth.amount) }}</em></div>
      </div>
      <div v-if="!annualStats?.count && !Number(annualStats?.income || 0)" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>この年の記録はありません</strong><p>別の年を選ぶか、記録を追加してください。</p><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div v-if="annualStats?.count" class="stats-card">
          <div class="section-title"><div><h2>月別支出</h2><p>{{ selectedYear }}年1月〜12月</p></div><span class="section-mark">01</span></div>
          <div class="year-month-list">
            <div v-for="item in yearMonthRows" :key="item.month" class="year-month-row">
              <span class="year-month-label">{{ item.label }}</span>
              <div class="year-month-track"><span :style="{ width: item.amount ? Math.max(2, item.amount / maxYearMonth * 100) + '%' : '0%' }"></span></div>
              <strong>{{ item.amount ? yen(item.amount) : '—' }}</strong>
            </div>
          </div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>収入の推移</h2><p>月ごとの年間収入の推移</p></div><span class="section-mark">03</span></div>
          <div class="trend-summary"><strong>{{ yen(incomeTrendMax) }}</strong><span>月間最高収入</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年収入の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polyline :points="incomeTrendLine" class="chart-line income-chart-line" />
            <circle v-for="point in incomeTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point income-chart-point clickable-chart-point" :class="{ 'chart-point-selected': selectedIncomeMonth === point.month }" role="button" tabindex="0" :aria-label="point.label + '収入 ' + yen(point.income) + '。タップしてカテゴリを確認'" @click="selectIncomeMonth(point)" @keydown.enter.prevent="selectIncomeMonth(point)" @keydown.space.prevent="selectIncomeMonth(point)" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" :class="{ 'trend-month-selected': selectedIncomeMonth === item.month }" @click="selectIncomeMonth(item)">{{ Number(item.month.slice(5)) }}</button></div>
          <p class="trend-note">グラフの月をタップすると、その月のカテゴリ別収入を確認できます。</p>
          <div v-if="selectedIncomeMonthRow" class="income-month-breakdown">
            <div class="income-breakdown-heading"><div><h3>{{ selectedIncomeMonthRow.label }}収入カテゴリ</h3><p>{{ selectedYear }}年 · {{ selectedIncomeCategories.length }}カテゴリ</p></div><strong>{{ yen(selectedIncomeMonthRow.income) }}</strong></div>
            <div v-if="selectedIncomeCategories.length" class="category-list">
              <div v-for="(c, i) in selectedIncomeCategories" :key="c.category" class="category-row">
                <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
                <div class="bar-track"><span class="bar-fill" :class="'fill-' + (i % 6)" :style="{ width: Math.max(2, Number(c.amount) / Math.max(1, Number(selectedIncomeMonthRow.income)) * 100) + '%' }"></span></div>
                <small class="category-share">{{ selectedIncomeMonthRow.income ? Math.round(Number(c.amount) / Number(selectedIncomeMonthRow.income) * 100) : 0 }}%（当月の収入に占める割合）</small>
              </div>
            </div>
            <p v-else class="trend-note">この月の収入記録はありません。</p>
          </div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>支出割合の推移</h2><p>支出 ÷ 収入。破線は80%と100%の目安</p></div><span class="section-mark">04</span></div>
          <div class="trend-summary"><strong>{{ ratioTrendMax ? Math.round(ratioTrendMax * 100) + '%' : 'データなし' }}</strong><span>月間最高の支出割合</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年支出割合の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <line x1="16" y1="64.27" x2="304" y2="64.27" class="chart-reference-line" />
            <line x1="16" y1="53.33" x2="304" y2="53.33" class="chart-reference-line chart-reference-danger" />
            <polyline v-if="ratioTrendLine" :points="ratioTrendLine" class="chart-line ratio-chart-line" />
            <circle v-for="point in ratioTrendPoints.filter(point => point.ratio !== null)" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point ratio-chart-point clickable-chart-point" :class="{ 'chart-point-selected': selectedRatioMonth === point.month }" role="button" tabindex="0" :aria-label="point.label + '支出割合 ' + Math.round(point.ratio * 100) + '%。タップして当月の収支を確認'" @click="selectRatioMonth(point)" @keydown.enter.prevent="selectRatioMonth(point)" @keydown.space.prevent="selectRatioMonth(point)" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" :class="{ 'trend-month-selected': selectedRatioMonth === item.month }" @click="selectRatioMonth(item)">{{ Number(item.month.slice(5)) }}</button></div>
          <div v-if="selectedRatioMonthRow" class="income-month-breakdown ratio-month-breakdown">
            <div class="income-breakdown-heading"><div><h3>{{ selectedRatioMonthRow.month.replace('-', '年') }}月の収支</h3><p>支出 ÷ 収入</p></div><strong>{{ selectedRatio === null ? '計算できません' : Math.round(selectedRatio * 100) + '%' }}</strong></div>
            <div class="ratio-detail-amounts"><div><span>当月の収入</span><strong>{{ yen(selectedRatioMonthRow.income) }}</strong></div><div><span>当月の支出</span><strong>{{ yen(selectedRatioMonthRow.amount) }}</strong></div></div>
            <p v-if="selectedRatio === null" class="trend-note">この月は収入記録がないため、支出割合を計算できません。</p>
          </div>
          <p class="trend-note">収入がない月は割合を計算しません。縦軸は0〜150%で、150%を超える点は上限に表示されます。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度カテゴリ収入</h2><p>年間合計の多い順</p></div><span class="section-mark">05</span></div>
          <div v-if="annualIncomeCategories.length" class="category-list">
            <div v-for="(c, i) in annualIncomeCategories" :key="c.category" class="category-row category-row-clickable" role="button" tabindex="0" :aria-expanded="categoryDetail?.period === 'year' && categoryDetail?.type === 'income' && categoryDetail?.category === c.category" @click="openCategoryDetails(c.category, 'income', 'year')" @keydown.enter.prevent="openCategoryDetails(c.category, 'income', 'year')" @keydown.space.prevent="openCategoryDetails(c.category, 'income', 'year')">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill" :class="'fill-' + (i % 6)" :style="{ width: Math.max(2, Number(c.amount) / maxAnnualIncomeCategory * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.income ? Math.round(Number(c.amount) / Number(annualStats.income) * 100) : 0 }}%（年間収入に占める割合） · タップして明細</small>
            </div>
          </div>
          <p v-else class="trend-note">この年の収入記録はありません。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度カテゴリ支出</h2><p>年間合計の多い順</p></div><span class="section-mark">02</span></div>
          <div class="category-list">
            <div v-for="(c, i) in (annualStats?.byCategory || [])" :key="c.category" class="category-row category-row-clickable" role="button" tabindex="0" :aria-expanded="categoryDetail?.period === 'year' && categoryDetail?.type === 'expense' && categoryDetail?.category === c.category" @click="openCategoryDetails(c.category, 'expense', 'year')" @keydown.enter.prevent="openCategoryDetails(c.category, 'expense', 'year')" @keydown.space.prevent="openCategoryDetails(c.category, 'expense', 'year')">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill" :class="'fill-' + (i % 6)" :style="{ width: Math.max(2, Number(c.amount) / Math.max(1, Number(annualStats?.total || 0)) * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.total ? Math.round(Number(c.amount) / Number(annualStats.total) * 100) : 0 }}%（年間支出に占める割合） · タップして明細</small>
            </div>
          </div>
        </div>
      </template>
    </section>


    <section v-else-if="tab === 'investments'" class="page-section">
      <article class="panel pending-transfer-panel">
        <div class="pending-transfer-heading"><h2>振替予定</h2><button class="pending-refresh" :disabled="transferLoading" @click="loadTransfers" aria-label="振替予定を更新" title="更新">↻ 更新</button></div>
        <div v-if="transferLoading" class="pending-transfer-empty">読み込み中…</div>
        <div v-else-if="!pendingTransfers.length" class="pending-transfer-empty">確認が必要な振替はありません</div>
        <div v-else class="pending-transfer-list">
          <div v-for="item in pendingTransfers" :key="item.id" class="pending-transfer-row">
            <div class="pending-transfer-main"><strong>{{ item.merchant || item.note || 'SBI証券への資産移動' }}</strong><span>予定日 {{ item.transfer_date || item.date }} · ¥{{ Number(item.amount || 0).toLocaleString('ja-JP') }}</span></div>
            <div class="pending-transfer-actions"><span class="pending-transfer-status" :class="transferStatusClass(item)">{{ transferStatus(item) }}</span><button v-if="Number(item.transfer_applied) === 1" class="pending-delete" aria-label="削除" title="削除" @click="deleteTransfer(item)">×</button><button v-else-if="transferDue(item)" class="pending-retry" @click="retryTransfer(item)">手動処理</button></div>
          </div>
        </div>
      </article>
      <div class="page-heading"><div><p class="eyebrow">資産の記録</p><h1>資産・投資</h1><p class="heading-subtitle">振替は評価額に自動反映。評価額・損益は手動更新できます</p></div><span class="heading-icon">￥</span></div>
      <div class="investment-note">振替先を指定すると評価額に自動加算。評価額・損益は手動更新できます。家計の収支には含みません。</div>
      <article v-for="item in investmentItems" :key="item.id" class="panel investment-card">
        <div class="investment-card-heading"><div><h2>{{ item.label }}</h2><p>{{ item.detail }}</p></div><span class="investment-unit">{{ item.unit }}</span></div>
        <label class="form-field"><span>現在の評価額（{{ item.unit }}）</span><input v-model.number="investments[item.id].currentValue" type="number" min="0" step="1" inputmode="numeric" placeholder="現在の評価額" /></label>
        <label class="form-field"><span>評価損益（{{ item.unit }}）</span><input v-model.number="investments[item.id].pnl" type="number" step="1" inputmode="numeric" placeholder="例：-1339" /></label>
        <div class="investment-summary">
          <div><small>評価損益</small><strong :class="Number(investments[item.id].pnl) > 0 ? 'investment-positive' : Number(investments[item.id].pnl) < 0 ? 'investment-negative' : ''">{{ investments[item.id].pnl === null || investments[item.id].pnl === '' ? '—' : (Number(investments[item.id].pnl) > 0 ? '+' : '') + Number(investments[item.id].pnl).toLocaleString('ja-JP') + ' ' + item.unit }}</strong></div>
          <div><small>損益率</small><strong :class="investmentReturn(item) > 0 ? 'investment-positive' : investmentReturn(item) < 0 ? 'investment-negative' : ''">{{ investmentReturn(item) === null ? '—' : (investmentReturn(item) > 0 ? '+' : '') + investmentReturn(item).toFixed(2) + '%' }}</strong></div>
        </div>
        <p class="investment-updated">最終更新：{{ investments[item.id].updatedAt ? new Date(investments[item.id].updatedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未更新' }}</p>
        <button class="button-primary investment-save" :disabled="investmentBusy" @click="saveInvestment(item)">最新データを保存</button>
      </article>
      <p class="investment-footnote">評価額は手動更新できます。振替先を指定した資産移動は登録時に自動加算されます。相場・評価損益の自動取得や日次履歴の保存は行いません。</p>
    </section>

    <nav class="bottom-nav" aria-label="メインメニュー">
      <button :class="{ active: tab === 'add' }" @click="tab = 'add'"><span class="nav-icon">＋</span><span>入力</span></button>
      <button :class="{ active: tab === 'list' }" @click="tab = 'list'"><span class="nav-icon">≡</span><span>明細</span></button>
      <button :class="{ active: tab === 'stat' }" @click="tab = 'stat'"><span class="nav-icon">▥</span><span>月間集計</span></button>
      <button :class="{ active: tab === 'year' }" @click="tab = 'year'"><span class="nav-icon">▤</span><span>年間集計</span></button>
      <button :class="{ active: tab === 'investments' }" @click="tab = 'investments'"><span class="nav-icon">￥</span><span>資産・投資</span></button>
    </nav>
  </main>
</template>

<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","PingFang SC",system-ui,sans-serif;color:#473d46;background:#fff8f5;font-synthesis:none;text-rendering:optimizeLegibility;--ink:#473d46;--muted:#8c7e88;--line:#f3e5e8;--blue:#d96f91;--blue-dark:#bd5376;--paper:#fff8f5;--card:#fff;--teal:#68a995}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse at 12% 0%,#fff0e8 0,transparent 32%),radial-gradient(ellipse at 95% 18%,#fff0f5 0,transparent 30%),var(--paper);color:var(--ink);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
button:disabled{opacity:.45;cursor:not-allowed}
main{width:min(100%,560px);min-height:100dvh;margin:0 auto;padding:calc(12px + env(safe-area-inset-top)) 18px calc(104px + env(safe-area-inset-bottom));background:var(--paper);color:var(--ink);transition:background .2s,color .2s}
/* Keep long pages, especially annual statistics, vertically scrollable on iOS/PWA. */
html,body,#app{min-height:100%;height:auto;overflow-y:auto;-webkit-overflow-scrolling:touch}
main{height:auto;overflow:visible}
.annual-page{display:block;min-height:0;overflow:visible;padding-bottom:18px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 24px}
.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:grid;place-items:center;width:58px;height:42px;border-radius:15px;background:linear-gradient(135deg,#fff0e6,#ffeaf1);color:var(--blue);font-size:20px;font-weight:800;letter-spacing:-7px;padding-right:7px;box-shadow:inset 0 0 0 1px #f8dce4}.brand strong{display:block;font-size:17px;letter-spacing:.02em}.brand-heart{color:#e985a2;font-size:15px}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:1px}
input,select,textarea{width:100%;min-width:0;border:1px solid #e0e6ed;border-radius:11px;background:#fff;color:var(--ink);padding:11px 12px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:#8da9e8;box-shadow:0 0 0 3px #315fbd18}
.month{width:142px;padding:9px 8px;font-size:12px;font-weight:650;background:#fff}
.page-section{animation:appear .18s ease-out}@keyframes appear{from{opacity:.6;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.page-heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 18px}.today-date{font-size:12px;font-weight:750;color:var(--muted);white-space:nowrap;padding:8px 0 8px 8px}.topbar-period{display:flex;align-items:center;gap:5px}.period-reset{flex:none;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:11px;font-weight:750;white-space:nowrap}.topbar-year{width:auto;max-width:116px;padding:9px 8px;font-size:12px;font-weight:750;background:var(--card)}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.15em;color:var(--blue);margin:0 0 4px}.page-heading h1{font-size:27px;line-height:1.2;letter-spacing:-.045em;margin:0;font-weight:800}.heading-subtitle{font-size:12px;color:var(--muted);margin:7px 0 0}.heading-icon{display:grid;place-items:center;width:43px;height:43px;border-radius:15px;background:#e9efff;color:var(--blue);font-size:25px;font-weight:500}
.panel,.entry-card,.stats-card,.metric-card{background:var(--card);border:1px solid #edf0f4;border-radius:18px;box-shadow:0 5px 20px #24354b08}
.capture-panel{padding:16px}.field-label{display:block;font-size:13px;font-weight:750;margin-bottom:9px}
textarea{resize:vertical;min-height:116px;line-height:1.65;font-size:14px;background:#fbfcfe;border-color:#e8edf3}
.action-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
.button-primary,.button-secondary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:45px;border-radius:12px;padding:11px 14px;font-size:13px;font-weight:750;border:1px solid transparent}
.button-primary{background:var(--blue);color:#fff;box-shadow:0 4px 9px #315fbd20}.button-primary:active{background:var(--blue-dark)}
.button-secondary{background:#f1f5ff;color:var(--blue);border-color:#e2eaff}
.upload-button{display:flex;cursor:pointer}
.microcopy{font-size:11px;color:#929cab;margin:12px 0 0}.manage-category{min-height:38px;padding:8px 10px;font-size:12px;white-space:nowrap}.bind-rule{display:flex;align-items:flex-start;gap:8px;padding:10px 11px;border:1px solid #dce7ff;background:#f7f9ff;border-radius:11px;color:#315fbd;font-size:12px}.bind-rule input{width:17px;height:17px;flex:none;margin:1px 0 0;accent-color:#315fbd}.bind-rule span{flex:1}.progress-wrap{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--blue);font-size:12px}.spinner{width:14px;height:14px;border:2px solid #dce6ff;border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.toast{position:sticky;top:calc(8px + env(safe-area-inset-top));z-index:5;margin:0 0 14px;padding:11px 14px;background:#202b37;color:white;border-radius:12px;font-size:13px;box-shadow:0 5px 16px #17253820}
.draft-heading{display:flex;align-items:center;justify-content:space-between;margin:24px 2px 10px}.draft-heading h2{font-size:17px;margin:0}.draft-heading p{font-size:12px;color:var(--muted);margin:3px 0 0}.count-pill{background:#e7f5f2;color:#11796f;padding:6px 10px;border-radius:99px;font-size:12px;font-weight:800}
.entry-card{padding:15px;margin-top:11px;display:grid;gap:13px}.entry-card-heading{display:flex;align-items:center;gap:9px;min-width:0}.entry-card-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:14px}.entry-number{display:grid;place-items:center;flex:none;width:30px;height:30px;background:#eef2ff;color:var(--blue);border-radius:10px;font-size:11px;font-weight:800}
.icon-button{border:0;background:transparent;color:#9ba5b2;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:23px;padding:0;flex:none}.icon-button:active{background:#f1f3f6}.form-field{display:grid;gap:6px;min-width:0}.form-field>span{font-size:11px;color:#7c8795;font-weight:650}.form-field input,.form-field select{font-size:13px;padding:10px;border-radius:10px}.amount-warning{margin:-4px 0 2px;color:#b45309;font-size:12px;font-weight:700}.amount-input-wrap{display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #e0e6ed;border-radius:12px;background:#fbfcff}.amount-input-wrap>span{font-size:18px;color:var(--blue);font-weight:800}.amount-input-wrap input{border:0;box-shadow:none;background:transparent;padding:11px 0;font-size:26px;font-weight:800;letter-spacing:-.04em;color:var(--ink)}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.batch-actions{display:grid;grid-template-columns:.8fr 1.2fr;gap:9px;margin-top:14px}.batch-actions button{width:100%}
.summary-strip{display:flex;justify-content:space-between;align-items:center;margin:-3px 0 12px;color:var(--muted);font-size:12px}.summary-strip strong{color:#536174;font-weight:700}
.month-calendar{margin:0 0 14px;padding:14px 12px 12px;background:#fff;border:1px solid #f3e2e7;border-radius:18px;box-shadow:0 5px 20px #a75d740a}.calendar-heading{display:flex;align-items:center;justify-content:space-between;margin:0 3px 12px}.calendar-heading strong{font-size:14px;font-weight:850}.calendar-reset{border:0;background:#fff0f4;color:#b95478;border-radius:9px;padding:6px 9px;font-size:11px;font-weight:750}.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.calendar-weekdays{margin-bottom:5px}.calendar-weekdays span{text-align:center;font-size:10px;color:#9b8790;font-weight:750;padding:3px 0}.calendar-day{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;min-width:0;min-height:54px;padding:6px 1px 4px;border:1px solid transparent;border-radius:10px;background:#fff9fa;color:#55464b}.calendar-day:disabled{background:transparent}.calendar-day-number{font-size:12px;font-weight:750;line-height:1.1}.calendar-day small{display:block;max-width:100%;font-size:8px;line-height:1.1;color:#bd6b88;font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:-.04em}.calendar-day .calendar-no-spend{color:#d7cbd0}.calendar-day.calendar-has-spend{background:#fff0f4;border-color:#f8dce5}.calendar-day.calendar-selected{background:#d96f91;border-color:#d96f91;color:#fff;box-shadow:0 3px 8px #d96f9128}.calendar-day.calendar-selected small{color:#fff}.calendar-day:active:not(:disabled){transform:scale(.96)}.ledger{list-style:none;margin:0;padding:3px 14px;background:#fff;border:1px solid #edf0f4;border-radius:17px;box-shadow:0 5px 20px #24354b08}.ledger li{position:relative;overflow:hidden;border-bottom:1px solid #eff2f6;min-width:0}.ledger li:last-child{border-bottom:0}.ledger-row-content{position:relative;z-index:1;display:flex;align-items:center;gap:11px;padding:13px 0;background:#fff;min-width:0;transition:transform .2s ease;cursor:pointer;touch-action:pan-y}.ledger li.swiped-open .ledger-row-content{transform:translateX(-68px)}.swipe-delete{position:absolute;top:0;right:0;bottom:0;width:64px;border:0;border-radius:10px;background:#e86e86;color:#fff;font-size:12px;font-weight:800;letter-spacing:.02em}.filtered-empty{margin-bottom:10px}.category-dot{display:grid;place-items:center;flex:none;width:39px;height:39px;border-radius:13px;background:#edf2ff;color:#315fbd;font-size:14px;font-weight:800}.cat-2{background:#e8f7f2;color:#16836f}.cat-3{background:#fff2df;color:#b87518}.cat-4{background:#f3eaff;color:#8755bd}.cat-5{background:#e8f5fb;color:#267da0}.cat-6{background:#ffecef;color:#c45569}.cat-7{background:#fff0e5;color:#bd6c39}.cat-8{background:#fcebdc;color:#a65b2a}.cat-9{background:#eef1f5;color:#667384}.ledger-info{min-width:0;flex:1}.ledger-info b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ledger-info small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.ledger-amount{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.delete-button{font-size:20px;width:24px}
.hero-total{position:relative;overflow:hidden;background:linear-gradient(130deg,#315fbd 0%,#284d9b 100%);border-radius:21px;padding:22px 21px 18px;color:#fff;box-shadow:0 10px 24px #315fbd24}.hero-total:after{content:"";position:absolute;width:155px;height:155px;border:1px solid #ffffff1c;border-radius:50%;right:-38px;top:-74px;box-shadow:0 0 0 22px #ffffff08,0 0 0 45px #ffffff06}.hero-total>span{display:block;font-size:12px;color:#dbe5ff}.hero-total>strong{display:block;font-size:clamp(29px,8vw,39px);line-height:1.25;letter-spacing:-.045em;margin:8px 0 15px;font-variant-numeric:tabular-nums}.hero-footer{display:flex;align-items:center;gap:7px;font-size:11px;color:#dbe5ff}.hero-dot{width:6px;height:6px;border-radius:50%;background:#76e0c1}
.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:11px 0 19px}.metric-card{padding:14px 14px 15px;min-width:0}.metric-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#edf2ff;color:var(--blue);font-size:17px;margin-bottom:10px}.metric-card small{display:block;color:var(--muted);font-size:11px;line-height:1.4;min-height:29px}.metric-card strong{display:block;font-size:20px;letter-spacing:-.04em;margin-top:4px;overflow-wrap:anywhere}.metric-card em{font-size:11px;font-style:normal;font-weight:600;color:var(--muted);margin-left:3px}
.stats-card{padding:18px 16px;margin-top:12px}.section-title{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.section-title h2{font-size:16px;margin:0;font-weight:800}.section-title p{font-size:11px;color:var(--muted);margin:4px 0 0}.section-mark{font-size:10px;font-weight:800;color:#a3adbb;letter-spacing:.1em;padding-top:3px}
.category-list{display:grid;gap:17px}.category-row-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.category-name{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}.category-row-top>strong{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}.category-swatch{width:9px;height:9px;border-radius:3px;background:#5279d1}.swatch-1{background:#26a69a}.swatch-2{background:#e5a34d}.swatch-3{background:#9b78d0}.swatch-4{background:#52a5c9}.swatch-5{background:#e07886}
.bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.bar-fill{display:block;height:100%;background:#5279d1;border-radius:99px;transition:width .25s}.fill-1{background:#26a69a}.fill-2{background:#e5a34d}.fill-3{background:#9b78d0}.fill-4{background:#52a5c9}.fill-5{background:#e07886}.category-share{display:block;text-align:right;color:#9aa4b1;font-size:10px;margin-top:4px}
.daily-list{display:grid;gap:13px}.daily-row{display:flex;align-items:center;gap:11px}.daily-date{display:flex;align-items:baseline;justify-content:center;gap:1px;width:34px;flex:none}.daily-date strong{font-size:16px}.daily-date span{font-size:10px;color:var(--muted)}.daily-date.week-index{width:48px;gap:0;white-space:nowrap}.daily-date.week-index strong{font-size:12px}.daily-bar-wrap{flex:1;min-width:0}.daily-bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.daily-bar-track span{display:block;height:100%;background:linear-gradient(90deg,#4f7bd7,#6b9de9);border-radius:99px}.daily-bar-wrap small{display:block;font-size:10px;color:#9aa4b1;margin-top:3px}.daily-amount{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.empty-state{display:flex;align-items:center;flex-direction:column;text-align:center;padding:34px 18px;background:#fff;border:1px dashed #dce3ec;border-radius:18px}.empty-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;background:#edf2ff;color:var(--blue);font-size:23px;margin-bottom:12px}.empty-state strong{font-size:14px}.empty-state p{font-size:12px;color:var(--muted);margin:6px 0 17px}.empty-state button{min-width:140px}.stats-empty{margin-top:8px}
.bottom-nav{position:fixed;z-index:10;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(calc(100% - 28px),460px);display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;padding:6px;background:#ffffffed;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid #e8edf2;border-radius:19px;box-shadow:0 8px 30px #20324b18}.bottom-nav button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:0;background:transparent;color:#8994a3;padding:7px 4px;border-radius:13px;font-size:10px;font-weight:700}.bottom-nav button.active{background:#edf2ff;color:var(--blue)}.nav-icon{font-size:21px;line-height:1.15;font-weight:500}

.pending-transfer-panel{padding:10px 13px;margin-bottom:12px}.pending-transfer-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.pending-transfer-heading h2{font-size:14px;margin:0}.pending-refresh{padding:4px 7px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:11px;font-weight:700}.pending-refresh:active{background:var(--paper)}.pending-transfer-list{display:grid;gap:5px}.pending-transfer-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--line)}.pending-transfer-main{display:grid;gap:4px;min-width:0}.pending-transfer-main strong{font-size:12px;overflow-wrap:anywhere}.pending-transfer-main span{font-size:11px;color:var(--muted)}.pending-transfer-actions{display:flex;align-items:center;gap:7px;flex:none}.pending-delete{width:29px;height:29px;border:1px solid var(--line);border-radius:50%;background:var(--card);color:var(--muted);font-size:20px;line-height:1;display:grid;place-items:center}.pending-retry{padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:800;white-space:nowrap}.pending-transfer-status{flex:none;padding:5px 8px;border-radius:99px;font-size:10px;font-weight:800}.transfer-done{background:#e5f6ed;color:#24815b}.transfer-waiting{background:#fff3d7;color:#9b7620}.pending-transfer-empty{padding:12px 0;color:var(--muted);font-size:12px}
.investment-note{padding:12px 14px;margin:-5px 0 14px;border-radius:13px;background:var(--card);border:1px solid var(--line);font-size:12px;line-height:1.7;color:var(--muted)}
.investment-card{padding:16px;margin-bottom:13px}
.investment-card-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px}
.investment-card-heading h2{margin:0;font-size:17px}.investment-card-heading p{margin:3px 0 0;color:var(--muted);font-size:12px}
.investment-unit{padding:5px 10px;border-radius:9px;background:var(--paper);font-size:12px;font-weight:800;color:var(--blue)}
.investment-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px;padding:12px;background:var(--paper);border-radius:12px}
.investment-summary div{display:grid;gap:4px}.investment-summary small{font-size:11px;color:var(--muted)}.investment-summary strong{font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.transfer-amount{color:var(--blue)}
.investment-positive{color:#25845f}.investment-negative{color:#c44f69}.investment-updated{margin:11px 0 13px;color:var(--muted);font-size:11px}
.investment-save{width:100%}.investment-footnote{font-size:11px;line-height:1.7;color:var(--muted);padding:0 4px}
.year-picker{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 13px;padding:10px 13px;background:#fff;border:1px solid #edf0f4;border-radius:13px;font-size:12px;font-weight:700;color:var(--muted)}.year-picker select{width:125px;padding:8px 10px;font-size:13px;font-weight:750;color:var(--ink)}.annual-hero{margin-bottom:0}.year-month-list{display:grid;gap:15px}.year-month-row{display:grid;grid-template-columns:36px minmax(40px,1fr) minmax(78px,auto);align-items:center;gap:10px}.year-month-label{font-size:12px;font-weight:700;color:#647184}.year-month-track{height:8px;border-radius:99px;background:#f0f3f7;overflow:hidden}.year-month-track span{display:block;height:100%;border-radius:99px;background:var(--blue);transition:width .2s}.year-month-row strong{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.category-share{display:block;color:#9aa4b1;font-size:10px;margin-top:5px}
.entry-mode-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr);gap:8px;margin:-5px 0 12px}.manual-add-button{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;min-height:40px;padding:4px 4px;border:1px solid #e8e8ee;border-radius:11px;background:rgba(255,255,255,.88);color:#454b57;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 5px rgba(40,45,60,.04);transition:transform .15s,box-shadow .15s}.manual-add-button:active{transform:scale(.97);box-shadow:none}.entry-mode-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 22px;width:22px;height:22px;border-radius:7px;font-size:17px;font-weight:800;line-height:1}.expense-icon{background:#fff0ef;color:#d85d59}.income-icon{background:#eaf7ee;color:#329464}.transfer-icon{background:#edf3ff;color:#587fc4;font-size:17px}.income-add-button{background:rgba(255,255,255,.88);color:#454b57;border-color:#e8e8ee}.type-switch{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:5px;border-radius:13px;background:#f2f5f9}.type-switch button{border:0;border-radius:9px;padding:9px;background:transparent;color:#788495;font-size:13px;font-weight:800}.type-switch button.selected{background:#fff;color:#315fbd;box-shadow:0 2px 8px #20324b12}.type-switch button:last-child.selected{color:#16836f}.income-amount-wrap>span{color:#16836f}.income-category-dot{background:#e5f7ef;color:#16836f}.income-amount{color:#16836f}.income-text{color:#16836f!important}.expense-text{color:#d84d4d!important}.batch-actions-empty{margin-top:12px}.transfer-count-link{display:inline-flex;align-items:center;gap:5px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:800;text-align:left;cursor:pointer}.transfer-count-link span{color:#587fc4;font-size:18px}.transfer-count-link:active{opacity:.65}.income-expense-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:11px 0}.income-expense-strip>div{display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px 10px;background:#fff;border:1px solid #edf0f4;border-radius:13px}.income-expense-strip small{font-size:10px;color:var(--muted)}.income-expense-strip strong{font-size:clamp(12px,3.2vw,15px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.piggy-card{display:flex;align-items:center;gap:13px;margin:12px 0;padding:15px;background:linear-gradient(135deg,#fff9ef,#fff);border:1px solid #f5e9d6;border-radius:18px;transition:background .2s,border-color .2s}.piggy-character{display:grid;place-items:center;flex:none;width:64px;height:64px;border-radius:20px;background:#fff0dc;font-size:35px;letter-spacing:-8px;padding-right:7px}.piggy-content{flex:1;min-width:0}.piggy-title{font-size:13px;font-weight:850}.piggy-status{font-size:11px;color:#8c7a64;margin:3px 0 9px}.piggy-track{height:10px;border-radius:99px;background:#f1e7dc;overflow:hidden}.piggy-track span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#74c6a7,#f0bf5e);transition:width .35s,background .2s}.piggy-numbers{display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:10px;color:#8c7a64}.piggy-numbers strong{font-size:11px;color:#5b5044}.piggy-sweating{background:linear-gradient(135deg,#fff0ed,#fff);border-color:#ffc6bc}.piggy-sweating .piggy-character{background:#ffe1dc;animation:piggy-shake .5s ease-in-out infinite alternate}.piggy-sweating .piggy-track span{background:linear-gradient(90deg,#ffad64,#ee5b55)}.piggy-sweating .piggy-status{color:#cb5148}.piggy-broken{background:linear-gradient(135deg,#fff0f0,#fff);border-color:#f3a4a4}.piggy-broken .piggy-character{background:#ffe0e0;filter:grayscale(.2);animation:piggy-shake .18s linear 3}.piggy-broken .piggy-track span{background:#dc4242}.piggy-broken .piggy-status{color:#c92f3b;font-weight:800}.piggy-empty{background:#f8fafc;border-color:#e8edf2}.piggy-empty .piggy-character{background:#edf2ff}.piggy-empty .piggy-track span{background:#b7c2d2}@keyframes piggy-shake{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}.category-emoji{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#f2f5fb;font-size:15px}.annual-income-strip{margin-top:10px}

/* しろちゃんとちび毛のテーマ：クリーム色、桜色、暖かな黄色 */
.brand-mark{display:flex;align-items:center;justify-content:center;gap:0;overflow:hidden}
.brand-mark img{width:27px;height:27px;object-fit:contain;display:block}
.brand-mark img+img{margin-left:-5px}
.puppy-pair{gap:0;letter-spacing:0;padding:3px}
.puppy-pair img{display:block;width:43px;height:43px;object-fit:contain;flex:none;filter:drop-shadow(0 2px 1px #7a4c3010);transition:transform .2s,filter .2s}
.puppy-pair img+img{margin-left:-5px}
.puppy-sweating img{transform:rotate(4deg) translateY(-2px)}
.puppy-broken img:first-child{transform:rotate(-8deg) translateY(2px);filter:grayscale(.35)}
.puppy-broken img:last-of-type{transform:rotate(8deg) translateY(-1px);filter:grayscale(.2)}
.puppy-empty img{opacity:.78}

.brand-mark{box-shadow:inset 0 0 0 1px #f8dce4,0 4px 12px #d96f9110}
.button-primary{background:linear-gradient(135deg,#e989a7,#d96f91);box-shadow:0 4px 10px #d96f9126}
.button-primary:active{background:#bd5376}
.button-secondary{background:#fff0f4;color:#b95478;border-color:#f8dce5}
.button-secondary:active{background:#ffe5ed}
.bottom-nav button.active{background:#fff0f4;color:#bd5376}
.bottom-nav{border-color:#f3e2e7;box-shadow:0 8px 30px #a75d7414}
.page-heading .heading-icon,.metric-icon,.empty-icon{background:#fff0f4;color:#bd5376}
.hero-total{background:linear-gradient(130deg,#e989a7 0%,#d96f91 100%);box-shadow:0 10px 24px #d96f9126}
.entry-number{background:#fff0f4;color:#bd5376}
.count-pill{background:#eaf7ef;color:#44866d}
.capture-panel,.entry-card,.stats-card,.metric-card,.ledger{border-color:#f3e7e9}
.piggy-card{background:linear-gradient(135deg,#fff8e9,#fff);border-color:#f6e6d3}
.piggy-sweating{background:linear-gradient(135deg,#fff0f4,#fff);border-color:#f5c5d4}
.piggy-broken{background:linear-gradient(135deg,#fff0f0,#fff);border-color:#f1b6c2}
.puppy-pair{display:flex;align-items:center;justify-content:center;gap:0;position:relative;flex:none;width:90px;height:76px;border-radius:23px;background:linear-gradient(135deg,#fff0e4,#ffeef4);font-size:28px;letter-spacing:-7px;padding-right:7px;transition:transform .2s,background .2s}
.puppy-pair span{display:inline-block;filter:drop-shadow(0 2px 1px #7a4c3010)}
.puppy-pair small{position:absolute;left:0;right:0;bottom:3px;text-align:center;font-size:8px;letter-spacing:.02em;color:#a77a85;font-weight:800}
.puppy-sweating{background:linear-gradient(135deg,#fff0dc,#ffe8ef);animation:puppy-bob .6s ease-in-out infinite alternate}
.puppy-broken{background:linear-gradient(135deg,#ffe6eb,#fff0f0);animation:puppy-shake .2s linear 3}
.puppy-empty{background:linear-gradient(135deg,#f2f5ff,#fff0f4)}
.puppy-happy{background:linear-gradient(135deg,#fff0e4,#fff0f6)}
@keyframes puppy-bob{from{transform:translateY(0) rotate(-2deg)}to{transform:translateY(-2px) rotate(2deg)}}
@keyframes puppy-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}
@media(prefers-reduced-motion:reduce){.puppy-sweating,.puppy-broken{animation:none}}

@media(min-width:480px){main{padding-left:22px;padding-right:22px}.stats-card{padding:20px}.hero-total{padding:25px 24px 20px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
.edit-overlay{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;padding:18px;background:#2f253566;backdrop-filter:blur(3px)}
.edit-dialog{display:grid;gap:14px;width:min(100%,460px);max-height:min(88dvh,760px);overflow:auto;padding:20px;background:#fffaf9;border:1px solid #f3e0e6;border-radius:22px;box-shadow:0 20px 70px #38233530}
.edit-dialog-heading{display:flex;align-items:center;justify-content:space-between}
.edit-dialog-heading h2{font-size:19px;margin:0}
.edit-dialog-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.edit-dialog .type-switch{margin:0}

.trend-card{overflow:hidden}.trend-summary{display:flex;align-items:baseline;gap:8px;margin:2px 0 4px}.trend-summary strong{font-size:22px;font-weight:800;color:var(--ink)}.trend-summary span,.trend-note{font-size:11px;color:var(--muted)}.trend-chart{display:block;width:100%;height:auto;overflow:visible;margin-top:8px}.chart-grid-line{stroke:var(--line);stroke-width:1}.chart-line{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.income-chart-line{stroke:#54a78c}.ratio-chart-line{stroke:#d96f91}.chart-point{stroke:#fff;stroke-width:1.2}.income-chart-point{fill:#54a78c}.ratio-chart-point{fill:#d96f91}.chart-reference-line{stroke:#d5a34b;stroke-width:1.2;stroke-dasharray:4 4}.chart-reference-danger{stroke:#d96f91}.trend-month-labels{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));padding:0 2px;text-align:center;color:var(--muted);font-size:10px}
.trend-month-labels button{min-width:0;padding:4px 0;border:0;border-radius:7px;background:transparent;color:inherit;font-size:10px}
.trend-month-labels button.trend-month-selected{background:#fff0f4;color:#bd5376;font-weight:850}
.clickable-chart-point{cursor:pointer;outline:none}
.clickable-chart-point:focus,.clickable-chart-point.chart-point-selected{stroke:#bd5376;stroke-width:2.5}
.income-month-breakdown{margin-top:14px;padding:13px;background:#fff9fa;border:1px solid #f3e2e7;border-radius:14px}
.ratio-detail-amounts{display:grid;grid-template-columns:1fr 1fr;gap:9px}.ratio-detail-amounts>div{display:grid;gap:5px;padding:11px;background:#fff;border:1px solid #f3e7e9;border-radius:11px}.ratio-detail-amounts span{font-size:11px;color:var(--muted)}.ratio-detail-amounts strong{font-size:14px;font-variant-numeric:tabular-nums}
.income-breakdown-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.income-breakdown-heading h3{margin:0;font-size:14px}
.income-breakdown-heading p{margin:3px 0 0;font-size:10px;color:var(--muted)}
.income-breakdown-heading>strong{font-size:16px;white-space:nowrap;color:#16836f}.trend-note{margin:8px 0 0;line-height:1.5}

.theme-switcher{display:flex;align-items:center;gap:6px;margin:-13px 0 17px;padding:0 0 2px;flex-wrap:wrap}
.theme-switcher>span{font-size:11px;color:var(--muted);font-weight:700;margin-right:2px}
.theme-switcher button{display:flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--line);border-radius:99px;background:var(--card);color:var(--muted);font-size:10px;font-weight:700}
.theme-switcher button i{display:block;width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 1px #00000010}
.theme-switcher button.selected{border-color:var(--blue);color:var(--blue-dark);background:var(--card);box-shadow:0 0 0 1px var(--blue) inset}
main.theme-blue{--ink:#34485b;--muted:#74899b;--line:#dceaf5;--blue:#78a9d6;--blue-dark:#4f87ba;--paper:#f2f8fd;--card:#fff}
main.theme-yellow{--ink:#5b5037;--muted:#93845f;--line:#f0e5bc;--blue:#d9b957;--blue-dark:#ad8c2e;--paper:#fffbed;--card:#fff}
main.theme-green{--ink:#3d5949;--muted:#789181;--line:#dcebe0;--blue:#78ad91;--blue-dark:#4e896b;--paper:#f1f9f3;--card:#fff}
main.theme-blue .button-secondary,main.theme-blue .bottom-nav button.active,main.theme-blue .page-heading .heading-icon,main.theme-blue .metric-icon,main.theme-blue .empty-icon,main.theme-blue .entry-number,main.theme-blue .calendar-reset,main.theme-blue .trend-month-labels button.trend-month-selected{background:#e5f2fc;color:#4f87ba;border-color:#d1e6f7}
main.theme-yellow .button-secondary,main.theme-yellow .bottom-nav button.active,main.theme-yellow .page-heading .heading-icon,main.theme-yellow .metric-icon,main.theme-yellow .empty-icon,main.theme-yellow .entry-number,main.theme-yellow .calendar-reset,main.theme-yellow .trend-month-labels button.trend-month-selected{background:#fff5cf;color:#a9892d;border-color:#f0e5bc}
main.theme-green .button-secondary,main.theme-green .bottom-nav button.active,main.theme-green .page-heading .heading-icon,main.theme-green .metric-icon,main.theme-green .empty-icon,main.theme-green .entry-number,main.theme-green .calendar-reset,main.theme-green .trend-month-labels button.trend-month-selected{background:#e4f3e8;color:#4e896b;border-color:#d1e8d8}
main.theme-blue .button-primary{background:#78a9d6}main.theme-blue .hero-total{background:linear-gradient(130deg,#78a9d6,#4f87ba)}
main.theme-yellow .button-primary{background:#d9b957}main.theme-yellow .hero-total{background:linear-gradient(130deg,#d9b957,#ad8c2e)}
main.theme-green .button-primary{background:#78ad91}main.theme-green .hero-total{background:linear-gradient(130deg,#78ad91,#4e896b)}
main.theme-blue .calendar-day.calendar-has-spend{background:#e5f2fc;border-color:#d1e6f7}main.theme-blue .calendar-day.calendar-selected{background:#78a9d6;border-color:#78a9d6}
main.theme-yellow .calendar-day.calendar-has-spend{background:#fff5cf;border-color:#f0e5bc}main.theme-yellow .calendar-day.calendar-selected{background:#d9b957;border-color:#d9b957}
main.theme-green .calendar-day.calendar-has-spend{background:#e4f3e8;border-color:#d1e8d8}main.theme-green .calendar-day.calendar-selected{background:#78ad91;border-color:#78ad91}
main.theme-blue .brand-mark{background:linear-gradient(135deg,#eaf5fd,#dcecf9);box-shadow:inset 0 0 0 1px #d1e6f7}
main.theme-yellow .brand-mark{background:linear-gradient(135deg,#fff9df,#f9edc1);box-shadow:inset 0 0 0 1px #f0e5bc}
main.theme-green .brand-mark{background:linear-gradient(135deg,#edf8ef,#dcefe0);box-shadow:inset 0 0 0 1px #d1e8d8}


.category-row-clickable{cursor:pointer;border-radius:12px;padding:8px;margin:-8px;transition:background .15s,transform .15s}
.category-row-clickable:hover,.category-row-clickable:focus-visible{background:color-mix(in srgb,var(--blue) 8%,transparent);outline:none}
.category-row-clickable:active{transform:scale(.99)}








.detail-filter-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 14px;color:var(--muted);font-size:12px}.detail-filter-strip button{min-height:34px;padding:7px 10px;font-size:12px;white-space:nowrap}.detail-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:14px}
.detail-pagination span{font-size:11px;color:var(--muted);text-align:center}
.detail-pagination button{padding:8px 10px;font-size:12px;white-space:nowrap}
</style>
