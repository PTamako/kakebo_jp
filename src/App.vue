<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import puppyWorried from './assets/puppy-worried.gif'
import puppyCrying from './assets/puppy-crying.jpg'
import { groupAnnualEntries } from './detail-pagination.js'
import { parseReceipt, parseEntries, ocrImage, CATEGORIES as BASE_CATEGORIES } from './parse.js'
import { compressReceiptImage } from './receipt-image.js'
import FinanceTools from './FinanceTools.vue'
import { checkRecurringEntries } from './recurring-check.js'
import { saveReceiptImage, getReceiptImage, deleteReceiptImage, cleanupReceiptImages } from './receipt-store.js'

const tab = ref('add')
const statsPeriod = ref('month')
const theme = ref(localStorage.getItem('kakeibo-theme') || 'pink')
const themes = [{ id: 'pink', label: 'ピンク', color: '#d96f91' }, { id: 'blue', label: 'ブルー', color: '#78a9d6' }, { id: 'yellow', label: 'イエロー', color: '#d9b957' }, { id: 'green', label: 'グリーン', color: '#78ad91' }]
function setTheme(value) { theme.value = value; localStorage.setItem('kakeibo-theme', value) }
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const month = ref(currentMonth())
function resetMonth() { month.value = currentMonth() }
const selectedYear = ref(new Date().getFullYear())
const annualStats = ref(null)
const selectedRatioMonth = ref('')
const rules = ref([]), entries = ref([]), stats = ref(null), categories = ref([...BASE_CATEGORIES])
const input = ref(''), busy = ref(''), msg = ref('')
const forms = ref([])
const defaultPaymentSources = ['現金', 'Suica', 'PayPay', '楽天カード', '三井住友カード', 'セブンカード・プラス', 'セゾンカード', 'その他']
function readPaymentSources() {
  try {
    const stored = JSON.parse(localStorage.getItem('kakeibo-payment-sources') || 'null')
    if (Array.isArray(stored)) return ['現金', ...new Set(stored.filter(x => typeof x === 'string' && x.trim() && x !== '現金'))]
  } catch {}
  return [...defaultPaymentSources]
}
const paymentSources = ref(readPaymentSources())
function updatePaymentSources(values) {
  paymentSources.value = values
  localStorage.setItem('kakeibo-payment-sources', JSON.stringify(values))
}
const pendingReceiptImage = ref(null)
const pendingReceiptFileName = ref('')
const editReceiptImage = ref(null)
const editReceiptFileName = ref('')
const receiptSaveError = ref('')
async function selectDraftReceipt(event, form) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try { const blob = await compressReceiptImage(file); form.receiptImage = blob; form.receiptFileName = file.name; receiptSaveError.value = '' }
  catch { receiptSaveError.value = 'レシート画像を準備できませんでした。元の写真を保管してください。' }
}
async function selectEditReceipt(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try { const blob = await compressReceiptImage(file); editReceiptImage.value = blob; editReceiptFileName.value = file.name; receiptSaveError.value = '' }
  catch { receiptSaveError.value = 'レシート画像を準備できませんでした。元の写真を保管してください。' }
}
async function persistReceipt(id, blob) {
  const entryId = Number(id)
  if (!Number.isSafeInteger(entryId) || entryId <= 0) throw new Error('記録IDを確認できません')
  await saveReceiptImage(entryId, blob)
  if (!await getReceiptImage(entryId)) throw new Error('保存した画像を確認できません')
  receiptImageIds.value = new Set([...receiptImageIds.value, entryId])
}

const receiptImageIds = ref(new Set())
const viewedReceiptUrl = ref('')
const viewedReceiptId = ref(null)
async function refreshReceiptImageIds() {
  const visible = [...(entries.value || []), ...(displayEntries.value || [])]
  const ids = [...new Set(visible.map(entry => Number(entry.id)).filter(Number.isSafeInteger))]
  const present = await Promise.all(ids.map(async id => {
    try { return [id, !!(await getReceiptImage(id))] }
    catch { return [id, false] }
  }))
  receiptImageIds.value = new Set(present.filter(([, found]) => found).map(([id]) => id))
}
async function viewReceipt(entryId) {
  const blob = await getReceiptImage(entryId)
  if (!blob) { receiptImageIds.value = new Set([...receiptImageIds.value].filter(id => Number(id) !== Number(entryId))); return flash('レシート画像は保存されていません') }
  if (viewedReceiptUrl.value) URL.revokeObjectURL(viewedReceiptUrl.value)
  viewedReceiptUrl.value = URL.createObjectURL(blob)
  viewedReceiptId.value = entryId
}
function closeReceipt() {
  if (viewedReceiptUrl.value) URL.revokeObjectURL(viewedReceiptUrl.value)
  viewedReceiptUrl.value = ''
  viewedReceiptId.value = null
}
async function removeReceiptImage() {
  if (!confirm('レシート画像のみ削除します。記録は残ります。よろしいですか？')) return
  await deleteReceiptImage(viewedReceiptId.value)
  receiptImageIds.value = new Set([...receiptImageIds.value].filter(id => id !== viewedReceiptId.value))
  closeReceipt()
  flash('レシート画像を削除しました。記録は残っています')
}
const editingEntry = ref(null)
const INCOME_CATEGORIES = ['工资', '奖金', '副业', '老公生活费', '父母赠与', '亲友赠与', '退款', '其他收入']
const CATEGORY_ICON_PATHS = {
 '餐饮':'M4 14h16M5 14a7 7 0 0 0 14 0M8 19h8M8 5v5M12 5v5M16 5v5',
 '饮食料品':'M3 6h2l2 11h12l2-8H6M9 21h.01M18 21h.01',
 '日用品':'M7 4h10l2 16H5L7 4ZM9 8h6',
 '交通':'M5 16V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v9H5ZM5 11h14M8 20v-4M16 20v-4',
 '购物':'M5 8h14l1 12H4L5 8ZM9 9V6a3 3 0 0 1 6 0v3',
 '居住':'M3 11l9-8 9 8M6 9v11h12V9M10 20v-7h4v7',
 '医疗':'M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4Z',
 '娱乐':'M7 7h10l4 8-3 4-4-4h-4l-4 4-3-4 4-8ZM8 11v4M6 13h4M16 11h.01M18 13h.01',
 '宠物':'M7 9h.01M17 9h.01M5 6h.01M19 6h.01M12 11c-3 0-7 4-7 7 0 2 2 3 4 2l3-1 3 1c2 1 4 0 4-2 0-3-4-7-7-7Z',
 '工资':'M4 8h16v12H4V8ZM7 8V5h10v3M8 14h8',
 '奖金':'M4 10h16v10H4V10ZM3 7h18v3H3V7ZM12 7v13M8 7c-3-4 3-6 4 0 1-6 7-4 4 0',
 '副业':'M3 7h18v13H3V7ZM8 7V4h8v3M3 12h18',
 '老公生活费':'M3 11l9-8 9 8M6 9v11h12V9M10 20v-7h4v7',
 '父母赠与':'M4 10h16v10H4V10ZM3 7h18v3H3V7ZM12 7v13',
 '亲友赠与':'M4 10h16v10H4V10ZM3 7h18v3H3V7ZM12 7v13',
 '退款':'M8 6 3 11l5 5M3 11h11a6 6 0 0 1 0 12',
 '投資・資産移動':'M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4'
}
const ICON_LIBRARY = [
  { id:'food', label:'飲食料品', path:CATEGORY_ICON_PATHS['饮食料品'] },
  { id:'dining', label:'外食', path:CATEGORY_ICON_PATHS['餐饮'] },
  { id:'daily', label:'日用品', path:CATEGORY_ICON_PATHS['日用品'] },
  { id:'transport', label:'交通', path:CATEGORY_ICON_PATHS['交通'] },
  { id:'shopping', label:'買い物', path:CATEGORY_ICON_PATHS['购物'] },
  { id:'home', label:'住居費', path:CATEGORY_ICON_PATHS['居住'] },
  { id:'medical', label:'医療費', path:CATEGORY_ICON_PATHS['医疗'] },
  { id:'pet', label:'ペット', path:CATEGORY_ICON_PATHS['宠物'] },
  { id:'beauty', label:'美容', path:'M9 3h6v5H9zM8 8h8v12H8zM10 12h4M18 3v4M16 5h4' },
  { id:'education', label:'教育', path:'M2 9l10-5 10 5-10 5-10-5ZM6 11v5c3 3 9 3 12 0v-5M21 10v6' },
  { id:'insurance', label:'保険', path:'M12 3l8 3v5c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3ZM9 12l2 2 4-4' },
  { id:'utilities', label:'光熱費', path:'M13 2 5 13h6l-1 9 9-12h-6V2Z' },
  { id:'phone', label:'通信', path:'M7 2h10v20H7zM10 5h4M11 19h2' },
  { id:'tax', label:'税金', path:'M4 21h16M5 19V9h14v10M3 9l9-6 9 6M8 12v4M12 12v4M16 12v4' },
  { id:'travel', label:'旅行', path:'M3 15l7 1 8 5 2-1-5-6 5-5c2-2 0-4-2-2l-5 5-6-5-1 2 5 8-8-2Z' },
  { id:'subscriptions', label:'サブスク', path:'M4 5h16v14H4zM10 9l5 3-5 3V9Z' },
  { id:'gift', label:'贈り物', path:CATEGORY_ICON_PATHS['奖金'] },
  { id:'electricity', label:'電気', path:'M13 2 5 13h6l-1 9 9-12h-6z' },
  { id:'water', label:'水道', path:'M12 3C9 7 6 11 6 15a6 6 0 0 0 12 0c0-4-3-8-6-12Z' },
  { id:'gas', label:'ガス', path:'M12 3c1 5-4 5-4 10-2-1-2-3-2-3-3 7 1 11 6 11s8-4 6-9c-1 2-2 2-3 2 1-5-2-8-3-11Z' },
  { id:'rent', label:'家賃', path:'M3 11l9-8 9 8M6 10v10h12V10M10 20v-6h4v6' },
  { id:'internet', label:'インターネット', path:'M3 9a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 15a5 5 0 0 1 6 0M12 19h.01' },
  { id:'hair', label:'美容院', path:'M4 5l16 14M20 5 4 19M5 5h.01M5 19h.01' },
  { id:'cosmetics', label:'化粧品', path:'M9 3h6v5H9zM8 8h8v12H8zM10 13h4' },
  { id:'clothes', label:'衣服', path:'M8 4 4 6 2 10l4 2v8h12v-8l4-2-2-4-4-2c-1 3-7 3-8 0Z' },
  { id:'shoes', label:'靴', path:'M4 5h5l3 8 6 2c2 1 3 2 3 4H3v-3z' },
  { id:'books', label:'書籍', path:'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z' },
  { id:'lessons', label:'習い事', path:'M4 20h16M6 17 16 4l3 3-10 13H6z' },
  { id:'childcare', label:'子育て', path:'M8 10a4 4 0 1 0 8 0 4 4 0 0 0-8 0ZM5 21c0-4 3-6 7-6s7 2 7 6' },
  { id:'family', label:'家族', path:'M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M16 14c3 0 5 2 5 5v1' },
  { id:'car', label:'車', path:'M4 16l1-6 2-4h10l2 4 1 6v3h-2v-2H6v2H4zM5 12h14M7 15h.01M17 15h.01' },
  { id:'bicycle', label:'自転車', path:'M5 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM5 16l5-7 3 7H5l7-5h4M10 9H8' },
  { id:'fuel', label:'ガソリン', path:'M5 20V4h10v16M3 20h14M7 6h6v5H7zM15 9h2l2 2v6a2 2 0 0 0 2 0v-5' },
  { id:'parking', label:'駐車場', path:'M4 3h16v18H4zM9 18V6h4a3 3 0 0 1 0 6H9' },
  { id:'fitness', label:'運動', path:'M4 8v8M2 10v4M7 6v12M7 12h10M17 6v12M20 8v8M22 10v4' },
  { id:'health', label:'健康', path:'M12 21S3 16 3 10a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 11-9 11Z' },
  { id:'medicine', label:'薬', path:'M5 12 12 5a5 5 0 0 1 7 7l-7 7a5 5 0 0 1-7-7ZM8 9l7 7' },
  { id:'dental', label:'歯科', path:'M7 4c-3 0-4 3-3 7l2 7c1 4 3 3 4-1l2-4 2 4c1 4 3 5 4 1l2-7c1-4 0-7-3-7-2 0-3 1-5 1S9 4 7 4Z' },
  { id:'cafe', label:'カフェ', path:'M4 7h13v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM17 9h2a2 2 0 0 1 0 4h-2M3 21h16' },
  { id:'hobby', label:'趣味', path:'M5 5h14v14H5zM8 9h8M8 13h5' },
  { id:'music', label:'音楽', path:'M9 18V5l10-2v13M9 8l10-2M9 18c0 2-4 3-5 1s3-4 5-3M19 16c0 2-4 3-5 1s3-4 5-3' },
  { id:'movie', label:'映画', path:'M3 6h18v13H3zM3 10h18M7 6l3 4M14 6l3 4' },
  { id:'electronics', label:'家電', path:'M4 5h16v12H4zM9 21h6M12 17v4' },
  { id:'furniture', label:'家具', path:'M4 10v8M20 10v8M4 14h16M6 14V8h12v6M6 18v2M18 18v2' },
  { id:'repair', label:'修理', path:'M14 5a5 5 0 0 0-6 6L3 16l5 5 5-5a5 5 0 0 0 6-6l-3 3-3-3z' },
  { id:'charity', label:'寄付', path:'M12 20S4 15 4 10a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 5-8 10-8 10Z' },
  { id:'bank', label:'銀行', path:'M3 9l9-6 9 6H3ZM5 10v8M9 10v8M15 10v8M19 10v8M3 20h18' },
  { id:'savings', label:'貯金', path:'M4 9h16v10H4zM8 9V6h8v3M15 14h2' },
  { id:'fees', label:'手数料', path:'M5 5h14v14H5zM8 9h8M8 13h8M8 17h4' },
  { id:'delivery', label:'配送料', path:'M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4' },
  { id:'cleaning', label:'清掃', path:'M8 3h8v5H8zM7 8h10l2 12H5zM9 12h6' },
  { id:'events', label:'イベント', path:'M4 6h16v14H4zM8 3v6M16 3v6M4 11h16' },
  { id:'work', label:'仕事', path:'M3 7h18v13H3zM8 7V4h8v3M3 12h18' },
  { id:'phone-device', label:'スマホ本体', path:'M7 2h10v20H7zM10 5h4M11 19h2' },
  { id:'other', label:'その他', path:'M5 3h14v18H5V3ZM8 8h8M8 12h8M8 16h5' }
]
const categoryIcons = ref({})
const availableIcons = computed(() => {
  const used = new Set(Object.values(categoryIcons.value))
  const existingPaths = new Set(categories.value.map(name => CATEGORY_ICON_PATHS[name]).filter(Boolean))
  const existingLabels = new Set(categories.value.map(name => CATEGORY_LABELS[name] || name))
  return ICON_LIBRARY.filter(icon => icon.id === 'other' || (!used.has(icon.id) && !existingPaths.has(icon.path) && !existingLabels.has(icon.label)))
})
const categoryIconPath = name => ICON_LIBRARY.find(icon => icon.id === categoryIcons.value[name])?.path || CATEGORY_ICON_PATHS[name] || ICON_LIBRARY.at(-1).path
const CATEGORY_LABELS = { '投資・資産移動':'資産移動', '餐饮':'外食', '饮食料品':'飲食料品', '日用品':'日用品', '交通':'交通費', '购物':'買い物', '居住':'住居費', '医疗':'医療費', '娱乐':'娯楽', '宠物':'ペット', '其他':'その他', '工资':'給与', '奖金':'賞与', '副业':'副業', '老公生活费':'配偶者からの生活費', '父母赠与':'親からの贈与', '亲友赠与':'親族・友人からの贈与', '退款':'返金', '其他收入':'その他の収入' }
const categoryLabel = name => CATEGORY_LABELS[name] || name

// Store only a revocable, 30-day device session; never persist the access code.
localStorage.removeItem('token')
const token = ref(localStorage.getItem('kakeibo-device-session') || '')
const locked = ref(!token.value && localStorage.getItem('kakeibo-logged-out') === '1')
async function signIn(code) {
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'アクセスコードを確認してください')
  token.value = result.session
  localStorage.setItem('kakeibo-device-session', result.session)
  localStorage.removeItem('kakeibo-logged-out')
  sessionStorage.removeItem('kakeibo-token')
  locked.value = false
  checkRecurringEntries(api).then(() => { load(); loadYear() }).catch(e => flash('固定支出の自動記録に失敗しました：'+e.message))
}
async function logout() {
  if (busy.value || editSaving.value || investmentBusy.value || transferActionId.value !== null) return flash('処理が完了してからログアウトしてください')
  if (!confirm('ログアウトしますか？未保存の入力は失われます。')) return
  const oldSession = token.value
  token.value = ''
  localStorage.removeItem('kakeibo-device-session')
  sessionStorage.removeItem('kakeibo-token')
  localStorage.setItem('kakeibo-logged-out', '1')
  locked.value = true
  if (oldSession) {
    try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-session': oldSession } }) }
    catch { /* Device is logged out locally even when offline. */ }
  }
}
let loginPromise = null
let rejectedSession = ''
async function ensureLogin() {
  if (loginPromise) return loginPromise
  loginPromise = (async () => {
    const code = prompt('アクセスコードを入力してください')
    if (!code) throw new Error('アクセスコードが必要です')
    await signIn(code)
  })()
  try { await loginPromise } finally { loginPromise = null }
}
async function unlock() {
  try { await ensureLogin(); await Promise.all([load(), loadYear(), loadInvestments(), loadTransfers()]) }
  catch (error) { flash(error.message) }
}
async function api(path, opt = {}) {
  // All requests wait for the same login; never display concurrent prompts.
  if (!token.value) await ensureLogin()
  const requestToken = token.value
  const r = await fetch('/api/' + path, {
    ...opt, headers: { 'content-type': 'application/json', 'x-session': requestToken, ...(opt.headers || {}) }
  })
  if (r.status === 401) {
    // A different request may already have refreshed the session.
    if (token.value !== requestToken) return api(path, opt)
    if (rejectedSession !== requestToken) {
      rejectedSession = requestToken
      token.value = ''
      localStorage.removeItem('kakeibo-device-session')
    }
    await ensureLogin()
    return api(path, opt)
  }
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'リクエストに失敗しました')
  return d
}

const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
let flashTimer
const flash = t => { clearTimeout(flashTimer); msg.value = t; flashTimer = setTimeout(() => (msg.value = ''), 3000) }

let loadRequestId = 0
async function load() {
  const requestId = ++loadRequestId
  const requestedMonth = month.value
  try {
    if (!rules.value.length) rules.value = await api('rules')
    const [nextCategories, nextEntries, nextStats] = await Promise.all([api('categories'), api('entries?month=' + requestedMonth), api('stats?month=' + requestedMonth)])
    if (requestId !== loadRequestId || requestedMonth !== month.value) return
    categories.value = nextCategories
    try { categoryIcons.value = await api('category-icons') } catch { /* Existing categories keep their default icons. */ }
    entries.value = nextEntries
    refreshReceiptImageIds().catch(() => {})
    stats.value = nextStats
  } catch (e) { flash(e.message) }
}
let yearRequestId = 0
async function loadYear() {
  const requestId = ++yearRequestId
  const year = selectedYear.value
  try {
    const nextStats = await api('stats?year=' + year)
    if (requestId === yearRequestId && year === selectedYear.value) annualStats.value = nextStats
  } catch (e) { if (requestId === yearRequestId) flash('年間集計の読み込みに失敗しました：' + e.message) }
}
onMounted(() => { cleanupReceiptImages().catch(() => {}); if (!locked.value) { load(); loadYear(); loadInvestments(); loadTransfers(); checkRecurringEntries(api).then(count => { if (count) { load(); loadYear() } }).catch(e => flash('固定支出の自動記録に失敗しました：'+e.message)) } })

watch(month, async () => { selectedDay.value = ''; calendarExpanded.value = false; swipedEntryId.value = null; swipedReceiptId.value = null; visibleEntryCount.value = 20; await load(); if (tab.value === 'list' && detailFilter.value?.period === 'month') await openCategoryDetails(detailFilter.value.category, detailFilter.value.type, 'month') })
watch(selectedYear, async () => { visibleEntryCount.value = 20; await loadYear(); if (tab.value === 'list' && detailFilter.value?.period === 'year') await openCategoryDetails(detailFilter.value.category, detailFilter.value.type, 'year') })
watch(tab, value => {
  if (value === 'stat' && statsPeriod.value === 'year') loadYear()
  if (value === 'list') visibleEntryCount.value = 20
})
watch(statsPeriod, value => { if (tab.value === 'stat' && value === 'year') loadYear() })

const recognitionMode = ref('statement')
const entryInputMode = ref('manual')
function recognize(mode = recognitionMode.value, append = false) {
  recognitionMode.value = mode
  if (!input.value.trim()) return
  const parsed = mode === 'receipt' ? [parseReceipt(input.value, rules.value)] : parseEntries(input.value, rules.value)
  if (mode !== 'receipt') { pendingReceiptImage.value = null; pendingReceiptFileName.value = '' }
  const parsedForms = parsed.map(f => {
    const transferText = [f.merchant, f.note, f.raw].filter(Boolean).join(' ')
    const transfer = /証券投信積立サービス|投信積立サービス|翌月買付分/.test(transferText) || (/SBI/i.test(transferText) && /投信積立|投資信託積立/.test(transferText))
    return { ...f, type: transfer ? 'transfer' : f.type, category: transfer ? '投資・資産移動' : f.category, transferTarget: f.transferTarget || '', transferDate: f.transferDate || f.date, paymentSource: f.paymentSource || '', receiptImage: mode === 'receipt' && !transfer ? pendingReceiptImage.value : null, receiptFileName: mode === 'receipt' && !transfer && pendingReceiptImage.value ? pendingReceiptFileName.value : '', showReceiptAttachment: mode === 'receipt', bindRule: false }
  })
  forms.value = append ? [...forms.value, ...parsedForms] : parsedForms
  entryInputMode.value = 'scan'
  flash(forms.value.length > 1 ? `${forms.value.length}件の記録を読み取りました。内容を確認して一括保存してください` : '読み取り結果を確認してください')
}
async function onImage(e, mode = 'statement') {
  const f = e.target.files[0]; e.target.value = ''
  if (!f || busy.value) return
  busy.value = '読み取り中 0%（初回は日本語データをダウンロードします）'
  try {
    input.value = await ocrImage(f, p => (busy.value = `読み取り中 ${p}%`))
    recognitionMode.value = mode
    pendingReceiptImage.value = null
    pendingReceiptFileName.value = ''
    if (mode === 'receipt') {
      try {
        pendingReceiptImage.value = await compressReceiptImage(f)
        pendingReceiptFileName.value = f.name || '読み取ったレシート'
        receiptSaveError.value = ''
      } catch {
        receiptSaveError.value = '読み取りは成功しましたが、画像を保存用に準備できませんでした。下の「レシート画像を追加」から再選択してください。'
      }
    }
    recognize(mode, true)
    entryInputMode.value = 'scan'
  } catch (err) { pendingReceiptImage.value = null; pendingReceiptFileName.value = ''; receiptSaveError.value = '画像の準備または読み取りに失敗しました。元の写真を保管してください。'; flash('画像の読み取りに失敗しました：' + err.message) }
  busy.value = ''
}
function addBlank(type = 'expense') {
  entryInputMode.value = 'manual'
  const category = type === 'income' ? '工资' : type === 'transfer' ? '投資・資産移動' : '日用品'
  forms.value.push({ date: new Date().toLocaleDateString('sv-SE'), transferDate: new Date().toLocaleDateString('sv-SE'), transferTarget: '', time: '', amount: 0, type, category, paymentSource: '', merchant: '', note: '', raw: '', suggested: category, keyword: '', bindRule: false })
}
function setEntryType(form, type) {
  form.type = type
  if (type === 'income') form.category = INCOME_CATEGORIES.includes(form.category) ? form.category : '工资'
  else if (type === 'transfer') form.category = '投資・資産移動'
  else if (INCOME_CATEGORIES.includes(form.category) || form.category === '投資・資産移動') form.category = '日用品'
}
const categoryDialog = ref(false)
const categoryName = ref('')
const categoryIcon = ref('other')
const categorySaving = ref(false)
function addCategory() { categoryName.value = ''; categoryIcon.value = availableIcons.value[0]?.id || 'other'; categoryDialog.value = true }
async function saveCategory() {
  if (categorySaving.value) return
  const name = categoryName.value.trim()
  if (!name) return flash('カテゴリ名を入力してください')
  if (categories.value.some(c => c === name || categoryLabel(c) === name)) return flash('同じカテゴリが既にあります')
  categorySaving.value = true
  try {
    await api('categories', { method: 'POST', body: JSON.stringify({ name, icon: categoryIcon.value }) })
    categories.value = await api('categories')
    categoryIcons.value = await api('category-icons')
    categoryDialog.value = false
    flash('カテゴリを追加しました')
  } catch (e) { flash('カテゴリの追加に失敗しました：' + e.message) }
  finally { categorySaving.value = false }
}
function removeDraft(i) { forms.value.splice(i, 1) }

async function saveAll() {
  if (busy.value) return
  if (!forms.value.length) return flash('保存する記録がありません')
  const invalid = forms.value.findIndex(f => !(Number(f.amount) > 0))
  if (invalid >= 0) return flash(`${invalid + 1}件目の金額が正しくありません。確認してください`)
  const uncertain = forms.value.filter(f => /要確認|不明瞭|読み取れません|確認してください/.test(f.note || ''))
  if (uncertain.length) return flash('金額・内容を確認し、要確認の表示を修正してください')
  const key = f => [f.date, f.time || '', Number(f.amount), f.merchant?.trim() || ''].join('|')
  const seen = new Set()
  const possibleDuplicates = forms.value.filter(f => { const k = key(f); const duplicate = seen.has(k) || entries.value.some(e => key(e) === k); seen.add(k); return duplicate })
  if (possibleDuplicates.length && !confirm(`同じ日付・金額・店名の記録が${possibleDuplicates.length}件あります。実際に別の取引なら保存できます。続行しますか？`)) return
  busy.value = 'saving'
  let saved = 0
  let ruleFailures = 0
  let receiptImageWarning = ''
  receiptSaveError.value = ''
  try {
    // Remove each successfully saved draft immediately so retry never resubmits it.
    while (forms.value.length) {
      const f = forms.value[0]
      // Retain one stable ID across retries (including "saved on server, reply lost").
      if (!f.clientRequestId) f.clientRequestId = crypto.randomUUID()
      const result = await api('entries', { method: 'POST', body: JSON.stringify({ ...f, amount: Number(f.amount) }) })
      const receiptBlob = f.type === 'expense' ? f.receiptImage : null
      if (receiptBlob) {
        try { await persistReceipt(result?.id, receiptBlob) }
        catch { receiptImageWarning = ' レシート画像は保存できませんでした。元の写真を保管してください。'; receiptSaveError.value = '記録は保存されましたが、レシート画像の保存に失敗しました。元の写真を保管してください。' }
      }
      if (forms.value.length === 1) pendingReceiptImage.value = null
      forms.value.shift()
      saved++
      if (f.bindRule && f.merchant && f.merchant.trim().length >= 2) {
        try {
          await api('rules', { method: 'POST', body: JSON.stringify({ keyword: f.merchant.trim(), category: f.category }) })
        } catch { ruleFailures++ }
      }
    }
    input.value = ''
    flash(`${saved}件の記録を保存しました${ruleFailures ? '（分類ルールの保存に一部失敗しました）' : ''}${receiptImageWarning}`)
  } catch (e) {
    flash(`${saved}件を保存しました。未保存の${forms.value.length}件は入力欄に残っています：${e.message}`)
  } finally {
    try { rules.value = await api('rules') } catch { /* Keep existing rules when temporarily offline. */ }
    await Promise.allSettled([load(), loadYear(), loadInvestments(), loadTransfers()])
    busy.value = ''
  }
}
const pendingEntryIds = ref(new Set())
const editSaving = ref(false)
async function remove(id) {
  if (pendingEntryIds.value.has(id)) return
  if (!confirm('この記録を削除しますか？')) return
  pendingEntryIds.value = new Set([...pendingEntryIds.value, id])
  try {
    await api('entries/' + id, { method: 'DELETE', headers: { 'x-confirm-delete': String(id) } })
    // Only remove the local receipt after the server confirms deletion.
    let receiptDeleteWarning = ''
    try {
      await deleteReceiptImage(id)
      receiptImageIds.value = new Set([...receiptImageIds.value].filter(imageId => Number(imageId) !== Number(id)))
      if (Number(viewedReceiptId.value) === Number(id)) closeReceipt()
    } catch { receiptDeleteWarning = ' 端末内のレシート画像は削除できませんでした。'; receiptSaveError.value = '記録は削除されましたが、端末内のレシート画像を削除できませんでした。' }
    await Promise.allSettled([load(), refreshDetailSource(), loadYear(), loadInvestments(), loadTransfers()])
    flash('記録を削除しました' + receiptDeleteWarning)
  } catch (error) { flash('削除に失敗しました：' + error.message) }
  finally { const next = new Set(pendingEntryIds.value); next.delete(id); pendingEntryIds.value = next }
}
function startEdit(entry) {
  editReceiptImage.value = null
  editReceiptFileName.value = ''
  editingEntry.value = {
    id: entry.id, date: entry.date, time: entry.time || '',
    amount: Number(entry.amount), type: ['income', 'transfer'].includes(entry.type) ? entry.type : 'expense',
    transferTarget: entry.transfer_target || '', transferDate: entry.transfer_date || entry.date,
    category: entry.category || '日用品', paymentSource: entry.payment_source || '', merchant: entry.merchant || '',
    note: entry.note || '', raw: entry.raw || ''
  }
}
function cancelEdit() { if (!editSaving.value) { editingEntry.value = null; editReceiptImage.value = null; editReceiptFileName.value = '' } }
async function saveEdit() {
  const e = editingEntry.value
  if (!e || editSaving.value) return
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !(Number(e.amount) > 0)) {
    flash('日付と金額を確認してください')
    return
  }
  editSaving.value = true
  try {
    await api('entries/' + e.id, {
      method: 'PUT',
      body: JSON.stringify({ ...e, amount: Number(e.amount) })
    })
    if (editReceiptImage.value) {
      try { await persistReceipt(e.id, editReceiptImage.value); editReceiptImage.value = null }
      catch { receiptSaveError.value = '記録は更新されましたが、レシート画像を保存できませんでした。元の写真を保管してください。' }
    }
    editingEntry.value = null
    flash(receiptSaveError.value || '記録を更新しました')
    await load()
    await refreshDetailSource()
    await loadYear()
    await loadInvestments()
    await loadTransfers()
  } catch (err) { flash('更新に失敗しました：' + err.message) }
  finally { editSaving.value = false }
}

const pendingTransfers = ref([])
const transferLoading = ref(false)
const transferDue = item => String(item.transfer_date || item.date) <= new Date().toLocaleDateString('sv-SE')
async function loadTransfers() {
  transferLoading.value = true
  try {
    let rows = await api('transfers')
    // The backend marks due transfers once; no extra per-row writes needed here.
    pendingTransfers.value = rows
  } catch (e) { flash('振替予定を読み込めませんでした：' + e.message) }
  finally { transferLoading.value = false }
}
const transferStatus = item => Number(item.transfer_applied) === 1 ? '処理成功' : (String(item.transfer_date || item.date) > new Date().toLocaleDateString('sv-SE') ? '入金予定' : '未処理')
const transferStatusClass = item => Number(item.transfer_applied) === 1 ? 'transfer-done' : 'transfer-waiting'
const transferActionId = ref(null)
async function retryTransfer(item) {
  if (transferActionId.value !== null) return
  transferActionId.value = item.id
  try {
    await api('transfers/' + item.id, { method: 'POST' })
    await loadTransfers()
    await loadInvestments()
    flash('資産移動を処理しました')
  } catch (e) { flash('処理に失敗しました：' + e.message) }
  finally { transferActionId.value = null }
}
async function deleteTransfer(item) {
  if (transferActionId.value !== null) return
  if (!confirm('この待処理事項を削除しますか？家計簿の記録も削除されます。')) return
  transferActionId.value = item.id
  try {
    await api('entries/' + item.id, { method: 'DELETE', headers: { 'x-confirm-delete': String(item.id) } })
    await loadTransfers()
    await load()
    await loadInvestments()
    flash('記録を削除しました')
  } catch (e) { flash('削除に失敗しました：' + e.message) }
  finally { transferActionId.value = null }
}

const investmentItems = [
  { id: 'sbi', label: 'SBI証券', detail: '投資信託', unit: '円' },
]
const investments = ref({
  sbi: { currentValue: null, pnl: null, investedTotal: 0, updatedAt: '' },
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
        investedTotal: Number(row.invested_total || 0),
        updatedAt: row.updated_at || ''
      }
    }
  } catch (e) { flash('資産データを読み込めませんでした：' + e.message) }
}
async function saveInvestment(item) {
  if (investmentBusy.value) return
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

async function openDuplicateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  clearDetailFilter()
  entryTypeFilter.value = 'all'
  calendarExpanded.value = true
  selectedDay.value = date
  month.value = date.slice(0, 7)
  tab.value = 'list'
  await load()
}
const selectedDay = ref('')
const entryTypeFilter = ref('all')
const calendarExpanded = ref(false)
const swipedEntryId = ref(null)
const swipedReceiptId = ref(null)
const filteredEntries = computed(() => entries.value.filter(e => String(e.date || '').startsWith(month.value) && (!selectedDay.value || String(e.date || '').slice(0, 10) === selectedDay.value)))
const detailFilter = ref(null)
const paymentMethodMatches = (entry, method) => method === '現金' ? !String(entry.payment_source || '').trim() || entry.payment_source === '現金' : Boolean(String(entry.payment_source || '').trim()) && entry.payment_source !== '現金'
async function openPaymentMethodDetails(method, period) {
  await openCategoryDetails('', 'expense', period)
  if (detailFilter.value) detailFilter.value = {...detailFilter.value, paymentMethod:method}
}
const detailSourceEntries = ref([])
const detailLoading = ref(false)
let detailRequestId = 0
const visibleEntryCount = ref(20)
const listPageSize = 20
const entryMatchesType = entry => entryTypeFilter.value === 'all' ||
  (entryTypeFilter.value === 'income' && entry.type === 'income') ||
  (entryTypeFilter.value === 'expense' && entry.type !== 'income' && entry.type !== 'transfer') ||
  (entryTypeFilter.value === 'transfer' && entry.type === 'transfer')
const displayEntries = computed(() => {
  const source = detailFilter.value ? detailSourceEntries.value : filteredEntries.value
  const narrowed = detailFilter.value
    ? source.filter(entry => detailFilter.value.paymentMethod ? entry.type === 'expense' && paymentMethodMatches(entry,detailFilter.value.paymentMethod) : detailFilter.value.type === 'transfer' ? entry.type === 'transfer' : entry.category === detailFilter.value.category && (detailFilter.value.type === 'income' ? entry.type === 'income' : entry.type !== 'income' && entry.type !== 'transfer'))
    : source
  return narrowed.filter(entryMatchesType).filter(entry => !selectedDay.value || String(entry.date || '').slice(0, 10) === selectedDay.value)
})
function setEntryTypeFilter(value) {
  detailRequestId++
  detailLoading.value = false
  entryTypeFilter.value = value
  detailFilter.value = null
  detailSourceEntries.value = []
  selectedDay.value = ''
  visibleEntryCount.value = 20
}
const sortedDisplayEntries = computed(() => [...displayEntries.value].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.time || '').localeCompare(String(a.time || ''))))
const annualDetailMode = computed(() => detailFilter.value?.period === 'year')
const pagedEntries = computed(() => sortedDisplayEntries.value.slice(0, visibleEntryCount.value))
const expandedMonth = ref('')
const annualVisibleCounts = ref({})
const annualMonthGroups = computed(() => groupAnnualEntries(sortedDisplayEntries.value, annualVisibleCounts.value, listPageSize))
function loadMoreAnnualEntries(group) {
  annualVisibleCounts.value = { ...annualVisibleCounts.value, [group.month]: Math.min(group.count, group.items.length + listPageSize) }
}
watch(annualMonthGroups, groups => {
  if (annualDetailMode.value && !groups.some(g => g.month === expandedMonth.value)) expandedMonth.value = groups[0]?.month || ''
})
function loadMoreEntries() { visibleEntryCount.value = Math.min(sortedDisplayEntries.value.length, visibleEntryCount.value + listPageSize) }
const expandedEntryDays = ref(new Set())
const groupedPagedEntries = computed(() => {
  const groups = new Map()
  for (const entry of pagedEntries.value) {
    const day = String(entry.date || '').slice(0, 10)
    if (!groups.has(day)) groups.set(day, [])
    groups.get(day).push(entry)
  }
  return [...groups.entries()].map(([date, items]) => ({ date, items }))
})
function toggleEntryDay(date) {
  expandedEntryDays.value = expandedEntryDays.value.has(date) ? new Set() : new Set([date])
}
watch([displayEntries, detailFilter, selectedDay], () => {
  annualVisibleCounts.value = {}
  visibleEntryCount.value = 20
  const days = [...new Set(displayEntries.value.map(entry => String(entry.date || '').slice(0, 10)).filter(Boolean))].sort((a, b) => b.localeCompare(a))
  const today = new Date().toLocaleDateString('sv-SE')
  const defaultDay = detailFilter.value ? days[0] : (days.includes(today) ? today : days[0])
  expandedEntryDays.value = new Set(defaultDay ? [defaultDay] : [])
  visibleEntryCount.value = 20
}, { deep: true })
watch(visibleEntryCount, () => {
  const days = groupedPagedEntries.value.map(group => group.date)
  if (days.length && !days.some(day => expandedEntryDays.value.has(day))) expandedEntryDays.value = new Set([days[0]])
})
async function fetchPeriodDetailRows(period, requestId = null) {
  if (period !== 'year') return api('entries?month=' + month.value)
  const year = selectedYear.value
  const rows = []
  for (let offset = 0; ; offset += 500) {
    if (requestId !== null && requestId !== detailRequestId) return []
    const page = await api('entries?year=' + year + '&offset=' + offset)
    if (!Array.isArray(page)) throw new Error('年間明細の形式が正しくありません')
    rows.push(...page)
    if (page.length < 500) break
  }
  return rows
}
async function openCategoryDetails(category, type, period) {
  detailFilter.value = { category, type, period }
  entryTypeFilter.value = type === 'transfer' ? 'transfer' : type
  selectedDay.value = ''
  detailSourceEntries.value = []
  visibleEntryCount.value = 20
  tab.value = 'list'
  detailLoading.value = true
  const requestId = ++detailRequestId
  try {
    const rows = await fetchPeriodDetailRows(period, requestId)
    if (requestId === detailRequestId) detailSourceEntries.value = rows
  } catch (e) {
    if (requestId === detailRequestId) flash('明細の読み込みに失敗しました：' + e.message)
  } finally {
    if (requestId === detailRequestId) detailLoading.value = false
  }
}
async function refreshDetailSource() {
  const filter = detailFilter.value
  if (!filter) return
  try {
    detailSourceEntries.value = await fetchPeriodDetailRows(filter.period)
  } catch (e) { flash('明細の再読み込みに失敗しました：' + e.message) }
}
function clearDetailFilter() {
  detailRequestId++
  detailLoading.value = false
  detailFilter.value = null
  detailSourceEntries.value = []
  visibleEntryCount.value = 20
}
const dayRows = computed(() => [...(stats.value?.byDay || [])].sort((a, b) => a.date.localeCompare(b.date)))
let touchStartX = 0
let touchStartY = 0
let suppressRowClick = false
const calendarEntries = computed(() => {
  const source = detailFilter.value ? detailSourceEntries.value : entries.value
  return source.filter(entryMatchesType).filter(entry => !detailFilter.value || (
    detailFilter.value.type === 'transfer' ? entry.type === 'transfer' :
    entry.category === detailFilter.value.category && (detailFilter.value.type === 'income' ? entry.type === 'income' : entry.type !== 'income' && entry.type !== 'transfer')
  )).filter(entry => String(entry.date || '').startsWith(month.value))
})
const calendarDays = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const firstDayOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7
  const amounts = new Map()
  for (const entry of calendarEntries.value) {
    const key = String(entry.date || '').slice(0, 10)
    amounts.set(key, (amounts.get(key) || 0) + Number(entry.amount || 0))
  }
  const days = Array.from({ length: firstDayOffset }, (_, i) => ({ key: `blank-${i}`, blank: true }))
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    days.push({ key: date, date, day, amount: amounts.get(date) || 0, blank: false })
  }
  while (days.length % 7) days.push({ key: `blank-end-${days.length}`, blank: true })
  return days
})
const visibleCalendarDays = computed(() => {
  if (calendarExpanded.value) return calendarDays.value
  const today = new Date().toLocaleDateString('sv-SE')
  const target = today.startsWith(month.value) ? today : (selectedDay.value.startsWith(month.value) ? selectedDay.value : calendarDays.value.find(day => !day.blank)?.date)
  const index = calendarDays.value.findIndex(day => day.date === target)
  const start = Math.max(0, Math.floor(Math.max(0, index) / 7) * 7)
  return calendarDays.value.slice(start, start + 7)
})
function toggleDay(date) {
  if (selectedDay.value === date) selectedDay.value = ''
  else selectedDay.value = date
  visibleEntryCount.value = 20
  swipedEntryId.value = null; swipedReceiptId.value = null
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
    swipedReceiptId.value = null
    suppressRowClick = true
    setTimeout(() => { suppressRowClick = false }, 350)
  }
}
function handleEntryClick(entry) {
  if (suppressRowClick) return
  if (swipedEntryId.value === entry.id || swipedReceiptId.value === entry.id) {
    swipedEntryId.value = null; swipedReceiptId.value = null
    return
  }
  swipedEntryId.value = null; swipedReceiptId.value = null
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
const ratioTrendLine = computed(() => ratioTrendPoints.value.filter(point => point.ratio !== null).map(point => `${point.x},${point.y}`).join(' '))
const incomeTrendMax = computed(() => Math.max(0, ...yearMonthRows.value.map(item => item.income)))
const ratioTrendMax = computed(() => Math.max(0, ...ratioTrendPoints.value.filter(point => point.ratio !== null).map(point => point.ratio)))
const maxYearMonth = computed(() => Math.max(1, ...yearMonthRows.value.map(item => item.amount)))
const highestSpendMonth = computed(() => yearMonthRows.value.reduce((best, item) => item.amount > best.amount ? item : best, { month: '', label: 'データなし', amount: 0 }))
const annualAverage = computed(() => Math.round(Number(annualStats.value?.total || 0) / 12))
const annualIncomeCategories = computed(() => (annualStats.value?.incomeByCategory || [])
  .map(item => ({ category: item.category || '其他收入', amount: Number(item.amount || 0) }))
  .sort((a, b) => b.amount - a.amount))
const maxAnnualIncomeCategory = computed(() => Math.max(1, ...annualIncomeCategories.value.map(item => item.amount)))
function openMonthDetails(point, type) {
  if (!point?.month || !['income', 'expense'].includes(type)) return
  detailRequestId++
  detailLoading.value = false
  detailFilter.value = null
  detailSourceEntries.value = []
  selectedDay.value = ''
  calendarExpanded.value = false
  entryTypeFilter.value = type
  if (month.value !== point.month) {
    entries.value = []
    month.value = point.month
  } else if (!entries.value.length) {
    load()
  }
  tab.value = 'list'
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
// Sticker sources: https://www.duitang.com/blog/?id=1514035767 and https://www.duitang.com/blog/?id=1536248097
const puppyExpression = ratio => ratio >= 1 ? puppyCrying : puppyWorried
function puppyFallback(event) { event.target.onerror = null; event.target.src = 'https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png' }
const pigLabel = ratio => ratio === null ? 'まず収入を記録して、収支バランスを確認しましょう' : ratio >= 1 ? '大変！支出が収入以上になっています！' : ratio >= .8 ? '予算オーバーに注意しましょう！' : 'いい感じです。この調子でいきましょう'
const ratioLabel = ratio => ratio === null ? '収入データなし' : Math.round(ratio * 100) + '%'
</script>

<template>
  <main v-if="locked" :class="`theme-${theme}`"><div class="empty-state"><strong>ログアウトしました</strong><p>再開するにはアクセスコードが必要です。</p><button type="button" class="button-primary" @click="unlock">ログイン</button></div></main>
  <main v-else :class="`theme-${theme}`">
    <div v-if="receiptSaveError" role="alert" class="receipt-error-banner"><span>{{ receiptSaveError }}</span><button type="button" @click="receiptSaveError = ''" aria-label="通知を閉じる">×</button></div>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-label="しろちゃんとちび毛"><img src="https://stickershop.line-scdn.net/stickershop/v1/product/17142161/LINEStorePC/main.png?v=1" alt="しろちゃん" /><img src="https://stickershop.line-scdn.net/stickershop/v1/product/24856095/LINEStorePC/main.png?v=1" alt="ちび毛" /></span>
        <div><strong>家計簿 <span class="brand-heart">♡</span></strong><small>家計をかんたんに記録</small></div>
      </div>
      <span v-if="tab === 'add'" class="today-date">{{ todayLabel }}</span>
      <div v-else-if="tab === 'list' || (tab === 'stat' && statsPeriod === 'month')" class="topbar-period"><input type="month" v-model="month" class="month" aria-label="集計月" /><button type="button" class="period-reset" @click="resetMonth" aria-label="今月に戻す" title="今月に戻す">今月</button></div>
      <label v-else-if="tab === 'stat' && statsPeriod === 'year'" class="topbar-year-wrap"><input v-model.number="selectedYear" class="topbar-year" type="number" min="1900" max="9999" step="1" inputmode="numeric" aria-label="集計年" /><span>年</span></label>
      <button type="button" class="header-logout" @click="logout">ログアウト</button>
    </header>
    <div class="theme-switcher" role="group" aria-label="配色">
      <span>配色</span>
      <button v-for="item in themes" :key="item.id" type="button" :class="{ selected: theme === item.id }" :aria-pressed="theme === item.id" @click="setTheme(item.id)"><i :style="{ background: item.color }"></i>{{ item.label }}</button>
    </div>

    <p v-if="msg" class="toast" role="status">{{ msg }}</p>

    <section v-if="tab === 'add'" class="page-section">
      <div class="page-heading"><div><p class="eyebrow">記録を追加</p><h1>入力</h1></div><button class="button-secondary manage-category" @click="addCategory">＋ カテゴリ追加</button></div>
      <fieldset class="draft-controls" :disabled="busy === 'saving'" :aria-busy="busy === 'saving'">
      <div v-if="categoryDialog" class="edit-overlay" @click.self="!categorySaving && (categoryDialog = false)">
        <form class="edit-dialog category-dialog" @submit.prevent="saveCategory" aria-label="カテゴリを追加">
          <div class="edit-dialog-heading"><h2>カテゴリを追加</h2><button type="button" class="icon-button" :disabled="categorySaving" @click="categoryDialog = false" aria-label="閉じる">×</button></div>
          <label class="form-field"><span>カテゴリ名</span><input v-model.trim="categoryName" maxlength="20" required :disabled="categorySaving" placeholder="例：美容" /></label>
          <p class="field-label">アイコンを選択</p>
          <div class="icon-picker" role="group" aria-label="アイコンを選択">
            <button v-for="icon in availableIcons" :key="icon.id" type="button" :disabled="categorySaving" :class="{ selected: categoryIcon === icon.id }" :aria-pressed="categoryIcon === icon.id" @click="categoryIcon = icon.id"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icon.path"/></svg><span>{{ icon.label }}</span></button>
          </div>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" :disabled="categorySaving" @click="categoryDialog = false">キャンセル</button><button type="submit" class="button-primary" :disabled="categorySaving">{{ categorySaving ? '保存中…' : '追加する' }}</button></div>
        </form>
      </div>
      <div class="input-mode-switch" role="tablist" aria-label="入力方法"><button type="button" role="tab" :aria-selected="entryInputMode === 'manual'" :class="{ selected: entryInputMode === 'manual' }" @click="entryInputMode = 'manual'">手入力</button><button type="button" role="tab" :aria-selected="entryInputMode === 'scan'" :class="{ selected: entryInputMode === 'scan' }" @click="entryInputMode = 'scan'">画像から読み取る</button></div>
      <div v-if="entryInputMode === 'manual'" class="entry-mode-row">
        <button class="button-secondary manual-add-button" aria-label="支出を追加" @click="addBlank('expense')"><span class="entry-mode-icon" aria-hidden="true"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15m-5-5 5 5 5-5"/><path d="M4 7h16"/></svg></span><span>支出</span></button>
        <button class="button-secondary manual-add-button income-add-button" aria-label="収入を追加" @click="addBlank('income')"><span class="entry-mode-icon" aria-hidden="true"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5m-5 5 5-5 5 5"/><path d="M4 17h16"/></svg></span><span>収入</span></button>
        <button class="button-secondary manual-add-button" aria-label="資産移動を追加" @click="addBlank('transfer')"><span class="entry-mode-icon" aria-hidden="true"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4"/></svg></span><span>資産移動</span></button>
      </div>
      <div v-if="entryInputMode === 'manual'" class="panel text-paste-panel">
        <details class="text-entry-details">
          <summary>テキストを貼り付けて読み取る</summary>
          <label class="field-label" for="entry-text">テキスト入力</label>
          <textarea id="entry-text" v-model="input" rows="4" :placeholder="recognitionMode === 'statement' ? 'カード利用明細などの複数の取引を貼り付けられます。' : 'レシートの読み取り文字を貼り付けられます。'"></textarea>
          <div class="action-row">
            <button class="button-secondary" @click="recognize(recognitionMode)" :disabled="!!busy || !input.trim()">テキストを読み取る</button>
          </div>
        </details>
      </div>
      <div v-if="entryInputMode === 'scan'" class="panel capture-panel">
        <div class="receipt-mode-tabs" role="tablist" aria-label="読み取りモード">
          <button type="button" role="tab" :aria-selected="recognitionMode === 'statement'" :class="{ selected: recognitionMode === 'statement' }" @click="recognitionMode = 'statement'">明細</button>
          <button type="button" role="tab" :aria-selected="recognitionMode === 'receipt'" :class="{ selected: recognitionMode === 'receipt' }" @click="recognitionMode = 'receipt'">レシート</button>
        </div>
        <p class="microcopy">{{ recognitionMode === 'statement' ? 'カード利用明細などを複数件に分けて読み取ります。' : 'レシートの合計金額を1件として読み取ります。' }}</p>
        <div class="action-row">
          <label class="button-primary upload-button">{{ forms.length ? '別の画像を読み取る' : recognitionMode === 'statement' ? '明細画像を読み取る' : 'レシート画像を読み取る' }}<input type="file" accept="image/*" @change="onImage($event, recognitionMode)" :disabled="!!busy" hidden /></label>
        </div>

        <div v-if="busy" class="progress-wrap"><span class="spinner"></span><span>{{ busy }}</span></div>
        <p class="microcopy">画像はこの端末内で処理され、外部のOCRサービスには送信されません。</p>
      </div>

      <div v-if="forms.length" class="draft-heading">
        <div><h2>{{ entryInputMode === 'scan' ? '読み取り結果の確認' : '入力内容の確認' }}</h2><p>金額・日付・店舗名を確認して保存してください</p></div>
        <span class="count-pill">{{ forms.length }}件</span>
      </div>
      <div v-for="(f, i) in forms" :key="i" class="entry-card">
        <div class="entry-card-heading"><span class="entry-number">{{ String(i + 1).padStart(2, '0') }}</span><strong>{{ f.merchant || '新しい記録' }}</strong><button class="icon-button remove-button" @click="removeDraft(i)" aria-label="この記録を削除">×</button></div>
        <div class="type-switch" role="group" aria-label="記録の種類">
          <button type="button" :class="{ selected: (f.type || 'expense') === 'expense' }" @click="setEntryType(f, 'expense')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15m-5-5 5 5 5-5"/><path d="M4 7h16"/></svg></span><span>支出</span></button>
          <button type="button" :class="{ selected: f.type === 'income' }" @click="setEntryType(f, 'income')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5m-5 5 5-5 5 5"/><path d="M4 17h16"/></svg></span><span>収入</span></button>
          <button type="button" :class="{ selected: f.type === 'transfer' }" @click="setEntryType(f, 'transfer')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4"/></svg></span><span>資産移動</span></button>
        </div>
        <label class="form-field amount-field"><span>{{ f.type === 'income' ? '収入金額（円）' : f.type === 'transfer' ? '資産移動額（円）' : '支出金額（円）' }}</span><div class="amount-input-wrap" :class="{ 'income-amount-wrap': f.type === 'income' }"><span>¥</span><input type="number" min="0" inputmode="numeric" v-model.number="f.amount" aria-label="金額（円）" /></div></label>
        <div v-if="!(Number(f.amount) > 0)" class="amount-warning" role="alert">
          <p>合計金額を特定できませんでした。レシートの「合計」を確認してください。</p>
          
        </div>
        <div class="field-grid">
          <label class="form-field"><span>日付</span><input type="date" v-model="f.date" /></label>
          <label class="form-field"><span>時刻</span><input type="time" v-model="f.time" /></label>
          <label class="form-field"><span>カテゴリ</span><select v-model="f.category"><option v-for="c in (f.type === 'income' ? INCOME_CATEGORIES : f.type === 'transfer' ? ['投資・資産移動'] : categories)" :key="c" :value="c">{{ categoryLabel(c) }}</option></select></label>
          <label class="form-field"><span>店舗</span><input v-model="f.merchant" /></label>
          <label class="form-field"><span>支払方法・カード</span><select v-model="f.paymentSource"><option value="">未設定</option><option v-for="source in paymentSources" :key="source" :value="source">{{source}}</option><option v-if="f.paymentSource && !paymentSources.includes(f.paymentSource)" :value="f.paymentSource">{{f.paymentSource}}（既存の設定）</option></select></label>
        </div>
        <div v-if="f.type === 'transfer'" class="field-grid transfer-schedule-fields">
          <label class="form-field"><span>振替先</span><select v-model="f.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option></select></label>
          <label class="form-field"><span>適用日（この日に残高へ反映）</span><input v-model="f.transferDate" type="date" required /></label>
        </div>
        <label class="form-field"><span>メモ</span><input v-model="f.note" placeholder="任意" /></label>
        <div v-if="recognitionMode === 'receipt' && f.type === 'expense'" class="receipt-attachment-field" role="group" aria-label="レシート画像の添付"><span class="receipt-attachment-label">レシート画像（任意）</span><label class="button-secondary receipt-attachment-button" :class="{ 'receipt-attachment-disabled': f.type !== 'expense' }">{{ f.receiptImage ? '画像を変更する' : 'レシート画像を追加' }}<input type="file" accept="image/*" :disabled="f.type !== 'expense'" @change="selectDraftReceipt($event, f)" hidden /></label><span class="receipt-attachment-status">{{ f.type !== 'expense' ? 'レシート画像は支出の記録に添付できます' : f.receiptImage ? `画像を選択しました${f.receiptFileName ? '：' + f.receiptFileName : ''}` : '画像は未選択です' }}</span><button v-if="f.receiptImage" type="button" class="receipt-attachment-clear" @click="f.receiptImage = null; f.receiptFileName = ''">選択を解除</button></div>
        <label v-if="f.type !== 'income' && f.merchant && f.merchant.trim().length >= 2" class="bind-rule"><input v-model="f.bindRule" type="checkbox" /> <span>この店舗を選択したカテゴリに登録し、次回から自動判定する</span></label>
      </div>
      <p v-if="receiptSaveError" role="alert" class="receipt-save-error">{{ receiptSaveError }}</p>
      <div class="batch-actions" :class="{ 'batch-actions-empty': !forms.length }">
        <button v-if="entryInputMode === 'manual'" class="button-secondary" @click="addBlank('expense')">＋ もう1件追加</button>
        <button class="button-primary" @click="saveAll" :disabled="!!busy || !forms.length">{{ busy === 'saving' ? '保存中…' : `保存 ${forms.length}件` }}</button>
      </div>
      </fieldset>
    </section>

    <section v-else-if="tab === 'list'" class="page-section">
      <div class="page-heading"><div><p class="eyebrow">収支記録</p><h1>収支明細</h1></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span></div>
      <div class="entry-type-filter" role="group" aria-label="明細の種類"><button v-for="option in [{value: 'all', label: 'すべて'}, {value: 'income', label: '収入'}, {value: 'expense', label: '支出'}, {value: 'transfer', label: '資産移動'}]" :key="option.value" type="button" :class="{ selected: entryTypeFilter === option.value }" :aria-pressed="entryTypeFilter === option.value" @click="setEntryTypeFilter(option.value)">{{ option.label }}</button></div>
      <section v-if="!detailFilter" class="month-calendar" aria-label="月間明細カレンダー">
        <div class="calendar-heading"><strong>{{ monthLabel }}</strong><div class="calendar-actions"><button type="button" class="calendar-reset" @click="calendarExpanded = !calendarExpanded">{{ calendarExpanded ? '週のみ表示' : '月全体を表示' }}</button><button v-if="selectedDay" type="button" class="calendar-reset" @click="selectedDay = ''">日付解除</button></div></div>
        <div class="calendar-weekdays"><span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{ weekday }}</span></div>
        <div class="calendar-grid">
          <button v-for="day in visibleCalendarDays" :key="day.key" type="button" class="calendar-day" :class="{ 'calendar-blank': day.blank, 'calendar-selected': selectedDay === day.date, 'calendar-has-spend': day.amount > 0 }" :disabled="day.blank" @click="toggleDay(day.date)" :aria-label="day.blank ? undefined : day.date + ' 記録額 ' + yen(day.amount)">
            <template v-if="!day.blank"><span class="calendar-day-number">{{ day.day }}</span><small v-if="day.amount > 0">{{ yen(day.amount) }}</small><small v-else class="calendar-no-spend">—</small></template>
          </button>
        </div>
      </section>
      <div class="summary-strip"><span>{{ detailFilter ? (detailFilter.period === 'year' ? selectedYear + '年' : monthLabel) + ' · ' + ({income:'収入',expense:'支出',transfer:'資産移動'}[detailFilter.type] || 'すべて') + ' · ' + (detailFilter.type === 'transfer' ? '資産移動' : categoryLabel(detailFilter.category)) : (selectedDay ? selectedDay.replace(/-/g, '/') + ' 当日の明細' : monthLabel + ' · ' + ({all: 'すべて', income: '収入', expense: '支出', transfer: '資産移動'}[entryTypeFilter])) }}</span><strong>{{ displayEntries.length }}件の記録</strong></div>
      <div v-if="detailFilter" class="detail-filter-strip"><span>{{ detailFilter.type === 'transfer' ? '資産移動で絞り込み中' : 'カテゴリで絞り込み中' }}</span><button type="button" class="button-secondary" @click="clearDetailFilter">絞り込みを解除</button></div>
      <p v-if="detailLoading" class="trend-note">明細を読み込み中…</p>
      <div v-if="!detailLoading && !displayEntries.length" class="empty-state"><span class="empty-icon">▤</span><strong>{{ detailFilter ? 'このカテゴリの明細はありません' : 'この期間の記録はありません' }}</strong><p>{{ detailFilter ? '条件に一致する記録はありません。' : '「入力」から最初の記録を追加できます。' }}</p><button v-if="detailFilter" class="button-secondary" @click="clearDetailFilter">絞り込みを解除</button><button v-else class="button-primary" @click="tab = 'add'">記録を追加</button></div>
      
      <div v-if="!detailLoading && displayEntries.length && annualDetailMode" class="ledger annual-month-list">
        <section v-for="group in annualMonthGroups" :key="group.month" class="entry-day-group">
          <button type="button" class="entry-day-heading" :aria-expanded="expandedMonth === group.month" @click="expandedMonth = expandedMonth === group.month ? '' : group.month">
            <span class="entry-day-chevron">{{ expandedMonth === group.month ? '▾' : '▸' }}</span>
            <strong>{{ Number(group.month.slice(5)) }}月</strong>
            <span class="entry-day-count">{{ group.count }}件</span>
            <span class="entry-day-total">{{ yen(group.total) }}</span>
          </button>
          <ul v-if="expandedMonth === group.month" class="ledger entry-day-items">
            <li v-for="e in group.items" :key="e.id" :class="{ 'swiped-open': swipedEntryId === e.id, 'receipt-available': receiptImageIds.has(Number(e.id)) }" @touchstart.passive="startSwipe($event)" @touchend="endSwipe($event, e.id)" @touchcancel="swipedEntryId = null">
              <div class="ledger-row-content" role="button" tabindex="0" @click="handleEntryClick(e)" @keydown.enter.prevent="startEdit(e)" @keydown.space.prevent="startEdit(e)">
                <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(e.category)"/></svg></span>
                <div class="ledger-info"><b>{{ e.merchant || categoryLabel(e.category) }}</b><small>{{ e.date.replace(/-/g, '/') }}<template v-if="e.time"> · {{ e.time }}</template> · {{ categoryLabel(e.category) }}</small></div>
                <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income', 'transfer-amount': e.type === 'transfer' }">{{ e.type === 'income' ? '+' : e.type === 'transfer' ? '' : '−' }}{{ yen(e.amount) }}</span>
              </div>
              <button v-if="receiptImageIds.has(Number(e.id))" type="button" class="swipe-receipt" @click.stop="viewReceipt(e.id); swipedEntryId = null" aria-label="レシート画像を見る">レシート</button>
              <button class="swipe-delete" :disabled="pendingEntryIds.has(e.id)" @click.stop="remove(e.id); swipedEntryId = null" aria-label="記録を削除">削除</button>
            </li>
          </ul>
          <div v-if="expandedMonth === group.month && group.items.length < group.count" class="load-more-wrap">
            <button type="button" class="button-secondary load-more-button" @click.stop="loadMoreAnnualEntries(group)">読み込みを続ける（{{ Math.min(listPageSize, group.count - group.items.length) }}件）</button>
          </div>
        </section>
      </div>
      <div v-else-if="!detailLoading && displayEntries.length" class="ledger day-group-list">
        <section v-for="group in groupedPagedEntries" :key="group.date" class="entry-day-group">
          <button type="button" class="entry-day-heading" :aria-expanded="expandedEntryDays.has(group.date)" @click="toggleEntryDay(group.date)">
            <span class="entry-day-chevron">{{ expandedEntryDays.has(group.date) ? '▾' : '▸' }}</span>
            <strong>{{ group.date.replace(/-/g, '/') }}</strong>
            <span class="entry-day-count">{{ group.items.length }}件</span>
            <span class="entry-day-total">{{ yen(group.items.reduce((sum, entry) => sum + (entry.type === 'income' ? -Number(entry.amount || 0) : Number(entry.amount || 0)), 0)) }}</span>
          </button>
          <ul v-if="expandedEntryDays.has(group.date)" class="ledger entry-day-items">
            <li v-for="e in group.items" :key="e.id" :class="{ 'swiped-open': swipedEntryId === e.id, 'receipt-available': receiptImageIds.has(Number(e.id)) }" @touchstart.passive="startSwipe($event)" @touchend="endSwipe($event, e.id)" @touchcancel="swipedEntryId = null">
              <div class="ledger-row-content" role="button" tabindex="0" @click="handleEntryClick(e)" @keydown.enter.prevent="startEdit(e)" @keydown.space.prevent="startEdit(e)">
                <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(e.category)"/></svg></span>
                <div class="ledger-info"><b>{{ e.merchant || categoryLabel(e.category) }}</b><small>{{ e.date.slice(5) }}<template v-if="e.time"> · {{ e.time }}</template> · {{ categoryLabel(e.category) }} · {{ e.type === 'income' ? '収入' : e.type === 'transfer' ? '資産移動' : '支出' }}<template v-if="e.type === 'transfer' && e.transfer_target"> · {{ e.transfer_target === 'sbi' ? '→ SBI証券' : '' }}</template></small></div>
                <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income', 'transfer-amount': e.type === 'transfer' }">{{ e.type === 'income' ? '+' : e.type === 'transfer' ? '' : '−' }}{{ yen(e.amount) }}</span>
              </div>
              
              <button v-if="receiptImageIds.has(Number(e.id))" type="button" class="swipe-receipt" @click.stop="viewReceipt(e.id); swipedEntryId = null" aria-label="レシート画像を見る">レシート</button>
              <button class="swipe-delete" @click.stop="remove(e.id); swipedEntryId = null" aria-label="記録を削除">削除</button>
            </li>
          </ul>
        </section>
      </div>
      <div v-if="!detailLoading && !annualDetailMode && visibleEntryCount < sortedDisplayEntries.length" class="load-more-wrap">
        <button type="button" class="button-secondary load-more-button" @click="loadMoreEntries">読み込みを続ける（{{ Math.min(listPageSize, sortedDisplayEntries.length - visibleEntryCount) }}件）</button>
      </div>
      <div v-if="viewedReceiptUrl" class="edit-overlay" @click.self="closeReceipt">
        <div class="edit-dialog" role="dialog" aria-modal="true" aria-label="レシート画像">
          <div class="edit-dialog-heading"><h2>レシート画像</h2><button type="button" class="icon-button" @click="closeReceipt" aria-label="閉じる">×</button></div>
          <img :src="viewedReceiptUrl" alt="保存したレシート" style="width:100%;max-height:65vh;object-fit:contain" />
          <p class="microcopy">画像はこの端末に30日間保存されます。記録は削除されません。</p>
          <button type="button" class="button-secondary" @click="removeReceiptImage">画像のみ削除</button>
        </div>
      </div>
      <div v-if="editingEntry" class="edit-overlay" @click.self="cancelEdit">
        <form class="edit-dialog" @submit.prevent="saveEdit" :aria-busy="editSaving">
          <p v-if="receiptSaveError" role="alert" class="receipt-save-error">{{ receiptSaveError }}</p>
          <div class="edit-dialog-heading"><h2>記録を編集</h2><button type="button" class="icon-button" @click="cancelEdit" aria-label="閉じる">×</button></div>
          <fieldset class="edit-fields" :disabled="editSaving">
          <div class="type-switch" role="group" aria-label="記録の種類">
            <button type="button" :class="{ selected: editingEntry.type === 'expense' }" @click="setEntryType(editingEntry, 'expense')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15m-5-5 5 5 5-5"/><path d="M4 7h16"/></svg></span><span>支出</span></button>
            <button type="button" :class="{ selected: editingEntry.type === 'income' }" @click="setEntryType(editingEntry, 'income')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5m-5 5 5-5 5 5"/><path d="M4 17h16"/></svg></span><span>収入</span></button>
            <button type="button" :class="{ selected: editingEntry.type === 'transfer' }" @click="setEntryType(editingEntry, 'transfer')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4"/></svg></span><span>資産移動</span></button>
          </div>
          <label class="form-field"><span>金額（円）</span><input v-model.number="editingEntry.amount" type="number" min="1" inputmode="numeric" required /></label>
          <div class="field-grid">
            <label class="form-field"><span>日付</span><input v-model="editingEntry.date" type="date" required /></label>
            <label class="form-field"><span>時刻</span><input v-model="editingEntry.time" type="time" /></label>
            <label class="form-field"><span>カテゴリ</span><select v-model="editingEntry.category"><option v-for="c in (editingEntry.type === 'income' ? INCOME_CATEGORIES : editingEntry.type === 'transfer' ? ['投資・資産移動'] : categories)" :key="c" :value="c">{{ categoryLabel(c) }}</option></select></label>
            <label class="form-field"><span>店舗</span><input v-model="editingEntry.merchant" /></label>
            <label class="form-field"><span>支払方法・カード</span><select v-model="editingEntry.paymentSource"><option value="">未設定</option><option v-for="source in paymentSources" :key="source" :value="source">{{source}}</option><option v-if="editingEntry.paymentSource && !paymentSources.includes(editingEntry.paymentSource)" :value="editingEntry.paymentSource">{{editingEntry.paymentSource}}（既存の設定）</option></select></label>
          </div>
          <div v-if="editingEntry.type === 'transfer'" class="field-grid transfer-schedule-fields">
            <label class="form-field"><span>振替先</span><select v-model="editingEntry.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option></select></label>
            <label class="form-field"><span>適用日（この日に残高へ反映）</span><input v-model="editingEntry.transferDate" type="date" required /></label>
          </div>
          <label class="form-field"><span>メモ</span><input v-model="editingEntry.note" /></label>
          <div v-if="editingEntry.type === 'expense'" class="receipt-attachment-field"><span class="receipt-attachment-label">レシート画像（任意）</span><label class="button-secondary receipt-attachment-button">{{ editReceiptImage || receiptImageIds.has(Number(editingEntry.id)) ? '画像を変更する' : 'レシート画像を追加' }}<input type="file" accept="image/*" @change="selectEditReceipt($event)" hidden /></label><span class="receipt-attachment-status">{{ editReceiptImage ? `画像を選択しました：${editReceiptFileName}` : receiptImageIds.has(Number(editingEntry.id)) ? '保存済みの画像があります' : '画像は未選択です' }}</span><button v-if="editReceiptImage" type="button" class="receipt-attachment-clear" @click="editReceiptImage = null; editReceiptFileName = ''">選択を解除</button></div>
          </fieldset>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" :disabled="editSaving" @click="cancelEdit">キャンセル</button><button type="submit" class="button-primary" :disabled="editSaving">{{ editSaving ? '保存中…' : '変更を保存' }}</button></div>
        </form>
      </div>
    </section>

    <section v-else-if="tab === 'stat' && statsPeriod === 'month'" class="page-section stats-page">
      <div class="page-heading"><div><p class="eyebrow">家計の分析</p><h1>統計</h1><p class="heading-subtitle">{{ monthLabel }}の収支を分析</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span></div>
      <div class="stats-period-tabs" role="tablist" aria-label="集計期間"><button type="button" role="tab" :aria-selected="statsPeriod === 'month'" :class="{ selected: statsPeriod === 'month' }" @click="statsPeriod = 'month'">月次</button><button type="button" role="tab" :aria-selected="statsPeriod === 'year'" :class="{ selected: statsPeriod === 'year' }" @click="statsPeriod = 'year'">年次</button></div>
      <div class="hero-total">
        <span>今月の支出合計</span>
        <strong>{{ yen(stats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ stats?.count || 0 }}件の支出記録</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(monthlyRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(monthlyRatio)" aria-label="収支バランスの表情"><img v-if="monthlyRatio !== null && monthlyRatio >= .8" :key="pigState(monthlyRatio)" class="puppy-expression" :src="puppyExpression(monthlyRatio)" :alt="monthlyRatio >= 1 ? '泣いているしろちゃん' : '汗をかくちび毛'" @error="puppyFallback" loading="lazy" /><template v-else><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="しろちゃんのスタンプ" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="ちび毛としろちゃんのスタンプ" loading="lazy" /></template></div>
        <div class="piggy-content"><div class="piggy-title">今月の収支バランス</div><div class="piggy-status">{{ pigLabel(monthlyRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (monthlyRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(monthlyRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip"><div><small>今月の収入</small><strong class="income-text">＋{{ yen(stats?.income) }}</strong></div><div><small>今月の支出</small><strong>−{{ yen(stats?.total) }}</strong></div><div><small>差引残高</small><strong :class="Number(stats?.income || 0) - Number(stats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(stats?.income || 0) - Number(stats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>今月の資産移動</small><strong>{{ yen(stats?.transferTotal) }}</strong></div><div><small>件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'month')" aria-label="今月の資産移動明細を表示">{{ stats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div></div>
      <div class="payment-method-stats"><h2>支払方法別</h2><div class="payment-method-stats-grid"><button v-for="method in ['カード・電子決済','現金']" :key="method" type="button" :disabled="!(stats?.paymentMethods || []).some(item => item.method === method && Number(item.count) > 0)" @click="openPaymentMethodDetails(method,'month')"><span>{{method}}</span><strong>{{(stats?.paymentMethods || []).find(item => item.method === method) ? yen((stats?.paymentMethods || []).find(item => item.method === method).amount) : '—'}}</strong><small>{{(stats?.paymentMethods || []).find(item => item.method === method) ? ((stats?.paymentMethods || []).find(item => item.method === method).count + '件 · 明細を見る ›') : '—'}}</small></button></div></div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><small>支出件数</small><strong>{{ stats?.count || 0 }}<em>件</em></strong></div>
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span><small>1日平均支出（支出があった日）</small><strong>{{ yen(averageDaily) }}</strong></div>
      </div>
      <div v-if="!stats?.count" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>集計データがありません</strong><p>支出を記録すると、ここに内訳が表示されます。</p><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div class="stats-card">
          <div class="section-title"><div><h2>カテゴリ支出</h2><p>何にお金を使ったか確認しましょう</p></div></div>
          <div class="pie-chart-layout donut-vertical">
            <div class="category-pie donut-chart" :style="{ background: monthlyCategoryPie }" role="group" :aria-label="'カテゴリ別支出円環グラフ。選択中 ' + (donutSelected('month') ? categoryLabel(donutSelected('month').category) : 'なし') + ' ' + donutPercent('month') + '%'" @click="selectDonutSlice($event, 'month')">
              <div class="donut-center"><span>{{ donutSelected('month') ? categoryLabel(donutSelected('month').category) : 'カテゴリ' }}</span><strong>{{ yen(donutSelected('month')?.amount || 0) }}</strong><small>{{ donutPercent('month') }}%</small></div>
            </div>
            <div class="category-list pie-legend" role="group" aria-label="カテゴリを選択すると明細を表示">
              <button v-for="(c, i) in categoryRows" :key="c.category" type="button" class="pie-legend-row" :class="{ 'donut-category-active': donutSelected('month')?.category === c.category }" @click="openCategoryDetails(c.category, 'expense', 'month')" :aria-label="categoryLabel(c.category) + 'の明細を見る'">
                <i class="pie-legend-dot" :style="{ background: expensePalette[i % expensePalette.length] }"></i><span>{{ categoryLabel(c.category) }}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>週別支出</h2><p>月曜日から日曜日で集計（最初と最後の週は当月の日付で計算）</p></div></div>
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

    <section v-else-if="tab === 'stat' && statsPeriod === 'year'" class="page-section stats-page annual-page">
      <div class="page-heading"><div><p class="eyebrow">家計の分析</p><h1>統計</h1><p class="heading-subtitle">{{ selectedYear }}年の収支を分析</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10M10 19V5M16 19v-8M22 19V8"/></svg></span></div>
      <div class="stats-period-tabs" role="tablist" aria-label="集計期間"><button type="button" role="tab" :aria-selected="statsPeriod === 'month'" :class="{ selected: statsPeriod === 'month' }" @click="statsPeriod = 'month'">月次</button><button type="button" role="tab" :aria-selected="statsPeriod === 'year'" :class="{ selected: statsPeriod === 'year' }" @click="statsPeriod = 'year'">年次</button></div>
      <div class="hero-total annual-hero">
        <span>{{ selectedYear }}年の支出合計</span><strong>{{ yen(annualStats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ annualStats?.count || 0 }}件の支出記録</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(annualRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(annualRatio)" aria-label="収支バランスの表情"><img v-if="annualRatio !== null && annualRatio >= .8" :key="pigState(annualRatio)" class="puppy-expression" :src="puppyExpression(annualRatio)" :alt="annualRatio >= 1 ? '泣いているしろちゃん' : '汗をかくちび毛'" @error="puppyFallback" loading="lazy" /><template v-else><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="しろちゃんのスタンプ" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="ちび毛としろちゃんのスタンプ" loading="lazy" /></template></div>
        <div class="piggy-content"><div class="piggy-title">年間の収支バランス</div><div class="piggy-status">{{ pigLabel(annualRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (annualRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(annualRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip annual-income-strip"><div><small>年間収入</small><strong class="income-text">＋{{ yen(annualStats?.income) }}</strong></div><div><small>年間支出</small><strong>−{{ yen(annualStats?.total) }}</strong></div><div><small>年間収支</small><strong :class="Number(annualStats?.income || 0) - Number(annualStats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(annualStats?.income || 0) - Number(annualStats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>年間の資産移動</small><strong>{{ yen(annualStats?.transferTotal) }}</strong></div><div><small>件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'year')" aria-label="年間の資産移動明細を表示">{{ annualStats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div></div>
      <div class="payment-method-stats"><h2>支払方法別</h2><div class="payment-method-stats-grid"><button v-for="method in ['カード・電子決済','現金']" :key="method" type="button" :disabled="!(annualStats?.paymentMethods || []).some(item => item.method === method && Number(item.count) > 0)" @click="openPaymentMethodDetails(method,'year')"><span>{{method}}</span><strong>{{(annualStats?.paymentMethods || []).find(item => item.method === method) ? yen((annualStats?.paymentMethods || []).find(item => item.method === method).amount) : '—'}}</strong><small>{{(annualStats?.paymentMethods || []).find(item => item.method === method) ? ((annualStats?.paymentMethods || []).find(item => item.method === method).count + '件 · 明細を見る ›') : '—'}}</small></button></div></div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><small>月平均支出（12か月で計算）</small><strong>{{ yen(annualAverage) }}</strong></div>
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span><small>支出が最も多い月</small><strong>{{ highestSpendMonth.amount ? highestSpendMonth.label : 'データなし' }}</strong><em v-if="highestSpendMonth.amount">{{ yen(highestSpendMonth.amount) }}</em></div>
      </div>
      <div v-if="!annualStats?.count && !Number(annualStats?.income || 0)" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>この年の記録はありません</strong><p>別の年を選ぶか、記録を追加してください。</p><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div v-if="annualStats?.count" class="stats-card">
          <div class="section-title"><div><h2>支出の推移</h2><p>{{ selectedYear }}年1月〜12月</p></div></div>
          <div class="trend-summary"><strong>{{ yen(highestSpendMonth.amount) }}</strong><span>月間最高支出 · {{ highestSpendMonth.amount ? highestSpendMonth.label : 'データなし' }}</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年支出の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polygon v-if="expenseTrendArea" :points="expenseTrendArea" class="expense-chart-area" />
            <polyline :points="expenseTrendLine" class="chart-line expense-chart-line" />
            <circle v-for="point in expenseTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point expense-chart-point clickable-chart-point" role="button" tabindex="0" :aria-label="point.label + '支出 ' + yen(point.amount) + '。タップして明細を表示'" @click="openMonthDetails(point, 'expense')" @keydown.enter.prevent="openMonthDetails(point, 'expense')" @keydown.space.prevent="openMonthDetails(point, 'expense')" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" @click="openMonthDetails(item, 'expense')">{{ Number(item.month.slice(5)) }}</button></div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>収入の推移</h2><p>月ごとの年間収入の推移</p></div></div>
          <div class="trend-summary"><strong>{{ yen(incomeTrendMax) }}</strong><span>月間最高収入</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年収入の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polyline :points="incomeTrendLine" class="chart-line income-chart-line" />
            <circle v-for="point in incomeTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point income-chart-point clickable-chart-point" role="button" tabindex="0" :aria-label="point.label + '収入 ' + yen(point.income) + '。タップして明細を表示'" @click="openMonthDetails(point, 'income')" @keydown.enter.prevent="openMonthDetails(point, 'income')" @keydown.space.prevent="openMonthDetails(point, 'income')" />
          </svg>
<div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" @click="openMonthDetails(item, 'income')">{{ Number(item.month.slice(5)) }}</button></div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>支出割合の推移</h2><p>支出 ÷ 収入。破線は80%と100%の目安</p></div></div>
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
          <div class="section-title"><div><h2>年度カテゴリ収入</h2><p>年間合計の多い順</p></div></div>
          <div v-if="annualIncomeCategories.length" class="category-list annual-income-bars">
            <div v-for="(c, i) in annualIncomeCategories" :key="c.category" class="category-row category-row-clickable" role="button" tabindex="0" :aria-expanded="categoryDetail?.period === 'year' && categoryDetail?.type === 'income' && categoryDetail?.category === c.category" @click="openCategoryDetails(c.category, 'income', 'year')" @keydown.enter.prevent="openCategoryDetails(c.category, 'income', 'year')" @keydown.space.prevent="openCategoryDetails(c.category, 'income', 'year')">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(c.category)"/></svg></span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill income-category-fill" :style="{ width: Math.max(2, Number(c.amount) / maxAnnualIncomeCategory * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.income ? Math.round(Number(c.amount) / Number(annualStats.income) * 100) : 0 }}%（年間収入に占める割合） · タップして明細</small>
            </div>
          </div>
          <p v-else class="trend-note">この年の収入記録はありません。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度カテゴリ支出</h2><p>年間合計の多い順</p></div></div>
          <div class="pie-chart-layout donut-vertical">
            <div class="category-pie donut-chart" :style="{ background: annualExpensePie }" role="group" :aria-label="'カテゴリ別支出円環グラフ。選択中 ' + (donutSelected('year') ? categoryLabel(donutSelected('year').category) : 'なし') + ' ' + donutPercent('year') + '%'" @click="selectDonutSlice($event, 'year')">
              <div class="donut-center"><span>{{ donutSelected('year') ? categoryLabel(donutSelected('year').category) : 'カテゴリ' }}</span><strong>{{ yen(donutSelected('year')?.amount || 0) }}</strong><small>{{ donutPercent('year') }}%</small></div>
            </div>
            <div class="category-list pie-legend" role="group" aria-label="カテゴリを選択すると明細を表示">
              <button v-for="(c, i) in (annualStats?.byCategory || [])" :key="c.category" type="button" class="pie-legend-row" :class="{ 'donut-category-active': donutSelected('year')?.category === c.category }" @click="openCategoryDetails(c.category, 'expense', 'year')" :aria-label="categoryLabel(c.category) + 'の明細を見る'">
                <i class="pie-legend-dot" :style="{ background: expensePalette[i % expensePalette.length] }"></i><span>{{ categoryLabel(c.category) }}</span>
              </button>
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
            <div class="pending-transfer-actions"><span class="pending-transfer-status" :class="transferStatusClass(item)">{{ transferStatus(item) }}</span><button v-if="Number(item.transfer_applied) === 1" class="pending-delete" :disabled="transferActionId !== null" aria-label="削除" title="削除" @click="deleteTransfer(item)">×</button><button v-else-if="transferDue(item)" class="pending-retry" :disabled="transferActionId !== null" @click="retryTransfer(item)">手動処理</button></div>
          </div>
        </div>
      </article>
      <div class="page-heading"><div><p class="eyebrow">資産の記録</p><h1>資産・投資</h1><p class="heading-subtitle">積立額は明細から計算し、評価額・損益は手動管理します</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M15 15h3"/></svg></span></div>
      <article v-for="item in investmentItems" :key="item.id" class="panel investment-card">
        <div class="investment-card-heading"><div><h2>{{ item.label }}</h2><p>{{ item.detail }}</p></div><span class="investment-unit">{{ item.unit }}</span></div>
        <div class="investment-principal"><small>家計簿から確認できる積立累計</small><strong>{{ yen(investments[item.id].investedTotal) }}</strong><small>振替先を設定した登録済み明細から集計</small></div>
        <label class="form-field"><span>現在の評価額（{{ item.unit }}）</span><input v-model.number="investments[item.id].currentValue" type="number" min="0" step="1" inputmode="numeric" placeholder="現在の評価額" /></label>
        <label class="form-field"><span>評価損益（{{ item.unit }}）</span><input v-model.number="investments[item.id].pnl" type="number" step="1" inputmode="numeric" placeholder="例：-1339" /></label>
        <div class="investment-summary">
          <div><small>評価損益</small><strong :class="Number(investments[item.id].pnl) > 0 ? 'investment-positive' : Number(investments[item.id].pnl) < 0 ? 'investment-negative' : ''">{{ investments[item.id].pnl === null || investments[item.id].pnl === '' ? '—' : (Number(investments[item.id].pnl) > 0 ? '+' : '') + Number(investments[item.id].pnl).toLocaleString('ja-JP') + ' ' + item.unit }}</strong></div>
          <div><small>損益率</small><strong :class="investmentReturn(item) > 0 ? 'investment-positive' : investmentReturn(item) < 0 ? 'investment-negative' : ''">{{ investmentReturn(item) === null ? '—' : (investmentReturn(item) > 0 ? '+' : '') + investmentReturn(item).toFixed(2) + '%' }}</strong></div>
        </div>
        <p class="investment-updated">最終更新：{{ investments[item.id].updatedAt ? new Date(investments[item.id].updatedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未更新' }}</p>
        <button class="button-primary investment-save" :disabled="investmentBusy" @click="saveInvestment(item)">最新データを保存</button>
      </article>
    </section>

    <FinanceTools v-if="tab === 'finance'" :api="api" :categories="categories" :payment-sources="paymentSources" @update-payment-sources="updatePaymentSources" @open-duplicate="openDuplicateDate" @ledger-updated="load(); loadYear()" />
    <nav class="bottom-nav" aria-label="メインメニュー">
      <button :class="{ active: tab === 'add' }" @click="tab = 'add'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><span>入力</span></button>
      <button :class="{ active: tab === 'list' }" @click="tab = 'list'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><span>明細</span></button>
      <button :class="{ active: tab === 'stat' }" @click="tab = 'stat'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4.5 19.5h15"/><rect x="6" y="11" width="3.2" height="6.5" rx="1"/><rect x="10.4" y="7.5" width="3.2" height="10" rx="1"/><rect x="14.8" y="4.5" width="3.2" height="13" rx="1"/></svg></span><span>統計</span></button>
      <button :class="{ active: tab === 'investments' }" @click="tab = 'investments'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M7 4.5h10M15.5 14.5h2"/></svg></span><span>資産・投資</span></button>
      <button :class="{ active: tab === 'finance' }" @click="tab = 'finance'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg></span><span>管理</span></button>
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
.page-heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 18px}.today-date{font-size:12px;font-weight:750;color:var(--muted);white-space:nowrap;padding:8px 0 8px 8px}.topbar-period{display:flex;align-items:center;gap:5px}.period-reset{flex:none;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:11px;font-weight:750;white-space:nowrap}.topbar-year-wrap{display:flex;align-items:center;gap:3px;padding:0 8px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;font-weight:750}.topbar-year{width:58px;min-width:0;padding:9px 0;border:0;background:transparent;font-size:13px;font-weight:750;text-align:right;appearance:textfield;-moz-appearance:textfield}.topbar-year::-webkit-inner-spin-button,.topbar-year::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.15em;color:var(--blue);margin:0 0 4px}.page-heading h1{font-size:27px;line-height:1.2;letter-spacing:-.045em;margin:0;font-weight:800}.heading-subtitle{font-size:12px;color:var(--muted);margin:7px 0 0}.heading-icon{display:grid;place-items:center;width:43px;height:43px;border-radius:15px;background:#e9efff;color:var(--blue);font-size:25px;font-weight:500}
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
.bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.bar-fill{display:block;height:100%;background:#5279d1;border-radius:99px;transition:width .25s}.income-category-fill{background:linear-gradient(90deg,#278b73,#78c4aa)}.expense-category-fill{background:linear-gradient(90deg,#d96f91,#efa6b9)}.fill-1{background:#26a69a}.fill-2{background:#e5a34d}.fill-3{background:#9b78d0}.fill-4{background:#52a5c9}.fill-5{background:#e07886}.category-share{display:block;text-align:right;color:#9aa4b1;font-size:10px;margin-top:4px}
.daily-list{display:grid;gap:13px}.daily-row{display:flex;align-items:center;gap:11px}.daily-date{display:flex;align-items:baseline;justify-content:center;gap:1px;width:34px;flex:none}.daily-date strong{font-size:16px}.daily-date span{font-size:10px;color:var(--muted)}.daily-date.week-index{width:48px;gap:0;white-space:nowrap}.daily-date.week-index strong{font-size:12px}.daily-bar-wrap{flex:1;min-width:0}.daily-bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.daily-bar-track span{display:block;height:100%;background:linear-gradient(90deg,#4f7bd7,#6b9de9);border-radius:99px}.daily-bar-wrap small{display:block;font-size:10px;color:#9aa4b1;margin-top:3px}.daily-amount{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.empty-state{display:flex;align-items:center;flex-direction:column;text-align:center;padding:34px 18px;background:#fff;border:1px dashed #dce3ec;border-radius:18px}.empty-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;background:#edf2ff;color:var(--blue);font-size:23px;margin-bottom:12px}.empty-state strong{font-size:14px}.empty-state p{font-size:12px;color:var(--muted);margin:6px 0 17px}.empty-state button{min-width:140px}.stats-empty{margin-top:8px}
.bottom-nav{position:fixed;z-index:10;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(calc(100% - 28px),460px);display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:6px;background:#ffffffed;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid #e8edf2;border-radius:19px;box-shadow:0 8px 30px #20324b18}.bottom-nav button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;min-height:56px;border:1px solid transparent;background:transparent;color:var(--muted);padding:6px 2px;border-radius:14px;font-size:10px;line-height:1.2;font-weight:750;white-space:nowrap;-webkit-tap-highlight-color:transparent;transition:background .18s ease,color .18s ease,transform .18s ease,border-color .18s ease}.bottom-nav button:active{transform:scale(.96)}.bottom-nav button.active{background:color-mix(in srgb,var(--blue) 16%,white);border-color:color-mix(in srgb,var(--blue) 30%,white);color:var(--blue-dark);box-shadow:0 3px 9px color-mix(in srgb,var(--blue) 12%,transparent)}.nav-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:10px;color:currentColor;transition:background .18s ease,transform .18s ease}.nav-icon svg{display:block;width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.bottom-nav button.active .nav-icon{background:color-mix(in srgb,var(--blue) 12%,white);transform:translateY(-1px)}.bottom-nav button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}

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
.puppy-pair .puppy-expression{width:100%;height:100%;object-fit:contain;border-radius:12px}
.puppy-sweating img{transform:rotate(4deg) translateY(-2px)}
.puppy-broken img:first-child{transform:rotate(-8deg) translateY(2px);filter:grayscale(.35)}
.puppy-broken img:last-of-type{transform:rotate(8deg) translateY(-1px);filter:grayscale(.2)}
.puppy-empty img{opacity:.78}

.brand-mark{box-shadow:inset 0 0 0 1px #f8dce4,0 4px 12px #d96f9110}
.button-primary{background:linear-gradient(135deg,#e989a7,#d96f91);box-shadow:0 4px 10px #d96f9126}
.button-primary:active{background:#bd5376}
.button-secondary{background:#fff0f4;color:#b95478;border-color:#f8dce5}
.button-secondary:active{background:#ffe5ed}
.bottom-nav button.active{background:color-mix(in srgb,var(--blue) 15%,white);color:var(--blue-dark);border-color:color-mix(in srgb,var(--blue) 30%,white)}
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

.trend-card{overflow:hidden}.trend-summary{display:flex;align-items:baseline;gap:8px;margin:2px 0 4px}.trend-summary strong{font-size:22px;font-weight:800;color:var(--ink)}.trend-summary span,.trend-note{font-size:11px;color:var(--muted)}.trend-chart{display:block;width:100%;height:auto;overflow:visible;margin-top:8px}.chart-grid-line{stroke:var(--line);stroke-width:1}.chart-line{fill:none;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.income-chart-line{stroke:#278b73}.expense-chart-line{stroke:#d96f91}.expense-chart-area{fill:#d96f9120;stroke:none}.ratio-chart-line{stroke:#d96f91}.chart-point{stroke:#fff;stroke-width:1.2}.income-chart-point{fill:#278b73}.expense-chart-point{fill:#d96f91}.ratio-chart-point{fill:#d96f91}.chart-reference-line{stroke:#d5a34b;stroke-width:1.2;stroke-dasharray:4 4}.chart-reference-danger{stroke:#d96f91}.trend-month-labels{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));padding:0 2px;text-align:center;color:var(--muted);font-size:10px}
.trend-month-labels button{min-width:0;min-height:32px;padding:7px 0;border:0;border-radius:7px;background:transparent;color:inherit;font-size:11px;cursor:pointer;touch-action:manipulation}.trend-month-labels button:hover,.trend-month-labels button:focus-visible{background:color-mix(in srgb,var(--blue) 12%,transparent);color:var(--ink);outline:2px solid transparent}
.trend-month-labels button.trend-month-selected{background:#fff0f4;color:#bd5376;font-weight:850}
.clickable-chart-point{cursor:pointer;outline:none}
.clickable-chart-point:focus,.clickable-chart-point.chart-point-selected{stroke:#bd5376;stroke-width:2.5}
.income-month-breakdown{margin-top:14px;padding:13px;background:#fff9fa;border:1px solid #f3e2e7;border-radius:14px}
.ratio-detail-amounts{display:grid;grid-template-columns:1fr 1fr;gap:9px}.ratio-detail-amounts>div{display:grid;gap:5px;padding:11px;background:#fff;border:1px solid #f3e7e9;border-radius:11px}.ratio-detail-amounts span{font-size:11px;color:var(--muted)}.ratio-detail-amounts strong{font-size:14px;font-variant-numeric:tabular-nums}
.income-breakdown-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.income-breakdown-heading h3{margin:0;font-size:14px}
.income-breakdown-heading p{margin:3px 0 0;font-size:10px;color:var(--muted)}
.income-breakdown-heading>strong{font-size:16px;white-space:nowrap;color:#16836f}.trend-note{margin:8px 0 0;line-height:1.5}

.header-logout{flex-shrink:0;white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:var(--card);color:var(--muted);font-size:11px;font-weight:700;cursor:pointer}
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








.annual-month-list,.day-group-list{display:grid;gap:10px;width:100%;box-sizing:border-box;margin:0;padding:0;background:transparent;border:0;box-shadow:none;overflow:visible}.entry-day-group{overflow:hidden;background:var(--card);border:1px solid var(--line);border-radius:14px}.entry-day-heading{display:grid;grid-template-columns:18px auto auto 1fr;align-items:center;gap:8px;width:100%;padding:13px 12px;border:0;background:var(--card);color:var(--ink);text-align:left}.entry-day-chevron{color:var(--blue-dark);font-size:16px}.entry-day-heading strong{font-size:13px}.entry-day-count{font-size:11px;color:var(--muted)}.entry-day-total{text-align:right;font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}.entry-day-items{margin:0;border:0;border-radius:0;box-shadow:none}.entry-day-items li:first-child{border-top:1px solid var(--line)}.entry-day-items li{padding-left:10px;padding-right:10px}.detail-filter-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0 14px;color:var(--muted);font-size:12px}.detail-filter-strip button{min-height:34px;padding:7px 10px;font-size:12px;white-space:nowrap} .load-more-wrap{display:flex;justify-content:center;padding:14px 0 28px}.load-more-button{width:100%;max-width:320px;padding:12px 16px;font-size:13px;font-weight:700}

.pie-chart-layout{display:flex;flex-direction:column;align-items:stretch;gap:16px}.category-pie{width:min(100%,188px);align-self:center;aspect-ratio:1;border-radius:50%;margin:0;border:5px solid var(--card);box-shadow:0 4px 18px #20324b16}.pie-legend{display:grid;gap:7px;min-width:0;width:100%}.pie-legend-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:10px 11px;border-radius:9px;background:color-mix(in srgb,var(--line) 24%,transparent)}.pie-legend-name{display:flex;align-items:center;gap:9px;min-width:0;font-size:12px;font-weight:700}.pie-legend-name>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pie-legend-dot{display:block;flex:none;width:10px;height:10px;border-radius:3px;box-shadow:0 0 0 2px #fff}.pie-legend-values{display:flex;flex:none;align-items:center;flex-direction:row;gap:10px;min-width:0}.pie-legend-values strong{font-size:12px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}.pie-legend-values small{display:inline-block;min-width:42px;text-align:right;font-size:11px;font-weight:800;color:var(--blue-dark)}.annual-income-bars .category-row{padding:8px 0}.clickable-chart-point{cursor:pointer;outline:none}.clickable-chart-point:focus-visible{stroke:var(--ink);stroke-width:3}.stats-period-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;margin:0 0 14px;border-radius:13px;background:color-mix(in srgb,var(--blue) 15%,var(--card))}.stats-period-tabs button{min-height:38px;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:13px;font-weight:750}.stats-period-tabs button.selected{background:var(--card);color:var(--blue-dark);box-shadow:0 2px 8px color-mix(in srgb,var(--blue) 18%,transparent);outline:1px solid color-mix(in srgb,var(--blue) 30%,transparent)}.entry-type-filter{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:0 0 12px;padding:4px;border-radius:13px;background:color-mix(in srgb,var(--blue) 13%,var(--card))}.entry-type-filter button{min-width:0;min-height:38px;padding:7px 3px;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:12px;font-weight:750;white-space:nowrap}.entry-type-filter button.selected{background:#fff;color:var(--blue-dark);box-shadow:0 2px 8px #4b23300d}.calendar-actions{display:flex;align-items:center;gap:5px}@media(max-width:390px){.pie-legend-row{gap:6px;padding:9px 8px}.pie-legend-values{gap:6px}.pie-legend-values strong{font-size:11px}.pie-legend-name{font-size:11px}.bottom-nav{width:calc(100% - 18px);gap:3px}.bottom-nav button{font-size:10px;padding:6px 1px}}

.pie-chart-layout{display:grid;grid-template-columns:minmax(110px,44%) minmax(0,1fr);align-items:center;gap:10px}
.category-pie.donut-chart{width:100%;max-width:210px;aspect-ratio:1;position:relative;display:grid;place-items:center;margin:auto;border:0}
.donut-center{width:69%;height:69%;background:var(--card);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:7px;text-align:center;box-shadow:0 1px 7px #0000000b;min-width:0}
.donut-center span{font-size:10px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.donut-center strong{font-size:clamp(12px,3vw,18px);letter-spacing:-.04em;overflow-wrap:anywhere}
.donut-center small{font-size:13px;font-weight:800}
.pie-legend{max-height:260px;overflow-y:auto;gap:5px;align-content:start}
.pie-legend-row{justify-content:flex-start;padding:8px;min-height:32px;border:1px solid transparent;cursor:pointer}
.pie-legend-row.donut-category-active{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 10%,var(--card))}
.pie-legend-name{font-size:11px;min-width:0}
@media(max-width:390px){.pie-chart-layout{grid-template-columns:minmax(100px,43%) minmax(0,1fr);gap:8px}.donut-center strong{font-size:12px}.pie-legend-row{padding:7px 5px}}
.donut-detail-link{font-size:11px;font-weight:700;border:1px solid var(--line);border-radius:9px;background:var(--card);padding:8px 5px;color:var(--blue-dark);width:100%}.donut-detail-link:disabled{opacity:.45}
.pie-chart-layout.donut-vertical{display:flex;flex-direction:column;align-items:center;gap:16px}
.donut-vertical .category-pie.donut-chart{width:min(100%,230px);max-width:230px;cursor:pointer;touch-action:manipulation}
.donut-vertical .donut-center{pointer-events:none}
.donut-vertical .pie-legend{display:flex;flex-wrap:nowrap;gap:7px;width:100%;max-height:none;overflow-x:auto;overflow-y:hidden;padding:4px 2px 8px;scrollbar-width:thin;justify-content:flex-start}
.donut-vertical .pie-legend-row{flex:0 0 auto;width:auto;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:11px;border-radius:999px;padding:8px 11px;min-height:36px}
.donut-vertical .pie-legend-dot{width:9px;height:9px;border-radius:50%}
@media(min-width:520px){.donut-vertical .pie-legend{justify-content:center;flex-wrap:wrap;overflow:visible}}

/* Unified visual system: theme tokens, interaction, components and charts. */
main{
 --radius-sm:10px;--radius-md:15px;--radius-lg:20px;
 --shadow-soft:0 5px 24px rgba(51,46,59,.055);
 --focus-ring:color-mix(in srgb,var(--blue) 28%,transparent);
 --tint:color-mix(in srgb,var(--blue) 10%,var(--card));
 --chart-1:#d96f91;--chart-2:#e2a16b;--chart-3:#9476bb;--chart-4:#6eae9a;--chart-5:#d6b252;
 --chart-6:#b879a6;--chart-7:#7d9cbd;--chart-8:#d98578;--chart-9:#91a96d;--chart-10:#bc8b72;
}
main.theme-blue{--chart-1:#689ed2;--chart-2:#8b8fce;--chart-3:#67ada8;--chart-4:#d1ac70;--chart-5:#a58ac8;--chart-6:#73b6cc;--chart-7:#b17caa;--chart-8:#8ba77c;--chart-9:#df988f;--chart-10:#849cad}
main.theme-yellow{--chart-1:#c9a441;--chart-2:#d98573;--chart-3:#90a86a;--chart-4:#a78cc2;--chart-5:#e0b778;--chart-6:#83b0a8;--chart-7:#ba9385;--chart-8:#d69ea8;--chart-9:#9d9fae;--chart-10:#b0a074}
main.theme-green{--chart-1:#69a68b;--chart-2:#a2b96f;--chart-3:#80a0cb;--chart-4:#d4aa6e;--chart-5:#ad8fc4;--chart-6:#7fb8ad;--chart-7:#d18e91;--chart-8:#91a878;--chart-9:#ac99b0;--chart-10:#b8a077}
main .stats-card,main .panel,main .metric-card,main .investment-card{
 border-color:var(--line);border-radius:var(--radius-lg);box-shadow:var(--shadow-soft);
}
main .stats-card{padding:20px 17px}
main .page-heading h1{letter-spacing:-.045em;line-height:1.25}
main .heading-icon,main .metric-icon,main .empty-icon{color:var(--blue-dark);background:var(--tint)}
main button{transition:background-color .18s,border-color .18s,color .18s,box-shadow .18s,transform .15s}
main button:not(:disabled):active{transform:scale(.975)}
main button:focus-visible,main [role="button"]:focus-visible,main a:focus-visible{
 outline:3px solid var(--focus-ring);outline-offset:3px
}
main input:focus,main select:focus,main textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px var(--focus-ring)}
main input,main textarea,main select{border-color:var(--line);background:var(--card);border-radius:var(--radius-sm)}
main .button-primary{border-color:transparent;background:var(--blue-dark);box-shadow:0 4px 12px var(--focus-ring);font-weight:750}
main .button-secondary,main .calendar-reset,main .period-reset{background:var(--tint);color:var(--blue-dark);border-color:var(--line)}
main .type-switch button.selected,main .entry-type-filter button.selected,main .stats-period-tabs button.selected{color:var(--blue-dark);border-color:var(--blue);background:var(--tint)}
main .bottom-nav{background:color-mix(in srgb,var(--card) 94%,transparent);border-color:var(--line);box-shadow:0 9px 28px rgba(40,42,55,.12)}
main .bottom-nav button{border-radius:13px}
main .bottom-nav button.active{background:var(--tint);color:var(--blue-dark)}
main .bottom-nav .nav-icon{color:inherit}
main .bottom-nav svg{stroke:currentColor}
main .donut-center{background:var(--card);box-shadow:inset 0 0 0 1px var(--line)}
main .donut-vertical .pie-legend-row{border-color:var(--line);background:var(--card);color:var(--ink)}
main .donut-vertical .pie-legend-row.donut-category-active{background:var(--tint);border-color:var(--blue);color:var(--blue-dark)}
main .category-swatch,main .pie-legend-dot{border:1px solid rgba(0,0,0,.06)}
main .entry-day-heading{border-radius:var(--radius-md)}
.draft-controls,.edit-fields{border:0;margin:0;padding:0;min-width:0}.draft-controls:disabled,.edit-fields:disabled{opacity:.7}button:disabled{cursor:not-allowed;opacity:.55}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.category-dialog{max-height:min(85dvh,720px);overflow-y:auto}.icon-picker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0 18px}.icon-picker button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;min-height:64px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-size:11px}.icon-picker button.selected{border:2px solid var(--blue);background:var(--tint);color:var(--blue-dark)}.icon-picker svg{width:24px;height:24px}
main .annual-month-list .entry-day-group{border-radius:var(--radius-md);overflow:hidden}
@media(prefers-reduced-motion:reduce){main *,main *::before,main *::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}

main .heading-icon svg{width:21px;height:21px;display:block}
.ui-line-icon{display:block;width:19px;height:19px;flex:none}.type-action-icon{display:inline-flex;vertical-align:middle;align-items:center;justify-content:center;margin-right:5px}.metric-icon .ui-line-icon{width:18px;height:18px}.type-switch button{display:inline-flex;align-items:center;justify-content:center;gap:3px}.category-line-icon{width:17px;height:17px;margin:auto}.category-dot,.category-emoji{display:inline-grid;place-items:center}
/* Mobile-first PWA shell, usable with four cream themes. */
main{--touch-height:44px;--card-padding:16px;--section-gap:14px;--radius-sm:10px;--radius-md:14px;--radius-lg:18px;
width:100%;max-width:560px;padding:calc(env(safe-area-inset-top) + 10px) 14px calc(env(safe-area-inset-bottom) + 100px);
overscroll-behavior-y:contain}
main .topbar{gap:8px;padding:5px 0 15px;min-height:58px}
main .brand-mark{width:49px;height:40px}
main .brand strong{font-size:16px}
main .page-heading{margin-bottom:14px}
main .page-heading h1{font-size:24px}
main .stats-card,main .panel,main .metric-card{border-radius:var(--radius-lg);box-shadow:0 3px 16px rgba(28,33,44,.045)}
main .stats-card{padding:var(--card-padding)}
main input:not([type=checkbox]):not([type=radio]),main select,main textarea{min-height:var(--touch-height);font-size:16px}
main .button-primary,main .button-secondary,main .entry-type-filter button,main .stats-period-tabs button{min-height:var(--touch-height)}
main .bottom-nav{bottom:calc(8px + env(safe-area-inset-bottom));width:min(calc(100% - 20px),460px);padding:7px;gap:4px;border-radius:22px}
main .bottom-nav button{min-height:52px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11px;font-weight:750}
main .bottom-nav .nav-icon{display:grid;place-items:center;min-height:23px}
main .bottom-nav .nav-icon svg{width:21px;height:21px}
main .piggy-card{border-radius:var(--radius-lg);gap:12px;min-height:104px}
main .puppy-pair{width:86px;min-width:86px;min-height:80px;position:relative}
main .puppy-pair img{width:43px;height:43px}
main .piggy-content{min-width:0}
main .piggy-sweating{border-color:#eac56d;background:linear-gradient(135deg,#fff8e9,var(--card))}
main .piggy-broken{border-color:#eaa3ad;background:linear-gradient(135deg,#fff0f1,var(--card))}
main .puppy-pair.puppy-sweating::after,main .puppy-pair.puppy-broken::after{position:absolute;top:0;right:0;display:grid;place-items:center;width:25px;height:25px;border-radius:50%;font-size:15px;box-shadow:0 2px 8px #00000014}
main .puppy-pair.puppy-sweating::after{content:"💦";background:#fff7df}
main .puppy-pair.puppy-broken::after{content:"💥";background:#ffebed}
main .piggy-sweating .piggy-status{color:#987018}
main .piggy-broken .piggy-status{color:#b74358}
@media(max-width:370px){main{padding-left:12px;padding-right:12px}main .bottom-nav{width:calc(100% - 12px);padding:5px;gap:2px}main .bottom-nav button{font-size:10px}main .topbar{gap:5px}main .brand small{font-size:10px}}
@media(min-width:561px){main{border-inline:1px solid var(--line)}}

/* Input shortcuts reuse the exact SVG paths from the draft/edit type selector. */
main .entry-mode-row .manual-add-button{min-height:44px;gap:7px}
main .entry-mode-row .entry-mode-icon{background:transparent;color:var(--blue-dark);border-radius:0;flex:0 0 19px;width:19px;height:19px}
main .entry-mode-row .entry-mode-icon .ui-line-icon{width:19px;height:19px}

.investment-principal{display:grid;gap:3px;padding:12px 14px;margin:0 0 14px;border-radius:14px;background:var(--tint);color:var(--ink)}
.investment-principal strong{font-size:21px;font-variant-numeric:tabular-nums}
.investment-principal small{font-size:11px;color:var(--muted)}

/* Receipt/statement OCR mode tabs: equal-width and theme-aware. */
main .capture-panel .receipt-mode-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;width:100%;padding:5px;margin-bottom:12px;border:1px solid var(--line);border-radius:15px;background:var(--tint)}
main .capture-panel .receipt-mode-tabs button{appearance:none;display:flex;align-items:center;justify-content:center;min-width:0;width:100%;min-height:44px;padding:10px 12px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--muted);font-size:14px;font-weight:750;line-height:1.3;cursor:pointer;transition:background .16s,color .16s,box-shadow .16s}
main .capture-panel .receipt-mode-tabs button.selected{background:var(--card);border-color:var(--blue);color:var(--blue-dark);box-shadow:0 2px 9px color-mix(in srgb,var(--blue) 14%,transparent)}
main .capture-panel .receipt-mode-tabs button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
main .capture-panel .action-row .upload-button,main .capture-panel .action-row>button{min-height:44px}
@media(max-width:360px){main .capture-panel .receipt-mode-tabs button{font-size:13px;padding:9px 6px}}
/* Five equal bottom tabs: maintain a single row on narrow iPhones. */
main .bottom-nav{grid-template-columns:repeat(5,minmax(0,1fr));max-width:460px}
main .bottom-nav button{min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-inline:2px}
main .bottom-nav button .nav-icon{width:100%;flex-shrink:0}
main .bottom-nav button span:last-child{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis}
@media(max-width:390px){main .bottom-nav{gap:2px;padding:5px}main .bottom-nav button{font-size:10px;padding-inline:0}}
.payment-method-stats{margin:12px 0;display:grid;gap:8px}.payment-method-stats h2{font-size:15px;margin:0}.payment-method-stats-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.payment-method-stats-grid button{display:grid;gap:5px;text-align:left;min-width:0;min-height:80px;padding:12px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--ink)}.payment-method-stats-grid strong{font-size:17px;overflow-wrap:anywhere}.payment-method-stats-grid small{color:var(--muted)}.payment-method-stats-grid button:disabled{opacity:.65;cursor:default}.payment-method-stats-grid button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}.text-entry-details{margin-top:10px}.text-entry-details summary{cursor:pointer;color:var(--muted);font-size:13px;padding:8px 0}.text-entry-details[open] summary{margin-bottom:8px}.text-entry-details textarea{width:100%;box-sizing:border-box}</style>

<style>
/* Right-side swipe actions: both buttons open with one left swipe. */
.ledger li{background:#fff}
.ledger li .ledger-row-content{transform:translateX(0);box-sizing:border-box;width:100%}
.ledger li:not(.swiped-open) .ledger-row-content{transform:translateX(-5px)}
.ledger li.receipt-available:not(.swiped-open) .ledger-row-content{transform:translateX(-10px)}
.ledger li.swiped-open .ledger-row-content{transform:translateX(-68px)}
.ledger li.swiped-open.receipt-available .ledger-row-content{transform:translateX(-144px)}
.ledger li .swipe-delete{right:0;width:64px;visibility:hidden}
.ledger li.swiped-open .swipe-delete{visibility:visible}
.ledger li .swipe-receipt{position:absolute;top:0;right:68px;bottom:0;width:72px;border:0;border-radius:10px;background:#397e9b;color:#fff;font-size:12px;font-weight:800;cursor:pointer;visibility:hidden}
.ledger li.swiped-open.receipt-available .swipe-receipt{visibility:visible}
.ledger li:not(.swiped-open)::after{content:'';position:absolute;right:0;top:0;bottom:0;width:5px;background:#e86e86;pointer-events:none}
.ledger li.receipt-available:not(.swiped-open)::after{width:10px;background:linear-gradient(to right,#397e9b 0 5px,#e86e86 5px 10px)}
</style>

<style>.receipt-save-error{color:#9b2938;background:#fff0f1;border:1px solid #e9aab2;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:700}</style>

<style>.receipt-error-banner{position:fixed;z-index:9999;top:calc(env(safe-area-inset-top,0px) + 8px);left:12px;right:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border:1px solid #df9aa6;border-radius:12px;background:#fff1f3;color:#8d2336;box-shadow:0 5px 22px #42202522;font-weight:700;font-size:13px}.receipt-error-banner button{border:0;background:transparent;color:inherit;font-size:24px;cursor:pointer}</style>

<style>.receipt-attachment-field{display:flex;flex-wrap:wrap;align-items:center;gap:9px;padding:10px 0}.receipt-attachment-label{width:100%;font-size:13px;font-weight:700}.receipt-attachment-button{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:9px 13px;border-radius:10px}.receipt-attachment-status{font-size:12px;color:var(--muted)}</style>

<style>.receipt-attachment-clear{border:0;background:transparent;color:#397e9b;font-size:12px;font-weight:700;text-decoration:underline;cursor:pointer;padding:5px}.receipt-attachment-status{overflow-wrap:anywhere}</style>

<style>.entry-card>.receipt-attachment-field{display:flex!important;visibility:visible!important;opacity:1!important;position:relative;min-height:70px;flex-direction:row;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0;padding:12px;border:1px solid #dbe4ef;border-radius:12px;background:#f7f9fc}.entry-card>.receipt-attachment-field .receipt-attachment-label{display:block;width:100%;font-weight:700;color:#475569}.receipt-attachment-disabled{opacity:.5;pointer-events:none}</style>

<style>.input-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;margin:10px 0 14px;background:#f0f2f7;border-radius:15px}.input-mode-switch button{border:0;border-radius:11px;background:transparent;padding:12px 7px;color:#677286;font-size:14px;font-weight:800;cursor:pointer}.input-mode-switch button.selected{background:#fff;color:#b64e72;box-shadow:0 2px 9px #00000012}.capture-panel{margin-bottom:15px}@media(max-width:480px){.input-mode-switch button{min-height:44px}}</style>

<style>.text-paste-panel{margin:10px 0 14px;padding:12px 14px}.text-paste-panel .text-entry-details{margin:0}</style>
