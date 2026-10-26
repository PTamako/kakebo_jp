<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { parseEntries, ocrImage, CATEGORIES as BASE_CATEGORIES } from './parse.js'

const tab = ref('add')
const month = ref(new Date().toISOString().slice(0, 7))
const selectedYear = ref(new Date().getFullYear())
const annualStats = ref(null)
const rules = ref([]), entries = ref([]), stats = ref(null), categories = ref([...BASE_CATEGORIES])
const input = ref(''), busy = ref(''), msg = ref('')
const forms = ref([])
const INCOME_CATEGORIES = ['工资', '奖金', '副业', '退款', '其他收入']
const CATEGORY_ICONS = { '餐饮':'🍜', '日用品':'🧻', '交通':'🚃', '购物':'🛍️', '居住':'🏠', '医疗':'💊', '娱乐':'🎮', '宠物':'🐱', '其他':'✨', '工资':'💴', '奖金':'🎁', '副业':'💻', '退款':'↩️', '其他收入':'🌷' }
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
watch(month, load)
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
const maxCat = computed(() => Math.max(1, ...(stats.value?.byCategory || []).map(c => c.amount)))
const maxDay = computed(() => Math.max(1, ...(stats.value?.byDay || []).map(c => c.amount)))
const categoryRows = computed(() => [...(stats.value?.byCategory || [])].sort((a, b) => b.amount - a.amount))
const dayRows = computed(() => [...(stats.value?.byDay || [])].sort((a, b) => a.date.localeCompare(b.date)))
const averageDaily = computed(() => {
  const days = dayRows.value.length
  return days ? Math.round(Number(stats.value?.total || 0) / days) : 0
})
const monthLabel = computed(() => {
  const [y, m] = month.value.split('-')
  return `${y}年${Number(m)}月`
})
const yearOptions = computed(() => Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - i))
const yearMonthRows = computed(() => {
  const values = new Map((annualStats.value?.byMonth || []).map(item => [item.month, Number(item.amount)]))
  return Array.from({ length: 12 }, (_, i) => {
    const key = `${selectedYear.value}-${String(i + 1).padStart(2, '0')}`
    return { month: key, label: `${i + 1}月`, amount: values.get(key) || 0 }
  })
})
const maxYearMonth = computed(() => Math.max(1, ...yearMonthRows.value.map(item => item.amount)))
const highestSpendMonth = computed(() => yearMonthRows.value.reduce((best, item) => item.amount > best.amount ? item : best, { month: '', label: '暂无', amount: 0 }))
const annualAverage = computed(() => Math.round(Number(annualStats.value?.total || 0) / 12))
const monthlyRatio = computed(() => Number(stats.value?.income || 0) > 0 ? Number(stats.value?.total || 0) / Number(stats.value.income) : null)
const annualRatio = computed(() => Number(annualStats.value?.income || 0) > 0 ? Number(annualStats.value?.total || 0) / Number(annualStats.value.income) : null)
const pigState = ratio => ratio === null ? 'empty' : ratio > 1 ? 'broken' : ratio >= .8 ? 'sweating' : 'happy'
const pigLabel = ratio => ratio === null ? '先记录收入，看看支出占收入多少' : ratio > 1 ? '支出超过收入了，小猪碎掉啦！' : ratio >= .8 ? '快到预算边缘了，小猪热得冒汗！' : '状态不错，小猪还很轻松'
const ratioLabel = ratio => ratio === null ? '暂无收入数据' : Math.round(ratio * 100) + '%'
</script>

<template>
  <main>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">¥</span>
        <div><strong>家計簿</strong><small>毎日の支出を、すっきり管理</small></div>
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
          <button type="button" :class="{ selected: (f.type || 'expense') === 'expense' }" @click="f.type = 'expense'; if (INCOME_CATEGORIES.includes(f.category)) f.category = '日用品'">💸 支出</button>
          <button type="button" :class="{ selected: f.type === 'income' }" @click="f.type = 'income'; if (!INCOME_CATEGORIES.includes(f.category)) f.category = '工资'">🌷 收入</button>
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
      <div class="summary-strip"><span>{{ monthLabel }}</span><strong>{{ entries.length }} 笔记录</strong></div>
      <div v-if="!entries.length" class="empty-state"><span class="empty-icon">▤</span><strong>这个月还没有记录</strong><p>去「记一笔」添加第一笔消费。</p><button class="button-primary" @click="tab = 'add'">添加记录</button></div>
      <ul v-else class="ledger">
        <li v-for="e in entries" :key="e.id">
          <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]">{{ categoryIcon(e.category) }}</span>
          <div class="ledger-info"><b>{{ e.merchant || e.category }}</b><small>{{ e.date.slice(5) }}<template v-if="e.time"> · {{ e.time }}</template> · {{ e.category }} · {{ e.type === 'income' ? '收入' : '支出' }}</small></div>
          <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income' }">{{ e.type === 'income' ? '+' : '−' }}{{ yen(e.amount) }}</span>
          <button class="icon-button delete-button" @click="remove(e.id)" aria-label="删除记录">×</button>
        </li>
      </ul>
    </section>

    <section v-else-if="tab === 'stat'" class="page-section stats-page">
      <div class="page-heading"><div><p class="eyebrow">MONTHLY OVERVIEW</p><h1>支出统计</h1><p class="heading-subtitle">{{ monthLabel }} · 消费概览</p></div><span class="heading-icon">↗</span></div>
      <div class="hero-total">
        <span>本月总支出</span>
        <strong>{{ yen(stats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ stats?.count || 0 }} 笔消费记录</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(monthlyRatio)">
        <div class="piggy-character" aria-hidden="true">{{ pigState(monthlyRatio) === 'broken' ? '🐷💔' : pigState(monthlyRatio) === 'sweating' ? '🐷💦' : '🐷' }}</div>
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
          <div class="section-title"><div><h2>每日支出</h2><p>按日期查看消费变化</p></div><span class="section-mark">02</span></div>
          <div class="daily-list">
            <div v-for="d in dayRows" :key="d.date" class="daily-row">
              <div class="daily-date"><strong>{{ Number(d.date.slice(8)) }}</strong><span>日</span></div>
              <div class="daily-bar-wrap"><div class="daily-bar-track"><span :style="{ width: Math.max(2, (d.amount / maxDay) * 100) + '%' }"></span></div><small>{{ d.date.slice(5) }}</small></div>
              <strong class="daily-amount">{{ yen(d.amount) }}</strong>
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
        <div class="piggy-character" aria-hidden="true">{{ pigState(annualRatio) === 'broken' ? '🐷💔' : pigState(annualRatio) === 'sweating' ? '🐷💦' : '🐷' }}</div>
        <div class="piggy-content"><div class="piggy-title">年度收支平衡</div><div class="piggy-status">{{ pigLabel(annualRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (annualRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出占收入</span><strong>{{ ratioLabel(annualRatio) }}</strong></div></div>
      </div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon">▦</span><small>月均支出（按12个月计算）</small><strong>{{ yen(annualAverage) }}</strong></div>
        <div class="metric-card"><span class="metric-icon">↗</span><small>消费最高月份</small><strong>{{ highestSpendMonth.amount ? highestSpendMonth.label : '暂无' }}</strong><em v-if="highestSpendMonth.amount">{{ yen(highestSpendMonth.amount) }}</em></div>
      </div>
      <div v-if="!annualStats?.count" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>这一年还没有记录</strong><p>选择其他年份，或添加消费记录后再查看。</p><button class="button-primary" @click="tab = 'add'">记一笔</button></div>
      <template v-else>
        <div class="stats-card">
          <div class="section-title"><div><h2>每月支出</h2><p>{{ selectedYear }}年1月至12月</p></div><span class="section-mark">01</span></div>
          <div class="year-month-list">
            <div v-for="item in yearMonthRows" :key="item.month" class="year-month-row">
              <span class="year-month-label">{{ item.label }}</span>
              <div class="year-month-track"><span :style="{ width: item.amount ? Math.max(2, item.amount / maxYearMonth * 100) + '%' : '0%' }"></span></div>
              <strong>{{ item.amount ? yen(item.amount) : '—' }}</strong>
            </div>
          </div>
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
:root{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","PingFang SC",system-ui,sans-serif;color:#202b37;background:#f5f7fa;font-synthesis:none;text-rendering:optimizeLegibility;--ink:#202b37;--muted:#7c8795;--line:#e8edf2;--blue:#315fbd;--blue-dark:#244b9a;--paper:#f5f7fa;--card:#fff;--teal:#168b82}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
button:disabled{opacity:.45;cursor:not-allowed}
main{width:min(100%,560px);min-height:100dvh;margin:0 auto;padding:calc(12px + env(safe-area-inset-top)) 18px calc(104px + env(safe-area-inset-bottom))}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 24px}
.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:14px;background:#e6edff;color:var(--blue);font-size:23px;font-weight:800}.brand strong{display:block;font-size:17px;letter-spacing:.02em}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:1px}
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
.ledger{list-style:none;margin:0;padding:3px 14px;background:#fff;border:1px solid #edf0f4;border-radius:17px;box-shadow:0 5px 20px #24354b08}.ledger li{display:flex;align-items:center;gap:11px;padding:13px 0;border-bottom:1px solid #eff2f6;min-width:0}.ledger li:last-child{border-bottom:0}.category-dot{display:grid;place-items:center;flex:none;width:39px;height:39px;border-radius:13px;background:#edf2ff;color:#315fbd;font-size:14px;font-weight:800}.cat-2{background:#e8f7f2;color:#16836f}.cat-3{background:#fff2df;color:#b87518}.cat-4{background:#f3eaff;color:#8755bd}.cat-5{background:#e8f5fb;color:#267da0}.cat-6{background:#ffecef;color:#c45569}.cat-7{background:#fff0e5;color:#bd6c39}.cat-8{background:#fcebdc;color:#a65b2a}.cat-9{background:#eef1f5;color:#667384}.ledger-info{min-width:0;flex:1}.ledger-info b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ledger-info small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.ledger-amount{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.delete-button{font-size:20px;width:24px}
.hero-total{position:relative;overflow:hidden;background:linear-gradient(130deg,#315fbd 0%,#284d9b 100%);border-radius:21px;padding:22px 21px 18px;color:#fff;box-shadow:0 10px 24px #315fbd24}.hero-total:after{content:"";position:absolute;width:155px;height:155px;border:1px solid #ffffff1c;border-radius:50%;right:-38px;top:-74px;box-shadow:0 0 0 22px #ffffff08,0 0 0 45px #ffffff06}.hero-total>span{display:block;font-size:12px;color:#dbe5ff}.hero-total>strong{display:block;font-size:clamp(29px,8vw,39px);line-height:1.25;letter-spacing:-.045em;margin:8px 0 15px;font-variant-numeric:tabular-nums}.hero-footer{display:flex;align-items:center;gap:7px;font-size:11px;color:#dbe5ff}.hero-dot{width:6px;height:6px;border-radius:50%;background:#76e0c1}
.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:11px 0 19px}.metric-card{padding:14px 14px 15px;min-width:0}.metric-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#edf2ff;color:var(--blue);font-size:17px;margin-bottom:10px}.metric-card small{display:block;color:var(--muted);font-size:11px;line-height:1.4;min-height:29px}.metric-card strong{display:block;font-size:20px;letter-spacing:-.04em;margin-top:4px;overflow-wrap:anywhere}.metric-card em{font-size:11px;font-style:normal;font-weight:600;color:var(--muted);margin-left:3px}
.stats-card{padding:18px 16px;margin-top:12px}.section-title{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.section-title h2{font-size:16px;margin:0;font-weight:800}.section-title p{font-size:11px;color:var(--muted);margin:4px 0 0}.section-mark{font-size:10px;font-weight:800;color:#a3adbb;letter-spacing:.1em;padding-top:3px}
.category-list{display:grid;gap:17px}.category-row-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.category-name{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}.category-row-top>strong{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}.category-swatch{width:9px;height:9px;border-radius:3px;background:#5279d1}.swatch-1{background:#26a69a}.swatch-2{background:#e5a34d}.swatch-3{background:#9b78d0}.swatch-4{background:#52a5c9}.swatch-5{background:#e07886}
.bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.bar-fill{display:block;height:100%;background:#5279d1;border-radius:99px;transition:width .25s}.fill-1{background:#26a69a}.fill-2{background:#e5a34d}.fill-3{background:#9b78d0}.fill-4{background:#52a5c9}.fill-5{background:#e07886}.category-share{display:block;text-align:right;color:#9aa4b1;font-size:10px;margin-top:4px}
.daily-list{display:grid;gap:13px}.daily-row{display:flex;align-items:center;gap:11px}.daily-date{display:flex;align-items:baseline;justify-content:center;gap:1px;width:34px;flex:none}.daily-date strong{font-size:16px}.daily-date span{font-size:10px;color:var(--muted)}.daily-bar-wrap{flex:1;min-width:0}.daily-bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.daily-bar-track span{display:block;height:100%;background:linear-gradient(90deg,#4f7bd7,#6b9de9);border-radius:99px}.daily-bar-wrap small{display:block;font-size:10px;color:#9aa4b1;margin-top:3px}.daily-amount{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.empty-state{display:flex;align-items:center;flex-direction:column;text-align:center;padding:34px 18px;background:#fff;border:1px dashed #dce3ec;border-radius:18px}.empty-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;background:#edf2ff;color:var(--blue);font-size:23px;margin-bottom:12px}.empty-state strong{font-size:14px}.empty-state p{font-size:12px;color:var(--muted);margin:6px 0 17px}.empty-state button{min-width:140px}.stats-empty{margin-top:8px}
.bottom-nav{position:fixed;z-index:10;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(calc(100% - 28px),460px);display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:7px;background:#ffffffed;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid #e8edf2;border-radius:19px;box-shadow:0 8px 30px #20324b18}.bottom-nav button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:0;background:transparent;color:#8994a3;padding:7px 4px;border-radius:13px;font-size:10px;font-weight:700}.bottom-nav button.active{background:#edf2ff;color:var(--blue)}.nav-icon{font-size:21px;line-height:1.15;font-weight:500}
.year-picker{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 13px;padding:10px 13px;background:#fff;border:1px solid #edf0f4;border-radius:13px;font-size:12px;font-weight:700;color:var(--muted)}.year-picker select{width:125px;padding:8px 10px;font-size:13px;font-weight:750;color:var(--ink)}.annual-hero{margin-bottom:0}.year-month-list{display:grid;gap:15px}.year-month-row{display:grid;grid-template-columns:36px minmax(40px,1fr) minmax(78px,auto);align-items:center;gap:10px}.year-month-label{font-size:12px;font-weight:700;color:#647184}.year-month-track{height:8px;border-radius:99px;background:#f0f3f7;overflow:hidden}.year-month-track span{display:block;height:100%;border-radius:99px;background:var(--blue);transition:width .2s}.year-month-row strong{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.category-share{display:block;color:#9aa4b1;font-size:10px;margin-top:5px}
.entry-mode-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:-5px 0 12px}.manual-add-button{min-height:43px;font-size:12px}.income-add-button{background:#fff4f0;color:#c15e48;border-color:#ffe1d8}.type-switch{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:5px;border-radius:13px;background:#f2f5f9}.type-switch button{border:0;border-radius:9px;padding:9px;background:transparent;color:#788495;font-size:13px;font-weight:800}.type-switch button.selected{background:#fff;color:#315fbd;box-shadow:0 2px 8px #20324b12}.type-switch button:last-child.selected{color:#16836f}.income-amount-wrap>span{color:#16836f}.income-category-dot{background:#e5f7ef;color:#16836f}.income-amount{color:#16836f}.income-text{color:#16836f!important}.expense-text{color:#d84d4d!important}.batch-actions-empty{margin-top:12px}.income-expense-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:11px 0}.income-expense-strip>div{display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px 10px;background:#fff;border:1px solid #edf0f4;border-radius:13px}.income-expense-strip small{font-size:10px;color:var(--muted)}.income-expense-strip strong{font-size:clamp(12px,3.2vw,15px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.piggy-card{display:flex;align-items:center;gap:13px;margin:12px 0;padding:15px;background:linear-gradient(135deg,#fff9ef,#fff);border:1px solid #f5e9d6;border-radius:18px;transition:background .2s,border-color .2s}.piggy-character{display:grid;place-items:center;flex:none;width:64px;height:64px;border-radius:20px;background:#fff0dc;font-size:35px;letter-spacing:-8px;padding-right:7px}.piggy-content{flex:1;min-width:0}.piggy-title{font-size:13px;font-weight:850}.piggy-status{font-size:11px;color:#8c7a64;margin:3px 0 9px}.piggy-track{height:10px;border-radius:99px;background:#f1e7dc;overflow:hidden}.piggy-track span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#74c6a7,#f0bf5e);transition:width .35s,background .2s}.piggy-numbers{display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:10px;color:#8c7a64}.piggy-numbers strong{font-size:11px;color:#5b5044}.piggy-sweating{background:linear-gradient(135deg,#fff0ed,#fff);border-color:#ffc6bc}.piggy-sweating .piggy-character{background:#ffe1dc;animation:piggy-shake .5s ease-in-out infinite alternate}.piggy-sweating .piggy-track span{background:linear-gradient(90deg,#ffad64,#ee5b55)}.piggy-sweating .piggy-status{color:#cb5148}.piggy-broken{background:linear-gradient(135deg,#fff0f0,#fff);border-color:#f3a4a4}.piggy-broken .piggy-character{background:#ffe0e0;filter:grayscale(.2);animation:piggy-shake .18s linear 3}.piggy-broken .piggy-track span{background:#dc4242}.piggy-broken .piggy-status{color:#c92f3b;font-weight:800}.piggy-empty{background:#f8fafc;border-color:#e8edf2}.piggy-empty .piggy-character{background:#edf2ff}.piggy-empty .piggy-track span{background:#b7c2d2}@keyframes piggy-shake{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}.category-emoji{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#f2f5fb;font-size:15px}.annual-income-strip{margin-top:10px}
@media(min-width:480px){main{padding-left:22px;padding-right:22px}.stats-card{padding:20px}.hero-total{padding:25px 24px 20px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
</style>
