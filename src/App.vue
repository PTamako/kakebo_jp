<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { parseEntries, ocrImage, CATEGORIES } from './parse.js'

const tab = ref('add')
const month = ref(new Date().toISOString().slice(0, 7))
const rules = ref([]), entries = ref([]), stats = ref(null)
const input = ref(''), busy = ref(''), msg = ref('')
const forms = ref([])
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
    entries.value = await api('entries?month=' + month.value)
    stats.value = await api('stats?month=' + month.value)
  } catch (e) { flash(e.message) }
}
onMounted(load)
watch(month, load)

function recognize() {
  if (!input.value.trim()) return
  forms.value = parseEntries(input.value, rules.value)
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
function addBlank() {
  forms.value.push({ date: new Date().toLocaleDateString('sv-SE'), time: '', amount: 0, category: '其他', merchant: '', note: '', raw: '', suggested: '其他', keyword: '' })
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
      if (f.merchant && f.merchant.length >= 2 && f.category !== f.suggested) {
        await api('rules', { method: 'POST', body: JSON.stringify({ keyword: f.merchant, category: f.category }) })
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
</script>

<template>
  <main>
    <header>
      <input type="month" v-model="month" class="month" />
      <div class="total"><small>本月支出</small><b>{{ yen(stats?.total) }}</b></div>
    </header>
    <p v-if="msg" class="toast">{{ msg }}</p>

    <section v-if="tab === 'add'">
      <textarea v-model="input" rows="5" placeholder="输入或粘贴消费记录。多笔记录请用空行分隔；也可直接上传包含多笔记录的截图。"></textarea>
      <div class="row">
        <button class="main" @click="recognize" :disabled="!!busy">识别文字</button>
        <label class="btn">拍照 / 选图<input type="file" accept="image/*" @change="onImage" hidden /></label>
      </div>
      <p v-if="busy" class="hint">{{ busy }}</p>

      <div v-if="forms.length" class="draft-head">
        <b>待保存记录（{{ forms.length }}）</b>
        <button @click="addBlank">＋ 添加一笔</button>
      </div>
      <div v-for="(f, i) in forms" :key="i" class="card">
        <div class="card-title"><b>第 {{ i + 1 }} 笔</b><button class="x" @click="removeDraft(i)" aria-label="移除此笔">×</button></div>
        <label>日期<input type="date" v-model="f.date" /></label>
        <label>时间<input type="time" v-model="f.time" /></label>
        <label>金额（日元）<input type="number" min="0" inputmode="numeric" v-model.number="f.amount" class="amt" /></label>
        <label>分类<select v-model="f.category"><option v-for="c in CATEGORIES" :key="c">{{ c }}</option></select></label>
        <label>商家<input v-model="f.merchant" /></label>
        <label>备注<input v-model="f.note" /></label>
      </div>
      <button v-if="forms.length" class="main save-all" @click="saveAll">确认并保存 {{ forms.length }} 笔</button>
    </section>

    <section v-else-if="tab === 'list'">
      <p v-if="!entries.length" class="hint">这个月还没有记录。去「记一笔」添加第一笔。</p>
      <ul class="ledger">
        <li v-for="e in entries" :key="e.id">
          <div><b>{{ e.merchant || e.category }}</b><small>{{ e.date.slice(5) }} {{ e.time }} · {{ e.category }}</small></div>
          <span class="amt">{{ yen(e.amount) }}</span>
          <button class="x" @click="remove(e.id)" aria-label="删除">×</button>
        </li>
      </ul>
    </section>

    <section v-else>
      <p v-if="!stats?.count" class="hint">这个月还没有数据。</p>
      <template v-else>
        <h2>分类</h2>
        <div v-for="c in stats.byCategory" :key="c.category" class="bar"><span>{{ c.category }}</span><i :style="{ width: (c.amount / maxCat) * 100 + '%' }"></i><em>{{ yen(c.amount) }}</em></div>
        <h2>每日</h2>
        <div v-for="d in stats.byDay" :key="d.date" class="bar day"><span>{{ d.date.slice(8) }}日</span><i :style="{ width: (d.amount / maxDay) * 100 + '%' }"></i><em>{{ yen(d.amount) }}</em></div>
      </template>
    </section>

    <nav>
      <button :class="{ on: tab === 'add' }" @click="tab = 'add'">记一笔</button>
      <button :class="{ on: tab === 'list' }" @click="tab = 'list'">明细</button>
      <button :class="{ on: tab === 'stat' }" @click="tab = 'stat'">统计</button>
    </nav>
  </main>
</template>

<style>
:root { --paper:#f1f4f1; --ink:#1d2b3a; --rule:#cfd8d3; --blue:#2f4b8a; --stamp:#b6402f; --card:#fbfcfb; color-scheme:light dark; }
@media(prefers-color-scheme:dark){:root{--paper:#141a20;--ink:#e3e9e6;--rule:#2c3640;--blue:#8aa6e8;--stamp:#e0705e;--card:#1b232b}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 "Hiragino Sans","Noto Sans JP","PingFang SC",system-ui,sans-serif;background-image:linear-gradient(var(--rule) 1px,transparent 1px),linear-gradient(90deg,var(--rule) 1px,transparent 1px);background-size:24px 24px;background-position:-1px -1px}
main{max-width:520px;margin:0 auto;padding:calc(12px + env(safe-area-inset-top)) 16px calc(84px + env(safe-area-inset-bottom))}
header{display:flex;justify-content:space-between;align-items:end;padding:8px 0 14px}
.total{text-align:right}.total small{display:block;opacity:.7}.total b{font-size:30px;font-variant-numeric:tabular-nums;color:var(--stamp);letter-spacing:-.5px}
input,select,textarea{width:100%;font:inherit;color:inherit;background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:10px}.month{width:auto;font-weight:600}textarea{resize:vertical}
.row{display:flex;gap:10px;margin:10px 0}
button,.btn{font:inherit;border:1px solid var(--blue);background:transparent;color:var(--blue);border-radius:6px;padding:10px 14px;text-align:center;cursor:pointer;flex:1}
button.main{background:var(--blue);color:var(--paper)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:14px;display:grid;gap:10px;margin-top:12px}
.card label{display:grid;gap:4px;font-size:14px}.amt{font-variant-numeric:tabular-nums;font-weight:600}input.amt{font-size:22px}
.hint{opacity:.7}.toast{background:var(--ink);color:var(--paper);padding:8px 12px;border-radius:6px}
.ledger{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--rule);border-radius:6px}.ledger li{display:grid;grid-template-columns:1fr auto 28px;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--rule)}.ledger li:last-child{border:0}.ledger small{display:block;opacity:.65}
.x{border:0;padding:0;font-size:22px;opacity:.6;color:var(--ink);flex:initial}.card-title,.draft-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.draft-head{margin-top:16px}.draft-head button{flex:initial;padding:6px 10px}.save-all{width:100%;margin-top:14px}
h2{font-size:15px;margin:18px 0 6px}.bar{display:grid;grid-template-columns:56px 1fr 84px;gap:8px;align-items:center;margin:4px 0;font-size:14px}.bar i{display:block;height:14px;background:var(--blue);border-radius:2px;min-width:2px}.bar.day i{background:var(--stamp);opacity:.8}.bar em{font-style:normal;text-align:right;font-variant-numeric:tabular-nums}
nav{position:fixed;left:0;right:0;bottom:0;display:flex;gap:8px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));background:var(--paper);border-top:1px solid var(--rule)}nav button{border-color:var(--rule);color:var(--ink)}nav button.on{border-color:var(--blue);color:var(--blue);font-weight:700}
</style>
