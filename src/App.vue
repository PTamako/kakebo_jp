<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { parseEntries, ocrImage, CATEGORIES as BASE_CATEGORIES } from './parse.js'

const tab = ref('add')
const month = ref(new Date().toISOString().slice(0, 7))
const selectedYear = ref(new Date().getFullYear())
const annualStats = ref(null)
const selectedIncomeMonth = ref('')
const rules = ref([]), entries = ref([]), stats = ref(null), categories = ref([...BASE_CATEGORIES])
const input = ref(''), busy = ref(''), msg = ref('')
const forms = ref([])
const editingEntry = ref(null)
const INCOME_CATEGORIES = ['工资', '奖金', '副业', '老公生活费', '父母赠与', '亲友赠与', '退款', '其他收入']
const CATEGORY_ICONS = { '餐饮':'🍜', '饮食料品':'🛒', '日用品':'🧻', '交通':'🚃', '购物':'🛍️', '居住':'🏠', '医疗':'💊', '娱乐':'🎮', '宠物':'🐱', '其他':'✨', '工资':'💴', '奖金':'🎁', '副业':'💻', '老公生活费':'🏠', '父母赠与':'💝', '亲友赠与':'🎁', '退款':'↩️', '其他收入':'🌷' }
const categoryIcon = name => CATEGORY_ICONS[name] || '🧾'
const token = ref(localStorage.getItem('token') || '')

async function api(path, opt = {}) {
  const r = await fetch('/api/' + path, {
    ...opt, headers: { 'content-type': 'application/json', 'x-token': token.value }
  })
  if (r.status === 401) {
    const t = prompt('请输入访问口令')
    if (t) { token.value = t; localStorage.setItem('token', t); return api(path, opt) }
    throw new Error('需要口令')
  }
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || '请求失败')
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
  catch (e) { flash('年度统计加载失败：' + e.message) }
}
onMounted(() => { load(); loadYear() })
watch(month, () => { selectedDay.value = ''; swipedEntryId.value = null; load() })
watch(selectedYear, loadYear)
watch(tab, value => { if (value === 'year') loadYear() })

function recognize() {
  if (!input.value.trim()) return
  forms.value = parseEntries(input.value, rules.value).map(f => ({ ...f, bindRule: false }))
  flash(forms.value.length > 1 ? `识别到 ${forms.value.length} 笔记录，请检查后批量保存` : '请检查识别结果')
}
async function onImage(e) {
  const f = e.target.files[0]; e.target.value = ''
  if (!f) return
  busy.value = '识别中 0%（首次需下载日文语言包）'
  try {
    input.value = await ocrImage(f, p => (busy.value = `识别中 ${p}%`))
    recognize()
  } catch (err) { flash('图片识别失败：' + err.message) }
  busy.value = ''
}
function addBlank(type = 'expense') {
  const category = type === 'income' ? '工资' : '日用品'
  forms.value.push({ date: new Date().toLocaleDateString('sv-SE'), time: '', amount: 0, type, category, merchant: '', note: '', raw: '', suggested: category, keyword: '', bindRule: false })
}
function setEntryType(form, type) {
  form.type = type
  if (type === 'income' && !INCOME_CATEGORIES.includes(form.category)) form.category = '工资'
  if (type === 'expense' && INCOME_CATEGORIES.includes(form.category)) form.category = '日用品'
}
async function addCategory() {
  const name = prompt('请输入新分类名称（最多20字）')
  if (!name?.trim()) return
  try {
    await api('categories', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
    categories.value = await api('categories')
    flash('分类已新增')
  } catch (e) { flash('新增分类失败：' + e.message) }
}
function removeDraft(i) { forms.value.splice(i, 1) }

async function saveAll() {
  if (!forms.value.length) return flash('没有可保存的记录')
  const invalid = forms.value.findIndex(f => !(Number(f.amount) > 0))
  if (invalid >= 0) return flash(`第 ${invalid + 1} 笔金额无效，请检查`)
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
    flash(`已保存 ${saved} 笔记录`)
    await load()
  } catch (e) { flash(`已保存部分记录；后续保存失败：${e.message}。请刷新明细确认，避免重复保存。`) }
}
async function remove(id) {
  if (!confirm('删除这一笔？')) return
  await api('entries/' + id, { method: 'DELETE' }); load()
}
function startEdit(entry) {
  editingEntry.value = {
    id: entry.id, date: entry.date, time: entry.time || '',
    amount: Number(entry.amount), type: entry.type === 'income' ? 'income' : 'expense',
    category: entry.category || '日用品', merchant: entry.merchant || '',
    note: entry.note || '', raw: entry.raw || ''
  }
}
function cancelEdit() { editingEntry.value = null }
async function saveEdit() {
  const e = editingEntry.value
  if (!e) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(Number(e.amount) > 0)) {
    flash('请检查日期和金额')
    return
  }
  try {
    await api('entries/' + e.id, {
      method: 'PUT',
      body: JSON.stringify({ ...e, amount: Number(e.amount) })
    })
    editingEntry.value = null
    flash('记录已更新')
    await load()
  } catch (err) { flash('更新失败：' + err.message) }
}
const maxCat = computed(() => Math.max(1, ...(stats.value?.byCategory || []).map(c => c.amount)))
const maxDay = computed(() => Math.max(1, ...(stats.value?.byDay || []).map(c => c.amount)))
const categoryRows = computed(() => [...(stats.value?.byCategory || [])].sort((a, b) => b.amount - a.amount))
const dayRows = computed(() => [...(stats.value?.byDay || [])].sort((a, b) => a.date.localeCompare(b.date)))
const selectedDay = ref('')
const swipedEntryId = ref(null)
let touchStartX = 0
let touchStartY = 0
let suppressRowClick = false
const filteredEntries = computed(() => selectedDay.value ? entries.value.filter(e => e.date === selectedDay.value) : entries.value)
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
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-')
  return `${y}年${Number(m)}月`
})
const yearOptions = computed(() => Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i))
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
const highestSpendMonth = computed(() => yearMonthRows.value.reduce((best, item) => item.amount > best.amount ? item : best, { month: '', label: '暂无', amount: 0 }))
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
  selectedIncomeMonth.value = point.month
}
const monthlyRatio = computed(() => Number(stats.value?.income || 0) > 0 ? Number(stats.value?.total || 0) / Number(stats.value.income) : null)
const annualRatio = computed(() => Number(annualStats.value?.income || 0) > 0 ? Number(annualStats.value?.total || 0) / Number(annualStats.value.income) : null)
const pigState = ratio => ratio === null ? 'empty' : ratio > 1 ? 'broken' : ratio >= .8 ? 'sweating' : 'happy'
const pigLabel = ratio => ratio === null ? '先记下收入，让小白和鸡毛看看收支情况' : ratio > 1 ? '糟糕！鸡毛和小白一起崩溃了！' : ratio >= .8 ? '快到预算边缘啦，鸡毛都冒汗了！' : '状态不错，小白和鸡毛都很轻松'
const ratioLabel = ratio => ratio === null ? '暂无收入数据' : Math.round(ratio * 100) + '%'
</script>

<template>
  <main>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-label="小白和鸡毛"><img src="https://stickershop.line-scdn.net/stickershop/v1/product/17142161/LINEStorePC/main.png?v=1" alt="小白" /><img src="https://stickershop.line-scdn.net/stickershop/v1/product/24856095/LINEStorePC/main.png?v=1" alt="鸡毛" /></span>
        <div><strong>家計簿 <span class="brand-heart">♡</span></strong><small>和小白、鸡毛一起记账</small></div>
      </div>
      <input type="month" v-model="month" class="month" aria-label="统计月份" />
    </header>

    <p v-if="msg" class="toast" role="status">{{ msg }}</p>

    <section v-if="tab === 'add'" class="page-section">
      <div class="page-heading"><div><p class="eyebrow">NEW ENTRY</p><h1>记一笔</h1></div><button class="button-secondary manage-category" @click="addCategory">＋ 新增分类</button></div>
      <div class="entry-mode-row">
        <button class="button-secondary manual-add-button" @click="addBlank('expense')">✍️ 手动添加支出</button>
        <button class="button-secondary manual-add-button income-add-button" @click="addBlank('income')">＋ 记录收入</button>
      </div>
      <div class="panel capture-panel">
        <label class="field-label" for="entry-text">文字识别</label>
        <textarea id="entry-text" v-model="input" rows="4" placeholder="例如：昨天 罗森 680円&#10;&#10;多笔消费可以分段粘贴，也可以上传小票图片。"></textarea>
        <div class="action-row">
          <button class="button-primary" @click="recognize" :disabled="!!busy || !input.trim()">识别文字</button>
          <label class="button-secondary upload-button">拍照 / 选图片<input type="file" accept="image/*" @change="onImage" hidden /></label>
        </div>
        <div v-if="busy" class="progress-wrap"><span class="spinner"></span><span>{{ busy }}</span></div>
        <p class="microcopy">图片在当前设备本地识别，不会上传到 OCR 服务。</p>
      </div>

      <div v-if="forms.length" class="draft-heading">
        <div><h2>确认识别结果</h2><p>保存前请核对金额和商家</p></div>
        <span class="count-pill">{{ forms.length }} 笔</span>
      </div>
      <div v-for="(f, i) in forms" :key="i" class="entry-card">
        <div class="entry-card-heading"><span class="entry-number">{{ String(i + 1).padStart(2, '0') }}</span><strong>{{ f.merchant || '新记录' }}</strong><button class="icon-button remove-button" @click="removeDraft(i)" aria-label="移除此笔">×</button></div>
        <div class="type-switch" role="group" aria-label="记录类型">
          <button type="button" :class="{ selected: (f.type || 'expense') === 'expense' }" @click="setEntryType(f, 'expense')">💸 支出</button>
          <button type="button" :class="{ selected: f.type === 'income' }" @click="setEntryType(f, 'income')">🌷 收入</button>
        </div>
        <label class="form-field amount-field"><span>{{ f.type === 'income' ? '收入金额（日元）' : '支出金额（日元）' }}</span><div class="amount-input-wrap" :class="{ 'income-amount-wrap': f.type === 'income' }"><span>¥</span><input type="number" min="0" inputmode="numeric" v-model.number="f.amount" aria-label="金额（日元）" /></div></label>
        <div class="field-grid">
          <label class="form-field"><span>日期</span><input type="date" v-model="f.date" /></label>
          <label class="form-field"><span>时间</span><input type="time" v-model="f.time" /></label>
          <label class="form-field"><span>分类</span><select v-model="f.category"><option v-for="c in (f.type === 'income' ? INCOME_CATEGORIES : categories)" :key="c">{{ c }}</option></select></label>
          <label class="form-field"><span>商家</span><input v-model="f.merchant" /></label>
        </div>
        <label class="form-field"><span>备注</span><input v-model="f.note" placeholder="可选" /></label>
        <label v-if="f.type !== 'income' && f.merchant && f.merchant.trim().length >= 2" class="bind-rule"><input v-model="f.bindRule" type="checkbox" /> <span>将此商家绑定到所选分类，下次自动识别</span></label>
      </div>
      <div class="batch-actions" :class="{ 'batch-actions-empty': !forms.length }">
        <button class="button-secondary" @click="addBlank('expense')">＋ 再加一笔</button>
        <button class="button-primary" @click="saveAll" :disabled="!forms.length">保存 {{ forms.length }} 笔</button>
      </div>
    </section>

    <section v-else-if="tab === 'list'" class="page-section">
      <div class="page-heading"><div><p class="eyebrow">TRANSACTIONS</p><h1>收支明细</h1></div><span class="heading-icon">≡</span></div>
      <section class="month-calendar" aria-label="月度消费日历">
        <div class="calendar-heading"><strong>{{ monthLabel }}</strong><button v-if="selectedDay" class="calendar-reset" @click="selectedDay = ''">查看整月</button></div>
        <div class="calendar-weekdays"><span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{ weekday }}</span></div>
        <div class="calendar-grid">
          <button v-for="day in calendarDays" :key="day.key" type="button" class="calendar-day" :class="{ 'calendar-blank': day.blank, 'calendar-selected': selectedDay === day.date, 'calendar-has-spend': day.amount > 0 }" :disabled="day.blank" @click="toggleDay(day.date)" :aria-label="day.blank ? undefined : day.date + ' 支出 ' + yen(day.amount)">
            <template v-if="!day.blank"><span class="calendar-day-number">{{ day.day }}</span><small v-if="day.amount > 0">{{ yen(day.amount) }}</small><small v-else class="calendar-no-spend">—</small></template>
          </button>
        </div>
      </section>
      <div class="summary-strip"><span>{{ selectedDay ? selectedDay.replace(/-/g, '/') + ' 当日明细' : monthLabel }}</span><strong>{{ filteredEntries.length }} 笔记录</strong></div>
      <div v-if="!entries.length" class="empty-state"><span class="empty-icon">▤</span><strong>这个月还没有记录</strong><p>去「记一笔」添加第一笔消费。</p><button class="button-primary" @click="tab = 'add'">添加记录</button></div>
      <div v-else-if="filteredEntries.length === 0" class="empty-state filtered-empty"><span class="empty-icon">♡</span><strong>{{ selectedDay ? '这一天还没有记录' : '这个月还没有记录' }}</strong><p>{{ selectedDay ? '点击日历中的日期可切换查看。' : '去「记一笔」添加第一笔消费。' }}</p><button v-if="selectedDay" class="button-secondary" @click="selectedDay = ''">查看整月</button><button v-else class="button-primary" @click="tab = 'add'">添加记录</button></div>
      <ul v-else class="ledger">
        <li v-for="e in filteredEntries" :key="e.id" :class="{ 'swiped-open': swipedEntryId === e.id }" @touchstart.passive="startSwipe($event)" @touchend="endSwipe($event, e.id)" @touchcancel="swipedEntryId = null">
          <div class="ledger-row-content" role="button" tabindex="0" @click="handleEntryClick(e)" @keydown.enter.prevent="startEdit(e)" @keydown.space.prevent="startEdit(e)">
            <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]">{{ categoryIcon(e.category) }}</span>
            <div class="ledger-info"><b>{{ e.merchant || e.category }}</b><small>{{ e.date.slice(5) }}<template v-if="e.time"> · {{ e.time }}</template> · {{ e.category }} · {{ e.type === 'income' ? '收入' : '支出' }}</small></div>
            <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income' }">{{ e.type === 'income' ? '+' : '−' }}{{ yen(e.amount) }}</span>
          </div>
          <button class="swipe-delete" @click.stop="remove(e.id); swipedEntryId = null" aria-label="删除记录">删除</button>
        </li>
      </ul>
      <div v-if="editingEntry" class="edit-overlay" @click.self="cancelEdit">
        <form class="edit-dialog" @submit.prevent="saveEdit">
          <div class="edit-dialog-heading"><h2>编辑记录</h2><button type="button" class="icon-button" @click="cancelEdit" aria-label="关闭">×</button></div>
          <div class="type-switch" role="group" aria-label="记录类型">
            <button type="button" :class="{ selected: editingEntry.type === 'expense' }" @click="setEntryType(editingEntry, 'expense')">💸 支出</button>
            <button type="button" :class="{ selected: editingEntry.type === 'income' }" @click="setEntryType(editingEntry, 'income')">🌷 收入</button>
          </div>
          <label class="form-field"><span>金额（日元）</span><input v-model.number="editingEntry.amount" type="number" min="1" inputmode="numeric" required /></label>
          <div class="field-grid">
            <label class="form-field"><span>日期</span><input v-model="editingEntry.date" type="date" required /></label>
            <label class="form-field"><span>时间</span><input v-model="editingEntry.time" type="time" /></label>
            <label class="form-field"><span>分类</span><select v-model="editingEntry.category"><option v-for="c in (editingEntry.type === 'income' ? INCOME_CATEGORIES : categories)" :key="c" :value="c">{{ c }}</option></select></label>
            <label class="form-field"><span>商家</span><input v-model="editingEntry.merchant" /></label>
          </div>
          <label class="form-field"><span>备注</span><input v-model="editingEntry.note" /></label>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" @click="cancelEdit">取消</button><button type="submit" class="button-primary">保存修改</button></div>
        </form>
      </div>
    </section>

    <section v-else-if="tab === 'stat'" class="page-section stats-page">
      <div class="page-heading"><div><p class="eyebrow">MONTHLY OVERVIEW</p><h1>支出统计</h1><p class="heading-subtitle">{{ monthLabel }} · 消费概览</p></div><span class="heading-icon">↗</span></div>
      <div class="hero-total">
        <span>本月总支出</span>
        <strong>{{ yen(stats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ stats?.count || 0 }} 笔消费记录</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(monthlyRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(monthlyRatio)" aria-label="小白和鸡毛"><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="小白贴图预览" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="鸡毛和小白贴图预览" loading="lazy" /><small>小白 × 鸡毛</small></div>
        <div class="piggy-content"><div class="piggy-title">本月收支平衡</div><div class="piggy-status">{{ pigLabel(monthlyRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (monthlyRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出占收入</span><strong>{{ ratioLabel(monthlyRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip"><div><small>本月收入</small><strong class="income-text">＋{{ yen(stats?.income) }}</strong></div><div><small>本月支出</small><strong>−{{ yen(stats?.total) }}</strong></div><div><small>结余</small><strong :class="Number(stats?.income || 0) - Number(stats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(stats?.income || 0) - Number(stats?.total || 0)) }}</strong></div></div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon">▦</span><small>支出笔数</small><strong>{{ stats?.count || 0 }}<em>笔</em></strong></div>
        <div class="metric-card"><span class="metric-icon">↗</span><small>日均消费（有消费日）</small><strong>{{ yen(averageDaily) }}</strong></div>
      </div>
      <div v-if="!stats?.count" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>还没有统计数据</strong><p>添加消费记录后，这里会显示支出分布。</p><button class="button-primary" @click="tab = 'add'">记一笔</button></div>
      <template v-else>
        <div class="stats-card">
          <div class="section-title"><div><h2>分类支出</h2><p>看看钱主要花在哪里</p></div><span class="section-mark">01</span></div>
          <div class="category-list">
            <div v-for="(c, i) in categoryRows" :key="c.category" class="category-row">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ c.category }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span :class="'bar-fill fill-' + (i % 6)" :style="{ width: Math.max(2, (c.amount / maxCat) * 100) + '%' }"></span></div>
              <small class="category-share">{{ stats.total ? Math.round(c.amount / stats.total * 100) : 0 }}% of total</small>
            </div>
          </div>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>每周支出</h2><p>按周一至周日汇总，首尾周按本月日期计算</p></div><span class="section-mark">02</span></div>
          <div class="daily-list">
            <div v-for="(w, i) in weekRows" :key="w.key" class="daily-row weekly-row">
              <div class="daily-date week-index"><strong>第{{ i + 1 }}</strong><span>周</span></div>
              <div class="daily-bar-wrap"><div class="daily-bar-track"><span :style="{ width: Math.max(2, (w.amount / maxWeek) * 100) + '%' }"></span></div><small>{{ w.label }} · {{ w.days }}个消费日</small></div>
              <strong class="daily-amount">{{ yen(w.amount) }}</strong>
            </div>
          </div>
        </div>
      </template>
    </section>

    <section v-else-if="tab === 'year'" class="page-section stats-page annual-page">
      <div class="page-heading"><div><p class="eyebrow">YEARLY OVERVIEW</p><h1>年度统计</h1><p class="heading-subtitle">按年份汇总全年消费</p></div><span class="heading-icon">⌁</span></div>
      <label class="year-picker"><span>统计年份</span><select v-model.number="selectedYear" aria-label="统计年份"><option v-for="y in yearOptions" :key="y" :value="y">{{ y }}年</option></select></label>
      <div class="hero-total annual-hero">
        <span>{{ selectedYear }}年总支出</span><strong>{{ yen(annualStats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ annualStats?.count || 0 }} 笔支出记录</div>
      </div>
      <div class="income-expense-strip annual-income-strip"><div><small>全年收入</small><strong class="income-text">＋{{ yen(annualStats?.income) }}</strong></div><div><small>全年支出</small><strong>−{{ yen(annualStats?.total) }}</strong></div><div><small>全年结余</small><strong :class="Number(annualStats?.income || 0) - Number(annualStats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(annualStats?.income || 0) - Number(annualStats?.total || 0)) }}</strong></div></div>
      <div class="piggy-card" :class="'piggy-' + pigState(annualRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(annualRatio)" aria-label="小白和鸡毛"><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="小白贴图预览" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="鸡毛和小白贴图预览" loading="lazy" /><small>小白 × 鸡毛</small></div>
        <div class="piggy-content"><div class="piggy-title">年度收支平衡</div><div class="piggy-status">{{ pigLabel(annualRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (annualRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出占收入</span><strong>{{ ratioLabel(annualRatio) }}</strong></div></div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon">▦</span><small>月均支出（按12个月计算）</small><strong>{{ yen(annualAverage) }}</strong></div>
        <div class="metric-card"><span class="metric-icon">↗</span><small>消费最高月份</small><strong>{{ highestSpendMonth.amount ? highestSpendMonth.label : '暂无' }}</strong><em v-if="highestSpendMonth.amount">{{ yen(highestSpendMonth.amount) }}</em></div>
      </div>
      <div v-if="!annualStats?.count && !Number(annualStats?.income || 0)" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>这一年还没有记录</strong><p>选择其他年份，或添加消费记录后再查看。</p><button class="button-primary" @click="tab = 'add'">记一笔</button></div>
      <template v-else>
        <div v-if="annualStats?.count" class="stats-card">
          <div class="section-title"><div><h2>每月支出</h2><p>{{ selectedYear }}年1月至12月</p></div><span class="section-mark">01</span></div>
          <div class="year-month-list">
            <div v-for="item in yearMonthRows" :key="item.month" class="year-month-row">
              <span class="year-month-label">{{ item.label }}</span>
              <div class="year-month-track"><span :style="{ width: item.amount ? Math.max(2, item.amount / maxYearMonth * 100) + '%' : '0%' }"></span></div>
              <strong>{{ item.amount ? yen(item.amount) : '—' }}</strong>
            </div>
          </div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>收入变化曲线</h2><p>按月查看全年收入走势</p></div><span class="section-mark">03</span></div>
          <div class="trend-summary"><strong>{{ yen(incomeTrendMax) }}</strong><span>单月最高收入</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年收入变化曲线'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polyline :points="incomeTrendLine" class="chart-line income-chart-line" />
            <circle v-for="point in incomeTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point income-chart-point clickable-chart-point" :class="{ 'chart-point-selected': selectedIncomeMonth === point.month }" role="button" tabindex="0" :aria-label="point.label + '收入 ' + yen(point.income) + '，点击查看分类'" @click="selectIncomeMonth(point)" @keydown.enter.prevent="selectIncomeMonth(point)" @keydown.space.prevent="selectIncomeMonth(point)" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" :class="{ 'trend-month-selected': selectedIncomeMonth === item.month }" @click="selectIncomeMonth(item)">{{ Number(item.month.slice(5)) }}</button></div>
          <p class="trend-note">点击曲线上的月份，即可查看该月各收入分类的金额。</p>
          <div v-if="selectedIncomeMonthRow" class="income-month-breakdown">
            <div class="income-breakdown-heading"><div><h3>{{ selectedIncomeMonthRow.label }}收入分类</h3><p>{{ selectedYear }}年 · {{ selectedIncomeCategories.length }} 个分类</p></div><strong>{{ yen(selectedIncomeMonthRow.income) }}</strong></div>
            <div v-if="selectedIncomeCategories.length" class="category-list">
              <div v-for="(c, i) in selectedIncomeCategories" :key="c.category" class="category-row">
                <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ c.category }}</span><strong>{{ yen(c.amount) }}</strong></div>
                <div class="bar-track"><span class="bar-fill" :class="'fill-' + (i % 6)" :style="{ width: Math.max(2, Number(c.amount) / Math.max(1, Number(selectedIncomeMonthRow.income)) * 100) + '%' }"></span></div>
                <small class="category-share">{{ selectedIncomeMonthRow.income ? Math.round(Number(c.amount) / Number(selectedIncomeMonthRow.income) * 100) : 0 }}% of monthly income</small>
              </div>
            </div>
            <p v-else class="trend-note">这个月还没有收入记录。</p>
          </div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>收支比变化曲线</h2><p>支出 ÷ 收入；虚线参考 80% 与 100%</p></div><span class="section-mark">04</span></div>
          <div class="trend-summary"><strong>{{ ratioTrendMax ? Math.round(ratioTrendMax * 100) + '%' : '暂无' }}</strong><span>最高月度支出占收入比例</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年收支比变化曲线'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <line x1="16" y1="64.27" x2="304" y2="64.27" class="chart-reference-line" />
            <line x1="16" y1="53.33" x2="304" y2="53.33" class="chart-reference-line chart-reference-danger" />
            <polyline v-if="ratioTrendLine" :points="ratioTrendLine" class="chart-line ratio-chart-line" />
            <circle v-for="point in ratioTrendPoints.filter(point => point.ratio !== null)" :key="point.month" :cx="point.x" :cy="point.y" r="2.7" class="chart-point ratio-chart-point" />
          </svg>
          <div class="trend-month-labels"><span v-for="item in yearMonthRows" :key="item.month">{{ Number(item.month.slice(5)) }}</span></div>
          <p class="trend-note">没有收入的月份不计算比例；曲线纵轴为 0%–150%，超过 150% 的点按上限显示。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度分类收入</h2><p>按全年累计金额排序</p></div><span class="section-mark">05</span></div>
          <div v-if="annualIncomeCategories.length" class="category-list">
            <div v-for="(c, i) in annualIncomeCategories" :key="c.category" class="category-row">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ c.category }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill" :class="'fill-' + (i % 6)" :style="{ width: Math.max(2, Number(c.amount) / maxAnnualIncomeCategory * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.income ? Math.round(Number(c.amount) / Number(annualStats.income) * 100) : 0 }}% of annual income</small>
            </div>
          </div>
          <p v-else class="trend-note">这一年还没有收入记录。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度分类支出</h2><p>按全年累计金额排序</p></div><span class="section-mark">02</span></div>
          <div class="category-list">
            <div v-for="(c, i) in (annualStats?.byCategory || [])" :key="c.category" class="category-row">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji">{{ categoryIcon(c.category) }}</span>{{ c.category }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill" :class="'fill-' + (i % 6)" :style="{ width: Math.max(2, Number(c.amount) / Math.max(1, Number(annualStats?.total || 0)) * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.total ? Math.round(Number(c.amount) / Number(annualStats.total) * 100) : 0 }}% of total</small>
            </div>
          </div>
        </div>
      </template>
    </section>

    <nav class="bottom-nav" aria-label="主导航">
      <button :class="{ active: tab === 'add' }" @click="tab = 'add'"><span class="nav-icon">＋</span><span>记一笔</span></button>
      <button :class="{ active: tab === 'list' }" @click="tab = 'list'"><span class="nav-icon">≡</span><span>明细</span></button>
      <button :class="{ active: tab === 'stat' }" @click="tab = 'stat'"><span class="nav-icon">▥</span><span>月统计</span></button>
      <button :class="{ active: tab === 'year' }" @click="tab = 'year'"><span class="nav-icon">▤</span><span>年统计</span></button>
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
main{width:min(100%,560px);min-height:100dvh;margin:0 auto;padding:calc(12px + env(safe-area-inset-top)) 18px calc(104px + env(safe-area-inset-bottom))}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 24px}
.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:grid;place-items:center;width:58px;height:42px;border-radius:15px;background:linear-gradient(135deg,#fff0e6,#ffeaf1);color:var(--blue);font-size:20px;font-weight:800;letter-spacing:-7px;padding-right:7px;box-shadow:inset 0 0 0 1px #f8dce4}.brand strong{display:block;font-size:17px;letter-spacing:.02em}.brand-heart{color:#e985a2;font-size:15px}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:1px}
input,select,textarea{width:100%;min-width:0;border:1px solid #e0e6ed;border-radius:11px;background:#fff;color:var(--ink);padding:11px 12px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:#8da9e8;box-shadow:0 0 0 3px #315fbd18}
.month{width:142px;padding:9px 8px;font-size:12px;font-weight:650;background:#fff}
.page-section{animation:appear .18s ease-out}@keyframes appear{from{opacity:.6;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.page-heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 18px}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.15em;color:var(--blue);margin:0 0 4px}.page-heading h1{font-size:27px;line-height:1.2;letter-spacing:-.045em;margin:0;font-weight:800}.heading-subtitle{font-size:12px;color:var(--muted);margin:7px 0 0}.heading-icon{display:grid;place-items:center;width:43px;height:43px;border-radius:15px;background:#e9efff;color:var(--blue);font-size:25px;font-weight:500}
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
.icon-button{border:0;background:transparent;color:#9ba5b2;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:23px;padding:0;flex:none}.icon-button:active{background:#f1f3f6}.form-field{display:grid;gap:6px;min-width:0}.form-field>span{font-size:11px;color:#7c8795;font-weight:650}.form-field input,.form-field select{font-size:13px;padding:10px;border-radius:10px}.amount-input-wrap{display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #e0e6ed;border-radius:12px;background:#fbfcff}.amount-input-wrap>span{font-size:18px;color:var(--blue);font-weight:800}.amount-input-wrap input{border:0;box-shadow:none;background:transparent;padding:11px 0;font-size:26px;font-weight:800;letter-spacing:-.04em;color:var(--ink)}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
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
.bottom-nav{position:fixed;z-index:10;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(calc(100% - 28px),460px);display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:7px;background:#ffffffed;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid #e8edf2;border-radius:19px;box-shadow:0 8px 30px #20324b18}.bottom-nav button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:0;background:transparent;color:#8994a3;padding:7px 4px;border-radius:13px;font-size:10px;font-weight:700}.bottom-nav button.active{background:#edf2ff;color:var(--blue)}.nav-icon{font-size:21px;line-height:1.15;font-weight:500}
.year-picker{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 13px;padding:10px 13px;background:#fff;border:1px solid #edf0f4;border-radius:13px;font-size:12px;font-weight:700;color:var(--muted)}.year-picker select{width:125px;padding:8px 10px;font-size:13px;font-weight:750;color:var(--ink)}.annual-hero{margin-bottom:0}.year-month-list{display:grid;gap:15px}.year-month-row{display:grid;grid-template-columns:36px minmax(40px,1fr) minmax(78px,auto);align-items:center;gap:10px}.year-month-label{font-size:12px;font-weight:700;color:#647184}.year-month-track{height:8px;border-radius:99px;background:#f0f3f7;overflow:hidden}.year-month-track span{display:block;height:100%;border-radius:99px;background:var(--blue);transition:width .2s}.year-month-row strong{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.category-share{display:block;color:#9aa4b1;font-size:10px;margin-top:5px}
.entry-mode-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:-5px 0 12px}.manual-add-button{min-height:43px;font-size:12px}.income-add-button{background:#fff4f0;color:#c15e48;border-color:#ffe1d8}.type-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;border-radius:13px;background:#f2f5f9}.type-switch button{border:0;border-radius:9px;padding:9px;background:transparent;color:#788495;font-size:13px;font-weight:800}.type-switch button.selected{background:#fff;color:#315fbd;box-shadow:0 2px 8px #20324b12}.type-switch button:last-child.selected{color:#16836f}.income-amount-wrap>span{color:#16836f}.income-category-dot{background:#e5f7ef;color:#16836f}.income-amount{color:#16836f}.income-text{color:#16836f!important}.expense-text{color:#d84d4d!important}.batch-actions-empty{margin-top:12px}.income-expense-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:11px 0}.income-expense-strip>div{display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px 10px;background:#fff;border:1px solid #edf0f4;border-radius:13px}.income-expense-strip small{font-size:10px;color:var(--muted)}.income-expense-strip strong{font-size:clamp(12px,3.2vw,15px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.piggy-card{display:flex;align-items:center;gap:13px;margin:12px 0;padding:15px;background:linear-gradient(135deg,#fff9ef,#fff);border:1px solid #f5e9d6;border-radius:18px;transition:background .2s,border-color .2s}.piggy-character{display:grid;place-items:center;flex:none;width:64px;height:64px;border-radius:20px;background:#fff0dc;font-size:35px;letter-spacing:-8px;padding-right:7px}.piggy-content{flex:1;min-width:0}.piggy-title{font-size:13px;font-weight:850}.piggy-status{font-size:11px;color:#8c7a64;margin:3px 0 9px}.piggy-track{height:10px;border-radius:99px;background:#f1e7dc;overflow:hidden}.piggy-track span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#74c6a7,#f0bf5e);transition:width .35s,background .2s}.piggy-numbers{display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:10px;color:#8c7a64}.piggy-numbers strong{font-size:11px;color:#5b5044}.piggy-sweating{background:linear-gradient(135deg,#fff0ed,#fff);border-color:#ffc6bc}.piggy-sweating .piggy-character{background:#ffe1dc;animation:piggy-shake .5s ease-in-out infinite alternate}.piggy-sweating .piggy-track span{background:linear-gradient(90deg,#ffad64,#ee5b55)}.piggy-sweating .piggy-status{color:#cb5148}.piggy-broken{background:linear-gradient(135deg,#fff0f0,#fff);border-color:#f3a4a4}.piggy-broken .piggy-character{background:#ffe0e0;filter:grayscale(.2);animation:piggy-shake .18s linear 3}.piggy-broken .piggy-track span{background:#dc4242}.piggy-broken .piggy-status{color:#c92f3b;font-weight:800}.piggy-empty{background:#f8fafc;border-color:#e8edf2}.piggy-empty .piggy-character{background:#edf2ff}.piggy-empty .piggy-track span{background:#b7c2d2}@keyframes piggy-shake{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}.category-emoji{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#f2f5fb;font-size:15px}.annual-income-strip{margin-top:10px}

/* 小白与鸡毛主题：整站统一使用柔和奶油色、樱花粉与暖黄色 */
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
.income-breakdown-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.income-breakdown-heading h3{margin:0;font-size:14px}
.income-breakdown-heading p{margin:3px 0 0;font-size:10px;color:var(--muted)}
.income-breakdown-heading>strong{font-size:16px;white-space:nowrap;color:#16836f}.trend-note{margin:8px 0 0;line-height:1.5}
</style>
