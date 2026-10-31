<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick, provide } from 'vue'
import { parseRepeatedExpense } from './natural-repeat.js'
import { parseNamedExpenseBlocks } from './named-expense.js'
import puppyWorried from './assets/puppy-worried.gif'
import puppyCrying from './assets/puppy-crying.jpg'
import { groupAnnualEntries } from './detail-pagination.js'
import { ledgerEntryAmount, ledgerEntriesTotal, formatLedgerTotal } from './ledger-totals.js'
import { normalizedDraftType, editedEntryMonth } from './entry-type.js'
import { classify, parseReceipt, parseEntries, ocrImage, CATEGORIES as BASE_CATEGORIES } from './parse.js'
import { localHHMM } from './entry-time.js'
import { compressReceiptImage } from './receipt-image.js'
import LedgerPage from './pages/LedgerPage.vue'
import StatisticsPage from './pages/StatisticsPage.vue'
import AssetsPage from './pages/AssetsPage.vue'
import ManagementPage from './pages/ManagementPage.vue'
import TransactionForm from './TransactionForm.vue'
import { paymentForDraft } from './payment-rules.js'
import { detectRegisteredReceiptPayment } from './receipt-payment.js'
import { prepaidTarget } from './prepaid-card.js'
import { recognizeAssetTransfer } from './transfer-recognition.js'
import { detectIcHistoryContext } from './transport-history.js'
import { monthLedgerMatchesStats } from './month-ledger-consistency.js'
import { matchesPrepaidHistoryEntry } from './prepaid-history.js'
import { ICON_LIBRARY } from './icon-library.js'
import { sortOtherLast } from './category-sort.js'
import { sundayFirstOffset, startOfSundayWeek } from './calendar-week.js'
import { saveReceiptImage, getReceiptImage, deleteReceiptImage, cleanupReceiptImages } from './receipt-store.js'

const tab = ref('add')
// Route the wallet's add-card action to the actual Cards subtab, even when
// the ManagementPage instance remembers the previous subtab.
const cardSettingsRequest = ref(0)
function openCardSettingsFromWallet(){cardSettingsRequest.value++;tab.value='finance'}
// Show a bundled vector dog if the LINE sticker CDN is offline or blocked.
const statsPeriod = ref('month')
// The four original IDs are permanent: saved device preferences must still work.
const themes = [
  { id: 'pink', label: 'ピンク', color: '#d96f91' },
  { id: 'blue', label: 'ブルー', color: '#78a9d6' },
  { id: 'yellow', label: 'イエロー', color: '#d9b957' },
  { id: 'green', label: 'グリーン', color: '#78ad91' },
  { id: 'lavender', label: 'ラベンダー', color: '#b697d1' },
  { id: 'peach', label: 'ピーチ', color: '#df9c7e' },
  { id: 'latte', label: 'ミルクティー', color: '#b59a81' },
  { id: 'slate', label: 'スモーキーブルー', color: '#86a8bd' },
]
const storedTheme = localStorage.getItem('kakeibo-theme')
const theme = ref(themes.some(item => item.id === storedTheme) ? storedTheme : 'pink')
function setTheme(value) {
  if (!themes.some(item => item.id === value)) return
  // Visual preferences are device-specific. Never update D1 for a theme change.
  try {
    localStorage.setItem('kakeibo-theme', value)
    localStorage.setItem('kakeibo-theme-local-v1', '1')
    theme.value = value
  } catch (e) { flash('テーマを保存できませんでした：' + e.message) }
}
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const month = ref(currentMonth())
function resetMonth() { month.value = currentMonth() }
const selectedYear = ref(new Date().getFullYear())
const annualStats = ref(null)
const selectedRatioMonth = ref('')
const rules = ref([]), entries = ref([]), stats = ref(null), categories = ref([...BASE_CATEGORIES])
const input = ref(''), busy = ref(''), msg = ref('')
const ocrEngine = ref(''), ocrWarning = ref('')
const forms = ref([])
// D1 is the only source of payment cards; never re-import old browser storage.
const paymentSources = ref([])
const paymentClosingDays = ref({})
const paymentSourceMeta = ref({})
const prepaidSources = computed(() => paymentSources.value.filter(name=>paymentSourceMeta.value[name]?.source_type==='prepaid'))
const transferDestinations = computed(() => prepaidSources.value.map(name=>({value:prepaidTarget(name),name})))
async function updatePaymentSources(values) {
  const removed = paymentSources.value.filter(name => !values.includes(name))
  const added = values.filter(name => !paymentSources.value.includes(name))
  try {
    for (const name of added) await api('payment-sources', { method: 'POST', body: JSON.stringify({ name }) })
    for (const name of removed) await api('payment-sources/remove', { method: 'POST', body: JSON.stringify({ name }) })
    await loadPaymentSettings()
  } catch (e) { flash('カード設定の保存に失敗しました：' + e.message); await loadPaymentSettings() }
}
const defaultPaymentSource = ref('')
const merchantPaymentRules = ref([])
const customCategoryRules = ref([])
const importPaymentSource = ref('')
let paymentSettingsLoaded = false
let paymentSettingsLoading = null
async function loadPaymentSettings() {
  if (paymentSettingsLoading) return paymentSettingsLoading
  paymentSettingsLoading = (async () => {
    const cards = await api('payment-sources')
    paymentSources.value = sortOtherLast(cards.map(x => x.name))
    paymentSourceMeta.value = Object.fromEntries(cards.map(x => [x.name,x]))
    paymentClosingDays.value = Object.fromEntries(cards.filter(x => x.closing_day !== null && x.closing_day !== undefined).map(x => [x.name, x.closing_day]))
    defaultPaymentSource.value = cards.find(x => x.is_default)?.name || ''
    merchantPaymentRules.value = await api('merchant-payment-rules')
    customCategoryRules.value = await api('custom-rules')
    paymentSettingsLoaded = true
  })().finally(() => { paymentSettingsLoading = null })
  return paymentSettingsLoading
}
const suggestedPayment = (merchant, source = '', type = 'expense', imported = '') => paymentForDraft({
  merchant, recognized: source, importSource: imported, rules: merchantPaymentRules.value, registeredSources: paymentSources.value, defaultSource: defaultPaymentSource.value, type
})
function applyMerchantPayment(form) {
  if (form.type !== 'expense' || form.paymentManuallySelected || form.importPaymentLocked) return
  form.paymentSource = suggestedPayment(form.merchant, form.recognizedPayment)
}
function manualPayment(form, value) { form.paymentSource = value; form.paymentManuallySelected = true }
async function refreshMerchantRules() {
  rules.value = await api('rules')
  await loadPaymentSettings()
}
async function setDefaultPaymentSource(name) {
  try {
    await api('payment-sources/default', { method: 'POST', body: JSON.stringify({ name }) })
    await loadPaymentSettings()
  } catch (e) { flash('デフォルト設定に失敗しました：' + e.message) }
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
// Device-only bulk image removal from 管理 → その他. Ledger records remain unchanged.
function onReceiptImagesCleared() {
  closeReceipt()
  receiptImageIds.value = new Set()
}

const editingEntry = ref(null)
const INCOME_CATEGORIES = sortOtherLast(['工资', '奖金', '副业', '老公生活费', '父母赠与', '亲友赠与', '退款', '其他收入'])
const categoryIcons = ref({})
const categoryDisplayNames = ref({})
const availableIcons = computed(() => {
  const used = new Set(Object.values(categoryIcons.value))
  const existingLabels = new Set(categories.value.map(name => categoryDisplayNames.value[name] || name))
  return ICON_LIBRARY.filter(icon => icon.id === 'other' || (!used.has(icon.id) && !existingLabels.has(icon.label)))
})
const categoryIconPath = name => ICON_LIBRARY.find(icon => icon.id === categoryIcons.value[name])?.path || ICON_LIBRARY.find(icon => icon.id === 'other').path
const legacyCategoryLabels = Object.freeze({'餐饮':'外食','饮食料品':'飲食料品','购物':'買い物','居住':'住居費','医疗':'医療費','娱乐':'娯楽','宠物':'ペット','其他':'その他','交通':'交通費','工资':'給与','奖金':'賞与','副业':'副業','老公生活费':'夫からの生活費','父母赠与':'両親からの援助','亲友赠与':'親族・友人からの援助','退款':'返金','其他收入':'その他の収入'})
// Keep historical D1 identifiers. Only the user-facing fallback is localized.
const categoryLabel = name => categoryDisplayNames.value[name] && categoryDisplayNames.value[name] !== name ? categoryDisplayNames.value[name] : (legacyCategoryLabels[name] || categoryDisplayNames.value[name] || name)
async function loadCategoryMetadata() {
  const rows = await api('category-source')
  categoryIcons.value = Object.fromEntries(rows.filter(row => row.icon).map(row => [row.category, row.icon]))
  categoryDisplayNames.value = Object.fromEntries(rows.filter(row => row.display_name).map(row => [row.category, row.display_name]))
}

// Store only a revocable, 30-day device session; never persist the access code.
localStorage.removeItem('token')
const rememberDevice = ref(localStorage.getItem('kakeibo-remember-device') !== '0')
const token = ref(sessionStorage.getItem('kakeibo-device-session') || (rememberDevice.value ? localStorage.getItem('kakeibo-device-session') : '') || '')
function setRememberDevice(remember) {
  rememberDevice.value=remember
  try {
    localStorage.setItem('kakeibo-remember-device',remember ? '1':'0')
    if(remember && token.value) localStorage.setItem('kakeibo-device-session',token.value)
    else localStorage.removeItem('kakeibo-device-session')
    if(!remember && token.value)sessionStorage.setItem('kakeibo-device-session',token.value)
  } catch { flash('ログイン状態の保存設定を変更できませんでした') }
}
const locked = ref(!token.value && localStorage.getItem('kakeibo-logged-out') === '1')
async function signIn(code) {
  const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'アクセスコードを確認してください')
  token.value = result.session
  sessionStorage.setItem('kakeibo-device-session', result.session)
  if(rememberDevice.value)localStorage.setItem('kakeibo-device-session', result.session)
  localStorage.removeItem('kakeibo-logged-out')
  sessionStorage.removeItem('kakeibo-token')
  locked.value = false
}
async function logout() {
  if (busy.value || editSaving.value || transferActionId.value !== null) return flash('処理が完了してからログアウトしてください')
  if (!confirm('ログアウトしますか？未保存の入力は、この端末に下書きとして残ります。')) return
  const oldSession = token.value
  token.value = ''
  localStorage.removeItem('kakeibo-device-session')
  sessionStorage.removeItem('kakeibo-device-session')
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
  try { await ensureLogin(); await Promise.all([load(), loadYear(), loadTransfers()]) }
  catch (error) { flash(error.message) }
}
async function api(path, opt = {}) {
  // All requests wait for the same login; never display concurrent prompts.
  if (!token.value) await ensureLogin()
  const requestToken = token.value
  const r = await fetch('/api/' + path, {
    ...opt, headers: { ...(opt.body instanceof FormData ? {} : { 'content-type': 'application/json' }), 'x-session': requestToken, ...(opt.headers || {}) }
  })
  if (r.status === 401) {
    // A different request may already have refreshed the session.
    if (token.value !== requestToken) return api(path, opt)
    if (rejectedSession !== requestToken) {
      rejectedSession = requestToken
      token.value = ''
      localStorage.removeItem('kakeibo-device-session')
      sessionStorage.removeItem('kakeibo-device-session')
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

const pageLoadError = ref('')
const annualLoadError = ref('')
let loadedMonth = ''
let loadedYear = null
async function fetchMonthEntries(targetMonth) {
  const all = []
  let cursor = 0
  for (;;) {
    const page = await api('entries?month=' + targetMonth + '&cursor=' + cursor)
    if (!Array.isArray(page)) throw Error('月別明細の形式が正しくありません')
    for (const row of page) {
      if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= cursor) throw Error('読み込み順序が変更されました')
      cursor = Number(row.id)
      all.push(row)
    }
    if (page.length < 500) return all
  }
}
let loadRequestId = 0
async function load() {
  const requestId = ++loadRequestId
  const requestedMonth = month.value
  if (loadedMonth !== requestedMonth) { entries.value = []; stats.value = null }
  pageLoadError.value = ''
  try {
    if (!rules.value.length) rules.value = await api('rules')
    if (!paymentSettingsLoaded) await loadPaymentSettings()
    const nextCategories = await api('categories')
    let nextEntries, nextStats
    // Entries and totals are different D1 reads; a concurrent write can land
    // between them. Retry once instead of showing contradictory financial data.
    for (let attempt=0; attempt<2; attempt++) {
      [nextEntries, nextStats]=await Promise.all([fetchMonthEntries(requestedMonth),api('stats?month='+requestedMonth)])
      if (requestId!==loadRequestId || requestedMonth!==month.value) return
      if (monthLedgerMatchesStats(nextEntries,nextStats)) break
      if (attempt===1) throw Error('記録と集計の更新時点が一致しません。もう一度読み込んでください')
    }
    if (requestId !== loadRequestId || requestedMonth !== month.value) return
    categories.value = sortOtherLast(nextCategories)
    try { await loadCategoryMetadata() } catch { /* Keep previously loaded category metadata until the next request. */ }
    entries.value = nextEntries
    refreshReceiptImageIds().catch(() => {})
    stats.value = nextStats
    loadedMonth = requestedMonth
  } catch (e) {
    if (requestId === loadRequestId && requestedMonth === month.value) {
      loadedMonth = ''
      entries.value = []
      stats.value = null
      pageLoadError.value = '月別データを読み込めませんでした：' + e.message
      flash(pageLoadError.value)
    }
  }
}
let yearRequestId = 0
async function loadYear() {
  const requestId = ++yearRequestId
  const year = selectedYear.value
  if (loadedYear !== year) annualStats.value = null
  annualLoadError.value = ''
  try {
    const nextStats = await api('stats?year=' + year)
    if (requestId === yearRequestId && year === selectedYear.value) {
      annualStats.value = nextStats
      loadedYear = year
    }
  } catch (e) {
    if (requestId === yearRequestId && year === selectedYear.value) {
      annualStats.value = null
      loadedYear = null
      annualLoadError.value = '年間集計の読み込みに失敗しました：' + e.message
      flash(annualLoadError.value)
    }
  }
}
onMounted(async () => {
  cleanupReceiptImages().catch(() => {}) // Keep the existing A01 thirty-day receipt behavior unchanged.
  if (!locked.value) {
    // Never auto-post fixed expenses on app open. User reviews the schedule in management.
    await load()
    await Promise.allSettled([loadYear(), loadTransfers()])
  }
})

watch(month, async () => { selectedDay.value = ''; calendarExpanded.value = false; swipedEntryId.value = null; swipedReceiptId.value = null; visibleEntryCount.value = 20; await load(); if (tab.value === 'list' && detailFilter.value?.period === 'month') await openCategoryDetails(detailFilter.value.category, detailFilter.value.type, 'month', detailFilter.value.paymentMethod || '') })
watch(selectedYear, async () => { visibleEntryCount.value = 20; await loadYear(); if (tab.value === 'list' && detailFilter.value?.period === 'year') await openCategoryDetails(detailFilter.value.category, detailFilter.value.type, 'year', detailFilter.value.paymentMethod || '') })
watch(tab, value => {
  if (value === 'stat' && statsPeriod.value === 'year') loadYear()
  if (value === 'list') visibleEntryCount.value = 20
  // Reset the vertical position on tab changes like a native app.
  window.scrollTo(0, 0)
})
watch(statsPeriod, value => { if (tab.value === 'stat' && value === 'year') loadYear() })

const recognitionMode = ref('statement')
const entryInputMode = ref('manual')
const aiOcrEnabled = ref(localStorage.getItem('kakeibo-ai-ocr-enabled') === '1')
const aiQuota = ref(null)
async function refreshAiQuota() {
  try { aiQuota.value=await api('ai-ocr/quota') }
  catch { aiQuota.value=null }
}
function setAiOcrEnabled(checked) {
  aiOcrEnabled.value = checked
  if (checked) void refreshAiQuota()
  try { localStorage.setItem('kakeibo-ai-ocr-enabled', checked ? '1' : '0') }
  catch { flash('AI OCRの設定を保存できませんでした') }
}
// Entering image-recognition mode always refreshes the shared D1 quota.
watch(entryInputMode, value => { if (value === 'scan') void refreshAiQuota() })
// Device-only recovery: never send unfinished drafts to D1. Receipt image blobs
// are intentionally excluded from localStorage; the original photo stays on device.
const draftRecoveryInfo = ref('')
const DRAFT_KEY = 'kakeibo-unsaved-draft-v1'
function clearLocalDraft() {
  if(!confirm('未保存の下書きを削除しますか？保存済み明細やレシート画像は残ります。'))return
  clearTimeout(draftSaveTimer)
  forms.value=[];input.value='';draftRecoveryInfo.value=''
  try{localStorage.removeItem(DRAFT_KEY)}catch{}
  flash('下書きを削除しました')
}
try {
  const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
  if (saved && Date.now() - Number(saved.updatedAt) < 7 * 86400000 && Array.isArray(saved.forms)) {
    forms.value = saved.forms.filter(f => f && typeof f === 'object' && !Array.isArray(f)).slice(0,150).map(f => ({...f,receiptImage:null,receiptFileName:''}))
    if (typeof saved.input === 'string') input.value = saved.input.slice(0,100000)
    if (forms.value.length || input.value.trim()) {
      entryInputMode.value = saved.mode === 'scan' ? 'scan' : 'manual'
      draftRecoveryInfo.value = '前回の下書きを復元しました（画像は再選択）'
    }
  }
} catch { /* Invalid old draft is ignored, not sent to the API. */ }
let draftSaveTimer = null
watch([forms,input,entryInputMode], () => {
  clearTimeout(draftSaveTimer)
  draftSaveTimer = setTimeout(() => {
    try {
      if (!forms.value.length && !input.value.trim()) return localStorage.removeItem(DRAFT_KEY)
      const safeForms = forms.value.slice(0,150).map(f => ({...f,receiptImage:null,receiptFileName:''}))
      localStorage.setItem(DRAFT_KEY,JSON.stringify({
        updatedAt:Date.now(),mode:entryInputMode.value,input:input.value.slice(0,100000),forms:safeForms
      }))
    } catch { /* Private browsing can disable storage; keep live draft intact. */ }
  }, 400)
}, {deep:true})
onUnmounted(() => { clearTimeout(draftSaveTimer) })
function recognize(mode = recognitionMode.value, append = false, referenceTime = new Date(), fromImage = false) {
  recognitionMode.value = mode
  if (!input.value.trim()) return
  // Scheduled-looking text expands into *drafts* only. Explicit review/save
  // and ordinary duplicate protections remain mandatory.
  // Natural-language expense drafts must work in 手入力 even after the user
  // previously selected レシート in the separate image-recognition tab.
  const structured = !append && entryInputMode.value === 'manual' ? parseNamedExpenseBlocks(input.value) : null
  if (structured?.error) return flash(structured.error)
  const repeated = parseRepeatedExpense(input.value)
  const effectiveMode = structured || repeated ? 'statement' : mode
  const parsed = structured ? structured.rows.map(row => {
    const match = classify(row.merchant, rules.value)
    return { ...row, category:match.category, suggested:match.category, keyword:match.keyword }
  }) : repeated || (effectiveMode === 'receipt' ? [parseReceipt(input.value, rules.value)] : parseEntries(input.value, rules.value, referenceTime))
  if (effectiveMode !== 'receipt') { pendingReceiptImage.value = null; pendingReceiptFileName.value = '' }
  // Recognize a *coherent* Suica history image, not isolated station strings
  // in arbitrary card statements. All guesses remain editable before saving.
  const icContext=fromImage && effectiveMode==='statement' &&
    (!importPaymentSource.value || importPaymentSource.value==='Suica')
    ? detectIcHistoryContext(parsed,paymentSources.value) : null
  const parsedForms = parsed.map(f => {
    // Apply the same rules to pasted text, statements and scanned receipts.
    // An unknown recharge is an editable transfer draft with no guessed target.
    const detectedTransfer = recognizeAssetTransfer({
      merchant: f.merchant, note: f.note, raw: f.raw, prepaidNames: prepaidSources.value
    })
    const type = detectedTransfer.isTransfer ? 'transfer'
      : effectiveMode === 'receipt' ? 'expense' : normalizedDraftType(f.type)
    const imported = effectiveMode === 'statement' ? importPaymentSource.value : ''
    const receiptPayment=effectiveMode==='receipt'
      ? detectRegisteredReceiptPayment(f.raw||input.value,paymentSources.value,paymentSourceMeta.value) : ''
    // Rule > registered OCR card > default, with a user-selected card
    // remaining authoritative after an edit. Payment networks like QUICPay
    // are not standalone cards and can never silently create one.
    const recognizedPayment=effectiveMode==='receipt'
      ? (receiptPayment || (paymentSources.value.includes(f.paymentSource) ? f.paymentSource : ''))
      : (f.paymentSource || icContext?.source || '')
    const chosenPayment=type==='transfer' ? (imported||'')
      : suggestedPayment(f.merchant,recognizedPayment,type,imported)
    const icFare=!!icContext?.municipalityFares?.has(f)
    const chosenCategory=type==='transfer'?'投資・資産移動':icFare?'交通':f.category
    const extraNote=icFare?'交通系ICの利用履歴から推定した交通費（登録前に確認）':''
    return { ...f, type, category: chosenCategory, note:[f.note,extraNote].filter(Boolean).join(' / '), transferTarget: detectedTransfer.transferTarget || f.transferTarget || '', transferDate: f.transferDate || f.date, paymentSource: chosenPayment, recognizedPayment, importPaymentLocked: !!imported, paymentManuallySelected: false, bindPaymentRule: false, receiptImage: effectiveMode === 'receipt' && type === 'expense' ? pendingReceiptImage.value : null, receiptFileName: effectiveMode === 'receipt' && type === 'expense' && pendingReceiptImage.value ? pendingReceiptFileName.value : '', showReceiptAttachment: effectiveMode === 'receipt', bindRule: false }
  })
  forms.value = append ? [...forms.value, ...parsedForms] : parsedForms
  // Preserve the current input tab: pasted text stays in 手入力. Only the
  // image-upload handler may switch to 画像から読み取る.
  flash(structured ? `${parsed.length}件の明細を作成しました。確認してから保存してください` : repeated ? `毎週の支出を${repeated.length}件に展開しました。日付・内容・金額を確認してから保存してください` : forms.value.length > 1 ? `${forms.value.length}件の記録を読み取りました。内容を確認して一括保存してください` : '読み取り結果を確認してください')
}
async function onImage(e, mode = 'statement') {
  // Freeze the reference at the start of upload so OCR network latency does
  // not change a relative timestamp such as 40分前 or 3時間前.
  const recognitionReference = new Date()
  const f = e.target.files[0]; e.target.value = ''
  if (!f || busy.value) return
  busy.value = '画像を準備中'
  ocrEngine.value = ''
  ocrWarning.value = ''
  try {
    // On-device OCR is the free, privacy-preserving default.
    if (!aiOcrEnabled.value) {
      busy.value = '端末内OCRで読み取り中'
      input.value = await ocrImage(f, progress => (busy.value = '読み取り中 ' + progress + '%'))
      ocrEngine.value = '端末内OCR'
    } else {
      try {
        busy.value = 'AIで画像を読み取り中'
        await refreshAiQuota()
        if(aiQuota.value && aiQuota.value.remaining<=0)throw Error('本日のAI上限に達しました')
        const data = new FormData()
        const image = await compressReceiptImage(f)
        data.append('image', image, image.type === 'image/jpeg' ? 'receipt.jpg' : 'receipt.webp')
        data.append('mode', mode)
        const response = await fetch('/api/ai-ocr', { method: 'POST', headers: { 'x-session': token.value }, body: data })
        if (!response.ok) { const errorBody = await response.json().catch(() => ({})); throw new Error(errorBody.error || `AI画像認識に失敗しました（HTTP ${response.status}）`) }
        const result = await response.json()
        await refreshAiQuota()
        if (!result.text?.trim()) throw new Error('認識結果がありません')
        if (result.engine !== 'gemma4') throw new Error('AIの応答を確認できませんでした')
        input.value = result.text
        ocrEngine.value = 'Gemma 4'
      } catch (aiError) {
        busy.value = '通常のOCRで読み取り中'
        try {
          input.value = await ocrImage(f, progress => (busy.value = '読み取り中 ' + progress + '%'))
          ocrEngine.value = '端末内OCR'
          ocrWarning.value = 'AIが使用できないため、端末内OCRに切り替えました：' + aiError.message
        } catch {
          throw new Error('AIと端末内OCRの両方で読み取れませんでした。再試行してください')
        }
      } finally {
        // An attempt is reserved before the model call even if OCR fails.
        await refreshAiQuota()
      }
    }
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
    // Do not classify a scanned receipt before saved merchant-payment rules
    // and the configured default card are available from existing D1.
    if (!paymentSettingsLoaded) await loadPaymentSettings()
    recognize(mode, true, recognitionReference, true)
    entryInputMode.value = 'scan'
  } catch (err) { pendingReceiptImage.value = null; pendingReceiptFileName.value = ''; receiptSaveError.value = '画像の準備または読み取りに失敗しました。元の写真を保管してください。'; flash('画像の読み取りに失敗しました：' + err.message) }
  busy.value = ''
}
function addBlank(type = 'expense') {
  entryInputMode.value = 'manual'
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE')
  const category = type === 'income' ? '工资' : type === 'transfer' ? '投資・資産移動' : '日用品'
  forms.value.push({ date: today, transferDate: today, transferTarget: '', time: localHHMM(now), amount: 0, type, category, paymentSource: type === 'expense' ? defaultPaymentSource.value : '', merchant: '', paymentManuallySelected: false, recognizedPayment: '', importPaymentLocked: false, bindPaymentRule: false, note: '', raw: '', suggested: category, keyword: '', bindRule: false })
}
function setEntryType(form, type) {
  if (form.type !== type) {
    if (type !== 'expense') {
      form.merchant = ''
      form.paymentSource = ''
      form.paymentManuallySelected = false
      form.bindRule = false
      form.bindPaymentRule = false
      form.receiptImage = null
      form.receiptFileName = ''
    }
    if (type !== 'transfer') form.transferTarget = ''
    if (type === 'transfer') form.transferDate = form.transferDate || form.date
  }
  form.type = type
  if (type === 'income') form.category = INCOME_CATEGORIES.includes(form.category) ? form.category : '工资'
  else if (type === 'transfer') form.category = '投資・資産移動'
  else if (INCOME_CATEGORIES.includes(form.category) || form.category === '投資・資産移動') form.category = '日用品'
  if (type === 'expense' && !form.paymentSource) applyMerchantPayment(form)
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
    categories.value = sortOtherLast(await api('categories'))
    await loadCategoryMetadata()
    categoryDialog.value = false
    flash('カテゴリを追加しました')
  } catch (e) { flash('カテゴリの追加に失敗しました：' + e.message) }
  finally { categorySaving.value = false }
}
function removeDraft(i) { forms.value.splice(i, 1) }

async function saveAll() {
  if (busy.value) return
  if (!forms.value.length) return flash('保存する記録がありません')
  const invalidTransfer = forms.value.findIndex(f => f.type === 'transfer' && (!f.transferTarget || !/^\d{4}-\d{2}-\d{2}$/.test(f.transferDate || '')))
  if (invalidTransfer >= 0) return flash(`${invalidTransfer + 1}件目の振替先と適用日を確認してください`)
  const invalid = forms.value.findIndex(f => !(Number(f.amount) > 0))
  if (invalid >= 0) return flash(`${invalid + 1}件目の金額が正しくありません。確認してください`)
  const uncertain = forms.value.filter(f => /要確認|不明瞭|読み取れません|確認してください/.test(f.note || ''))
  if (uncertain.length) return flash('金額・内容を確認し、要確認の表示を修正してください')
  // Check every month represented by the drafts, not just the currently displayed month.
  // This is an advisory check: two purchases with the same details can both be legitimate.
  const duplicateConfirmedKeys=new Set()
  busy.value = '重複を確認中'
  try {
    const months = [...new Set(forms.value.map(f => String(f.date || '').slice(0, 7)))]
    if (months.some(m => !/^\d{4}-(0[1-9]|1[0-2])$/.test(m))) throw Error('日付を確認してください')
    const historical = (await Promise.all(months.map(fetchMonthEntries))).flat()
    // Time differs between a manual entry and an OCR scan of the same purchase.
    // Use it for display, not as a reason to suppress a duplicate warning.
    const key = f => [f.date, Number(f.amount), String(f.merchant || '').trim(),
      f.payment_source ?? f.paymentSource ?? '', f.type || 'expense'].join('|')
    const seen = new Set()
    const known = new Set(historical.map(key))
    const possibleDuplicates = forms.value.filter(f => {
      const k = key(f)
      const ownRetry = f.clientRequestId && historical.some(e => e.client_request_id === f.clientRequestId)
      const duplicate = !ownRetry && (seen.has(k) || known.has(k))
      seen.add(k)
      return duplicate
    })
    if (possibleDuplicates.length) {
      if (!confirm(`対象月の既存明細と同じ日付・金額・店名・支払方法の候補が${possibleDuplicates.length}件あります。別の取引なら保存できます。続行しますか？`)) {
        busy.value = ''
        return
      }
      for (const candidate of possibleDuplicates) duplicateConfirmedKeys.add(key(candidate))
    }
  } catch (e) {
    busy.value = ''
    return flash('重複確認ができないため、保存を中止しました：' + e.message)
  }
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
      const result = await api('entries', { method: 'POST', body: JSON.stringify({
        ...f, amount: Number(f.amount), duplicatePolicy:'check',
        // Approval applies only to flagged rows, not the whole import batch.
        allowDuplicate:duplicateConfirmedKeys.has([f.date,Number(f.amount),String(f.merchant||'').trim(),
          f.paymentSource||'',f.type||'expense'].join('|'))
      }) })
      const receiptBlob = f.type === 'expense' ? f.receiptImage : null
      if (receiptBlob) {
        try { await persistReceipt(result?.id, receiptBlob) }
        catch { receiptImageWarning = ' レシート画像は保存できませんでした。元の写真を保管してください。'; receiptSaveError.value = '記録は保存されましたが、レシート画像の保存に失敗しました。元の写真を保管してください。' }
      }
      if (forms.value.length === 1) pendingReceiptImage.value = null
      forms.value.shift()
      saved++
      if (f.bindPaymentRule && f.type === 'expense' && f.merchant?.trim().length >= 2 && f.paymentSource) {
        try { await api('merchant-payment-rules', { method: 'POST', body: JSON.stringify({ keyword: f.merchant.trim(), paymentSource: f.paymentSource }) }) }
        catch { ruleFailures++ }
      }
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
    if (saved > 0) ledgerRevision.value++ // Also invalidate partial-success imports.
    try { rules.value = await api('rules') } catch { /* Keep existing rules when temporarily offline. */ }
    try { await loadPaymentSettings() } catch {}
    await Promise.allSettled([load(), loadYear(), loadTransfers()])
    busy.value = ''
  }
}
const ledgerRevision = ref(0)
const pendingEntryIds = ref(new Set())
const editSaving = ref(false)
async function remove(id) {
  const operatedDate = entries.value.find(entry => Number(entry.id) === Number(id))?.date?.slice(0, 10)
  if (pendingEntryIds.value.has(id)) return
  if (!confirm('この記録を削除しますか？')) return
  pendingEntryIds.value = new Set([...pendingEntryIds.value, id])
  try {
    await api('entries/' + id, { method: 'DELETE', headers: { 'x-confirm-delete': String(id) } })
    ledgerRevision.value++
    // Only remove the local receipt after the server confirms deletion.
    let receiptDeleteWarning = ''
    try {
      await deleteReceiptImage(id)
      receiptImageIds.value = new Set([...receiptImageIds.value].filter(imageId => Number(imageId) !== Number(id)))
      if (Number(viewedReceiptId.value) === Number(id)) closeReceipt()
    } catch { receiptDeleteWarning = ' 端末内のレシート画像は削除できませんでした。'; receiptSaveError.value = '記録は削除されましたが、端末内のレシート画像を削除できませんでした。' }
    preserveOperatedDay.value = operatedDate || ''
    await Promise.allSettled([load(), refreshDetailSource(), loadYear(), loadTransfers()])
    flash('記録を削除しました' + receiptDeleteWarning)
  } catch (error) { flash('削除に失敗しました：' + error.message) }
  finally { const next = new Set(pendingEntryIds.value); next.delete(id); pendingEntryIds.value = next }
}
function startEdit(entry) {
  editReceiptImage.value = null
  editReceiptFileName.value = ''
  editingEntry.value = {
    // Send an immutable snapshot for optimistic concurrency in D1.
    expected: Object.fromEntries(['date','time','amount','category','merchant','note','raw','type','transfer_target','transfer_date','payment_source']
      .map(key=>[key,entry[key]??null])),
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
  if (e.type === 'transfer' && (!e.transferTarget || !/^\d{4}-\d{2}-\d{2}$/.test(e.transferDate || ''))) {
    flash('振替先と適用日を確認してください')
    return
  }
  editSaving.value = true
  try {
    await api('entries/' + e.id, {
      method: 'PUT',
      body: JSON.stringify({ ...e, amount: Number(e.amount) })
    })
    ledgerRevision.value++
    if (editReceiptImage.value) {
      try { await persistReceipt(e.id, editReceiptImage.value); editReceiptImage.value = null }
      catch { receiptSaveError.value = '記録は更新されましたが、レシート画像を保存できませんでした。元の写真を保管してください。' }
    }
    const editedDay = e.date.slice(0, 10)
    const destinationMonth = editedEntryMonth(e.date)
    preserveOperatedDay.value = editedDay
    // An edited type/category can no longer match the previous detail filters.
    detailRequestId++
    detailFilter.value = null
    detailSourceEntries.value = []
    entryTypeFilter.value = 'all'
    selectedDay.value = ''
    editingEntry.value = null
    if (destinationMonth && destinationMonth !== month.value) month.value = destinationMonth
    flash(receiptSaveError.value || '記録を更新しました')
    await load()
    await refreshDetailSource()
    await loadYear()
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
    // Explicitly apply due transfers; this must not happen on unrelated GET requests.
    if (!/^[^.]+\.kakeibo-f17\.pages\.dev$/.test(window.location.hostname))
      await api('transfers/process-due',{method:'POST'})
    let rows = await api('transfers')
    // The backend marks due transfers once; no extra per-row writes needed here.
    pendingTransfers.value = rows
  } catch (e) { flash('振替予定を読み込めませんでした：' + e.message) }
  finally { transferLoading.value = false }
}
const transferStatus = item => Number(item.transfer_applied) === 1 ? '記帳反映済み' : (String(item.transfer_date || item.date) > new Date().toLocaleDateString('sv-SE') ? '入金予定' : '未処理')
const transferStatusClass = item => Number(item.transfer_applied) === 1 ? 'transfer-done' : 'transfer-waiting'
const transferActionId = ref(null)
async function retryTransfer(item) {
  if (transferActionId.value !== null) return
  transferActionId.value = item.id
  try {
    await api('transfers/' + item.id, { method: 'POST' })
    await loadTransfers()
        flash('資産移動を処理しました')
  } catch (e) { flash('処理に失敗しました：' + e.message) }
  finally { transferActionId.value = null }
}
async function dismissTransferReminder(item) {
  if (transferActionId.value !== null) return
  transferActionId.value = item.id
  try {
    await api('transfers/' + item.id + '/dismiss', { method: 'POST' })
    pendingTransfers.value = pendingTransfers.value.filter(row => row.id !== item.id)
    flash('振替予定の表示を閉じました')
  } catch (e) { flash('表示の更新に失敗しました：' + e.message) }
  finally { transferActionId.value = null }
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
  const targetMonth = date.slice(0, 7)
  if (month.value !== targetMonth) {
    month.value = targetMonth
    // The month watcher resets the selected day and calendar view.
    await nextTick()
  }
  calendarExpanded.value = true
  selectedDay.value = date
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
const prepaidHistoryFilter = ref(null)
// Histories are scoped to one actual prepaid card, never all transport cards.
const matchesPrepaidHistory = entry => matchesPrepaidHistoryEntry(entry, prepaidHistoryFilter.value)
async function openPrepaidHistoryDetails(cardName,kind) {
  if (!prepaidSources.value.includes(cardName) || !['charge','usage'].includes(kind)) return
  detailRequestId++
  detailLoading.value = false
  detailFilter.value = null
  detailSourceEntries.value = []
  selectedDay.value = ''
  visibleEntryCount.value = 20
  calendarExpanded.value = false
  preserveOperatedDay.value = ''
  const source=paymentSourceMeta.value[cardName]
  prepaidHistoryFilter.value = {
    card:cardName, kind, openingDate:source?.opening_date||'',
    openingEntryId:Number(source?.opening_entry_id||0)
  }
  entryTypeFilter.value = kind === 'charge' ? 'transfer' : 'all'
  const targetMonth = currentMonth()
  const changedMonth = month.value !== targetMonth
  month.value = targetMonth
  tab.value = 'list'
  if (!changedMonth) await load()
}
const paymentMethodMatches = (entry, method) => method === '現金' ? !String(entry.payment_source || '').trim() || entry.payment_source === '現金' : Boolean(String(entry.payment_source || '').trim()) && entry.payment_source !== '現金'
async function openPaymentMethodDetails(method, period) {
  await openCategoryDetails('', 'expense', period, method)
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
  return narrowed.filter(entryMatchesType).filter(matchesPrepaidHistory).filter(entry => !selectedDay.value || String(entry.date || '').slice(0, 10) === selectedDay.value)
})
function setEntryTypeFilter(value) {
  prepaidHistoryFilter.value = null
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
const annualMonthGroups = computed(() => groupAnnualEntries(sortedDisplayEntries.value, annualVisibleCounts.value, listPageSize, entryTypeFilter.value))
function loadMoreAnnualEntries(group) {
  annualVisibleCounts.value = { ...annualVisibleCounts.value, [group.month]: Math.min(group.count, group.items.length + listPageSize) }
}
watch(annualMonthGroups, groups => {
  if (annualDetailMode.value && !groups.some(g => g.month === expandedMonth.value)) expandedMonth.value = groups[0]?.month || ''
})
function loadMoreEntries() { visibleEntryCount.value = Math.min(sortedDisplayEntries.value.length, visibleEntryCount.value + listPageSize) }
const expandedEntryDays = ref(new Set())
const preserveOperatedDay = ref('')
const groupedPagedEntries = computed(() => {
  // Use every matching row for each day's headline, not just the first 20 visible rows.
  const fullDays = new Map()
  for (const entry of sortedDisplayEntries.value) {
    const day = String(entry.date || '').slice(0, 10)
    if (!fullDays.has(day)) fullDays.set(day, [])
    fullDays.get(day).push(entry)
  }
  const totalsByDay = new Map()
  for (const [day, all] of fullDays) {
    totalsByDay.set(day, { count: all.length, total: ledgerEntriesTotal(all, entryTypeFilter.value) })
  }
  const groups = new Map()
  for (const entry of pagedEntries.value) {
    const day = String(entry.date || '').slice(0, 10)
    if (!groups.has(day)) groups.set(day, { date: day, items: [], ...totalsByDay.get(day) })
    groups.get(day).items.push(entry)
  }
  return [...groups.values()]
})
function toggleEntryDay(date) {
  expandedEntryDays.value = expandedEntryDays.value.has(date) ? new Set() : new Set([date])
}
watch([displayEntries, detailFilter, selectedDay], () => {
  annualVisibleCounts.value = {}
  visibleEntryCount.value = 20
  const days = [...new Set(displayEntries.value.map(entry => String(entry.date || '').slice(0, 10)).filter(Boolean))].sort((a, b) => b.localeCompare(a))
  const today = new Date().toLocaleDateString('sv-SE')
  const operatedDay = preserveOperatedDay.value
  const defaultDay = operatedDay && days.includes(operatedDay) ? operatedDay : (detailFilter.value ? days[0] : (days.includes(today) ? today : days[0]))
  expandedEntryDays.value = new Set(defaultDay ? [defaultDay] : [])
  if (operatedDay && days.includes(operatedDay)) {
    const index = sortedDisplayEntries.value.findIndex(entry => String(entry.date || '').slice(0, 10) === operatedDay)
    visibleEntryCount.value = Math.max(20, index + 1)
  }
  if (!operatedDay || days.includes(operatedDay)) preserveOperatedDay.value = ''
}, { deep: true })
watch(visibleEntryCount, () => {
  const days = groupedPagedEntries.value.map(group => group.date)
  if (days.length && !days.some(day => expandedEntryDays.value.has(day))) expandedEntryDays.value = new Set([days[0]])
})
async function fetchPeriodDetailRows(period, requestId = null) {
  if (period !== 'year') return fetchMonthEntries(month.value)
  const year = selectedYear.value
  const rows = []
  let cursor = 0
  for (;;) {
    if (requestId !== null && requestId !== detailRequestId) return []
    const page = await api('entries?year=' + year + '&cursor=' + cursor)
    if (!Array.isArray(page)) throw new Error('年間明細の形式が正しくありません')
    for (const entry of page) {
      if (!Number.isSafeInteger(Number(entry.id)) || Number(entry.id) <= cursor) throw Error('明細の順序が変更されました')
      cursor = Number(entry.id)
      rows.push(entry)
    }
    if (page.length < 500) break
  }
  return rows
}
async function openCategoryDetails(category, type, period, paymentMethod = '') {
  prepaidHistoryFilter.value = null
  detailFilter.value = { category, type, period, paymentMethod }
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
  if (prepaidHistoryFilter.value) entryTypeFilter.value = 'all'
  prepaidHistoryFilter.value = null
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
  return source.filter(entryMatchesType).filter(matchesPrepaidHistory).filter(entry => !detailFilter.value || (
    detailFilter.value.paymentMethod ? entry.type === 'expense' && paymentMethodMatches(entry,detailFilter.value.paymentMethod) :
    detailFilter.value.type === 'transfer' ? entry.type === 'transfer' :
    entry.category === detailFilter.value.category && (detailFilter.value.type === 'income' ? entry.type === 'income' : entry.type !== 'income' && entry.type !== 'transfer')
  )).filter(entry => String(entry.date || '').startsWith(month.value))
})
const calendarDays = computed(() => {
  const [year, monthNumber] = month.value.split('-').map(Number)
  const daysInMonth = new Date(year, monthNumber, 0).getDate()
  const firstDayOffset = sundayFirstOffset(year, monthNumber - 1)
  const amounts = new Map(), expenses = new Map(), incomes = new Map(), entryCounts = new Map()
  // Use the same signed totals as the full day heading. Transfers are not spending in "all".
  for (const entry of calendarEntries.value) {
    const key = String(entry.date || '').slice(0, 10)
    const amount = Number(entry.amount || 0)
    amounts.set(key, (amounts.get(key) || 0) + ledgerEntryAmount(entry, entryTypeFilter.value))
    entryCounts.set(key, (entryCounts.get(key) || 0) + 1)
    if (entry.type === 'expense' || !entry.type) expenses.set(key, (expenses.get(key) || 0) + amount)
    if (entry.type === 'income') incomes.set(key, (incomes.get(key) || 0) + amount)
  }
  const maxExpense=Math.max(0,...expenses.values()),maxIncome=Math.max(0,...incomes.values())
  const today=liveNow.value.toLocaleDateString('sv-SE')
  const days = Array.from({ length: firstDayOffset }, (_, i) => ({ key: `blank-${i}`, blank: true }))
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    days.push({ key: date, date, day, amount: amounts.get(date) || 0, hasEntries: entryCounts.has(date),
      isToday:date===today, topExpense:maxExpense>0 && expenses.get(date)===maxExpense,
      topIncome:maxIncome>0 && incomes.get(date)===maxIncome, blank:false })
  }
  while (days.length % 7) days.push({ key: `blank-end-${days.length}`, blank: true })
  return days
})
const visibleCalendarDays = computed(() => {
  if (calendarExpanded.value) return calendarDays.value
  const today = liveNow.value.toLocaleDateString('sv-SE')
  const target = today.startsWith(month.value) ? today : (selectedDay.value.startsWith(month.value) ? selectedDay.value : calendarDays.value.find(day => !day.blank)?.date)
  const index = calendarDays.value.findIndex(day => day.date === target)
  const start = Math.max(0, Math.floor(Math.max(0, index) / 7) * 7)
  return calendarDays.value.slice(start, start + 7)
})
function openLedgerFromNav() {
  prepaidHistoryFilter.value = null
  detailFilter.value = null
  entryTypeFilter.value = 'all'
  selectedDay.value = ''
  detailSourceEntries.value = []
  calendarExpanded.value = false
  visibleEntryCount.value = 20
  preserveOperatedDay.value = ''
  tab.value = 'list'
}

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
// Monthly statistics use the same Sunday–Saturday weeks as the Japanese calendar.
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
const averageDaily = computed(() => dayRows.value.length ? Math.round(Number(stats.value?.total || 0) / dayRows.value.length) : 0)
const liveNow = ref(new Date())
let clockTimer = null
const todayLabel = computed(() => {
  const d=liveNow.value, pad=n=>String(n).padStart(2,'0')
  return `${d.getFullYear()}年${pad(d.getMonth()+1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
const liveClockIso = computed(() => {
  const d=liveNow.value, pad=n=>String(n).padStart(2,'0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
onMounted(() => { liveNow.value = new Date(); clockTimer = setInterval(() => { liveNow.value = new Date() }, 1000) })
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer) })
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
  prepaidHistoryFilter.value = null
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
// Statistical illustrations are bundled local assets; do not rely on image CDNs.
const puppyExpression = ratio => ratio >= 1 ? puppyCrying : puppyWorried
function puppyFallback(event) { event.target.onerror = null; event.target.src = puppyWorried }
const pigLabel = ratio => ratio === null ? 'お財布、収入の登場を待機中…🪙' : ratio >= 1 ? 'お財布が大泣き！収入より使ってるよ💸' : ratio >= .8 ? 'ちょっと使いすぎ？お財布に汗が…💦' : 'お財布、ごきげん♪ この調子！'
const ratioLabel = ratio => ratio === null ? '収入データなし' : Math.round(ratio * 100) + '%'

// All page links share these same reactive refs and navigation handlers.
// Child page components never create separate ledger selection state.
provide('kakeibo-page-context', { tab, cardSettingsRequest, openCardSettingsFromWallet, statsPeriod, themes, storedTheme, theme, setTheme, currentMonth, month, resetMonth, selectedYear, annualStats, selectedRatioMonth, rules, input, ocrEngine, forms, paymentSources, paymentClosingDays, paymentSourceMeta, transferDestinations, updatePaymentSources, defaultPaymentSource, merchantPaymentRules, customCategoryRules, importPaymentSource, paymentSettingsLoaded, paymentSettingsLoading, loadPaymentSettings, suggestedPayment, applyMerchantPayment, manualPayment, refreshMerchantRules, setDefaultPaymentSource, pendingReceiptImage, pendingReceiptFileName, editReceiptImage, editReceiptFileName, receiptSaveError, selectDraftReceipt, selectEditReceipt, persistReceipt, receiptImageIds, viewedReceiptUrl, viewedReceiptId, refreshReceiptImageIds, viewReceipt, closeReceipt, removeReceiptImage, onReceiptImagesCleared, editingEntry, INCOME_CATEGORIES, categoryIcons, categoryDisplayNames, availableIcons, categoryIconPath, categoryLabel, loadCategoryMetadata, rememberDevice, token, setRememberDevice, locked, signIn, logout, loginPromise, rejectedSession, ensureLogin, unlock, api, yen, formatLedgerTotal, flashTimer, flash, pageLoadError, annualLoadError, loadedMonth, loadedYear, fetchMonthEntries, loadRequestId, load, yearRequestId, loadYear, recognitionMode, entryInputMode, aiOcrEnabled, aiQuota, refreshAiQuota, setAiOcrEnabled, draftRecoveryInfo, DRAFT_KEY, clearLocalDraft, draftSaveTimer, recognize, onImage, addBlank, setEntryType, categoryDialog, categoryName, categoryIcon, categorySaving, addCategory, saveCategory, removeDraft, saveAll, ledgerRevision, pendingEntryIds, editSaving, remove, startEdit, cancelEdit, saveEdit, pendingTransfers, transferLoading, transferDue, loadTransfers, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder, maxCat, maxDay, categoryRows, pieGradient, expensePalette, selectedDonut, donutRows, donutSelected, donutTotal, donutPercent, chooseDonut, selectDonutSlice, monthlyCategoryPie, annualExpensePie, openDuplicateDate, selectedDay, entryTypeFilter, calendarExpanded, swipedEntryId, swipedReceiptId, filteredEntries, detailFilter, prepaidHistoryFilter, openPrepaidHistoryDetails, paymentMethodMatches, openPaymentMethodDetails, detailSourceEntries, detailLoading, detailRequestId, visibleEntryCount, listPageSize, entryMatchesType, displayEntries, setEntryTypeFilter, sortedDisplayEntries, annualDetailMode, pagedEntries, expandedMonth, annualVisibleCounts, annualMonthGroups, loadMoreAnnualEntries, loadMoreEntries, expandedEntryDays, preserveOperatedDay, groupedPagedEntries, toggleEntryDay, fetchPeriodDetailRows, openCategoryDetails, refreshDetailSource, clearDetailFilter, dayRows, touchStartX, touchStartY, suppressRowClick, calendarEntries, calendarDays, visibleCalendarDays, openLedgerFromNav, toggleDay, startSwipe, endSwipe, handleEntryClick, weekRows, maxWeek, averageDaily, liveNow, clockTimer, todayLabel, liveClockIso, monthLabel, yearMonthRows, expenseTrendPoints, expenseTrendLine, expenseTrendArea, incomeTrendPoints, incomeTrendLine, ratioTrendPoints, ratioTrendSegments, incomeTrendMax, ratioTrendMax, maxYearMonth, highestSpendMonth, annualAverage, annualIncomeCategories, maxAnnualIncomeCategory, openMonthDetails, selectRatioMonth, selectedRatioMonthRow, selectedRatio, monthlyRatio, annualRatio, pigState, puppyExpression, puppyFallback, pigLabel, ratioLabel, entries, stats, categories, msg, ocrWarning, busy })
</script>

<template>
  <main v-if="locked" :class="`theme-${theme}`"><div class="empty-state"><strong>ログアウトしました</strong><p>再開するにはアクセスコードが必要です。</p><button type="button" class="button-primary" @click="unlock">ログイン</button></div></main>
  <main v-else :class="`theme-${theme}`">
    <div v-if="receiptSaveError" role="alert" class="receipt-error-banner"><span>{{ receiptSaveError }}</span><button type="button" @click="receiptSaveError = ''" aria-label="通知を閉じる">×</button></div>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" role="img" aria-label="家計簿のノートとコイン">
          <img class="brand-local-logo" src="/branding/kakeibo-ledger.svg" alt="" width="44" height="44" decoding="async" />
        </span>
        <div><strong>家計簿</strong><small>家計をかんたんに記録</small></div>
      </div>
      
      <div class="header-actions">
        <details class="theme-picker">
          <summary aria-label="テーマカラーを選ぶ" title="配色を変更">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a1.5 1.5 0 0 1 0-3h3.5A4.5 4.5 0 0 0 21 9.5 9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="6.5" r="1"/><circle cx="16" cy="8.5" r="1"/></svg>
            <span class="theme-indicator" :style="{ background: themes.find(item => item.id === theme)?.color }"></span>
          </summary>
          <div class="theme-switcher" role="group" aria-label="テーマカラー">
            <button v-for="item in themes" :key="item.id" type="button" class="theme-swatch"
              :class="{ selected: theme === item.id }" :aria-label="item.label + 'テーマ'"
              :aria-pressed="theme === item.id"
              @click="setTheme(item.id); $event.currentTarget.closest('details').open = false">
              <span class="theme-dot" :style="{ backgroundColor: item.color }" aria-hidden="true"></span>
              <svg v-if="theme === item.id" class="theme-check" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12 5 5 9-10" />
              </svg>
            </button>
          </div>
        </details>
        <button type="button" class="header-logout" @click="logout" aria-label="ログアウト"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg><span>ログアウト</span></button>
      </div>
    </header>

    <p v-if="msg" class="toast" role="status">{{ msg }}</p>
    <div v-if="(tab === 'list' || (tab === 'stat' && statsPeriod === 'month')) && pageLoadError" class="panel" role="alert"><span>{{pageLoadError}}</span> <button type="button" class="button-secondary" @click="load">再読み込み</button></div>
    <div v-if="tab === 'stat' && statsPeriod === 'year' && annualLoadError" class="panel" role="alert"><span>{{annualLoadError}}</span> <button type="button" class="button-secondary" @click="loadYear">再読み込み</button></div>

    <section v-if="tab === 'add'" class="page-section">
      <div class="page-heading"><div><h1>入力</h1><time class="entry-live-clock" :datetime="liveClockIso" aria-label="現在の日時">{{ todayLabel }}</time></div><button class="button-secondary manage-category" @click="addCategory">＋ カテゴリ追加</button></div>
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
      <div v-if="entryInputMode === 'manual'" class="panel text-paste-panel">
        <details class="text-entry-details">
          <summary>テキストを貼り付けて読み取る</summary>
          <label class="field-label" for="entry-text">テキスト入力</label>
          <label class="form-field"><span>読み取り対象のカード</span><select v-model="importPaymentSource"><option value="">自動判定</option><option v-for="source in paymentSources" :key="source" :value="source">{{ source }}</option></select></label>
          <textarea id="entry-text" v-model="input" rows="4" :placeholder="recognitionMode === 'statement' ? '例：勉強会　10月毎週の金曜日（もしくは　10/10） 100円' : 'レシートの読み取り文字を貼り付けられます。'"></textarea>
          <div class="action-row">
            <button class="button-secondary" @click="recognize(recognitionMode)" :disabled="!!busy || !input.trim()">テキストを読み取る</button>
          </div>
        </details>
      </div>
      <div v-if="entryInputMode === 'scan'" class="panel capture-panel">
        <div class="ocr-engine-picker" role="group" aria-label="画像の読み取り方法">
          <span class="ocr-engine-title">読み取り方法</span>
          <div class="ocr-engine-options">
            <button type="button" :class="{ selected: !aiOcrEnabled }" :aria-pressed="!aiOcrEnabled" :disabled="!!busy" @click="setAiOcrEnabled(false)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18h4"/></svg>
              <span>端末内</span>
            </button>
            <button type="button" :class="{ selected: aiOcrEnabled }" :aria-pressed="aiOcrEnabled" :disabled="!!busy" @click="setAiOcrEnabled(true)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>
              <span>AI</span>
            </button>
          </div>
        </div>
        <p v-if="aiQuota" class="ocr-engine-note" role="note">本日のAI残り回数：{{aiQuota.remaining}}/{{aiQuota.limit}}回</p>
        <label class="form-field receipt-mode-select"><span>読み取り対象</span><select v-model="recognitionMode" aria-label="読み取り対象"><option value="statement">利用明細</option><option value="receipt">レシート</option></select></label>
        <label v-if="recognitionMode === 'statement'" class="form-field"><span>読み取り対象のカード</span><select v-model="importPaymentSource"><option value="">自動判定</option><option v-for="source in paymentSources" :key="source" :value="source">{{ source }}</option></select></label>
        <p class="microcopy">{{ recognitionMode === 'statement' ? '明細を複数件読み取り' : 'レシートを1件読み取り' }}</p>


        <div v-if="busy" class="progress-wrap"><span class="spinner"></span><span>{{ busy }}</span></div>
        <p v-if="ocrEngine" class="microcopy" role="status">読み取りエンジン：{{ ocrEngine }}</p>
        <p v-if="ocrWarning" class="microcopy" role="alert">{{ ocrWarning }}</p>
      </div>

      <div v-if="forms.length || input.trim()" class="draft-utility-row">
        <span v-if="draftRecoveryInfo" class="draft-recovery-hint" role="status">{{draftRecoveryInfo}}</span>
        <button type="button" class="draft-discard-inline" :disabled="!!busy" @click="clearLocalDraft" aria-label="未保存の下書きを削除" title="未保存の下書きを削除">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 4h4M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg>
          下書きを削除
        </button>
      </div>
      <div v-if="forms.length" class="draft-heading">
        <div><h2>{{ entryInputMode === 'scan' ? '読み取り結果の確認' : '入力内容の確認' }}</h2><p>保存前に金額・日付を確認</p></div>
        <span class="count-pill">{{ forms.length }}件</span>
      </div>
      <div v-for="(f, i) in forms" :key="i" class="entry-card">
        <div class="entry-card-heading"><span class="entry-number">{{ String(i + 1).padStart(2, '0') }}</span><strong>{{ f.merchant || '新しい記録' }}</strong><button class="icon-button remove-button" @click="removeDraft(i)" aria-label="この記録を削除">×</button></div>
        <TransactionForm :transfer-destinations="transferDestinations" :record="f" :categories="categories" :income-categories="INCOME_CATEGORIES" :payment-sources="paymentSources" :category-label="categoryLabel" :receipt-enabled="entryInputMode === 'manual' || f.showReceiptAttachment === true" @change-type="setEntryType(f, $event)" @merchant-change="applyMerchantPayment(f)" @payment-change="manualPayment(f, $event)" @select-receipt="selectDraftReceipt($event, f)" @clear-receipt="f.receiptImage = null; f.receiptFileName = ''" />
      </div>
      <p v-if="receiptSaveError" role="alert" class="receipt-save-error">{{ receiptSaveError }}</p>
      <div class="batch-actions" :class="{ 'batch-actions-empty': !forms.length }">
        <button v-if="entryInputMode === 'manual'" type="button" class="button-secondary" :disabled="!!busy" @click="addBlank('expense')">＋ 記録を追加</button>
        <label v-else class="button-secondary upload-button" :class="{ 'upload-disabled': !!busy }" :aria-disabled="!!busy">{{ forms.length ? '別の画像を読み取る' : recognitionMode === 'statement' ? '明細を読み取る' : 'レシートを読み取る' }}<input type="file" accept="image/*" @change="onImage($event, recognitionMode)" :disabled="!!busy" hidden /></label>
        <button class="button-primary" @click="saveAll" :disabled="!!busy || !forms.length">{{ busy === 'saving' ? '保存中…' : `保存 ${forms.length}件` }}</button>
      </div>
      </fieldset>
    </section>

    <LedgerPage v-else-if="tab === 'list'" />
    <StatisticsPage v-else-if="tab === 'stat'" />
    <AssetsPage v-else-if="tab === 'investments'" />
    <ManagementPage :card-settings-request="cardSettingsRequest" :payment-source-meta="paymentSourceMeta" v-show="tab === 'finance'" :active="tab === 'finance'" :ledger-revision="ledgerRevision" :api="api" :categories="categories" :payment-sources="paymentSources" :payment-closing-days="paymentClosingDays" :default-payment-source="defaultPaymentSource" :merchant-payment-rules="merchantPaymentRules" :category-rules="customCategoryRules" :remember-device="rememberDevice" @change-remember-device="setRememberDevice" @receipt-images-cleared="onReceiptImagesCleared" @merchant-rules-changed="refreshMerchantRules" @set-default-payment-source="setDefaultPaymentSource" @settings-changed="loadPaymentSettings" @update-payment-sources="updatePaymentSources" @payment-settings-refresh="loadPaymentSettings" @open-duplicate="openDuplicateDate" @ledger-updated="ledgerRevision++; load(); loadYear()" />
    <nav class="bottom-nav" aria-label="メインメニュー">
      <button type="button" :class="{ active: tab === 'list' }" :aria-current="tab === 'list' ? 'page' : undefined" @click="openLedgerFromNav"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><span>明細</span></button>
      <button type="button" :class="{ active: tab === 'stat' }" :aria-current="tab === 'stat' ? 'page' : undefined" @click="tab = 'stat'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4.5 19.5h15"/><rect x="6" y="11" width="3.2" height="6.5" rx="1"/><rect x="10.4" y="7.5" width="3.2" height="10" rx="1"/><rect x="14.8" y="4.5" width="3.2" height="13" rx="1"/></svg></span><span>統計</span></button>
      <button type="button" class="nav-add" :class="{ active: tab === 'add' }" :aria-current="tab === 'add' ? 'page' : undefined" aria-label="記録を追加" title="記録を追加" @click="tab = 'add'"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <button type="button" :class="{ active: tab === 'investments' }" :aria-current="tab === 'investments' ? 'page' : undefined" aria-label="残高" @click="tab = 'investments'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M7 4.5h10M15.5 14.5h2"/></svg></span><span>残高</span></button>
      <button type="button" :class="{ active: tab === 'finance' }" :aria-current="tab === 'finance' ? 'page' : undefined" @click="tab = 'finance'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg></span><span>管理</span></button>
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
.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:grid;place-items:center;width:58px;height:42px;border-radius:15px;background:linear-gradient(135deg,#fff0e6,#ffeaf1);color:var(--blue);font-size:20px;font-weight:800;letter-spacing:-7px;padding-right:7px;box-shadow:inset 0 0 0 1px #f8dce4}.brand strong{display:block;font-size:17px;letter-spacing:.02em}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:1px}
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
.batch-actions{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:9px;margin-top:14px;align-items:stretch}.batch-actions button,.batch-actions .upload-button{width:100%;min-width:0;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center}
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
.brand-mark img.brand-local-logo{display:block;width:100%;height:100%;object-fit:contain;flex:none}
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
/* Mobile-first PWA shell, usable with all cream themes. */
main{--touch-height:44px;--card-padding:16px;--section-gap:14px;--radius-sm:10px;--radius-md:14px;--radius-lg:18px;
width:100%;max-width:560px;padding:calc(env(safe-area-inset-top) + 10px) 14px calc(env(safe-area-inset-bottom) + 100px);
overscroll-behavior-y:contain}
main .topbar{gap:8px;padding:5px 0 15px;min-height:58px}
main .brand-mark{width:44px;height:44px}
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
.payment-method-stats{margin:12px 0;display:grid;gap:8px}.payment-method-stats h2{font-size:15px;margin:0}.payment-method-stats-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.payment-method-stats-grid button{display:grid;gap:5px;text-align:left;min-width:0;min-height:80px;padding:12px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--ink)}.payment-method-stats-grid strong{font-size:17px;overflow-wrap:anywhere}.payment-method-stats-grid small{color:var(--muted)}.payment-method-stats-grid button:disabled{opacity:.65;cursor:default}.payment-method-stats-grid button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}.text-entry-details{margin-top:10px}.text-entry-details summary{cursor:pointer;color:var(--muted);font-size:13px;padding:8px 0}.text-entry-details[open] summary{margin-bottom:8px}.text-entry-details textarea{width:100%;box-sizing:border-box}
/* Period controls live alongside the section title, not in the global top bar. */
.page-heading{gap:10px;min-width:0}.page-heading>div:first-child{min-width:0}.heading-period{display:flex;align-items:center;gap:5px;flex:none;min-width:0}.heading-period .month{width:135px;max-width:100%;font-size:13px}.heading-year{display:flex;align-items:center;gap:3px;flex:none;padding:0 8px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;font-weight:750}
@media(max-width:390px){.page-heading .heading-period .month{width:115px;font-size:12px}.page-heading .heading-period .period-reset{padding:8px 6px}.page-heading:has(.heading-period),.page-heading:has(.heading-year){gap:6px}}
</style>

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

<style>.input-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:5px;margin:10px 0 14px;background:var(--line);border-radius:15px}.input-mode-switch button{border:0;border-radius:11px;background:transparent;padding:12px 7px;color:var(--muted);font-size:14px;font-weight:800;cursor:pointer}.input-mode-switch button.selected{background:var(--card);color:var(--blue-dark);box-shadow:0 2px 9px #00000012,inset 0 0 0 1px var(--blue)}.capture-panel{margin-bottom:15px}@media(max-width:480px){.input-mode-switch button{min-height:44px}}</style>

<style>.text-paste-panel{margin:10px 0 14px;padding:12px 14px}.text-paste-panel .text-entry-details{margin:0}
/* Keep both primary entry actions in a stable, narrow-screen row. */
.batch-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;min-width:0;width:100%}
.batch-actions>*{min-width:0;max-width:100%;width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;white-space:normal;overflow-wrap:anywhere;min-height:44px}
.batch-actions .upload-disabled{opacity:.55;pointer-events:none;cursor:not-allowed}
/* Remove the logo's outer frame across all cream themes. */
main .brand-mark,
main.theme-pink .brand-mark,
main.theme-blue .brand-mark,
main.theme-yellow .brand-mark,
main.theme-green .brand-mark{
  background:transparent;
  box-shadow:none;
  border:none;
  border-radius:0;
  padding:0;
}

/* Low-emphasis draft action, with a full-size 44px touch target. */
.draft-utility-row{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;margin:4px 1px 0}
.draft-recovery-hint{flex:1;min-width:0;font-size:11px;line-height:1.4;color:var(--muted)}
.draft-discard-inline{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:44px;border:0;background:transparent;box-shadow:none;color:var(--muted);padding:7px 8px;border-radius:9px;font-size:12px;font-weight:500;cursor:pointer}
.draft-discard-inline svg{width:15px;height:15px;flex:none}
.draft-discard-inline:disabled{opacity:.45;cursor:not-allowed}
.draft-discard-inline:focus-visible{outline:2px solid var(--blue);outline-offset:2px}

/* Default balance illustration: local GIF, only for the under-80% / unrecorded state.
   The existing 80% and 100% character images remain unchanged. */
main .puppy-pair.puppy-happy,
main .puppy-pair.puppy-empty{padding:0;background:transparent}
main .puppy-pair img.puppy-default-gif{display:block;width:100%;height:100%;object-fit:contain;flex:none;border:0;border-radius:0;filter:none}
</style>
