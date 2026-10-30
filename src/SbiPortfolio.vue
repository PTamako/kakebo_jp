<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { autoNavSupported, KNOWN_MANUAL_NAV_FUNDS } from './fund-nav-coverage.js'
import { parseSbiHoldingsText } from './sbi-holdings-import.js'
import { reconcileSbiScreens } from './sbi-dual-screens.js'
import { ocrImage } from './parse.js'
import { compressReceiptImage } from './receipt-image.js'

const props = defineProps({
  api: { type: Function, required: true },
  transferLoading: { type: Boolean, default: false }
})
const emit = defineEmits(['summary'])
const showAllHoldings = ref(false), showAllPlans = ref(false), showAllTransfers = ref(false)
const expandedHolding = ref('')
const navSupport = ref({})
const holdingKey = h => h.fund_code + ':' + h.account_type
const today = () => new Date().toLocaleDateString('sv-SE')
const month = ref(today().slice(0, 7))
const data = ref(null)
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const editing = ref('')
const existingIdentity = ref(false)
const knownFunds = [
  { code:'0331418A', name:'eMAXIS Slim 全世界株式（オール・カントリー）', account:'tsumitate' },
  { code:'03311187', name:'eMAXIS Slim 米国株式（S&P500）', account:'tsumitate' },
  { code:'0331A172', name:'eMAXIS Slim 先進国債券インデックス（除く日本）', account:'growth' },
  { code:'04317188', name:'iFreeNEXT NASDAQ100インデックス', account:'tsumitate' }
]
const nextMonth = value => {
  const [year,month] = value.split('-').map(Number)
  return new Date(Date.UTC(year,month,1)).toISOString().slice(0,7)
}
const emptyPlan = () => ({fundCode:'',fundName:'',accountType:'tsumitate',monthlyAmount:0,orderDay:9,enabled:true,effectiveMonth:month.value})
const emptyHolding = () => ({fundCode:'',fundName:'',accountType:'tsumitate',units:0,acquisitionCost:0})
const emptyPrice = () => ({fundCode:'',navPer10000:0,priceDate:today()})
const plan = ref(emptyPlan())
const holding = ref(emptyHolding())
const price = ref(emptyPrice())
const editingTransfer = ref(null)
const newPurchaseMonth = ref('')
const yen = value => '¥' + Number(value || 0).toLocaleString('ja-JP')
const signYen = value => (Number(value) >= 0 ? '+' : '−') + yen(Math.abs(Number(value) || 0))
const accountLabel = code => code === 'growth' ? '成長投資枠' : code === 'combined' ? '成長＋つみたて（合算）' : 'つみたて投資枠'
const shortFundName = item => ({
  '0331418A': 'オール・カントリー',
  '03311187': '米国株式（S&P500）',
  '0331A172': '先進国債券（除く日本）',
  '04317188': 'NASDAQ100'
})[item.fund_code] || item.fund_name
const sourceLabel = source => source === 'official_mufg' ? '公式取得済' : source === 'manual' ? '手入力' : source === 'sbi_screenshot' ? '初期記録' : '価格未取得'
// Never claim that an unknown fund is manual-only without trying the
// official read-only provider lookup. A network failure remains "確認不可".
const navMode = code => {
  const fundCode=String(code||'').trim().toUpperCase()
  if (!/^[A-Z0-9]{8}$/.test(fundCode)) return 'invalid'
  if (autoNavSupported(fundCode)) return 'auto'
  if (Object.hasOwn(KNOWN_MANUAL_NAV_FUNDS,fundCode)) return 'manual'
  return navSupport.value[fundCode] || 'checking'
}
const navModeLabel = code => ({
  auto:'自動取得対象', manual:'手動入力',
  checking:'確認中…', unknown:'確認できません', invalid:'コード入力待ち'
})[navMode(code)]
const navModeHelp = code => ({
  auto:'公式APIに対応。定期更新Workerが稼働しているときは基準価額が更新されます。口数・取得金額は手入力です。',
  manual:'現在この銘柄に対応する公式APIが確認できません。基準価額は「詳細」から手入力してください。',
  checking:'公式APIに接続して取得可否を確認しています。',
  unknown:'公式APIの接続確認に失敗しました。時間をおいて再確認するか、基準価額を手入力してください。',
  invalid:'8文字の銘柄コードを入力すると、公式APIの対応状況を確認します。'
})[navMode(code)]
async function checkNavSupport(code,force=false) {
  const normalized=String(code||'').trim().toUpperCase()
  if(!/^[A-Z0-9]{8}$/.test(normalized) ||
     autoNavSupported(normalized) || Object.hasOwn(KNOWN_MANUAL_NAV_FUNDS,normalized))return
  if(!force && navSupport.value[normalized])return
  navSupport.value={...navSupport.value,[normalized]:'checking'}
  try{
    const result=await props.api('investment-portfolio/nav-eligibility?fundCode='+encodeURIComponent(normalized))
    const status=['auto','manual'].includes(result?.status)?result.status:'unknown'
    navSupport.value={...navSupport.value,[normalized]:status}
  }catch{
    navSupport.value={...navSupport.value,[normalized]:'unknown'}
  }
}
function toggleHoldingDetail(h) {
  const key=holdingKey(h)
  expandedHolding.value=expandedHolding.value===key?'':key
}
let checkTimer=null
watch(() => holding.value.fundCode,code=>{
  if(checkTimer!==null)clearTimeout(checkTimer)
  if(editing.value==='holding'&&/^[A-Z0-9]{8}$/.test(String(code||'').trim().toUpperCase()))
    checkTimer=setTimeout(()=>{void checkNavSupport(code)},450)
})

const holdingsData = computed(() => data.value?.holdings || [])
watch(holdingsData,holdings=>{
  for(const code of new Set(holdings.map(h=>h.fund_code)))
    void checkNavSupport(code)
})

const visibleHoldings = computed(() => showAllHoldings.value ? holdingsData.value : holdingsData.value.slice(0,2))
const totalAcquisition = computed(() => holdingsData.value.reduce((sum,h) => sum + Number(h.acquisition_cost || 0),0))
const returnRatio = computed(() => data.value?.valuation?.pnl == null || !totalAcquisition.value ? null : data.value.valuation.pnl / totalAcquisition.value * 100)
const allocationColors = ['var(--blue)', 'var(--teal)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']
const allocationRows = computed(() => {
  const total = data.value?.valuation?.value
  if (total == null || total <= 0 || !holdingsData.value.length) return []
  if (holdingsData.value.some(h => h.market_value == null || !Number.isFinite(Number(h.market_value)))) return []
  return holdingsData.value.map((h, index) => ({
    key: h.fund_code + ':' + h.account_type,
    ratio: Math.max(0, Number(h.market_value) / total * 100),
    color: allocationColors[index % allocationColors.length]
  }))
})
const bulkRows = ref([])
const bulkText = ref('')
const bulkWarning = ref('')
const bulkInfo = ref('')
const bulkBusy = ref(false)
const bulkAi = ref(false)
const dualProfit = ref(''), dualPositions = ref('')
const dualActive = ref(false), dualVerified = ref(false)
const dualInfo = ref('')
const bulkChanged = computed(() => bulkRows.value.filter(row =>
  Number.isSafeInteger(Number(row.units)) && Number.isSafeInteger(Number(row.acquisitionCost)) &&
  (Number(row.units)!==row.expectedUnits || Number(row.acquisitionCost)!==row.expectedAcquisitionCost)))
function openBulk() {
  if (!holdingsData.value.length) return
  error.value = ''
  bulkText.value = ''
  bulkWarning.value = ''
  bulkInfo.value = ''
  dualProfit.value = ''; dualPositions.value = ''; dualActive.value = false; dualVerified.value = false; dualInfo.value = ''
  bulkRows.value = holdingsData.value.map(h => ({
    fundCode:h.fund_code,accountType:h.account_type,fundName:h.fund_name,
    units:Number(h.units),acquisitionCost:Number(h.acquisition_cost),
    expectedUnits:Number(h.units),expectedAcquisitionCost:Number(h.acquisition_cost)
  }))
  editing.value = 'bulk'
}
function applyBulkText() {
  const {updates,warnings} = parseSbiHoldingsText(bulkText.value,holdingsData.value)
  bulkWarning.value = warnings.join(' / ')
  if(!updates.length) {
    bulkInfo.value = '一致する銘柄と口数・取得金額を読み取れませんでした。SBIの保有画面を確認してください。'
    return
  }
  const incoming = new Map(updates.map(h => [h.fundCode+':'+h.accountType,h]))
  bulkRows.value = bulkRows.value.map(row => {
    const update = incoming.get(row.fundCode+':'+row.accountType)
    return update ? {...row,units:update.units,acquisitionCost:update.acquisitionCost} : row
  })
  bulkInfo.value = updates.length + '件を読み取りました。数値を確認してから保存してください。'
}
function clearDual(){
  if(bulkBusy.value||saving.value)return
  dualProfit.value=''; dualPositions.value=''
  dualActive.value=false; dualVerified.value=false; dualInfo.value=''
  bulkRows.value=holdingsData.value.map(h=>({
    fundCode:h.fund_code,accountType:h.account_type,fundName:h.fund_name,
    units:Number(h.units),acquisitionCost:Number(h.acquisition_cost),
    expectedUnits:Number(h.units),expectedAcquisitionCost:Number(h.acquisition_cost)
  }))
  bulkWarning.value=''
}
async function readSbiScreen(event,kind){
  const file=event.target.files?.[0]
  event.target.value=''
  if(!file||bulkBusy.value||saving.value)return
  bulkBusy.value=true
  dualActive.value=true
  dualVerified.value=false
  dualInfo.value='SBI画面を確認中…'
  bulkWarning.value=''
  if(kind==='profit') dualProfit.value=''
  else dualPositions.value=''
  try{
    // The two native SBI screenshots need their own image-layout-aware prompts.
    // A generic on-device OCR can confuse the values across columns.
    const image = file.size<=4*1024*1024 && ['image/png','image/jpeg','image/webp'].includes(file.type)
      ? file : await compressReceiptImage(file,1600,1300*1024)
    const body=new FormData()
    body.append('image',image,image.type==='image/jpeg'?'sbi.jpg':'sbi.webp')
    body.append('mode',kind==='profit'?'portfolio-profit':'portfolio-positions')
    const result=await props.api('ai-ocr',{method:'POST',body})
    const text=String(result?.text||'').trim()
    if(!text)throw Error('文字を読み取れませんでした')
    if(kind==='profit') dualProfit.value=text
    else dualPositions.value=text
    if(!dualProfit.value||!dualPositions.value){
      dualInfo.value='1枚読み取りました。もう1枚の画面を選んでください。'
      return
    }
    const matched=reconcileSbiScreens(dualProfit.value,dualPositions.value,holdingsData.value)
    if(matched.error){
      dualInfo.value=''
      bulkWarning.value=matched.error+'。画像を確認して再試行してください。'
      return
    }
    const match=new Map(matched.updates.map(x=>[x.fundCode+':'+x.accountType,x]))
    bulkRows.value=bulkRows.value.map(row=>{
      const update=match.get(row.fundCode+':'+row.accountType)
      return update?{...row,units:update.units,acquisitionCost:update.acquisitionCost}:row
    })
    dualVerified.value=true
    dualInfo.value=matched.stamp+' · 評価額 '+yen(matched.totalValue)+' · 評価損益 '+signYen(matched.totalPnl)+' · 取得金額 '+yen(matched.totalCost)+'。確認して保存してください。'
  }catch(e){
    dualInfo.value=''
    bulkWarning.value='画像を読み取れませんでした：'+e.message
  }finally{bulkBusy.value=false}
}
async function readBulkImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || bulkBusy.value || saving.value) return
  bulkBusy.value = true
  bulkInfo.value = '画像を読み取り中…'
  bulkWarning.value = ''
  try {
    let recognized = ''
    if(bulkAi.value){
      try{
        const image = file.size <= 4*1024*1024 && ['image/png','image/jpeg','image/webp'].includes(file.type)
          ? file : await compressReceiptImage(file,1600,1300*1024)
        const data = new FormData()
        data.append('image',image,image.type==='image/jpeg'?'portfolio.jpg':'portfolio.webp')
        data.append('mode','portfolio')
        const response = await props.api('ai-ocr',{method:'POST',body:data})
        recognized = response.text || ''
      }catch(aiError){
        bulkWarning.value = 'AIを利用できませんでした。端末内OCRに切り替えました。'
      }
    }
    if (!recognized.trim()) recognized = await ocrImage(file)
    if (!recognized.trim()) throw Error('画像から文字を読み取れませんでした')
    bulkText.value = recognized
    applyBulkText()
    if (bulkWarning.value) bulkWarning.value = [...new Set(bulkWarning.value.split(' / '))].join(' / ')
  }catch(e){
    bulkInfo.value = '読み取りに失敗しました：'+e.message
  }finally{ bulkBusy.value=false }
}
async function saveBulk(){
  if (saving.value || bulkBusy.value || !bulkChanged.value.length) return
  if (dualActive.value && !dualVerified.value) { error.value='2枚の照合が完了していません。画面を選び直してください'; return }
  const changes = bulkChanged.value
  if (changes.some(h=>![h.units,h.acquisitionCost].every(v=>Number.isSafeInteger(Number(v)) && Number(v)>=0 && Number(v)<=1000000000000))) {
    error.value='保有口数と取得金額を確認してください'
    return
  }
  if(!confirm(changes.length+'件の保有口数・取得金額を更新します。SBIの最新情報と一致していますか？'))return
  saving.value=true
  error.value=''
  try {
    await props.api('investment-portfolio/holdings-bulk',{
      method:'PUT',body:JSON.stringify({holdings:changes.map(h=>({
        fundCode:h.fundCode,accountType:h.accountType,
        units:Number(h.units),acquisitionCost:Number(h.acquisitionCost),
        expectedUnits:h.expectedUnits,expectedAcquisitionCost:h.expectedAcquisitionCost
      }))})
    })
    await load()
    editing.value=''
    notice.value=changes.length+'件の保有情報を更新しました'
  }catch(e){
    error.value=e.message
    bulkInfo.value=e.message
  }finally{saving.value=false}
}
function closeEditor() { if(!saving.value && !bulkBusy.value){ editing.value = ''; editingTransfer.value = null } }
function onEditorKeydown(event) { if (event.key === 'Escape') closeEditor() }

const availableFunds = computed(() => {
  const items = new Map(knownFunds.map(item => [item.code,item]))
  for(const p of [...(data.value?.plans || []),...(data.value?.holdings || [])]){
    items.set(p.fund_code,{code:p.fund_code,name:p.fund_name,account:p.account_type})
  }
  return [...items.values()]
})
function fillFund(target) {
  const match = availableFunds.value.find(item=>item.code===target.fundCode)
  if(match){target.fundName=match.name; if(editing.value==='plan')target.accountType=match.account}
}
let loadSequence = 0
async function load() {
  const sequence = ++loadSequence
  const targetMonth = month.value
  loading.value = true
  error.value = ''
  // A different month must never briefly show a previous month's reconciliation.
  if (data.value?.month !== targetMonth) { data.value = null; emit('summary',null) }
  try {
    const response = await props.api('investment-portfolio?month=' + targetMonth)
    if (sequence !== loadSequence || targetMonth !== month.value) return
    data.value = response
    emit('summary',{month:response.month,valuation:response.valuation.value,pnl:response.valuation.pnl,reconciliation:response.reconciliation})
  } catch(e) {
    if (sequence !== loadSequence || targetMonth !== month.value) return
    error.value = e.message
    // Keep the current month's successfully loaded values visible if a refresh fails.
    if (data.value?.month !== targetMonth) { data.value = null; emit('summary',null) }
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}
function editPlan(p) {
  existingIdentity.value = !!p
  error.value = ''
  editing.value = 'plan'
  plan.value = p ? {
    fundCode:p.fund_code,fundName:p.fund_name,accountType:p.account_type,
    monthlyAmount:Number(p.monthly_amount),orderDay:Number(p.order_day),
    enabled:!!p.enabled,effectiveMonth:nextMonth(month.value)
  } : emptyPlan()
}
function editHolding(h) {
  existingIdentity.value = !!h
  error.value = ''
  editing.value = 'holding'
  holding.value = h ? {
    fundCode:h.fund_code,fundName:h.fund_name,accountType:h.account_type,
    units:Number(h.units),acquisitionCost:Number(h.acquisition_cost)
  } : emptyHolding()
}
function editPrice(h) {
  error.value = ''
  editing.value = 'price'
  price.value = {
    fundCode:h.fund_code,
    navPer10000:Number(h.nav_per_10000||0),
    priceDate:h.price_date||today()
  }
}
async function submit(path, body, message) {
  saving.value = true
  notice.value = ''
  try{
    await props.api('investment-portfolio/' + path,{method:'PUT',body:JSON.stringify(body)})
    editing.value=''
    editingTransfer.value=null
    await load()
    notice.value=message
  }catch(e){ error.value = e.message }
  finally{ saving.value=false }
}
async function submitTransfer() {
  await submit('transfer-month',{entryId:Number(editingTransfer.value),purchaseMonth:newPurchaseMonth.value},'買付月を更新しました')
}
// Refresh after existing due-transfer processing completes, so the asset
// reconciliation cannot be stale if it raced the automatic due-date update.
watch(() => props.transferLoading, (busy, previous) => { if (previous && !busy) void load() })
onMounted(() => { window.addEventListener('keydown',onEditorKeydown); void load() })
onUnmounted(() => { if(checkTimer!==null)clearTimeout(checkTimer); window.removeEventListener('keydown',onEditorKeydown) })
</script>

<template>
  <div class="sbi-portfolio">
    <div class="sbi-toolbar">
      <div class="sbi-provider"><span class="sbi-provider-dot" aria-hidden="true"></span><span>SBI証券</span></div>
      <div class="sbi-toolbar-actions">
        <label class="sbi-month-label"><span class="sr-only">積立・振替の対象月</span><input v-model="month" type="month" aria-label="積立・振替の対象月" @change="load" /></label>
        <button type="button" class="sbi-icon-button" @click="load" :disabled="loading" aria-label="残高・積立を更新" title="更新">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14 5l2-2"/><path d="M20 20v-4h-4"/></svg>
        </button>
      </div>
    </div>
    <p v-if="loading && !data" class="sbi-loading" role="status">残高・積立を読み込み中…</p>
    <p v-if="error" class="sbi-error" role="alert">{{error}}</p>
    <p v-if="error && /投資テーブルの移行が未実施/.test(error)" class="sbi-hint">投資データを確認してください。既存の家計簿は変更されません。</p>
    <p v-if="notice" class="sbi-success" role="status">{{notice}}</p>

    <template v-if="data">

      <details class="panel sbi-card sbi-holdings" open>
        <summary class="sbi-disclosure-summary"><strong>投資信託の保有</strong><small>{{holdingsData.length}}件</small><span class="sbi-chevron" aria-hidden="true">⌄</span></summary>
        <div class="sbi-section-body">
        <div class="sbi-inline-action sbi-holding-toolbar"><button v-if="holdingsData.length" type="button" class="sbi-bulk-primary" @click="openBulk"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 18h7M17.5 14.5v7"/></svg><span>保有を一括更新</span></button><button type="button" class="sbi-text-action sbi-add-holding" @click="editHolding(null)">＋ 追加</button></div>
        <p v-if="!holdingsData.length" class="sbi-empty">保有銘柄はまだありません</p>
        <article v-for="(h,index) in visibleHoldings" :key="h.fund_code+':'+h.account_type" class="sbi-holding-row">
          <div class="sbi-holding-top">
            <span class="sbi-fund-dot" :style="{background:allocationColors[index % allocationColors.length]}" aria-hidden="true"></span>
            <div class="sbi-holding-name">
              <strong :title="h.fund_name">{{shortFundName(h)}}</strong>
              <small>{{accountLabel(h.account_type)}} · {{h.fund_code}}</small>
            </div>
            <div class="sbi-holding-value">
              <strong>{{h.market_value === null ? '—' : yen(h.market_value)}}</strong>
              <small v-if="h.pnl !== null" :class="h.pnl >= 0 ? 'sbi-positive' : 'sbi-negative'">{{signYen(h.pnl)}}</small>
            </div>
          </div>
          <div class="sbi-holding-footer">
            <span class="sbi-nav-status" :class="'sbi-nav-'+navMode(h.fund_code)">{{navModeLabel(h.fund_code)}}</span>
            <div class="sbi-holding-commands">
              <button type="button" class="sbi-holding-action" :aria-label="shortFundName(h)+'の保有を編集'" @click="editHolding(h)">編集</button>
              <button type="button" class="sbi-holding-action" :aria-expanded="expandedHolding===holdingKey(h)" :aria-label="shortFundName(h)+'の詳細を表示'" @click="toggleHoldingDetail(h)">詳細 <span class="sbi-detail-chevron" aria-hidden="true">{{expandedHolding===holdingKey(h)?'⌃':'⌄'}}</span></button>
            </div>
          </div>
          <div v-if="expandedHolding===holdingKey(h)" class="sbi-holding-expanded">
            <span>{{Number(h.units).toLocaleString('ja-JP')}}口 · 取得 {{yen(h.acquisition_cost)}}</span>
            <span>基準価額 {{h.nav_per_10000 ? yen(h.nav_per_10000) : '未設定'}} · {{sourceLabel(h.source)}}</span>
            <span v-if="h.price_date">{{h.source==='sbi_screenshot'?'確認日':'基準日'}} {{h.price_date}}</span>
            <button type="button" class="sbi-row-edit" @click="editPrice(h)">基準価額を変更</button>
          </div>
        </article>
        <button v-if="holdingsData.length>2" type="button" class="sbi-show-more" :aria-expanded="showAllHoldings" @click="showAllHoldings=!showAllHoldings">{{showAllHoldings?'閉じる':'あと'+(holdingsData.length-2)+'件を表示'}}</button>
        <details class="sbi-valuation-details"><summary>評価額・損益の内訳</summary>
      <section class="sbi-hero" aria-label="投資信託の評価内訳" :aria-busy="loading">
        <div class="sbi-hero-head"><span>投資信託の評価額</span><small>{{holdingsData.length}}銘柄</small></div>
        <div class="sbi-hero-value">{{data.valuation.value === null ? '—' : yen(data.valuation.value)}}</div>
        <div v-if="data.valuation.pnl !== null" class="sbi-hero-gain" :class="data.valuation.pnl >= 0 ? 'sbi-gain-plus' : 'sbi-gain-minus'">
          <span>評価損益</span><strong>{{signYen(data.valuation.pnl)}}</strong>
          <span v-if="returnRatio !== null" class="sbi-rate">{{returnRatio >= 0 ? '+' : ''}}{{returnRatio.toFixed(2)}}%</span>
        </div>
        <div v-else class="sbi-hero-gain"><span>評価額を計算できない銘柄があります</span></div>
        <div v-if="allocationRows.length" class="sbi-allocation" aria-label="投資信託の評価額比率">
          <span v-for="row in allocationRows" :key="row.key" :style="{width:row.ratio+'%',background:row.color}" :title="row.ratio.toFixed(1)+'%'" />
        </div>
        <div class="sbi-hero-foot"><span>取得金額 <strong>{{yen(totalAcquisition)}}</strong></span><span>基準日は銘柄ごとに表示</span></div>
      </section>
        </details>
        </div>
      </details>
    </template>

    <slot name="before-holdings" />

    <template v-if="data">
      <details class="panel sbi-card sbi-investment-manage">
        <summary class="sbi-disclosure-summary">
          <span class="sbi-manage-title"><strong>毎月の積立</strong><small>{{yen(data.reconciliation.monthly_amount)}} / 月 · {{data.plans.filter(p=>p.enabled).length}}銘柄</small></span>
          <span class="sbi-manage-link">設定</span>
          <span class="sbi-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="sbi-section-body sbi-management-body">
          <div class="sbi-month-pulse">
            <div><span>積立予定</span><strong>{{yen(data.reconciliation.monthly_amount)}}</strong></div>
            <div><span>振替記帳</span><strong>{{yen(data.reconciliation.funded)}}</strong></div>
          </div>
          <div class="sbi-progress" role="progressbar" aria-label="積立予定に対する振替記帳額" :aria-valuemax="Math.max(1,data.reconciliation.monthly_amount)" :aria-valuenow="Math.max(0,Math.min(data.reconciliation.monthly_amount,data.reconciliation.funded))">
            <span :style="{width:Math.min(100,100*data.reconciliation.funded/Math.max(1,data.reconciliation.monthly_amount))+'%'}"></span>
          </div>
          <div class="sbi-reconcile-state">
            <span v-if="data.reconciliation.difference === 0 && data.reconciliation.funded > 0" class="sbi-positive">予定額と一致</span>
            <span v-else-if="data.reconciliation.difference < 0 && data.reconciliation.funded > 0" class="sbi-hint">差額 {{yen(Math.abs(data.reconciliation.difference))}}</span>
            <span v-else-if="data.reconciliation.difference > 0" class="sbi-hint">超過 {{yen(data.reconciliation.difference)}}</span>
            <span v-if="data.reconciliation.pending">反映待ち {{yen(data.reconciliation.pending)}}</span>
          </div>
          <div class="sbi-manage-subhead">
            <strong>積立設定</strong>
            <button type="button" class="sbi-text-action" @click="editPlan(null)">＋ 追加</button>
          </div>
          <p v-if="!data.plans.length" class="sbi-empty">積立設定はまだありません</p>
          <div v-for="p in (showAllPlans ? data.plans : data.plans.slice(0,2))" :key="p.fund_code+':'+p.account_type" class="sbi-plan-row">
            <div class="sbi-row-main"><strong>{{shortFundName(p)}}</strong><small>{{accountLabel(p.account_type)}} · 毎月{{p.order_day}}日</small></div>
            <div class="sbi-row-end"><strong>{{p.enabled ? yen(p.monthly_amount) : '停止中'}}</strong><button type="button" class="sbi-row-edit" @click="editPlan(p)" :aria-label="shortFundName(p)+'の積立設定を変更'">変更</button></div>
          </div>
          <button v-if="data.plans.length>2" type="button" class="sbi-show-more" :aria-expanded="showAllPlans" @click="showAllPlans=!showAllPlans">{{showAllPlans?'閉じる':'あと'+(data.plans.length-2)+'件を表示'}}</button>

          <details class="sbi-transfer-disclosure">
            <summary class="sbi-transfer-summary">
              <strong>振替記録・買付月</strong>
              <small>{{data.transfers.length}}件</small>
              <span class="sbi-detail-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div class="sbi-transfer-content">
              <p v-if="!data.transfers.length" class="sbi-empty">この月の振替記録はありません</p>
              <div v-for="t in (showAllTransfers ? data.transfers : data.transfers.slice(0,2))" :key="t.id" class="sbi-transfer-row">
                <div class="sbi-row-main"><strong>{{yen(t.amount)}}</strong><small>{{t.transfer_date || t.date}} · {{Number(t.transfer_applied) === 1 ? '記帳済' : '反映待ち'}}</small></div>
                <div class="sbi-row-end"><small>{{t.effective_month}} {{t.inferred ? '（推定）' : ''}}</small><button type="button" class="sbi-row-edit" @click="editingTransfer=t.id;newPurchaseMonth=t.effective_month">買付月を変更</button></div>
              </div>
              <button v-if="data.transfers.length>2" type="button" class="sbi-show-more" :aria-expanded="showAllTransfers" @click="showAllTransfers=!showAllTransfers">{{showAllTransfers?'閉じる':'あと'+(data.transfers.length-2)+'件を表示'}}</button>
              <details class="sbi-footnote"><summary>振替の確認について</summary><p>振替の記帳反映は証券口座での着金・買付完了を意味しません。買付月が異なる場合は変更できます。</p></details>
            </div>
          </details>
        </div>
      </details>
    </template>
    <div v-if="editing || editingTransfer!==null" class="sbi-overlay" @click.self="closeEditor">
      <form v-if="editing==='plan'" class="sbi-dialog" role="dialog" aria-modal="true" aria-label="積立設定の編集" @submit.prevent="submit('plan',{...plan,monthlyAmount:Number(plan.monthlyAmount),orderDay:Number(plan.orderDay)},'積立設定を保存しました')">
        <div class="sbi-line-heading"><h3>積立設定</h3><button type="button" class="sbi-close" @click="editing=''">×</button></div>
        <label>銘柄コード<input v-model.trim="plan.fundCode" maxlength="8" required :disabled="existingIdentity" placeholder="03311187" @input="plan.fundCode=plan.fundCode.toUpperCase();fillFund(plan)"/></label>
        <label>銘柄名<input v-model.trim="plan.fundName" maxlength="120" required /></label>
        <label>口座区分<select v-model="plan.accountType" :disabled="existingIdentity"><option value="tsumitate">NISA（つみたて）</option><option value="growth">NISA（成長）</option></select></label>
        <label>毎月の積立額（円）<input v-model.number="plan.monthlyAmount" type="number" min="0" step="1" required /></label>
        <label>注文希望日<input v-model.number="plan.orderDay" type="number" min="1" max="28" required /></label>
        <label>適用開始月<input v-model="plan.effectiveMonth" type="month" required /></label><p class="sbi-hint">変更は指定した月以降に適用され、以前の月は変更されません。</p>
        <label class="sbi-checkbox"><input v-model="plan.enabled" type="checkbox"/>積立中</label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editing=''">キャンセル</button><button class="button-primary" type="submit" :disabled="saving">保存</button></div>
      </form>
      <form v-else-if="editing==='bulk'" class="sbi-dialog sbi-bulk-dialog" role="dialog" aria-modal="true" aria-label="保有を一括更新" @submit.prevent="saveBulk">
        <div class="sbi-line-heading"><h3>保有を一括更新</h3><button type="button" class="sbi-close" :disabled="saving || bulkBusy" @click="closeEditor">×</button></div>
        <div class="sbi-bulk-reader">
          <div class="sbi-dual-panel">
            <div class="sbi-bulk-heading"><strong>SBIの2画面から更新</strong><button type="button" class="sbi-dual-reset" :disabled="saving || bulkBusy" @click="clearDual">クリア</button></div>
            <div class="sbi-dual-choices">
              <label class="sbi-bulk-upload" :aria-disabled="saving || bulkBusy">
                <span>① 評価損益・取得単価</span>
                <small>{{dualProfit ? '読み取り済み ✓' : '画像を選択'}}</small>
                <input type="file" accept="image/*" hidden :disabled="saving || bulkBusy" @change="readSbiScreen($event,'profit')" />
              </label>
              <label class="sbi-bulk-upload" :aria-disabled="saving || bulkBusy">
                <span>② 保有数量・評価額</span>
                <small>{{dualPositions ? '読み取り済み ✓' : '画像を選択'}}</small>
                <input type="file" accept="image/*" hidden :disabled="saving || bulkBusy" @change="readSbiScreen($event,'positions')" />
              </label>
            </div>
            <small class="sbi-dual-help">同じ更新日時の2画面を選択。AI画像認識を各1回使用します。</small>
            <p v-if="dualInfo" role="status" class="sbi-bulk-notice">{{dualInfo}}</p>
          </div>
          <details class="sbi-single-import">
            <summary>その他の取り込み方法</summary>
          <label>保有画面のテキストを貼り付け
            <textarea v-model="bulkText" rows="3" :disabled="saving || bulkBusy" placeholder="銘柄名 / 保有口数 / 取得金額"></textarea>
          </label>
          <div class="sbi-bulk-tools">
            <button type="button" class="button-secondary" :disabled="saving || bulkBusy || !bulkText.trim()" @click="applyBulkText">テキストを読み取る</button>
            <label class="sbi-bulk-upload" :aria-disabled="saving || bulkBusy">
              画像を読み取る
              <input type="file" accept="image/*" hidden :disabled="saving || bulkBusy" @change="readBulkImage" />
            </label>
          </div>
          <label class="sbi-bulk-ai"><input v-model="bulkAi" type="checkbox" :disabled="saving || bulkBusy" /><span>画像はAIで読み取る（オフなら端末内OCR）</span></label>
          </details>
          <p v-if="bulkInfo" class="sbi-bulk-notice" role="status">{{bulkInfo}}</p>
          <p v-if="bulkWarning" class="sbi-bulk-warning" role="alert">{{bulkWarning}}</p>
        </div>
        <div class="sbi-bulk-heading"><strong>更新内容を確認</strong><span>{{bulkChanged.length}}件変更</span></div>
        <div class="sbi-bulk-rows">
          <div v-for="row in bulkRows" :key="row.fundCode+':'+row.accountType" class="sbi-bulk-row">
            <div class="sbi-bulk-row-name"><strong>{{shortFundName({fund_code:row.fundCode,fund_name:row.fundName})}}</strong><small>{{accountLabel(row.accountType)}} · {{row.fundCode}}</small></div>
            <div class="sbi-bulk-fields">
              <label>保有口数<input v-model.number="row.units" type="number" min="0" step="1" required :disabled="saving || bulkBusy" /></label>
              <label>取得金額（円）<input v-model.number="row.acquisitionCost" type="number" min="0" step="1" required :disabled="saving || bulkBusy" /></label>
            </div>
            <small v-if="Number(row.units)!==row.expectedUnits || Number(row.acquisitionCost)!==row.expectedAcquisitionCost" class="sbi-bulk-diff">変更前：{{row.expectedUnits.toLocaleString('ja-JP')}}口 · {{yen(row.expectedAcquisitionCost)}}</small>
          </div>
        </div>
        <div class="sbi-actions"><button type="button" class="button-secondary" :disabled="saving || bulkBusy" @click="closeEditor">キャンセル</button><button class="button-primary" type="submit" :disabled="saving || bulkBusy || !bulkChanged.length || (dualActive && !dualVerified)">{{saving ? '保存中…' : '更新 '+bulkChanged.length+'件'}}</button></div>
      </form>
      <form v-else-if="editing==='holding'" class="sbi-dialog" role="dialog" aria-modal="true" aria-label="保有情報の編集" @submit.prevent="submit('holding',{...holding,units:Number(holding.units),acquisitionCost:Number(holding.acquisitionCost)},'保有情報を更新しました')">
        <div class="sbi-line-heading"><h3>保有口数・取得金額</h3><button type="button" class="sbi-close" @click="editing=''">×</button></div>
        <label>銘柄コード<input v-model.trim="holding.fundCode" maxlength="8" required :disabled="existingIdentity" @input="holding.fundCode=holding.fundCode.toUpperCase();fillFund(holding)" /></label>
        <div class="sbi-nav-guidance" role="status">
          <span class="sbi-nav-status" :class="'sbi-nav-'+navMode(holding.fundCode)">{{navModeLabel(holding.fundCode)}}</span>
          <span>{{navModeHelp(holding.fundCode)}}</span>
          <button v-if="navMode(holding.fundCode)==='unknown'" type="button" class="sbi-nav-retry" @click="checkNavSupport(holding.fundCode,true)">再確認</button>
        </div>
        <label>銘柄名<input v-model.trim="holding.fundName" maxlength="120" required /></label>
        <label>口座区分<select v-model="holding.accountType" :disabled="existingIdentity"><option value="tsumitate">NISA（つみたて）</option><option value="growth">NISA（成長）</option><option value="combined">NISA（成長＋つみたて 合算）</option></select></label>
        <label>保有口数<input v-model.number="holding.units" type="number" min="0" step="1" required /></label>
        <label>取得金額（円）<input v-model.number="holding.acquisitionCost" type="number" min="0" step="1" required /></label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editing=''">キャンセル</button><button class="button-primary" type="submit" :disabled="saving">保存</button></div>
      </form>
      <form v-else-if="editing==='price'" class="sbi-dialog" role="dialog" aria-modal="true" aria-label="基準価額の編集" @submit.prevent="submit('price',{...price,navPer10000:Number(price.navPer10000)},'基準価額を更新しました')">
        <div class="sbi-line-heading"><h3>基準価額</h3><button type="button" class="sbi-close" @click="editing=''">×</button></div>
        <p>銘柄コード：{{price.fundCode}}</p>
        <label>基準価額（1万口当たり円）<input v-model.number="price.navPer10000" type="number" min="1" step="1" required /></label>
        <label>基準日<input v-model="price.priceDate" type="date" required /></label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editing=''">キャンセル</button><button class="button-primary" type="submit" :disabled="saving">保存</button></div>
      </form>
      <form v-else-if="editingTransfer!==null" class="sbi-dialog" role="dialog" aria-modal="true" aria-label="買付月の編集" @submit.prevent="submitTransfer">
        <div class="sbi-line-heading"><h3>振替の買付月</h3><button class="sbi-close" type="button" @click="editingTransfer=null">×</button></div>
        <label>対象月<input v-model="newPurchaseMonth" type="month" required /></label>
        <div class="sbi-actions"><button type="button" class="button-secondary" @click="editingTransfer=null">キャンセル</button><button type="submit" class="button-primary" :disabled="saving">保存</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.sbi-portfolio{display:grid;gap:12px;min-width:0}
.sbi-toolbar,.sbi-toolbar-actions,.sbi-provider,.sbi-line-heading,.sbi-holding-top,.sbi-holding-bottom,.sbi-holding-actions,.sbi-plan-total,.sbi-plan-row,.sbi-transfer-row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.sbi-toolbar{min-height:43px;min-width:0}
.sbi-provider{justify-content:flex-start;font-size:12px;font-weight:800;color:var(--muted)}
.sbi-provider-dot,.sbi-fund-dot{width:9px;height:9px;border-radius:50%;background:var(--blue);flex:none}
.sbi-toolbar-actions{gap:7px}
.sbi-period-filter{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 2px 0}
.sbi-period-filter>span{font-size:11px;color:var(--muted);font-weight:750}
.sbi-month-label input{max-width:146px;min-height:42px;padding:8px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);font-size:13px;font-weight:750}
.sbi-icon-button{display:grid;place-items:center;width:44px;height:44px;padding:0;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--blue-dark)}
.sbi-icon-button svg{width:19px;height:19px}.sbi-icon-button:disabled{opacity:.45}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.sbi-hero{padding:19px 18px 15px;border:1px solid color-mix(in srgb,var(--blue) 20%,var(--line));border-radius:22px;background:linear-gradient(145deg,color-mix(in srgb,var(--blue) 13%,var(--card)),var(--card) 67%);min-width:0}
.sbi-hero-head,.sbi-hero-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:12px;color:var(--muted)}
.sbi-hero-head{font-weight:750}.sbi-hero-head small{font-size:11px}
.sbi-hero-value{font-size:clamp(30px,8vw,40px);letter-spacing:-.045em;font-weight:850;font-variant-numeric:tabular-nums;line-height:1.3;margin:7px 0 9px;overflow-wrap:anywhere}
.sbi-hero-gain{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
.sbi-hero-gain strong{font-size:17px;font-variant-numeric:tabular-nums}.sbi-rate{font-weight:750;font-size:12px}
.sbi-gain-plus strong,.sbi-gain-plus .sbi-rate,.sbi-positive{color:#16816b!important}
.sbi-gain-minus strong,.sbi-gain-minus .sbi-rate,.sbi-negative{color:#c44d69!important}
.sbi-allocation{display:flex;width:100%;height:7px;border-radius:99px;overflow:hidden;gap:2px;margin-top:14px;background:var(--line)}
.sbi-allocation span{height:100%;min-width:0}
.sbi-hero-foot{padding-top:13px;margin-top:13px;border-top:1px solid color-mix(in srgb,var(--blue) 13%,var(--line));font-size:11px}
.sbi-hero-foot strong{color:var(--ink);font-size:12px}
.sbi-card{padding:14px 15px;border-radius:18px;min-width:0}
.sbi-line-heading{margin-bottom:10px}.sbi-line-heading h3{font-size:15px;margin:0;font-weight:800}
.sbi-text-action,.sbi-row-edit{border:0;border-radius:10px;background:color-mix(in srgb,var(--blue) 9%,var(--card));color:var(--blue-dark);font-size:12px;font-weight:750;min-height:39px;padding:8px 12px;white-space:nowrap}
.sbi-holding-row,.sbi-plan-row,.sbi-transfer-row{border-top:1px solid var(--line);padding:13px 0;min-width:0}
.sbi-holding-top{align-items:flex-start;justify-content:flex-start;gap:9px}
.sbi-fund-dot{margin-top:6px;width:10px;height:10px}
.sbi-holding-name,.sbi-row-main{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;flex:1}
.sbi-holding-name strong,.sbi-row-main strong{font-size:13px;line-height:1.45;overflow-wrap:anywhere}
.sbi-holding-name small,.sbi-row-main small,.sbi-row-end small{font-size:10px;color:var(--muted);overflow-wrap:anywhere}
.sbi-holding-value{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:none;text-align:right}
.sbi-holding-value strong{font-size:16px;font-weight:850;font-variant-numeric:tabular-nums}
.sbi-holding-value small{font-size:12px;font-weight:750;font-variant-numeric:tabular-nums}
.sbi-holding-bottom{align-items:flex-end;flex-wrap:wrap;margin:9px 0 0 19px}
.sbi-fund-meta{display:flex;align-items:center;gap:4px 9px;flex-wrap:wrap;min-width:0;flex:1;font-size:10px;color:var(--muted)}
.sbi-holding-actions{justify-content:flex-end;flex-wrap:wrap;gap:4px 7px;font-size:10px;color:var(--muted)}
.sbi-nav-source{border-radius:99px;padding:3px 7px;background:var(--paper);font-size:10px;white-space:nowrap}
.sbi-source-auto{background:color-mix(in srgb,var(--teal) 15%,var(--card));color:#16816b}
.sbi-holding-actions small{font-size:10px}
.sbi-action-menu{position:relative}
.sbi-action-menu summary{list-style:none;display:flex;align-items:center;justify-content:center;min-height:40px;min-width:53px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;font-size:12px;font-weight:750;color:var(--blue-dark);cursor:pointer;background:var(--card)}
.sbi-action-menu summary::-webkit-details-marker{display:none}
.sbi-action-list{position:absolute;z-index:5;right:0;top:calc(100% + 5px);min-width:152px;padding:5px;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 9px 24px #00000018;display:grid;gap:3px}
.sbi-action-list button{min-height:43px;text-align:left;border:0;border-radius:8px;background:transparent;padding:9px;color:var(--ink);font-size:12px;white-space:nowrap}
.sbi-action-list button:active{background:var(--paper)}
.sbi-plan-total{align-items:flex-end;padding:6px 0 13px}
.sbi-plan-total>div:first-child{display:grid;gap:1px}.sbi-plan-total span{font-size:11px;color:var(--muted)}
.sbi-plan-total strong{font-size:24px;font-variant-numeric:tabular-nums}.sbi-plan-total strong small{font-size:11px;font-weight:600;color:var(--muted)}
.sbi-plan-day{font-size:11px;color:var(--muted)}
.sbi-row-end{display:flex;flex-direction:column;align-items:flex-end;gap:4px;text-align:right;min-width:85px}
.sbi-row-end strong{font-size:14px;font-weight:850;font-variant-numeric:tabular-nums}
.sbi-row-edit{background:transparent;min-height:39px;padding:7px 3px}
.sbi-count{color:var(--muted);font-size:11px}
.sbi-funding-stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:11px 0 12px}
.sbi-funding-stats>div{display:grid;gap:4px}.sbi-funding-stats>div span{font-size:11px;color:var(--muted)}
.sbi-funding-stats strong{font-size:19px;font-variant-numeric:tabular-nums}
.sbi-progress{height:8px;background:var(--line);border-radius:99px;overflow:hidden}
.sbi-progress>span{height:100%;display:block;background:var(--blue);border-radius:inherit}
.sbi-reconcile-state{display:flex;justify-content:space-between;gap:7px;flex-wrap:wrap;margin-top:9px;font-size:11px;color:var(--muted)}
.sbi-hint,.sbi-empty,.sbi-loading{font-size:12px;color:var(--muted)}.sbi-empty{text-align:center;padding:15px 6px;margin:0}
.sbi-error,.sbi-success{padding:10px 12px;border-radius:10px;font-size:12px;margin:0}
.sbi-error{background:#fff0f1;color:#9b2938}.sbi-success{background:#e8f7ee;color:#287957}
.sbi-overlay{position:fixed;z-index:60;inset:0;background:#23273588;display:flex;align-items:flex-end;justify-content:center;padding:0}
.sbi-dialog{box-sizing:border-box;display:grid;gap:12px;width:100%;max-width:520px;max-height:calc(92dvh - env(safe-area-inset-bottom, 0px));overflow:auto;overscroll-behavior:contain;padding:18px 18px calc(18px + env(safe-area-inset-bottom, 0px));border-radius:22px 22px 0 0;background:var(--card);color:var(--ink);box-shadow:0 -12px 35px #00000018}
.sbi-dialog label{display:grid;gap:5px;font-size:12px;font-weight:700}
.sbi-dialog label input,.sbi-dialog label select{box-sizing:border-box;width:100%;min-height:44px;background:var(--card);border:1px solid var(--line);border-radius:11px;padding:10px;font-size:16px;color:var(--ink)}
.sbi-dialog .sbi-checkbox{display:flex;align-items:center;gap:10px}.sbi-dialog .sbi-checkbox input{width:auto;min-height:auto}
.sbi-dialog .sbi-line-heading h3{font-size:17px}
.sbi-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sbi-actions button{min-height:46px}
.sbi-close{border:0;background:transparent;color:var(--muted);font-size:26px;min-width:44px;min-height:44px}
.sbi-portfolio button:focus-visible,.sbi-action-menu summary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
@media (min-width:720px){.sbi-overlay{align-items:center;padding:16px}.sbi-dialog{border-radius:20px;max-height:88dvh;padding:22px}.sbi-card{padding:20px}.sbi-hero{padding:22px 24px}}
@media (max-width:370px){.sbi-holding-bottom{margin-left:0}.sbi-holding-actions{width:100%;justify-content:flex-start}.sbi-holding-value strong{font-size:14px}.sbi-plan-day{display:none}.sbi-hero-value{font-size:30px}}

/* The summary area lives on AssetsPage. Keep detail panels short until opened. */
.sbi-portfolio{gap:10px}
.sbi-toolbar{min-height:39px;padding:1px 2px}
.sbi-toolbar-actions{min-width:0}.sbi-month-label{display:block;min-width:0}.sbi-month-label input{width:133px;max-width:100%;min-height:40px}
.sbi-card:has(> .sbi-disclosure-summary){padding:0}
.sbi-disclosure-summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;min-height:56px;padding:12px 14px}
.sbi-disclosure-summary::-webkit-details-marker{display:none}
.sbi-disclosure-summary strong{font-size:15px;flex:1}
.sbi-disclosure-summary small{font-size:11px;color:var(--muted)}
.sbi-chevron{font-size:20px;line-height:1;color:var(--muted);transition:transform .18s}
.sbi-card[open] > .sbi-disclosure-summary .sbi-chevron{transform:rotate(180deg)}
.sbi-disclosure-summary:focus-visible,.sbi-show-more:focus-visible,.sbi-holding-action:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.sbi-section-body{padding:0 14px 12px}.sbi-inline-action{display:flex;justify-content:flex-end;padding:0 0 5px}.sbi-inline-action .sbi-text-action{background:var(--paper);min-height:38px;border-radius:10px}
.sbi-inline-action .sbi-text-action{padding:4px 10px;min-height:44px}
.sbi-holding-row,.sbi-plan-row,.sbi-transfer-row{padding:9px 0}
.sbi-holding-top{gap:7px}
.sbi-holding-value strong{font-size:15px}
/* One stable two-row grid per holding. The expanded details live OUTSIDE
   the actions container and can never push 編集 / 詳細 out of alignment. */
.sbi-holding-row{display:grid;gap:5px;min-height:0;margin:0;padding:11px 0 10px;border-top:1px solid var(--line)}
.sbi-holding-top{display:grid;grid-template-columns:10px minmax(0,1fr) minmax(82px,max-content);align-items:start;gap:9px;min-height:0}
.sbi-fund-dot{margin-top:5px}
.sbi-holding-name{min-width:0;gap:3px}
.sbi-holding-name strong{font-size:13px;line-height:1.35}
.sbi-holding-name small{font-size:10px;line-height:1.35}
.sbi-holding-value{min-width:82px;align-items:flex-end;gap:2px}
.sbi-holding-footer{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;margin:0 0 0 19px;min-height:42px;min-width:0}
.sbi-nav-status{display:inline-flex;align-items:center;justify-self:start;border-radius:8px;font-size:10px;font-weight:750;padding:5px 7px;line-height:1.3;white-space:nowrap}
.sbi-nav-auto{color:#16816b;background:color-mix(in srgb,var(--teal) 13%,var(--card))}
.sbi-nav-manual{color:var(--muted);background:var(--paper)}
.sbi-nav-checking,.sbi-nav-unknown,.sbi-nav-invalid{color:var(--muted);background:var(--paper)}
.sbi-holding-commands{display:flex;justify-content:flex-end;align-items:center;gap:6px;min-width:0}
.sbi-holding-commands .sbi-holding-action{display:inline-flex;justify-content:center;align-items:center;gap:5px;min-height:42px;min-width:54px;padding:7px 9px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--blue-dark);font-size:12px;line-height:1.2;font-weight:750;white-space:nowrap}
.sbi-detail-chevron{color:var(--muted);font-size:13px;line-height:1}
.sbi-holding-expanded{display:grid;gap:6px;min-width:0;margin:2px 0 2px 19px;padding:11px;border-radius:11px;background:var(--paper);color:var(--muted);font-size:11px;line-height:1.5}
.sbi-holding-expanded .sbi-row-edit{justify-self:start;min-height:40px;padding:8px 9px;color:var(--blue-dark)}
.sbi-nav-guidance{display:flex;align-items:flex-start;gap:9px;padding:10px;background:var(--paper);border-radius:11px;font-size:11px;line-height:1.5;color:var(--muted)}
.sbi-nav-guidance span:nth-child(2){flex:1;min-width:0}
.sbi-nav-retry{flex:none;align-self:center;padding:7px 8px;min-height:40px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--blue-dark);font-size:11px;font-weight:750}
.sbi-show-more{display:block;margin:2px auto 4px;min-height:44px;padding:7px;border:0;background:transparent;color:var(--blue-dark);font-size:12px;font-weight:750}
.sbi-valuation-details,.sbi-footnote{border-top:1px solid var(--line);margin-top:3px}
.sbi-valuation-details>summary,.sbi-footnote>summary{cursor:pointer;padding:12px 0;min-height:40px;font-size:11px;color:var(--muted);font-weight:750}
.sbi-valuation-details .sbi-hero{margin-bottom:9px;padding:12px;border-radius:14px}
.sbi-valuation-details .sbi-hero-value{font-size:24px}.sbi-valuation-details .sbi-hero-foot{margin-top:7px;padding-top:8px}
.sbi-footnote p{font-size:11px;color:var(--muted);line-height:1.6;margin:0 0 6px}
.sbi-plan-total{padding:3px 0 9px}.sbi-plan-total strong{font-size:18px}
.sbi-funding-stats{margin:4px 0 9px}.sbi-funding-stats strong{font-size:16px}.sbi-progress{height:5px}
@media(max-width:370px){.sbi-month-label input{width:120px;padding:7px 5px;font-size:12px}.sbi-toolbar-actions{gap:4px}.sbi-disclosure-summary{padding:11px 12px}.sbi-section-body{padding:0 12px 10px}}
@media(prefers-reduced-motion:reduce){.sbi-chevron{transition:none}}

.sbi-holding-toolbar{gap:7px;flex-wrap:wrap}
.sbi-bulk-dialog{gap:13px}
.sbi-bulk-reader{display:grid;gap:8px}
.sbi-bulk-reader textarea{box-sizing:border-box;width:100%;min-height:74px;resize:vertical;padding:10px;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--ink);font-size:13px}
.sbi-bulk-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sbi-bulk-tools button,.sbi-bulk-upload{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-height:44px;width:100%;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--blue-dark);font-size:12px;font-weight:750;cursor:pointer}
.sbi-bulk-upload[aria-disabled="true"]{opacity:.55;pointer-events:none}
.sbi-dialog .sbi-bulk-ai{display:flex;align-items:center;gap:8px;font-weight:500;font-size:11px;color:var(--muted)}
.sbi-dialog .sbi-bulk-ai input{width:16px;min-height:16px;height:16px;flex:none}
.sbi-bulk-notice,.sbi-bulk-warning{font-size:11px;line-height:1.5;margin:0;padding:8px 10px;border-radius:8px;background:var(--paper);color:var(--muted)}
.sbi-bulk-warning{color:#9b2938;background:#fff0f1}
.sbi-bulk-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px}
.sbi-bulk-heading span{font-size:11px;color:var(--muted)}
.sbi-bulk-rows{display:grid;gap:0}
.sbi-bulk-row{display:grid;gap:8px;padding:11px 0;border-top:1px solid var(--line)}
.sbi-bulk-row-name{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:5px;min-width:0}
.sbi-bulk-row-name strong{font-size:12px;overflow-wrap:anywhere}
.sbi-bulk-row-name small,.sbi-bulk-diff{font-size:10px;color:var(--muted)}
.sbi-bulk-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;min-width:0}
.sbi-bulk-fields label{min-width:0;font-size:11px}
.sbi-bulk-fields label input{min-width:0}
.sbi-bulk-diff{color:var(--blue-dark)}

.sbi-dual-panel{display:grid;gap:8px;padding:11px;border:1px solid var(--line);border-radius:13px;background:var(--paper)}
.sbi-dual-choices{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sbi-dual-panel .sbi-bulk-upload{flex-direction:column;gap:3px;text-align:center;background:var(--card);font-size:11px;padding:10px 5px;min-height:62px}
.sbi-dual-panel .sbi-bulk-upload small{color:var(--muted);font-size:10px;font-weight:500}
.sbi-dual-help{font-size:10px;color:var(--muted);line-height:1.5}
.sbi-dual-reset{border:0;background:none;color:var(--blue-dark);font-weight:700;min-height:36px;padding:4px;font-size:11px}
.sbi-single-import>summary{font-size:11px;color:var(--muted);font-weight:700;padding:8px 0;cursor:pointer}
.sbi-single-import[open]{display:grid;gap:8px}
.sbi-dual-panel .sbi-bulk-heading{font-size:12px}

/* Balance screen: make the monthly screenshot update the unmistakable primary action. */
.sbi-holding-toolbar{justify-content:space-between;gap:8px;padding:3px 0 9px}
.sbi-holding-toolbar .sbi-bulk-primary{display:flex;flex:1;align-items:center;justify-content:center;gap:7px;min-width:0;min-height:45px;padding:9px 12px;border:1px solid var(--blue);border-radius:12px;background:var(--blue);color:#fff;font-size:12px;font-weight:800;letter-spacing:-.015em;cursor:pointer}
.sbi-bulk-primary svg{width:18px;height:18px;flex:none}
.sbi-holding-toolbar .sbi-add-holding{flex:none;min-height:45px;padding:8px 12px;border-radius:12px;border:1px solid var(--line);background:var(--paper);font-size:12px}
.sbi-investment-manage .sbi-disclosure-summary{min-height:58px}
.sbi-manage-title{display:grid;gap:3px;flex:1;min-width:0}
.sbi-manage-title strong{font-size:14px}
.sbi-manage-title small{font-size:11px;font-weight:500;color:var(--muted)}
.sbi-manage-link{font-size:11px;font-weight:750;color:var(--blue-dark)}
.sbi-management-body{padding-top:4px}
.sbi-month-pulse{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:10px}
.sbi-month-pulse>div{display:grid;gap:3px;padding:12px;border-radius:12px;background:var(--paper);min-width:0}
.sbi-month-pulse span{font-size:10px;color:var(--muted)}
.sbi-month-pulse strong{font-size:clamp(15px,4.5vw,19px);font-weight:850;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.sbi-manage-subhead{display:flex;align-items:center;justify-content:space-between;gap:9px;margin-top:13px;padding-top:11px;border-top:1px solid var(--line)}
.sbi-manage-subhead>strong{font-size:12px}
.sbi-manage-subhead .sbi-text-action{min-height:40px;padding:6px 12px;border:1px solid var(--line);border-radius:9px;background:var(--paper);font-size:11px}
.sbi-transfer-disclosure{margin-top:9px;border-top:1px solid var(--line)}
.sbi-transfer-summary{display:flex;align-items:center;gap:8px;min-height:49px;padding:7px 0;list-style:none;cursor:pointer}
.sbi-transfer-summary::-webkit-details-marker{display:none}
.sbi-transfer-summary strong{font-size:12px;flex:1}
.sbi-transfer-summary small{font-size:11px;color:var(--muted)}
.sbi-transfer-summary .sbi-detail-chevron{transition:transform .18s}
.sbi-transfer-disclosure[open] .sbi-transfer-summary .sbi-detail-chevron{transform:rotate(180deg)}
.sbi-transfer-content{border-top:1px solid var(--line);padding-top:4px}
.sbi-transfer-summary:focus-visible,.sbi-bulk-primary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:3px}
@media(max-width:370px){.sbi-holding-toolbar .sbi-bulk-primary{padding:8px 6px;font-size:11px}.sbi-holding-toolbar .sbi-add-holding{padding:8px;font-size:11px}}
@media(prefers-reduced-motion:reduce){.sbi-transfer-summary .sbi-detail-chevron{transition:none}}
</style>
