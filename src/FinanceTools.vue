<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch } from 'vue'
import { notify, NOTIFICATION_DURATION } from './notifications.js'
import { sortOtherLast } from './category-sort.js'
import ReviewTrashActions from './ReviewTrashActions.vue'
import { findLedgerDuplicateGroups, duplicateReviewSignature } from './duplicate-review.js'
import { duplicateTrashKey, recurringTrashKey, transferTrashKey, visibleReviewedTrash } from './review-trash.js'
import AmountInput from './AmountInput.vue'
import SbiPortfolio from './SbiPortfolio.vue'
import InvestmentTransferReview from './InvestmentTransferReview.vue'
import { validateBackup, transactionKey, nextScheduledDate, prepareRestoreRows, restoreMissingByKey, backupVersion, prepaidRestoreBalances, isFuturePrepaidMovement, chunkRestoreSettings } from './finance-tools.js'
import { isCardBilledEntry } from './card-billing.js'
import { sealBackup, verifyBackupIntegrity } from './backup-integrity.js'
import { previewRecurringEntries, postApprovedRecurringEntries } from './recurring-check.js'
import { recurringReviewWindow, validRecurringMonth } from './recurring-review-window.js'
import { countReceiptImages, clearAllReceiptImages, listReceiptImagesForExport } from './receipt-store.js'
import { receiptZip } from './receipt-export.js'
const props = defineProps({ cardSettingsRequest: { type: Number, default: 0 }, active: { type: Boolean, default: false }, ledgerRevision: { type: Number, default: 0 }, api: { type: Function, required: true }, categories: { type: Array, default: () => [] }, paymentSources: { type: Array, default: () => [] }, paymentClosingDays: { type: Object, default: () => ({}) }, paymentSourceMeta: { type: Object, default: () => ({}) }, defaultPaymentSource: { type: String, default: '' }, merchantPaymentRules: { type: Array, default: () => [] }, categoryRules: { type: Array, default: () => [] }, rememberDevice: { type: Boolean, default: true } })
const emit = defineEmits(['ledger-updated', 'update-payment-sources', 'open-duplicate', 'open-card-bill-details', 'set-default-payment-source', 'settings-changed', 'merchant-rules-changed', 'payment-settings-refresh', 'change-remember-device', 'receipt-images-cleared'])

const orderedCategories = computed(() => sortOtherLast(props.categories))
const orderedPayments = computed(() => sortOtherLast(props.paymentSources))
const isCreditCard = name => !!name && !['現金','その他','其他'].includes(name) && props.paymentSourceMeta[name]?.source_type === 'standard'
const creditCardSources = computed(() => orderedPayments.value.filter(isCreditCard))
const managementTab = ref('cards')
const appContext = inject('kakeibo-page-context', null)
const investmentRefreshKey = ref(0)
const refreshingEverything = ref(false)
async function refreshEverything() {
  if (busy.value || refreshingEverything.value) return
  refreshingEverything.value = true
  try {
    // Update scheduled transfer bookkeeping before taking the ledger snapshot,
    // otherwise a due transfer created during refresh could be missed.
    if (appContext?.loadTransfers) await appContext.loadTransfers()
    await loadAll()
    if(managementTab.value==='tools')await refreshLocalReceiptCount()
    // Refresh the SBI monthly plans/reconciliation after the transfer state.
    investmentRefreshKey.value++
  } catch (e) {
    loadError.value = '更新に失敗しました：' + e.message
  } finally {
    refreshingEverything.value = false
  }
}
const localReceiptCount = ref(null)
const receiptImagesBusy = ref(false)
const receiptImagePrivacyMessage = ref('')
const receiptExportMessage = ref('')
async function refreshLocalReceiptCount() {
  if (receiptImagesBusy.value) return
  receiptImagesBusy.value = true
  try {
    localReceiptCount.value = await countReceiptImages()
    receiptImagePrivacyMessage.value = ''
  } catch (e) {
    localReceiptCount.value = null
    receiptImagePrivacyMessage.value = '画像の件数を確認できません：' + e.message
  } finally { receiptImagesBusy.value = false }
}
async function downloadReceiptImages() {
  if(receiptImagesBusy.value)return
  receiptImagesBusy.value=true
  try {
    const records=await listReceiptImagesForExport()
    if(!records.length){receiptExportMessage.value='保存対象のレシート画像はありません';return}
    const blob=await receiptZip(records)
    const url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download='kakeibo-receipts-'+new Date().toISOString().slice(0,10)+'.zip'
    document.body.appendChild(a)
    a.click();a.remove()
    setTimeout(()=>URL.revokeObjectURL(url),60000)
    receiptExportMessage.value=records.length+'件の画像をZIPに保存しました。帳簿JSONとは別に保管してください'
  }catch(e){receiptExportMessage.value='画像の保存に失敗しました：'+e.message}
  finally{receiptImagesBusy.value=false}
}
async function clearLocalReceiptImages() {
  if (receiptImagesBusy.value || !localReceiptCount.value) return
  receiptImagesBusy.value = true
  try {
    // Recount immediately before a destructive operation to avoid a stale confirmation.
    const latest = await countReceiptImages()
    if (latest !== localReceiptCount.value) {
      localReceiptCount.value = latest
      receiptImagePrivacyMessage.value = '画像の件数が変わりました。再確認してください。'
      return
    }
    if (!latest) return
    if (!confirm('レシート画像 ' + latest +
      '件を削除しますか？画像は復元できません。明細・SBI評価額は残ります。')) return
    // This only clears the local IndexedDB receipt-image store. Never call D1 APIs.
    await clearAllReceiptImages()
    localReceiptCount.value = 0
    receiptImagePrivacyMessage.value = '画像を削除しました（明細は保持）'
    emit('receipt-images-cleared')
  } catch (e) {
    receiptImagePrivacyMessage.value = '画像の削除に失敗しました：' + e.message
  } finally {
    receiptImagesBusy.value = false
  }
}
watch([() => props.active, managementTab], ([active,tab]) => {
  if(active && tab === 'tools') {
    void refreshLocalReceiptCount()
    // Prefetch all bin sources when entering その他, not only after tapping
    // ゴミ箱. Otherwise the collapsed header shows a misleading partial count.
    void loadTransferTrash()
    void loadDeletedPlans()
    void loadDeletedEntries()
  }
})
watch(() => props.rememberDevice, () => {
  if(props.active && managementTab.value==='tools')void refreshLocalReceiptCount()
})

const cardMode = ref('')
watch(()=>props.cardSettingsRequest,()=>{managementTab.value='cards';cardMode.value='add'})
const selectedCard = ref('')
const editedCardName = ref('')
const closingDays = computed(() => props.paymentClosingDays)
const defaultClosingDay = name => {
  const normalized = String(name || '').normalize('NFKC').toLowerCase().replace(/[\\s　・（）()_-]/g, '')
  if (/セゾン|saison/.test(normalized)) return '10'
  if (/セブンカード|7card/.test(normalized)) return '15'
  return '末日'
}
const closingDayFor = name => closingDays.value[name] === 0 ? '末日' : closingDays.value[name] == null ? defaultClosingDay(name) : String(closingDays.value[name])
function selectCardForEdit() {
  if (!selectedCard.value) return
  editedCardName.value = selectedCard.value
  editSourceType.value=selectedSourceType.value
  cardMode.value = 'edit'
}
async function saveClosingDay(name, day) {
  if (!name || (day !== '末日' && !(Number.isInteger(Number(day)) && Number(day) >= 1 && Number(day) <= 31))) return
  try {
    await props.api('payment-sources/closing-day',{method:'POST',body:JSON.stringify({name,closingDay:day === '末日' ? 0 : Number(day)})})
    emit('payment-settings-refresh')
    cardMessage.value = '締め日を更新しました'
  } catch(e) { cardMessage.value = '締め日の保存に失敗しました：'+e.message }
}
async function renameCard() {
  if (busy.value) return
  const name = editedCardName.value.trim(), old = selectedCard.value
  if (!old || old === '現金' || !name || name.length > 80 || (name !== old && props.paymentSources.includes(name))) {
    cardMessage.value = '名称を確認してください（重複・現金の変更不可）'
    return
  }
  if (name !== old) {
    if (busy.value || !settingsReady.value) return
    busy.value = true
    try {
      // Commit the ledger rename on D1 before updating local display names.
      const result = await props.api('payment-sources/rename', {method:'POST',body:JSON.stringify({oldName:old,newName:name})})
      rows.value = rows.value.map(e => e.payment_source === old ? {...e,payment_source:name} : e)
      // Payment source references are changed server-side with the card rename.
      await loadFinanceSettings()
      // Closing day follows the renamed payment_sources row automatically.
      // D1 already renamed the card, its merchant bindings and historical payments.
      // Refresh the card list; never interpret a rename as delete + insert.
      emit('payment-settings-refresh')
      emit('settings-changed')
      if (bill.value.name === old) bill.value.name = name
      selectedCard.value = name
      cardMessage.value = '名称を変更しました（明細 '+(result?.changes ?? 0)+'件も更新）'
      emit('ledger-updated')
    } catch(e) {
      cardMessage.value = '名称変更に失敗しました：'+e.message
      return
    } finally { busy.value = false }
  }
  cardMode.value = ''
}
const cardPeriod = computed(() => {
  if (!isCreditCard(bill.value.name)) return null
  const match = /^(\d{4})-(\d{2})$/.exec(bill.value.month)
  const day = closingDayFor(bill.value.name)
  if (!match || !day) return null
  const year = Number(match[1]), month = Number(match[2])
  if (month < 1 || month > 12) return null
  const last = (y,m) => new Date(Date.UTC(y,m,0)).getUTCDate()
  const cutoff = (y,m) => day === '末日' ? last(y,m) : Math.min(Number(day),last(y,m))
  const previous = new Date(Date.UTC(year,month-2,1))
  const py = previous.getUTCFullYear(), pm = previous.getUTCMonth()+1
  const start = new Date(Date.UTC(py,pm-1,cutoff(py,pm)+1)).toISOString().slice(0,10)
  const end = [year,String(month).padStart(2,'0'),String(cutoff(year,month)).padStart(2,'0')].join('-')
  return {start,end}
})
const newPaymentSource = ref('')
const newSourceType = ref('standard')
const editSourceType = ref('standard')
const selectedSourceType = computed(() => props.paymentSourceMeta[selectedCard.value]?.source_type || 'standard')
async function saveCardType(){
  if(!selectedCard.value||busy.value)return
  const kind=editSourceType.value
  if(kind===selectedSourceType.value)return renameCard()
  if(editedCardName.value.trim()!==selectedCard.value){
    cardMessage.value='名称変更と種別変更は分けて保存してください'
    return
  }
  busy.value=true
  try{
    await props.api('payment-sources/type',{method:'POST',body:JSON.stringify({name:selectedCard.value,sourceType:kind})})
    emit('payment-settings-refresh')
    cardMessage.value='カード種別を更新しました'
    cardMode.value=''
  }catch(e){cardMessage.value='種別を保存できませんでした：'+e.message}
  finally{busy.value=false}
}
const cardMessage = ref('')
// Changing the selected card must discard the previous card's unsaved draft.
// Keep the editor open, but always show the new card's actual stored type.
watch(selectedCard, (name) => {
  // A native iOS select must be able to return to its placeholder.
  // Clearing the card also closes a previously opened editor; no stale
  // card-specific draft or actions should survive the reset.
  if (!name && cardMode.value === 'edit') cardMode.value = ''
  editedCardName.value = name || ''
  editSourceType.value = selectedSourceType.value
  cardMessage.value = ''
}, { flush: 'sync' })
// If card metadata arrives after the selection, refresh an untouched type field.
// Do not overwrite a pending type choice the user has edited manually.
watch(selectedSourceType, (type, previousType) => {
  if (editSourceType.value === previousType) editSourceType.value = type
}, { flush: 'sync' })
const merchantRulesCombined = computed(() => {
  const items = new Map()
  for (const r of props.categoryRules) items.set(r.keyword, { keyword: r.keyword, category: r.category, payment_source: '' })
  for (const r of props.merchantPaymentRules) {
    const item = items.get(r.keyword) || { keyword: r.keyword, category: '', payment_source: '' }
    item.payment_source = r.payment_source
    items.set(r.keyword, item)
  }
  return [...items.values()].sort((a, b) => a.keyword.localeCompare(b.keyword, 'ja'))
})
const merchantRuleSearch = ref('')
const visibleMerchantRuleCount = ref(8)
const merchantRuleBatchSize = 8
const filteredMerchantRules = computed(() => {
  const key = merchantRuleSearch.value.normalize('NFKC').trim().toLowerCase()
  return key ? merchantRulesCombined.value.filter(rule =>
    [rule.keyword, categoryLabel(rule.category), rule.payment_source].some(value =>
      String(value || '').normalize('NFKC').toLowerCase().includes(key))
  ) : merchantRulesCombined.value
})
const visibleMerchantRules = computed(() => filteredMerchantRules.value.slice(0, visibleMerchantRuleCount.value))
function searchMerchantRules(value) { merchantRuleSearch.value = value; visibleMerchantRuleCount.value = merchantRuleBatchSize }
function showMoreMerchantRules() { visibleMerchantRuleCount.value += merchantRuleBatchSize }
async function changeCategoryRule(rule, category) {
  if (category === rule.category) return
  try {
    if (category) await props.api('rules', { method: 'POST', body: JSON.stringify({ keyword: rule.keyword, category }) })
    else if (rule.category && confirm(rule.keyword + 'のカテゴリルールを解除しますか？'))
      await props.api('custom-rules?keyword=' + encodeURIComponent(rule.keyword), { method: 'DELETE' })
    else return
    emit('merchant-rules-changed')
  } catch (e) { cardMessage.value = 'カテゴリルールを更新できませんでした：' + e.message; emit('merchant-rules-changed') }
}
async function changePaymentRule(rule, name) {
  if (name === rule.payment_source) return
  try {
    if (name) await props.api('merchant-payment-rules', { method: 'POST', body: JSON.stringify({ keyword: rule.keyword, paymentSource: name }) })
    else if (rule.payment_source && confirm(rule.keyword + 'の支払方法ルールを解除しますか？'))
      await props.api('merchant-payment-rules?keyword=' + encodeURIComponent(rule.keyword), { method: 'DELETE' })
    else return
    emit('merchant-rules-changed')
  } catch (e) { cardMessage.value = '支払方法ルールを更新できませんでした：' + e.message; emit('merchant-rules-changed') }
}
async function removeMerchantRule(keyword) {
  if (!confirm(keyword + 'の支払方法ルールを解除しますか？')) return
  try {
    await props.api('merchant-payment-rules?keyword=' + encodeURIComponent(keyword), { method: 'DELETE' })
    emit('settings-changed')
  } catch (e) { cardMessage.value = 'ルールを解除できませんでした：' + e.message }
}
async function addPaymentSource() {
  const name = newPaymentSource.value.trim()
  if (!name || name.length > 80) { cardMessage.value = '名称は1～80文字で入力してください'; return }
  if (props.paymentSources.includes(name)) { cardMessage.value = '同じ名前が登録されています'; return }
  if (busy.value) return
  busy.value = true
  try {
    await props.api('payment-sources',{method:'POST',body:JSON.stringify({name,sourceType:newSourceType.value})})
    emit('payment-settings-refresh')
    newPaymentSource.value = ''
    newSourceType.value = 'standard'
    cardMode.value = ''
    cardMessage.value = name + 'を追加しました'
  } catch(e) { cardMessage.value = 'カードを追加できませんでした：' + e.message }
  finally { busy.value = false }
}
async function removePaymentSource(name) {
  if (name === '現金' || busy.value) return
  if (!confirm(name + 'を削除しますか？明細・請求履歴は残ります。')) return
  busy.value = true
  try {
    await props.api('payment-sources/remove',{method:'POST',body:JSON.stringify({name})})
    emit('payment-settings-refresh')
    selectedCard.value = ''
    cardMode.value = ''
    cardMessage.value = name + 'を削除しました（明細は保持）'
  } catch(e) { cardMessage.value = 'カードを削除できませんでした：' + e.message }
  finally { busy.value = false }
}

const rows = ref([])
const loaded = ref(false)
const loadError = ref('')
const lastLoadedAt = ref(null)
const lastLoadedLabel = computed(() => lastLoadedAt.value ? new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(lastLoadedAt.value) : '')
const busy = ref(false)
const message = ref('')
const restoreRows = ref([])
const restoreConflicts = ref([])
const restoreIncludeConflicts = ref(false)
const backupPreview = ref(null)
const backupLedgerFingerprint = ref('')
// Restore progress survives a recoverable API error in this page, without ever modifying existing records.
const restoreOwnKeys = ref(new Map())
function unrelatedLedgerFingerprint(items) {
  return ledgerFingerprint(items.filter(row => {
    const expected = restoreOwnKeys.value.get(row.client_request_id)
    return !expected || transactionKey(row) !== expected
  }))
}
const ledgerFingerprint = items => items.map(x=>[x.id,transactionKey(x),x.raw||'',x.transfer_applied||0].join('|')).sort().join('\n')
const backupBusy = ref(false)
const plans = ref([])
const recurringListQuery = ref('')
const recurringListFilter = ref('all')
const expandedRecurringPlanId = ref('')
const activeRecurringPlans = computed(() => plans.value.filter(item => item.enabled))
const currentEligiblePlans = computed(() => activeRecurringPlans.value.filter(item =>
  validRecurringMonth(item.startMonth) && item.startMonth <= currentRecurringMonth()))
const recurringMonthlyTotal = computed(() => currentEligiblePlans.value.reduce((sum,item) => sum + Number(item.amount || 0),0))
const filteredRecurringPlans = computed(() => {
  const query = recurringListQuery.value.trim().toLocaleLowerCase('ja-JP')
  return plans.value.filter(item =>
    (recurringListFilter.value === 'all' || (recurringListFilter.value === 'active' ? item.enabled : !item.enabled)) &&
    (!query || String(item.name || '').toLocaleLowerCase('ja-JP').includes(query))
  )
})
function toggleRecurringPlanDetails(id) {
  expandedRecurringPlanId.value = expandedRecurringPlanId.value === id ? '' : id
}
const bills = ref([])
const categoryJapaneseLabels = {'餐饮':'外食','饮食料品':'飲食料品','购物':'買い物','居住':'住居費','医疗':'医療費','娱乐':'娯楽','宠物':'ペット','其他':'その他','日用品':'日用品','交通':'交通費','工资':'給与','奖金':'賞与','副业':'副業','老公生活费':'夫からの生活費','父母赠与':'両親からの援助','亲友赠与':'親族・友人からの援助','退款':'返金','其他收入':'その他の収入'}
const categoryLabel = category => categoryJapaneseLabels[category] || category
const currentRecurringMonth = () => new Date().toLocaleDateString('sv-SE').slice(0,7)
const blankPlan = () => ({name:'',amount:'',day:1,category:'',paymentSource:'現金',startMonth:currentRecurringMonth()})
const plan = ref(blankPlan())
const editingPlanId = ref('')
// Default to the earliest effective month among enabled plans, with an
// explicit 119-month safety limit. Manual lookback options remain available.
const recurringAutoWindow = computed(() => recurringReviewWindow(plans.value,currentRecurringMonth()))
const recurringPreview = ref([])
const recurringSelected = ref(new Set())
const recurringExclusions = ref([])
const recurringListOpen = ref(false)
const recurringSwipeOpenKey = ref('')
let recurringTouchStart = null
const recurringExcludedRows = computed(() => recurringExclusions.value.map(item => ({
  ...item,name:plans.value.find(plan => plan.id === item.planId)?.name ||
    trashedRecurringPlans.value.find(plan => plan.id === item.planId)?.name || '固定費'
})))
const recurringKey = row => row.planId + ':' + row.month
const selectedRecurring = computed(() => recurringPreview.value.filter(row => !row.conflict && recurringSelected.value.has(recurringKey(row))))
function toggleRecurringSelection(row, checked) {
  const next = new Set(recurringSelected.value)
  if (checked && !row.conflict) next.add(recurringKey(row))
  else next.delete(recurringKey(row))
  recurringSelected.value = next
}
const recurringPreviewTotal = computed(() => selectedRecurring.value.reduce((sum,row) => sum + row.amount,0))
function beginEditPlan(item) {
  editingPlanId.value = item.id
  plan.value = {...item, paymentSource:item.paymentSource || '現金',startMonth:item.startMonth || currentRecurringMonth()}
  recurringPreview.value = []
  recurringSelected.value = new Set()
  recurringListOpen.value=false
}
function cancelPlanEdit() { editingPlanId.value = ''; plan.value = blankPlan() }
async function togglePlanEnabled(item) {
  if(recurringBusy.value || !settingsReady.value)return
  recurringBusy.value=true
  try {
    await props.api('recurring-plans/'+encodeURIComponent(item.id),{method:'PUT',body:JSON.stringify({...item,enabled:!item.enabled})})
    plans.value=await props.api('recurring-plans')
    recurringPreview.value=[]
    recurringListOpen.value=false
    recurringMessage.value=item.enabled?'固定費を停止しました':'固定費を再開しました。登録前に確認してください'
    if(editingPlanId.value===item.id)cancelPlanEdit()
  }catch(e){recurringMessage.value='固定費の状態を変更できませんでした：'+e.message}
  finally{recurringBusy.value=false}
}
const bill = ref({name:'',month:new Date().toLocaleDateString('sv-SE').slice(0,7)})
// A source reclassified as prepaid must disappear from credit-card billing immediately.
watch(creditCardSources, sources => {
  if (bill.value.name && !sources.includes(bill.value.name)) bill.value.name = ''
})
const settingsReady = ref(false)
async function loadFinanceSettings() {
  const [loadedPlans,loadedBills] = await Promise.all([props.api('recurring-plans'),props.api('card-bills')])
  if (!Array.isArray(loadedPlans) || !Array.isArray(loadedBills)) throw Error('保存データの形式が不正です')
  plans.value = loadedPlans
  bills.value = loadedBills
  // Keep card settings usable if the additive exclusion table is not yet migrated.
  try {
    const excluded=await props.api('recurring-exclusions')
    if(!Array.isArray(excluded))throw Error('除外設定の形式が不正です')
    recurringExclusions.value=excluded
  } catch(e) {
    recurringExclusions.value=[]
    recurringMessage.value='除外設定を読み込めません：'+e.message
  }
  settingsReady.value = true
}
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP')
// Keep the full ledger in memory during tab switches. A successful edit
// invalidates it; explicit backup/export and restore still fetch fresh data.
const MANAGEMENT_LEDGER_TTL_MS = 5 * 60 * 1000
let ledgerDirty = false
async function loadAll() {
  if (busy.value) return false
  busy.value=true; message.value=''; loadError.value=''
  const startingRevision = props.ledgerRevision
  try {
    const all=[]
    const years = await props.api('entry-years')
    if (!Array.isArray(years)) throw Error('記録年の一覧を取得できません')
    for(const item of years){
      const year=String(item.year), expected=Number(item.count)
      if(!/^\d{4}$/.test(year) || !Number.isSafeInteger(expected) || expected<0) throw Error('記録年の一覧が不正です')
      let fetched=0,cursor=0
      for(;;){
        const page=await props.api('entries?year='+year+'&cursor='+cursor)
        if(!Array.isArray(page))throw Error('読み込み形式が不正です')
        for(const row of page){
          if(!Number.isSafeInteger(Number(row.id)) || Number(row.id)<=cursor)throw Error('明細ページの順序が変わりました')
          cursor=Number(row.id)
        }
        all.push(...page);fetched+=page.length
        if(page.length<500)break
      }
      if(fetched!==expected) throw Error('読み込み中に明細件数が変わりました。もう一度更新してください')
    }
    const latestYears=await props.api('entry-years')
    if(JSON.stringify(years)!==JSON.stringify(latestYears))throw Error('明細の件数が読み込み中に変わりました。再度実行してください')
    await loadReviewState()
    rows.value=all;loaded.value=true;lastLoadedAt.value=new Date()
    // A save completed during this download: do not call stale data fresh.
    ledgerDirty = props.ledgerRevision !== startingRevision
    message.value=all.length+'件の明細を読み込みました'
    return !ledgerDirty
  }catch(e){
    // Never show or export stale data as if it were a complete ledger.
    rows.value=[];loaded.value=false;lastLoadedAt.value=null;ledgerDirty=true
    loadError.value='全明細の読み込みに失敗しました：'+e.message
    message.value=loadError.value
    return false
  }
  finally{busy.value=false}
}
// During merge-first rollout the legacy D1 has no new SBI tables yet.
// Keep large ledger backups available, without suppressing unrelated API failures.
async function exportPortfolioSafely() {
  try { return await props.api('investment-portfolio/export') }
  catch(error) {
    if (/投資テーブルの移行が未実施/.test(String(error.message))) return {}
    throw error
  }
}
async function downloadBackup(){
  if (busy.value || backupBusy.value) return
  backupBusy.value = true
  try {
    // One server-side D1 read transaction avoids cross-table mixed snapshots.
    // Oversized archives retain the existing twice-verified resumable export.
    let atomicBackup=null
    try { atomicBackup=await props.api('backup-snapshot') }
    catch(e) { if(!/snapshot_too_large|大容量|413/.test(String(e.message)))throw e }
    if(atomicBackup){
      const validated=validateBackup(atomicBackup)
      const sealed=await sealBackup(validated)
      const url=URL.createObjectURL(new Blob([JSON.stringify(sealed,null,2)],{type:'application/json'}))
      const anchor=document.createElement('a')
      anchor.href=url;anchor.download='kakeibo-ledger-settings-'+new Date().toISOString().slice(0,10)+'.json';anchor.click()
      setTimeout(()=>URL.revokeObjectURL(url),30000)
      message.value='D1の同一時点の帳簿と設定を保存しました'
      return
    }
    // Refresh ledger and D1 metadata immediately before export. A partial fetch
    // must not be mistaken for a complete, safe recovery archive.
    if (!(await loadAll())) throw Error('明細がすべて取得できなかったため、バックアップを中止しました')
    const snapshot = rows.value.map(row=>({...row}))
    const before = ledgerFingerprint(snapshot)
    const [nextPlans,nextBills,paymentSources,merchantPaymentRules,customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata,portfolio,recurringExclusionsBackup,archivedPlansBackup,trashedEntriesBackup] = await Promise.all([
      props.api('recurring-plans'),props.api('card-bills'),
      props.api('payment-sources'),props.api('merchant-payment-rules'),props.api('custom-rules'),
      props.api('categories'),props.api('category-icons'),props.api('dismissed-transfer-reminders'),props.api('category-source'),exportPortfolioSafely(),props.api('recurring-exclusions'),props.api('recurring-plans?trash=1'),props.api('trash-items?full=1')
    ])
    // Reject mixed-time exports when another device edited the ledger during metadata reads.
    if (!(await loadAll()) || ledgerFingerprint(rows.value)!==before)
      throw Error('明細がバックアップ作成中に変更されました。もう一度実行してください')
    // Settings have their own write APIs. Read a second time to avoid exporting
    // a mixed ledger/setting revision; a true cross-table snapshot still needs D1.
    const currentSettings = await Promise.all([
      props.api('recurring-plans'),props.api('card-bills'),
      props.api('payment-sources'),props.api('merchant-payment-rules'),props.api('custom-rules'),
      props.api('categories'),props.api('category-icons'),props.api('dismissed-transfer-reminders'),props.api('category-source'),exportPortfolioSafely(),props.api('recurring-exclusions'),props.api('recurring-plans?trash=1'),props.api('trash-items?full=1')
    ])
    if (JSON.stringify(currentSettings) !== JSON.stringify([
      nextPlans,nextBills,paymentSources,merchantPaymentRules,
      customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata,portfolio,recurringExclusionsBackup,archivedPlansBackup,trashedEntriesBackup
    ])) throw Error('設定がバックアップ中に変更されました。もう一度実行してください')
    const data = validateBackup({
      format:'kakeibo-ledger-backup',version:backupVersion,exportedAt:new Date().toISOString(),
      entries:snapshot,plans:nextPlans,bills:nextBills,
      paymentSources,merchantPaymentRules,customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata,recurringExclusions:recurringExclusionsBackup,archivedPlans:archivedPlansBackup.map(({archivedAt,...p})=>p),trashedEntries:trashedEntriesBackup,...portfolio
    })
    const sealed = await sealBackup(data)
    const url=URL.createObjectURL(new Blob([JSON.stringify(sealed,null,2)],{type:'application/json'}))
    const a=document.createElement('a')
    a.href=url;a.download='kakeibo-ledger-settings-'+new Date().toISOString().slice(0,10)+'.json';a.click()
    setTimeout(()=>URL.revokeObjectURL(url),30000)
    message.value='帳簿JSONを保存しました'
  } catch(e) { message.value='バックアップを作成できませんでした：'+e.message }
  finally { backupBusy.value=false }
}
async function preview(event){
  const file=event.target.files?.[0];event.target.value=''
  restoreRows.value=[];restoreConflicts.value=[];backupPreview.value=null;restoreIncludeConflicts.value=false
  restoreOwnKeys.value=new Map()
  if(!file)return
  try{
    if(!loaded.value)throw Error('先に全明細を読み込んでください')
    if(file.size>25*1024*1024)throw Error('ファイルが大きすぎます')
    const backup=validateBackup(JSON.parse(await file.text()))
    await verifyBackupIntegrity(backup)
    const result=prepareRestoreRows(rows.value,backup.entries)
    backupLedgerFingerprint.value=ledgerFingerprint(rows.value)
    restoreRows.value=result.newRows
    restoreConflicts.value=result.conflicts
    backupPreview.value=backup
    const settingsCount=(backup.recurringExclusions?.length||0)+(backup.plans?.length||0)+(backup.archivedPlans?.length||0)+(backup.trashedEntries?.length||0)+(backup.bills?.length||0)+(backup.paymentSources?.length||0)+(backup.customRules?.length||0)
    message.value=backup.entries.length+'件 · 追加 '+restoreRows.value.length+'件 · 重複 '+restoreConflicts.value.length+'件 · 設定 '+settingsCount+'件'
  }catch(e){backupPreview.value=null;message.value='確認失敗：'+e.message}
}
async function restore(){
  const backup=backupPreview.value
  if(!backup || busy.value || backupBusy.value)return
  const selectedRows=[...restoreRows.value,...(restoreIncludeConflicts.value?restoreConflicts.value:[])]
  const descriptions=selectedRows.length+'件の明細を追加します。既存データは保持します。'
  if(!confirm(descriptions+' 続けますか？'))return
  if(restoreIncludeConflicts.value && restoreConflicts.value.length &&
      !confirm('同一内容の取引 '+restoreConflicts.value.length+'件を別の取引として追加します。本当に登録しますか？')) return
  // Re-fetch before writing: preview must still refer to the same server ledger.
  if(!(await loadAll())) {message.value='最新の明細を再取得できません。復元を中止しました';return}
  if(backupLedgerFingerprint.value!==unrelatedLedgerFingerprint(rows.value)){
    backupPreview.value=null;restoreRows.value=[];restoreConflicts.value=[]
    message.value='明細が変更されました。バックアップを選び直してください'
    return
  }
  const restoreToday=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  let prepaidFinal=[]
  try{prepaidFinal=prepaidRestoreBalances(backup,restoreToday)}
  catch(e){message.value=e.message;return}
  // Each server call is atomic; a large restore remains resumable without
  // silently dropping display metadata, investment holdings, or custom settings.
  // Always stage prepaid future-dated movements after the restored balance anchor.
  const BATCH_SIZE=80
  const prepaidNames=(backup.paymentSources||[]).filter(x=>x.source_type==='prepaid').map(x=>x.name)
  const deferredRows=selectedRows.filter(e=>isFuturePrepaidMovement(e,prepaidNames,restoreToday))
  const regularRows=selectedRows.filter(e=>!isFuturePrepaidMovement(e,prepaidNames,restoreToday))
  const chunk=(items,size=BATCH_SIZE)=>{
    const batches=[]
    for(let i=0;i<items.length;i+=size)batches.push(items.slice(i,i+size))
    return batches
  }
  const settingsJobs=chunkRestoreSettings(backup,BATCH_SIZE).map(settings=>({settings,rows:[],deferred:[]}))
  const regularJobs=chunk(regularRows).map(rows=>({settings:{},rows,deferred:[]}))
  const jobs=[...settingsJobs,...regularJobs]
  if(!jobs.length)jobs.push({settings:{},rows:[],deferred:[]})
  const finalizationIndex=jobs.length-1
  const futureBatches=chunk(deferredRows)
  if(futureBatches.length){
    jobs[finalizationIndex].deferred=futureBatches.shift()
    for(const deferred of futureBatches)jobs.push({settings:{},rows:[],deferred})
  }
  const emptySettings={
    paymentSources:[],merchantPaymentRules:[],customRules:[],categories:[],
    plans:[],archivedPlans:[],trashedEntries:[],bills:[],recurringExclusions:[],dismissedTransfers:[],categoryMetadata:[],
    investmentPlans:[],investmentPlanHistory:[],investmentHoldings:[],
    fundPrices:[],transferLinks:[],categoryIcons:{}
  }
  const makeRestoreRow=async e=>{
    const payload=JSON.stringify([e.id,e.backupIndex,e.date,e.time,e.amount,e.merchant,e.type,e.category,e.note,e.payment_source,e.transfer_target,e.transfer_date])
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))
    const clientRequestId='restore_'+Array.from(new Uint8Array(hash)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('')
    restoreOwnKeys.value=new Map([...restoreOwnKeys.value,[clientRequestId,transactionKey(e)]])
    return {...e,clientRequestId}
  }
  busy.value=true
  let completed=0,settingsRestored=0,alreadyPresent=0,processed=0
  try{
    for(let i=0;i<jobs.length;i++){
      const job=jobs[i]
      const [atomicRows,deferredPrepaidEntries]=await Promise.all([
        Promise.all(job.rows.map(makeRestoreRow)),
        Promise.all(job.deferred.map(makeRestoreRow))
      ])
      const included=[...job.rows,...job.deferred]
      const oldIds=new Set(included.map(e=>Number(e.id)))
      const scopedArchive={
        ...backup,integrity:undefined,...emptySettings,...job.settings,
        entries:atomicRows,deferredPrepaidEntries,
        transferLinks:(backup.transferLinks||[]).filter(t=>oldIds.has(Number(t.entry_id))),
        dismissedTransfers:(backup.dismissedTransfers||[]).filter(id=>oldIds.has(Number(id))),
        prepaidRestoreInProgress:true,
        prepaidFinalize:i===finalizationIndex?prepaidFinal:[]
      }
      const result=await props.api('restore-atomic',{method:'POST',body:JSON.stringify(scopedArchive)})
      completed+=result.created
      settingsRestored+=result.settings
      alreadyPresent+=result.skipped
      processed+=included.length
      const keys=new Set(included.map(e=>e.backupIndex))
      restoreRows.value=restoreRows.value.filter(row=>!keys.has(row.backupIndex))
      restoreConflicts.value=restoreConflicts.value.filter(row=>!keys.has(row.backupIndex))
      message.value=`復元中 ${processed}/${selectedRows.length}件・${i+1}/${jobs.length}回`
    }
    loaded.value=false;backupPreview.value=null;restoreRows.value=[];restoreConflicts.value=[]
    restoreIncludeConflicts.value=false;restoreOwnKeys.value=new Map()
    message.value=`復元完了：明細 ${completed}件・設定 ${settingsRestored}件（重複除外 ${alreadyPresent}件）`
    await loadFinanceSettings()
    emit('payment-settings-refresh');emit('merchant-rules-changed');emit('settings-changed');emit('ledger-updated')
  }catch(e){
    ledgerDirty=true
    message.value=`復元を中断しました。完了済み ${completed}件は保持されます。再試行可能：${e.message}`
  }finally{busy.value=false}
}
// Use a read-only, tolerant comparison for review; backup keys stay strict.
const duplicates=computed(() => findLedgerDuplicateGroups(rows.value))
// Persist notification decisions in D1, never rely on per-installation cache.
const confirmedDuplicateKeys = ref(new Set())
const archivedTrashKeys = ref(new Set())
const reviewStateReady = ref(false)
const reviewStateError = ref('')
const reviewStateBusy = ref(false)
async function loadReviewState() {
  reviewStateReady.value = false
  try {
    const state = await props.api('review-notices')
    if (!Array.isArray(state?.keys) || state.keys.some(key => typeof key !== 'string'))
      throw Error('確認履歴の形式が不正です')
    confirmedDuplicateKeys.value = new Set(state.keys.filter(key => /^c:v1:[0-9a-f]{16}$/.test(key)).map(key => key.slice(2)))
    archivedTrashKeys.value = new Set(state.keys.filter(key => /^(?:d:v1:|r:|t:)/.test(key)))
    reviewStateError.value = ''
    reviewStateReady.value = true
  } catch (error) {
    confirmedDuplicateKeys.value = new Set()
    archivedTrashKeys.value = new Set()
    reviewStateError.value = '確認履歴を読み込めません：' + error.message
  }
}
async function writeReviewNotices(add = [], remove = []) {
  if (!reviewStateReady.value) throw Error(reviewStateError.value || '確認履歴を更新できません')
  const result = await props.api('review-notices', {method:'PUT',body:JSON.stringify({add,remove})})
  if (!result?.ok) throw Error('確認履歴をD1に保存できませんでした')
}
const trashMessage = ref('')
const trashBusy = ref(false)
const deletedEntries = ref([])
const deletedEntryLoading = ref(false)
const deletedEntryLoaded = ref(false)
async function loadDeletedEntries() {
  if (deletedEntryLoading.value) return
  deletedEntryLoading.value = true
  deletedEntryLoaded.value = false
  try {
    const rows=await props.api('trash-items')
    if(!Array.isArray(rows))throw Error('一覧の形式を確認できません')
    deletedEntries.value=rows
    deletedEntryLoaded.value=true
  } catch(e) {
    trashMessage.value='削除した明細を読み込めませんでした：'+e.message
  } finally {deletedEntryLoading.value=false}
}
async function restoreDeletedEntry(item) {
  if (deletedEntryLoading.value || trashBusy.value) return
  deletedEntryLoading.value=true
  try {
    await props.api('trash-items/'+encodeURIComponent(item.id)+'/restore',{method:'POST'})
    deletedEntries.value=deletedEntries.value.filter(row=>row.id!==item.id)
    emit('ledger-updated')
    if(appContext?.load) await appContext.load()
    if(appContext?.loadYear) await appContext.loadYear()
    if(appContext?.loadTransfers) await appContext.loadTransfers()
    await loadAll()
    trashMessage.value='明細を元に戻しました（元のIDを保持）'
  } catch(e) {trashMessage.value='明細の復元に失敗しました：'+e.message}
  finally {deletedEntryLoading.value=false}
}
async function purgeDeletedEntry(item) {
  if (deletedEntryLoading.value || trashBusy.value) return
  if (!confirm('明細「'+(item.merchant||item.category)+'」'+yen(item.amount)+'を完全に削除しますか？元に戻せません。')) return
  deletedEntryLoading.value=true
  try {
    await props.api('trash-items/'+encodeURIComponent(item.id)+'/purge',
      {method:'DELETE',headers:{'x-confirm-purge':String(item.id)}})
    deletedEntries.value=deletedEntries.value.filter(row=>row.id!==item.id)
    trashMessage.value='明細を完全に削除しました'
  } catch(e) {trashMessage.value='明細の完全削除に失敗しました：'+e.message}
  finally {deletedEntryLoading.value=false}
}
const trashedRecurringPlans = ref([])
const deletedPlanLoading = ref(false)
const deletedPlanLoaded = ref(false)
async function loadDeletedPlans() {
  if (deletedPlanLoading.value) return
  deletedPlanLoading.value = true
  deletedPlanLoaded.value = false
  try {
    const list = await props.api('recurring-plans?trash=1')
    if (!Array.isArray(list)) throw Error('一覧の形式を確認できません')
    trashedRecurringPlans.value = list
    deletedPlanLoaded.value = true
  } catch (e) {
    deletedPlanLoaded.value = false
    trashMessage.value = '削除した固定費を読み込めませんでした：' + e.message
  } finally { deletedPlanLoading.value = false }
}
async function purgeDeletedPlan(item) {
  if (recurringBusy.value || trashBusy.value || deletedPlanLoading.value) return
  if (!confirm('固定費「' + item.name + '」を完全に削除しますか？設定・除外履歴は復元できません。記帳済み明細は残ります。')) return
  recurringBusy.value = true
  try {
    const result = await props.api('recurring-plans/' + encodeURIComponent(item.id) + '/purge',
      {method:'DELETE',headers:{'x-confirm-purge':String(item.id)}})
    if (!result.ok) throw Error('削除できませんでした')
    trashedRecurringPlans.value = trashedRecurringPlans.value.filter(row => row.id !== item.id)
    recurringExclusions.value = recurringExclusions.value.filter(row => row.planId !== item.id)
    trashMessage.value = '固定費の設定を完全に削除しました（明細は保持）'
  } catch (e) { trashMessage.value = '固定費の削除に失敗しました：' + e.message }
  finally { recurringBusy.value = false }
}
async function restoreDeletedPlan(item) {
  if (recurringBusy.value || trashBusy.value || deletedPlanLoading.value) return
  recurringBusy.value = true
  try {
    const result = await props.api('recurring-plans/' + encodeURIComponent(item.id) + '/restore', {method:'POST'})
    if (!result.ok) throw Error('元に戻せませんでした')
    trashedRecurringPlans.value = trashedRecurringPlans.value.filter(p => p.id !== item.id)
    plans.value = await props.api('recurring-plans')
    recurringPreview.value = []
    recurringListOpen.value = false
    trashMessage.value = '固定費を元に戻しました'
  } catch (e) { trashMessage.value = '固定費を元に戻せませんでした：' + e.message }
  finally { recurringBusy.value = false }
}
const dismissedTransferTrash = ref([])
const transferTrashLoading = ref(false)
const transferTrashLoaded = ref(false)
async function loadTransferTrash() {
  if (transferTrashLoading.value) return
  transferTrashLoading.value = true
  transferTrashLoaded.value = false
  try {
    const details = await props.api('dismissed-transfer-reminders?details=1')
    if (!Array.isArray(details)) throw Error('一覧の形式を確認できません')
    dismissedTransferTrash.value = details
    transferTrashLoaded.value = true
  } catch (e) {
    trashMessage.value = '振替の履歴を読み込めませんでした：' + e.message
    transferTrashLoaded.value = false
  } finally { transferTrashLoading.value = false }
}
async function restoreTransferReminder(item) {
  const id = Number(item?.id)
  if (transferTrashLoading.value || !Number.isSafeInteger(id) || id <= 0) return
  transferTrashLoading.value = true
  try {
    const result = await props.api('dismissed-transfer-reminders', {method:'DELETE',body:JSON.stringify({entryId:id})})
    if (!result.ok) throw Error('通知を元に戻せませんでした')
    dismissedTransferTrash.value = dismissedTransferTrash.value.filter(x => Number(x.id) !== id)
    const key = transferTrashKey(item)
    if (archivedTrashKeys.value.has(key)) {
      await writeReviewNotices([], [key])
      const next = new Set(archivedTrashKeys.value)
      next.delete(key)
      archivedTrashKeys.value = next
    }
    if (appContext?.loadTransfers) await appContext.loadTransfers()
    trashMessage.value = '振替の通知を元に戻しました'
  } catch(e) { trashMessage.value = '振替の通知を戻せませんでした：' + e.message }
  finally { transferTrashLoading.value = false }
}
const pendingDuplicates = computed(() => reviewStateReady.value ? duplicates.value.filter(group =>
  !confirmedDuplicateKeys.value.has(duplicateReviewSignature(group))) : [])
const confirmedDuplicates = computed(() => reviewStateReady.value ? duplicates.value.filter(group =>
  confirmedDuplicateKeys.value.has(duplicateReviewSignature(group))) : [])
const reviewTrash = computed(() => visibleReviewedTrash(
  confirmedDuplicates.value, recurringExcludedRows.value, dismissedTransferTrash.value,
  archivedTrashKeys.value, duplicateReviewSignature))
// Never report a subtotal while archived plans or transfer notices are still
// loading. A count becomes authoritative only after every source succeeds.
const trashCountReady = computed(() => reviewStateReady.value && settingsReady.value && loaded.value && !busy.value &&
  transferTrashLoaded.value && deletedPlanLoaded.value && deletedEntryLoaded.value &&
  !transferTrashLoading.value && !deletedPlanLoading.value && !deletedEntryLoading.value)
const trashCount = computed(() => trashCountReady.value
  ? reviewTrash.value.duplicateGroups.length + reviewTrash.value.recurringExclusions.length +
    reviewTrash.value.transferReminders.length + trashedRecurringPlans.value.length + deletedEntries.value.length
  : null)
const trashCountLoading = computed(() => (reviewStateBusy.value || (!reviewStateReady.value && !reviewStateError.value)) || busy.value || transferTrashLoading.value ||
  deletedPlanLoading.value || deletedEntryLoading.value || !settingsReady.value || !loaded.value)
const duplicateReviewMessage = ref('')
async function removeReviewedTrashNotice(key) {
  if (!key || !reviewStateReady.value || trashBusy.value || recurringBusy.value ||
      transferTrashLoading.value || deletedPlanLoading.value) return
  trashBusy.value = true
  try {
    await writeReviewNotices([key])
    archivedTrashKeys.value = new Set([...archivedTrashKeys.value,key])
    trashMessage.value = 'ゴミ箱から削除しました（記帳済み明細は保持）'
  } catch (e) {
    trashMessage.value = '確認履歴の削除に失敗しました：' + e.message
  } finally { trashBusy.value = false }
}
async function emptyReviewTrash() {
  if (!reviewStateReady.value || !trashCount.value || trashBusy.value || recurringBusy.value || transferTrashLoading.value ||
      deletedPlanLoading.value || deletedEntryLoading.value || !transferTrashLoaded.value || !deletedPlanLoaded.value || !deletedEntryLoaded.value) return
  const count = trashedRecurringPlans.value.length
  const entryCount=deletedEntries.value.length
  const warning = entryCount
    ? 'ゴミ箱の'+trashCount.value+'件を消去しますか？削除済み明細'+entryCount+'件は完全に削除され、復元できません。削除済み固定費'+count+'件も完全削除します。'
    : count
      ? 'ゴミ箱の' + trashCount.value + '件を消去しますか？削除済みの固定費' + count + '件は設定と除外履歴を完全に削除します。記帳済み明細・SBI資産は残ります。'
      : 'ゴミ箱の' + trashCount.value + '件を消去しますか？明細・固定費の除外・振替の通知設定は変更しません。'
  if (!confirm(warning)) return
  trashBusy.value = true
  try {
    // Archive notices in D1 before purging deleted recurring settings.
    const keys = [
      ...reviewTrash.value.duplicateGroups.map(group => duplicateTrashKey(duplicateReviewSignature(group))),
      ...reviewTrash.value.recurringExclusions.map(recurringTrashKey),
      ...reviewTrash.value.transferReminders.map(transferTrashKey)
    ].filter(Boolean)
    if (keys.length) {
      await writeReviewNotices(keys)
      archivedTrashKeys.value = new Set([...archivedTrashKeys.value,...keys])
    }
    for (const item of [...trashedRecurringPlans.value]) {
      await props.api('recurring-plans/' + encodeURIComponent(item.id) + '/purge',
        {method:'DELETE',headers:{'x-confirm-purge':String(item.id)}})
      trashedRecurringPlans.value = trashedRecurringPlans.value.filter(row => row.id !== item.id)
      recurringExclusions.value = recurringExclusions.value.filter(row => row.planId !== item.id)
    }
    for (const item of [...deletedEntries.value]) {
      await props.api('trash-items/'+encodeURIComponent(item.id)+'/purge',
        {method:'DELETE',headers:{'x-confirm-purge':String(item.id)}})
      deletedEntries.value=deletedEntries.value.filter(row=>row.id!==item.id)
    }
    trashMessage.value = (count || entryCount)
      ? 'ゴミ箱を空にしました（通常の明細は保持）'
      : 'ゴミ箱を空にしました（明細・通知設定は保持）'
  } catch (e) {
    trashMessage.value = 'ゴミ箱の消去を完了できませんでした：' + e.message
    await Promise.allSettled([loadDeletedPlans(),loadDeletedEntries()])
  } finally { trashBusy.value = false }
}
async function setDuplicateConfirmation(group, isConfirmed) {
  const key = duplicateReviewSignature(group)
  if (!key || !reviewStateReady.value || reviewStateBusy.value) {
    duplicateReviewMessage.value = reviewStateError.value || '明細を更新してから再度お試しください'
    return
  }
  reviewStateBusy.value = true
  try {
    const archived = duplicateTrashKey(key)
    await writeReviewNotices(isConfirmed ? ['c:'+key] : [], isConfirmed ? [archived] : ['c:'+key,archived])
    const next = new Set(confirmedDuplicateKeys.value)
    if (isConfirmed) next.add(key)
    else next.delete(key)
    confirmedDuplicateKeys.value = next
    const nextArchived = new Set(archivedTrashKeys.value)
    nextArchived.delete(archived)
    archivedTrashKeys.value = nextArchived
    duplicateReviewMessage.value = isConfirmed ? 'ゴミ箱へ移動しました' : '重複候補に戻しました'
  } catch (e) {
    duplicateReviewMessage.value = '確認履歴の保存に失敗しました：' + e.message
  } finally { reviewStateBusy.value = false }
}
function refreshDuplicateReview(event) {
  if (event.currentTarget?.open && props.active && managementTab.value === 'tools' && !busy.value) void loadAll()
}
function onReviewTrashToggle(event) {
  if (!event.currentTarget?.open) return
  void loadTransferTrash()
  void loadDeletedPlans()
  void loadDeletedEntries()
  // The main ledger already has a five-minute cache. Avoid reloading it on
  // every accordion toggle (which causes another mid-animation count change).
  if (props.active && !busy.value && (ledgerDirty || !loaded.value || !lastLoadedAt.value ||
      Date.now() - lastLoadedAt.value.getTime() >= MANAGEMENT_LEDGER_TTL_MS)) void loadAll()
}
async function addPlan(){
  if(!plan.value.name.trim() || !Number.isSafeInteger(Number(plan.value.amount)) || Number(plan.value.amount)<=0 ||
    !Number.isInteger(Number(plan.value.day)) || Number(plan.value.day)<1 || Number(plan.value.day)>31 ||
    !validRecurringMonth(plan.value.startMonth) ||
    !props.categories.includes(plan.value.category) || !props.paymentSources.includes(plan.value.paymentSource)) {
    message.value='名称・金額・記帳日・開始月・カテゴリ・支払方法を確認してください';return
  }
  if(!settingsReady.value || recurringBusy.value)return
  recurringBusy.value=true
  try {
    const existing=plans.value.find(row=>row.id===editingPlanId.value)
    const item={...plan.value,id:existing?.id || crypto.randomUUID(),amount:Number(plan.value.amount),day:Number(plan.value.day),
      startMonth:plan.value.startMonth,enabled:existing ? !!existing.enabled : true}
    const updated=Boolean(existing)
    const saved=await props.api(updated?'recurring-plans/'+encodeURIComponent(item.id):'recurring-plans',
      {method:updated?'PUT':'POST',body:JSON.stringify(item)})
    if(!saved.ok)throw Error('保存処理を確認できませんでした')
    plans.value=await props.api('recurring-plans')
    cancelPlanEdit()
    recurringPreview.value=[]
    recurringSelected.value=new Set()
    recurringListOpen.value=false
    recurringMessage.value=updated?'固定費を更新しました':'固定費を登録しました。記帳前に内容を確認してください'
  }catch(e){message.value='固定費の保存に失敗しました：'+e.message}
  finally {recurringBusy.value=false}
}
const recurringBusy=ref(false)
const recurringMessage=ref('')
async function reviewRecurring() {
  if(recurringListOpen.value) {
    recurringListOpen.value=false
    recurringSwipeOpenKey.value=''
    return
  }
  if(recurringBusy.value || !settingsReady.value || !loaded.value) {
    recurringMessage.value='先に全明細を更新してください';return
  }
  recurringBusy.value=true
  try {
    const excluded=await props.api('recurring-exclusions')
    if(!Array.isArray(excluded))throw Error('除外設定の形式が不正です')
    recurringExclusions.value=excluded
    const window=recurringReviewWindow(plans.value,currentRecurringMonth())
    const preview=previewRecurringEntries(plans.value,rows.value,{historicalMonths:window.historicalMonths,excluded})
    recurringPreview.value=preview
    recurringListOpen.value=true
    recurringSwipeOpenKey.value=''
    const current=currentRecurringMonth()
    recurringSelected.value=new Set(preview.filter(row=>!row.conflict && row.month===current).map(recurringKey))
    const conflicts=preview.filter(x=>x.conflict).length
    const historical=preview.filter(row=>row.month<current).length
    recurringMessage.value=preview.length
      ? '候補 '+preview.length+'件 · 重複 '+conflicts+'件（未登録）'+
        (historical?' · 過去分 '+historical+'件は現行の設定金額による推定です':'')
      : '未記帳の固定費はありません'
  }catch(e){recurringMessage.value='未記帳分を確認できません：'+e.message}
  finally{recurringBusy.value=false}
}
function onRecurringTouchStart(event,row) {
  if(recurringBusy.value)return
  const touch=event.touches?.[0]
  if(touch)recurringTouchStart={key:recurringKey(row),x:touch.clientX,y:touch.clientY}
}
function onRecurringTouchEnd(event,row) {
  const touch=event.changedTouches?.[0],start=recurringTouchStart
  recurringTouchStart=null
  if(!start || !touch || start.key!==recurringKey(row))return
  const dx=touch.clientX-start.x,dy=touch.clientY-start.y
  if(Math.abs(dx)<38 || Math.abs(dx)<Math.abs(dy)*1.3)return
  if(event.cancelable)event.preventDefault()
  recurringSwipeOpenKey.value=dx<0?start.key:''
}
function onRecurringTouchCancel(){recurringTouchStart=null}
async function dismissRecurring(row) {
  if(recurringBusy.value || !recurringListOpen.value)return
  recurringBusy.value=true
  try {
    const result=await props.api('recurring-exclusions',{method:'POST',body:JSON.stringify({planId:row.planId,month:row.month})})
    if(!result.ok)throw Error('除外できませんでした')
    const key=recurringKey(row)
    recurringExclusions.value=[...recurringExclusions.value.filter(item=>recurringKey(item)!==key),{planId:row.planId,month:row.month}]
    // A new exclusion is reviewable even if an older notice was cleared.
    const archivedKey = recurringTrashKey(row)
    if (archivedTrashKeys.value.has(archivedKey)) {
      await writeReviewNotices([], [archivedKey])
      const next = new Set(archivedTrashKeys.value)
      next.delete(archivedKey)
      archivedTrashKeys.value = next
    }
    recurringPreview.value=recurringPreview.value.filter(item=>recurringKey(item)!==key)
    const next=new Set(recurringSelected.value)
    next.delete(key)
    recurringSelected.value=next
    recurringSwipeOpenKey.value=''
    recurringMessage.value=row.name+'（'+row.month+'）を候補から除外しました'
  }catch(e){recurringMessage.value='候補を除外できませんでした：'+e.message}
  finally{recurringBusy.value=false}
}
async function restoreRecurringExclusion(item) {
  if(recurringBusy.value)return
  recurringBusy.value=true
  try {
    const result=await props.api('recurring-exclusions',{method:'DELETE',body:JSON.stringify({planId:item.planId,month:item.month})})
    if(!result.ok)throw Error('解除できませんでした')
    recurringExclusions.value=recurringExclusions.value.filter(row=>recurringKey(row)!==recurringKey(item))
    if(recurringListOpen.value) {
      const window=recurringReviewWindow(plans.value,currentRecurringMonth())
      recurringPreview.value=previewRecurringEntries(plans.value,rows.value,{historicalMonths:window.historicalMonths,excluded:recurringExclusions.value})
    }
    recurringMessage.value='除外を解除しました：'+item.month
  }catch(e){recurringMessage.value='除外を解除できませんでした：'+e.message}
  finally{recurringBusy.value=false}
}
async function applyRecurring(){
  if(recurringBusy.value || !loaded.value || !recurringPreview.value.length)return
  const safe=selectedRecurring.value
  if(!safe.length){recurringMessage.value='重複候補は登録できません。明細を確認してください';return}
  const summary=safe.length+'件、合計 '+yen(safe.reduce((sum,row)=>sum+row.amount,0))+
    ' の固定費を登録します。日付と金額を確認しましたか？'
  if(!confirm(summary))return
  const thisMonth=new Date().toLocaleDateString('sv-SE').slice(0,7)
  const historical=safe.filter(row=>row.month<thisMonth)
  if(historical.length && !confirm('過去の固定費'+historical.length+'件は現在の設定金額を使用します。過去に金額が変わっている場合は実際と異なります。個別の金額を確認しましたか？'))return
  recurringBusy.value=true
  try{
    const result=await postApprovedRecurringEntries(props.api,safe)
    recurringMessage.value='登録 '+result.created+'件 · 重複除外 '+result.conflicts+'件'
    recurringPreview.value=[]
    recurringListOpen.value=false
    if(result.created){emit('ledger-updated');await loadAll()}
  }catch(e){recurringMessage.value='処理中断。明細を更新してください：'+e.message}
  finally{recurringBusy.value=false}
}
let financeInitialized = false
let financeInitPromise = null
async function initializeFinance() {
  if (financeInitialized && loaded.value) return true
  if (financeInitPromise) return financeInitPromise
  financeInitPromise = (async () => {
    try {
      await loadFinanceSettings()
      financeInitialized = await loadAll()
      // Fixed expenses are never posted by opening the management page.
      return financeInitialized
    } catch (e) {
      financeInitialized = false
      loadError.value = '設定の読込に失敗しました：' + e.message
      message.value = loadError.value
      return false
    }
  })()
  try { return await financeInitPromise }
  finally { financeInitPromise = null }
}
// Keep operation outcomes in one centered toast instead of scattered
// permanent status lines at the top/bottom of each management panel.
const noticeTimeouts = new Map()
for (const field of [cardMessage, recurringMessage, message, trashMessage,
  duplicateReviewMessage, receiptImagePrivacyMessage, receiptExportMessage]) {
  watch(field, value => {
    if (!value) return
    if (noticeTimeouts.has(field)) clearTimeout(noticeTimeouts.get(field))
    // Background data fetches and backup progress are not action outcomes.
    if (!/^復元中\s/.test(value) && !/^\d+件の明細を読み込みました$/.test(value)) notify(value)
    noticeTimeouts.set(field, setTimeout(() => {
      if (field.value === value) field.value = ''
      noticeTimeouts.delete(field)
    }, NOTIFICATION_DURATION))
  })
}
onUnmounted(() => {
  for (const timer of noticeTimeouts.values()) clearTimeout(timer)
  noticeTimeouts.clear()
})
onMounted(() => { if (props.active) void initializeFinance() })
watch(() => props.ledgerRevision, () => {
  ledgerDirty = true
  // Avoid fetching during a restore or duplicate check; the next visit or
  // explicit refresh will reconcile the current D1 ledger safely.
  if (props.active && !busy.value) void loadAll()
})
watch(() => props.active, active => {
  if (!active) return
  if (!financeInitialized || !loaded.value) return void initializeFinance()
  if (ledgerDirty || !lastLoadedAt.value ||
      Date.now() - lastLoadedAt.value.getTime() >= MANAGEMENT_LEDGER_TTL_MS) {
    void loadFinanceSettings().catch(e => { loadError.value='設定を更新できませんでした：'+e.message })
    void loadAll()
  }
  // Otherwise reuse the already loaded ledger: no D1 fetch on every tap.
})
async function removePlan(id) {
  if (!settingsReady.value || recurringBusy.value) return
  const target=plans.value.find(p=>p.id===id)
  if (!target || !confirm('固定費「'+target.name+'」をゴミ箱に移動しますか？記帳済み明細は残り、元に戻せます。')) return
  recurringBusy.value = true
  try {
    const result = await props.api('recurring-plans/'+encodeURIComponent(id),{method:'DELETE'})
    if (!result.ok) throw Error('削除の確認に失敗しました')
    plans.value = plans.value.filter(x=>x.id!==id)
    trashedRecurringPlans.value = [target,...trashedRecurringPlans.value.filter(x=>x.id!==id)]
    recurringPreview.value=[]
    recurringListOpen.value=false
    if(editingPlanId.value===id) cancelPlanEdit()
    message.value = '固定費をゴミ箱に移動しました'
  } catch(e) { message.value='ゴミ箱への移動に失敗しました：'+e.message }
  finally { recurringBusy.value = false }
}
const cardTransactions=computed(()=>rows.value.filter(e=>isCardBilledEntry(e,cardPeriod.value,bill.value.name)))
const cardTotal=computed(()=>cardTransactions.value.reduce((sum,e)=>sum+Number(e.amount||0),0))
const selectedSavedBill = computed(() => isCreditCard(bill.value.name) ? bills.value.find(record => record.name === bill.value.name && record.month === bill.value.month) || null : null)
const savedBillDifference = computed(() => selectedSavedBill.value && loaded.value ? cardTotal.value - Number(selectedSavedBill.value.total) : null)
const cardBillHistory = computed(() => isCreditCard(bill.value.name) ? bills.value.filter(record => record.name === bill.value.name && record.month !== bill.value.month).slice().sort((a,b) => b.month.localeCompare(a.month)) : [])

function viewCardBillDetails() {
  const period = cardPeriod.value
  if (!isCreditCard(bill.value.name) || !period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bill.value.month)) return
  // Send exact billing dates. The ledger must apply the same inclusion rules
  // as cardTotal (card purchases plus card-funded asset transfers).
  emit('open-card-bill-details', {
    name: bill.value.name, month: bill.value.month, start: period.start, end: period.end
  })
}
async function saveCardBill() {
  if (!settingsReady.value || !loaded.value || !isCreditCard(bill.value.name) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bill.value.month) || !cardPeriod.value) {
    message.value='カード・締め月・明細を確認してください'; return
  }
  const record={name:bill.value.name,month:bill.value.month,start:cardPeriod.value.start,end:cardPeriod.value.end}
  if(busy.value)return
  busy.value=true
  try {
    const latest=await props.api('card-bills/recalculate',{method:'POST',body:JSON.stringify(record)})
    bills.value=await props.api('card-bills')
    ledgerDirty=true
    message.value='D1の最新明細で計算しました：'+yen(latest.total)+'（'+latest.count+'件）'
  } catch(e) { message.value='カード利用額を保存できませんでした：'+e.message }
  finally{busy.value=false}
  // loadAll refuses requests while busy; refresh only after it is released.
  await loadAll()
}
async function removeCardBill(record) {
  if (!record?.name || !record?.month || !confirm(record.name+' '+record.month+' の請求額を削除しますか？明細は残ります。')) return
  try {
    await props.api('card-bills?name='+encodeURIComponent(record.name)+'&month='+encodeURIComponent(record.month),{method:'DELETE'})
    bills.value=await props.api('card-bills')
    message.value='請求額を削除しました（明細は保持）'
  } catch(e) { message.value='カード請求額を削除できませんでした：'+e.message }
}
</script>
<template>
<section class="finance-tools">
  <div class="finance-page-heading"><h1 class="finance-heading">管理</h1><button type="button" class="finance-global-load" :disabled="busy || refreshingEverything" @click="refreshEverything"><span aria-hidden="true" class="finance-refresh-icon">↻</span>{{busy || refreshingEverything ? "更新中…" : "すべて更新"}}</button></div>
  <p class="finance-last-loaded" role="status">{{loaded ? "最終更新："+lastLoadedLabel+" · "+rows.length+"件" : busy ? "明細を読み込み中…" : "未読み込み"}}</p>
  <p v-if="loadError" class="finance-load-error" role="alert">{{ loadError }}</p>
  <div class="finance-section-tabs" role="group" aria-label="管理項目">
    <button type="button" :class="{ selected: managementTab === 'cards' }" :aria-pressed="managementTab === 'cards'" @click="managementTab = 'cards'">カード</button>
    <button type="button" :class="{ selected: managementTab === 'plans' }" :aria-pressed="managementTab === 'plans'" @click="managementTab = 'plans'">固定費</button>
    <button type="button" :class="{ selected: managementTab === 'investment' }" :aria-pressed="managementTab === 'investment'" @click="managementTab = 'investment'">積立</button>
    <button type="button" :class="{ selected: managementTab === 'tools' }" :aria-pressed="managementTab === 'tools'" @click="managementTab = 'tools'">その他</button>
  </div>
  <section v-if="managementTab === 'investment'" class="finance-investment-panel" aria-label="積立管理">
    <InvestmentTransferReview />
    <SbiPortfolio :api="props.api" active-view="plans" :refresh-key="investmentRefreshKey" />
  </section>
  <article v-show="managementTab === 'cards'" class="finance-panel">
    <h2>支払方法・カード管理</h2>
    <div class="finance-inputs card-controls card-main-controls">
      <select v-model="selectedCard" :disabled="busy" aria-label="管理するカード"><option value="">支払方法・カードを選択</option><option v-for="source in orderedPayments" :key="source" :value="source">{{source}}</option></select>
      <button type="button" class="card-icon-action" :disabled="!selectedCard || selectedCard === defaultPaymentSource" @click="emit('set-default-payment-source', selectedCard)" aria-label="デフォルトに設定" title="デフォルトに設定"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z"/></svg></button>
      <button type="button" class="card-icon-action" :disabled="!selectedCard" @click="selectCardForEdit" aria-label="カードを編集" title="カードを編集"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4L16.5 4.5Z"/></svg></button>
      <button type="button" class="card-icon-action" @click="cardMode = 'add'" aria-label="カードを追加" title="カードを追加"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>
    <p v-if="defaultPaymentSource">デフォルト：{{ defaultPaymentSource }}</p>
    <div v-if="cardMode === 'add'" class="card-editor card-add-editor" role="group" aria-label="カードを追加">
      <label class="card-add-field">名称<input v-model="newPaymentSource" maxlength="80" placeholder="例：Suica、楽天カード" aria-label="新しいカード名"></label>
      <label class="card-add-field">種類<select v-model="newSourceType" aria-label="新しいカードの種類"><option value="standard">クレジットカード</option><option value="prepaid">プリペイドカード</option></select></label>
      <p v-if="newSourceType === 'prepaid'" class="card-type-hint">期首残高は「残高」で設定できます。</p>
      <div class="card-add-actions">
        <button type="button" class="card-add-cancel" :disabled="busy" @click="cardMode = ''">キャンセル</button>
        <button type="button" class="card-add-save" :disabled="busy || !newPaymentSource.trim()" @click="addPaymentSource">{{busy ? '保存中…' : '保存'}}</button>
      </div>
    </div>
    <div v-if="cardMode === 'edit' && selectedCard" :key="selectedCard" class="card-editor">
      <label>名称<input :key="selectedCard" v-model="editedCardName" maxlength="80" :disabled="busy || selectedCard === '現金'" aria-label="カード名を編集"></label>
      <label v-if="!['現金','その他','其他'].includes(selectedCard)">種類<select v-model="editSourceType" aria-label="カードの種類"><option value="standard">クレジットカード</option><option value="prepaid">プリペイドカード</option></select></label>
      <p v-if="editSourceType === 'prepaid' && !['現金','その他','其他'].includes(selectedCard)" class="card-type-hint">期首残高は「残高」画面で変更できます。</p>
      <label v-if="isCreditCard(selectedCard) && editSourceType === 'standard'">締め日
        <select :key="selectedCard + '-closing-day'" :value="closingDayFor(selectedCard)" @change="saveClosingDay(selectedCard,$event.target.value)">
          <option v-for="day in 31" :key="day" :value="String(day)">{{day}}日</option><option value="末日">月末</option>
        </select>
      </label>
      <div class="finance-inputs card-edit-actions">
        <button type="button" :disabled="busy" @click="saveCardType">{{editSourceType!==selectedSourceType?'種別を保存':'保存'}}</button>
        <button type="button" :disabled="busy" @click="cardMode = ''">閉じる</button>
        <button v-if="selectedCard !== '現金'" type="button" :disabled="busy" @click="removePaymentSource(selectedCard)">削除</button>
      </div>
    </div>
    
  </article>
  <details v-show="managementTab === 'tools'" class="finance-panel merchant-rules-panel">
    <summary class="merchant-rules-summary"><span>店舗ルール管理</span><span class="merchant-rules-count">{{ merchantRulesCombined.length }}件</span></summary>
    <div v-if="merchantRulesCombined.length" class="merchant-rule-search">
      <input type="search" :value="merchantRuleSearch" @input="searchMerchantRules($event.target.value)" placeholder="店舗名・カテゴリ・カードで検索" aria-label="店舗ルールを検索" />
      <span>{{ filteredMerchantRules.length }}件</span>
    </div>
    <p v-if="!merchantRulesCombined.length">記憶した店舗ルールはありません。</p>
    <p v-else-if="!filteredMerchantRules.length">該当するルールはありません。</p>
    <div v-for="rule in visibleMerchantRules" :key="rule.keyword" class="merchant-rule-row">
      <strong>{{ rule.keyword }}</strong>
      <div class="merchant-rule-fields">
        <label>カテゴリ
          <select :value="rule.category" :aria-label="rule.keyword + 'のカテゴリ'" @change="changeCategoryRule(rule, $event.target.value)">
            <option value="">ルールなし</option>
            <option v-for="category in orderedCategories" :key="category" :value="category">{{ categoryLabel(category) }}</option>
            <option v-if="rule.category && !categories.includes(rule.category)" :value="rule.category">{{ categoryLabel(rule.category) }}</option>
          </select>
        </label>
        <label>支払方法
          <select :value="rule.payment_source" :aria-label="rule.keyword + 'の支払方法'" @change="changePaymentRule(rule, $event.target.value)">
            <option value="">ルールなし</option>
            <option v-for="source in orderedPayments" :key="source" :value="source">{{ source }}</option>
            <option v-if="rule.payment_source && !paymentSources.includes(rule.payment_source)" :value="rule.payment_source">{{ rule.payment_source }}</option>
          </select>
        </label>
      </div>
    </div>
    <div v-if="visibleMerchantRules.length < filteredMerchantRules.length" class="merchant-rule-more">
      <button type="button" @click="showMoreMerchantRules">もっと見る</button>
      <span>{{ visibleMerchantRules.length }} / {{ filteredMerchantRules.length }}件</span>
    </div>
  </details>
  <article v-show="managementTab === 'plans'" class="finance-panel recurring-manager-panel">
    <h2>固定費の設定</h2>
    <div class="finance-inputs recurring-name-amount"><input v-model="plan.name" placeholder="名称" aria-label="固定費名"><AmountInput v-model="plan.amount" input-label="固定費額（円）" /></div>
    <div class="finance-inputs recurring-details"><label>毎月の記帳日<select v-model.number="plan.day" aria-label="毎月の記帳日"><option v-for="day in 31" :key="day" :value="day">{{day}}日</option></select></label><label>カテゴリ<select v-model="plan.category" aria-label="固定費カテゴリ"><option value="">選択してください</option><option v-for="category in orderedCategories" :key="category" :value="category">{{categoryLabel(category)}}</option></select></label><label>支払方法・カード<select v-model="plan.paymentSource" aria-label="固定費支払方法"><option v-for="source in orderedPayments" :key="source" :value="source">{{source}}</option><option v-if="plan.paymentSource && !props.paymentSources.includes(plan.paymentSource)" :value="plan.paymentSource">{{plan.paymentSource}}（既存の設定）</option></select></label></div>
    <label class="recurring-start-month">適用開始月<input v-model="plan.startMonth" type="month" aria-label="固定費の適用開始月" /></label>
    <div class="finance-actions recurring-save-actions"><button type="button" @click="addPlan" :disabled="recurringBusy || !settingsReady">{{editingPlanId ? '変更を保存' : '固定費を登録'}}</button>
    <button v-if="editingPlanId" type="button" :disabled="recurringBusy" @click="cancelPlanEdit">編集をやめる</button></div>
    <p class="recurring-window-note">開始月から未記帳分を確認</p>
    <p v-if="recurringAutoWindow.clipped" class="recurring-window-note">10年以上前の設定は、直近10年分まで確認します。</p>
    <div class="finance-actions recurring-review-actions" :class="{'has-preview':recurringListOpen && recurringPreview.length > 0}"><button type="button" :disabled="recurringBusy || (!recurringListOpen && (!settingsReady || !loaded))" :aria-expanded="recurringListOpen" aria-controls="recurring-candidate-list" @click="reviewRecurring">{{recurringListOpen ? '候補を閉じる' : '未記帳分を確認'}}</button>
    <button v-if="recurringListOpen && recurringPreview.length" type="button" :disabled="recurringBusy || !selectedRecurring.length" @click="applyRecurring">選択した{{selectedRecurring.length}}件を登録</button></div>
    <p v-if="recurringListOpen && recurringPreview.length" class="microcopy" role="status">候補 {{recurringPreview.length}}件 · 選択額 {{yen(recurringPreviewTotal)}}</p>
    <div v-if="recurringListOpen && recurringPreview.length" id="recurring-candidate-list" class="recurring-candidate-list" role="group" aria-label="未登録の固定費候補">
      <div v-for="candidate in recurringPreview" :key="recurringKey(candidate)" class="recurring-swipe-row" :class="{'is-open':recurringSwipeOpenKey === recurringKey(candidate)}"
        @touchstart.passive="onRecurringTouchStart($event,candidate)" @touchend="onRecurringTouchEnd($event,candidate)" @touchcancel="onRecurringTouchCancel">
        <button type="button" class="recurring-swipe-dismiss" :disabled="recurringBusy || recurringSwipeOpenKey !== recurringKey(candidate)" @click="dismissRecurring(candidate)">除外</button>
        <label class="finance-row recurring-candidate" :class="{'recurring-conflict':candidate.conflict}">
        <input type="checkbox" :checked="recurringSelected.has(recurringKey(candidate))" class="recurring-candidate-checkbox" :disabled="recurringBusy || candidate.conflict" @change="toggleRecurringSelection(candidate,$event.target.checked)" />
        <span class="recurring-candidate-content">
          <span class="recurring-candidate-top"><strong class="recurring-candidate-name">{{candidate.name}}</strong><strong class="recurring-candidate-amount">{{yen(candidate.amount)}}</strong></span>
          <span class="recurring-candidate-date">{{candidate.date}}</span>
          <span class="recurring-candidate-state">
            <span v-if="candidate.month < currentRecurringMonth()" class="recurring-candidate-estimated">過去分は推定</span>
            <span :class="candidate.conflict ? 'recurring-status-conflict' : recurringSelected.has(recurringKey(candidate)) ? 'recurring-status-selected' : ''">{{candidate.conflict ? '既存の明細を優先（対象外）' : recurringSelected.has(recurringKey(candidate)) ? '登録対象' : '未選択'}}</span>
          </span>
        </span>
        </label>
        <button type="button" class="recurring-dismiss-desktop" :disabled="recurringBusy" :aria-label="candidate.name+' '+candidate.month+'を候補から除外'" @click="dismissRecurring(candidate)">除外</button>
      </div>
    </div>
    <p v-if="recurringListOpen && recurringPreview.length" class="recurring-swipe-tip">左にスワイプして候補から除外</p>

    
    <details class="recurring-list-disclosure">
      <summary class="recurring-list-summary">
        <span class="recurring-list-summary-title">登録済みの固定費 <strong>{{plans.length}}件</strong></span>
        <span class="recurring-list-summary-total">今月対象 {{currentEligiblePlans.length}}件 · 月額 {{yen(recurringMonthlyTotal)}}</span>
      </summary>
      <div class="recurring-list-body">
        <div class="recurring-list-filters">
          <input v-model="recurringListQuery" type="search" placeholder="名前で検索" aria-label="固定費を検索" />
          <select v-model="recurringListFilter" aria-label="固定費の状態"><option value="all">すべて</option><option value="active">有効</option><option value="stopped">停止中</option></select>
        </div>
        <div v-if="!filteredRecurringPlans.length" class="recurring-list-empty">{{plans.length ? '該当する固定費はありません' : '固定費はまだありません'}}</div>
        <div v-else class="recurring-plan-scroll" role="list" aria-label="固定費一覧">
          <div v-for="p in filteredRecurringPlans" :key="p.id" class="recurring-plan-item" role="listitem">
            <button type="button" class="recurring-plan-toggle" :aria-expanded="expandedRecurringPlanId===p.id" :aria-controls="'recurring-plan-actions-'+p.id" @click="toggleRecurringPlanDetails(p.id)">
              <span class="recurring-plan-name" :title="p.name">{{p.name}}</span>
              <span class="recurring-plan-amount">{{yen(p.amount)}}</span>
              <span class="recurring-plan-chevron" aria-hidden="true">{{expandedRecurringPlanId===p.id ? '⌃' : '⌄'}}</span>
              <span class="recurring-plan-meta">
                <span class="recurring-plan-meta-item">毎月{{p.day}}日</span>
                <span class="recurring-plan-meta-item recurring-payment-source" :title="p.paymentSource || '未設定'">{{p.paymentSource || '未設定'}}</span>
                <span class="recurring-plan-meta-item">開始 {{p.startMonth?.replace('-', '/') || '未設定'}}</span>
                <span class="recurring-plan-meta-item">{{p.enabled ? '次回 '+nextScheduledDate(p.day,new Date(),p.startMonth,true).slice(5).replace('-','/') : '停止中'}}</span>
              </span>
            </button>
            <div v-if="expandedRecurringPlanId===p.id" :id="'recurring-plan-actions-'+p.id" class="recurring-plan-more">
              <span class="recurring-plan-category">{{categoryLabel(p.category)}} · {{p.enabled ? '有効' : '停止中'}}</span>
              <div class="recurring-plan-actions">
                <button type="button" :disabled="recurringBusy" @click="beginEditPlan(p)">編集</button>
                <button type="button" :disabled="recurringBusy" @click="togglePlanEnabled(p)">{{p.enabled ? '停止' : '再開'}}</button>
                <button type="button" :disabled="recurringBusy" @click="removePlan(p.id)">削除</button>
              </div>
            </div>
          </div>
        </div>
        <p class="recurring-list-count">{{filteredRecurringPlans.length}} / {{plans.length}}件</p>
      </div>
    </details>
  </article>
  <article v-show="managementTab === 'cards'" class="finance-panel card-billing-panel">
    <h2>カード別利用額</h2>
    <div class="finance-inputs card-billing-fields">
      <label>カード<select v-model="bill.name" aria-label="カード名"><option value="">カードを選択</option><option v-for="source in creditCardSources" :key="source" :value="source">{{source}}</option></select></label>
      <label>締め月<input class="card-closing-month" v-model="bill.month" type="month" aria-label="締め月"></label>
      <label>利用額<output class="card-usage-total" aria-live="polite">{{loaded && bill.name && cardPeriod ? yen(cardTotal) : "—"}}</output></label>
    </div>
    <p v-if="!loaded">全明細を更新してください。</p>
    <p v-else-if="bill.name && cardPeriod" class="card-billing-period">{{cardPeriod.start}} ～ {{cardPeriod.end}} · {{cardTransactions.length}}件（資産移動を含む）</p>
    <div v-if="bill.name" class="card-billing-actions">
      <button type="button" class="card-billing-save" :disabled="!settingsReady || !loaded || !isCreditCard(bill.name) || !cardPeriod" @click="saveCardBill">この月の利用額を保存</button>
      <button type="button" class="card-billing-detail" :disabled="!settingsReady || !isCreditCard(bill.name) || !cardPeriod" @click="viewCardBillDetails">明細を見る</button>
    </div>
    <div v-if="selectedSavedBill" class="finance-saved-bill">
      <div class="finance-saved-bill-text"><span class="finance-saved-bill-caption">保存済みの請求額 · {{selectedSavedBill.month}}</span><strong>{{yen(selectedSavedBill.total)}}</strong><span v-if="savedBillDifference !== null" role="status">{{savedBillDifference === 0 ? '現在の明細と一致' : '現在の明細との差額：'+yen(savedBillDifference)+'（再保存すると更新）'}}</span></div>
      <button type="button" class="finance-compact-action" @click="removeCardBill(selectedSavedBill)" :aria-label="selectedSavedBill.month+' の保存済み請求額を削除'">削除</button>
    </div>
    <details v-if="bill.name && cardBillHistory.length" class="finance-bill-history">
      <summary>過去の保存済み請求 <span>{{cardBillHistory.length}}件</span></summary>
      <div class="finance-bill-history-scroll">
        <div v-for="record in cardBillHistory" :key="record.name+'-'+record.month" class="finance-row finance-bill-history-row">
          <span>{{record.month}} · {{yen(record.total)}}</span>
          <button type="button" class="finance-compact-action" @click="removeCardBill(record)" :aria-label="record.name+' '+record.month+' の請求額を削除'">削除</button>
        </div>
      </div>
    </details>
  </article>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure device-privacy-panel">
    <summary>端末のプライバシー設定</summary>
    <div class="device-privacy-section">
      <label class="device-login-field"><span>ログイン・レシート画像の保存</span>
        <select :value="props.rememberDevice ? 'remember' : 'session'" aria-label="ログインとレシート画像の保存方法" @change="emit('change-remember-device', $event.target.value === 'remember'); $event.target.value = props.rememberDevice ? 'remember' : 'session'">
          <option value="remember">この端末に保存（最長30日）</option>
          <option value="session">このセッション内のみ保存</option>
        </select>
      </label>
      
    </div>
    <div class="device-privacy-section">
      <div class="device-privacy-row">
        <strong>保存済みレシート画像</strong>
        <span class="device-privacy-count" aria-live="polite">{{receiptImagesBusy && localReceiptCount === null ? '確認中…' : localReceiptCount === null ? '未確認' : localReceiptCount + '件'}}</span>
      </div>
      <p>{{props.rememberDevice ? '端末保存・30日' : 'セッション内のみ保存'}}（明細は保持）</p>
      <div class="device-receipt-actions">
        <button type="button" class="device-receipt-clear" :disabled="receiptImagesBusy || !localReceiptCount" @click="clearLocalReceiptImages">画像をすべて削除</button>
      </div>
      
    </div>
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure" @toggle="$event.target.open && refreshLocalReceiptCount()">
    <summary>バックアップ・復元</summary>
    <p>帳簿・設定をJSON保存（レシート画像は対象外）</p>
    <div class="finance-actions backup-actions"><button type="button" :disabled="busy||backupBusy||!loaded" @click="downloadBackup">{{backupBusy ? 'バックアップ作成中…' : '帳簿JSONを保存'}}</button><label class="backup-upload" :class="{ 'is-disabled': busy||backupBusy||!loaded }">バックアップを選択<input type="file" accept=".json,application/json" :disabled="busy||backupBusy||!loaded" @change="preview"></label></div>
    <div class="backup-receipt-group">
      <button type="button" :disabled="receiptImagesBusy || !localReceiptCount" @click="downloadReceiptImages">レシート画像をZIP保存</button>
      
    </div>
    <div v-if="backupPreview" class="restore-preview">
      <p>追加 {{restoreRows.length}}件 · 重複候補 {{restoreConflicts.length}}件（既存データは保持）</p>
      <details v-if="restoreConflicts.length"><summary>重複候補を確認（{{restoreConflicts.length}}件）</summary><p v-for="e in restoreConflicts.slice(0,30)" :key="e.backupIndex">{{e.date}} · {{e.merchant || e.category}} · {{yen(e.amount)}} · {{e.payment_source || '未設定'}}</p><p v-if="restoreConflicts.length>30">30件まで表示</p></details>
      <label v-if="restoreConflicts.length" class="restore-confirm-duplicates"><input type="checkbox" v-model="restoreIncludeConflicts" />重複候補も別取引として追加する（再確認あり）</label>
      <button type="button" :disabled="busy||backupBusy" @click="restore">未登録の設定と明細を確認して復元</button>
    </div>
    <p v-if="message && message.startsWith('復元中 ')" role="status">{{message}}</p>
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure" @toggle="refreshDuplicateReview">
    <summary>重複の可能性</summary>
    <p v-if="busy">重複候補を確認中…</p>
    <p v-else-if="!reviewStateReady" role="status">{{ reviewStateError || '確認履歴を読み込み中…' }}</p>
    <p v-else-if="!loaded">{{ loadError || '全明細を更新してください。' }}</p>
    <p v-else-if="!pendingDuplicates.length && reviewStateReady">重複候補はありません。</p>
    <div v-for="(group,i) in pendingDuplicates.slice(0,30)" :key="duplicateReviewSignature(group) || i" class="duplicate-review-row">
      <span class="duplicate-review-label">{{group[0].date}} {{group[0].merchant}} {{yen(group[0].amount)}} · {{group.length}}件</span>
      <div class="duplicate-review-actions">
        <button type="button" class="duplicate-review-view" @click="emit('open-duplicate', group[0].date)">明細を見る</button>
        <button type="button" class="duplicate-review-ignore" :disabled="reviewStateBusy || !reviewStateReady || !duplicateReviewSignature(group)" @click="setDuplicateConfirmation(group, true)">重複ではない</button>
      </div>
    </div>

    
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure review-trash-panel" @toggle="onReviewTrashToggle">
    <summary>ゴミ箱 <span class="review-trash-count" aria-live="polite">{{trashCountReady ? trashCount+'件' : trashCountLoading ? '確認中…' : '再読み込みが必要'}}</span></summary>
    <p v-if="!loaded">{{loadError || '全明細を更新してください。'}}</p>
    <template v-else>
      <p v-if="!trashCountReady" class="review-trash-loading" role="status">{{reviewStateError || (trashCountLoading ? 'ゴミ箱を確認中…' : '件数を取得できませんでした。再読み込みしてください。')}}</p>
      <button v-if="!trashCountReady && !trashCountLoading" type="button" class="review-trash-retry" @click="onReviewTrashToggle({currentTarget:{open:true}})">再読み込み</button>
      <template v-if="trashCountReady">
      <p v-if="trashCount === 0">ゴミ箱は空です。</p>
      <details v-if="reviewTrash.duplicateGroups.length" class="review-trash-category">
        <summary>重複確認 <span>{{reviewTrash.duplicateGroups.length}}件</span></summary>
        <div v-for="(group,i) in reviewTrash.duplicateGroups" :key="duplicateReviewSignature(group) || i" class="review-trash-item">
          <span class="review-trash-text" :title="group[0].date+' '+group[0].merchant+' '+yen(group[0].amount)">{{group[0].date}} {{group[0].merchant}} · {{yen(group[0].amount)}} · {{group.length}}件</span>
          <ReviewTrashActions :label="group[0].date+' '+group[0].merchant" :disabled="trashBusy || recurringBusy || reviewStateBusy" @restore="setDuplicateConfirmation(group, false)" @remove="removeReviewedTrashNotice(duplicateTrashKey(duplicateReviewSignature(group)))" />
        </div>
      </details>
      <details v-if="deletedEntries.length" class="review-trash-category">
        <summary>削除した明細 <span>{{deletedEntries.length}}件</span></summary>
        <p class="review-trash-category-note">元のIDで復元できます。レシート画像は元の端末に残ります。</p>
        <div v-for="item in deletedEntries" :key="item.id" class="review-trash-item">
          <span class="review-trash-text" :title="item.date+' '+(item.merchant||item.category)">{{item.date}} · {{item.merchant||item.category}} · {{yen(item.amount)}}</span>
          <ReviewTrashActions :label="item.merchant||item.category" restore-label="明細を復元" remove-label="明細を完全削除"
            :disabled="deletedEntryLoading || trashBusy" @restore="restoreDeletedEntry(item)" @remove="purgeDeletedEntry(item)" />
        </div>
      </details>
      <!-- Different effects: one is a deleted whole schedule, the other
           merely excludes a single month's unposted candidate. -->
      <details v-if="trashedRecurringPlans.length" class="review-trash-category">
        <summary>削除した固定費 <span>{{trashedRecurringPlans.length}}件</span></summary>
        <p class="review-trash-category-note">固定費の登録を削除した項目です。</p>
        <div v-for="item in trashedRecurringPlans" :key="item.id" class="review-trash-item">
          <span class="review-trash-text" :title="item.name+' '+yen(item.amount)">{{item.name}} · {{yen(item.amount)}} · 毎月{{item.day}}日</span>
          <ReviewTrashActions :label="item.name" restore-label="固定費設定を復元" remove-label="固定費設定を完全削除"
            :disabled="recurringBusy || trashBusy || deletedPlanLoading" @restore="restoreDeletedPlan(item)" @remove="purgeDeletedPlan(item)" />
        </div>
      </details>
      <details v-if="reviewTrash.recurringExclusions.length" class="review-trash-category">
        <summary>固定費の月別除外 <span>{{reviewTrash.recurringExclusions.length}}件</span></summary>
        <p class="review-trash-category-note">指定した月だけ記帳候補から除外した項目です。</p>
        <div v-for="item in reviewTrash.recurringExclusions" :key="recurringTrashKey(item)" class="review-trash-item">
          <span class="review-trash-text" :title="item.name+' '+item.month">{{item.name}} · {{item.month}}</span>
          <ReviewTrashActions :label="item.name+' '+item.month" restore-label="その月の記帳候補を再表示" remove-label="確認済み一覧から削除"
            :disabled="recurringBusy || trashBusy" @restore="restoreRecurringExclusion(item)" @remove="removeReviewedTrashNotice(recurringTrashKey(item))" />
        </div>
      </details>
      <details v-if="reviewTrash.transferReminders.length" class="review-trash-category">
        <summary>振替の確認 <span>{{reviewTrash.transferReminders.length}}件</span></summary>
        <div v-for="item in reviewTrash.transferReminders" :key="transferTrashKey(item)" class="review-trash-item">
          <span class="review-trash-text" :title="(item.merchant || item.note || 'SBI証券への振替')+' '+yen(item.amount)">{{item.merchant || item.note || 'SBI証券への振替'}} · {{item.transfer_date || item.date}} · {{yen(item.amount)}}</span>
          <ReviewTrashActions :label="item.merchant || item.note || 'SBI証券への振替'" :disabled="transferTrashLoading || trashBusy" @restore="restoreTransferReminder(item)" @remove="removeReviewedTrashNotice(transferTrashKey(item))" />
        </div>
      </details>
      <button v-if="trashCount" type="button" class="review-trash-empty" :disabled="recurringBusy || trashBusy || transferTrashLoading || deletedPlanLoading || deletedEntryLoading || !transferTrashLoaded || !deletedPlanLoaded || !deletedEntryLoaded" @click="emptyReviewTrash">ゴミ箱を空にする</button>
      <p v-if="trashCount" class="review-trash-note">削除済み固定費は完全削除。それ以外の確認状態と記帳済み明細は残ります。</p>
      </template>
    </template>
    
  </details>
</section>
</template>
<style scoped>
.finance-tools{display:grid;gap:10px}.finance-heading{margin:0 0 2px;font-size:21px;line-height:1.3}.finance-panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;display:grid;gap:8px}.finance-panel h2{font-size:17px;margin:0}.finance-panel p{font-size:13px;color:var(--muted);margin:0}.finance-panel button{border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);padding:9px}.finance-panel label{font-size:13px}.finance-panel input[type=file]{display:block;max-width:100%}.finance-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.finance-inputs input,.finance-inputs select{width:100%;min-width:0;height:44px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px 5px;background:var(--card);color:var(--ink)}.finance-inputs label{min-width:0;font-size:12px;color:var(--muted)}.finance-inputs label select{display:block;color:var(--ink)}.finance-row{font-size:13px;padding:8px 0;border-bottom:1px solid var(--line)}.finance-row button{margin-left:6px}
.duplicate-review-row{display:grid;gap:8px;min-width:0;background:var(--tint);border:1px solid var(--line);border-radius:11px;padding:10px}
.duplicate-review-label{min-width:0;overflow-wrap:anywhere;font-size:13px;font-weight:650}
.duplicate-review-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.finance-panel .duplicate-review-actions button{min-width:0;min-height:44px;padding:9px 5px;font-size:12px}
.finance-panel .duplicate-review-view{background:var(--card);color:var(--blue-dark);border:1px solid var(--line)}
.finance-panel .duplicate-review-ignore{background:var(--card);color:var(--ink);border:1px solid var(--line)}
.duplicate-confirmed-list{min-width:0;border-top:1px solid var(--line);padding-top:8px}
.duplicate-confirmed-list>summary{cursor:pointer;font-size:12px;color:var(--muted);padding:8px 3px}
.duplicate-confirmed-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 3px;border-top:1px solid var(--line);font-size:12px}
.duplicate-confirmed-row span{min-width:0;overflow-wrap:anywhere}
.finance-panel .duplicate-confirmed-row button{flex:none;min-height:44px;color:var(--blue-dark);background:var(--card)}
.finance-panel .duplicate-review-message{font-size:12px;color:var(--muted)}
.review-trash-category{min-width:0;border:1px solid var(--line);border-radius:10px;padding:0 10px;background:var(--card)}
.review-trash-category>summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;cursor:pointer;font-size:13px;font-weight:700;list-style:none}
.review-trash-category>summary::-webkit-details-marker{display:none}
.review-trash-category>summary::after{content:'⌄';font-size:18px;color:var(--muted);transition:transform .15s}
.review-trash-category[open]>summary::after{transform:rotate(180deg)}
.review-trash-category>summary>span{margin-left:auto;font-size:12px;color:var(--muted);font-weight:500}
.review-trash-category>summary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.finance-panel .review-trash-category-note{padding:0 0 7px;margin:0;font-size:11px;line-height:1.45;color:var(--muted)}
.review-trash-subheading{padding-top:9px;font-size:11px;font-weight:700;color:var(--muted)}
.review-trash-panel .review-trash-count{font-size:12px;color:var(--muted);font-weight:600;margin-left:6px}
.review-trash-item{display:flex;align-items:center;justify-content:space-between;gap:5px;min-width:0;min-height:44px;padding:1px 0;border-bottom:1px solid var(--line)}
.review-trash-item .review-trash-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.3}
.review-trash-item:last-child{border-bottom:0}
.finance-panel .review-trash-empty{background:var(--card);color:var(--blue-dark);min-height:44px}
.finance-panel .review-trash-note{font-size:11px;color:var(--muted)}.card-controls{grid-template-columns:minmax(0,1fr) auto auto}.card-editor{display:grid;gap:10px}.card-editor label{display:grid;gap:4px}.card-editor input,.card-editor select{width:100%;min-width:0;height:44px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px;background:var(--card);color:var(--ink)}.recurring-name-amount{grid-template-columns:minmax(0,1fr)}@media(min-width:640px){.recurring-name-amount{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}.recurring-details{grid-template-columns:repeat(3,minmax(0,1fr))}.recurring-name-amount input,.recurring-details select{height:44px;box-sizing:border-box;font:inherit}.recurring-details label{max-width:100%;min-width:0}.card-usage-total{display:flex;align-items:center;height:44px;min-height:44px;box-sizing:border-box;padding:9px 7px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.card-billing-fields{align-items:end}.card-billing-fields>label{display:flex;flex-direction:column;min-width:0;gap:4px}.card-billing-fields select,.card-billing-fields input.card-closing-month,.card-billing-fields .card-usage-total{display:flex;width:100%;height:44px!important;min-height:44px!important;max-height:44px!important;box-sizing:border-box;margin:0;line-height:normal;align-items:center}.card-billing-fields input.card-closing-month{-webkit-appearance:none;appearance:none;display:block;padding:0 4px;font-size:13px;min-width:0}.card-billing-fields input.card-closing-month::-webkit-date-and-time-value{min-height:0;text-align:left}.card-billing-fields input.card-closing-month::-webkit-datetime-edit{padding:0;line-height:42px}.card-billing-fields input.card-closing-month::-webkit-calendar-picker-indicator{margin:0;padding:0;max-width:16px}.finance-tools{min-width:0}.finance-panel{min-width:0}.finance-panel button,.finance-panel input,.finance-panel select,.finance-panel output{font-family:inherit}.finance-panel button{min-height:44px;box-sizing:border-box;font-size:13px;font-weight:650;line-height:1.25;cursor:pointer}.finance-panel button:disabled{opacity:.5;cursor:not-allowed}.finance-panel label{min-width:0;display:flex;flex-direction:column;gap:4px;line-height:1.3}.finance-panel input:not([type=file]),.finance-panel select{height:44px!important;min-height:44px!important;max-height:44px!important;box-sizing:border-box;margin:0;line-height:normal}.finance-panel .card-usage-total{height:44px;min-height:44px;max-height:44px;box-sizing:border-box}.finance-panel input[type=file]{width:100%;box-sizing:border-box;font-size:12px}.finance-panel input[type=file]::file-selector-button{min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--tint);color:var(--ink)}.finance-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.finance-actions button{width:100%;min-width:0}.finance-inputs{align-items:end;gap:8px}.card-controls{grid-template-columns:minmax(0,1fr) auto auto}.card-controls button{padding-inline:12px}.card-edit-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.card-editor{gap:8px}.recurring-name-amount,.recurring-details{align-items:end}.finance-row{min-width:0;overflow-wrap:anywhere}.card-billing-fields{grid-template-columns:repeat(3,minmax(0,1fr))}.card-billing-fields>label{min-width:0;justify-content:flex-end}.card-billing-fields .card-closing-month{width:100%;font-size:13px!important;padding:0 4px!important}.card-billing-fields .card-usage-total{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;padding:0 5px}.finance-panel :focus-visible{outline:2px solid var(--blue);outline-offset:2px}@media(max-width:360px){.finance-panel{padding:10px}.finance-inputs{gap:5px}.card-controls button{padding-inline:8px}.card-billing-fields .card-closing-month{font-size:12px!important}}.finance-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.finance-section-heading h2{margin:0}.finance-page-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;}.finance-page-heading .finance-heading{margin:0;min-width:0}.finance-global-load{flex:none;max-width:64%;min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);font-size:12px;font-weight:600;white-space:normal;text-align:center}.finance-global-load:disabled{opacity:.6}.finance-global-load{display:inline-flex;align-items:center;justify-content:center;gap:5px}.finance-refresh-icon{font-size:19px;line-height:1}.finance-last-loaded{margin:-5px 0 12px;color:var(--muted);font-size:12px}@media(max-width:360px){.finance-global-load{font-size:11px;padding:6px 8px}}.backup-actions{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}.backup-upload{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:44px;padding:8px 6px;border:1px solid var(--line);border-radius:9px;background:var(--tint);color:var(--ink);font-size:12px;font-weight:600;text-align:center;cursor:pointer;box-sizing:border-box}.backup-upload input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}.backup-upload.is-disabled{opacity:.55;cursor:not-allowed}.backup-upload:focus-within{outline:2px solid var(--blue);outline-offset:2px}.backup-actions button{min-width:0;min-height:44px;font-size:12px;white-space:normal}.card-main-controls{grid-template-columns:minmax(0,1fr) repeat(3,44px)!important;align-items:center;gap:6px}
.card-main-controls>select{min-width:0;width:100%}
.finance-panel .card-main-controls .card-icon-action{display:inline-flex;align-items:center;justify-content:center;width:44px;min-width:44px;height:44px;min-height:44px;padding:0;border-radius:10px}
.card-icon-action svg{width:19px;height:19px;flex:none}
@media(max-width:360px){.card-main-controls{grid-template-columns:minmax(0,1fr) repeat(3,40px)!important;gap:4px}.finance-panel .card-main-controls .card-icon-action{width:40px;min-width:40px;height:44px}}
.merchant-rule-row{display:grid;gap:8px;padding:12px 0;border-bottom:1px solid var(--line);min-width:0}
.merchant-rule-row:last-child{border-bottom:none}
.merchant-rule-row strong{font-size:13px;overflow-wrap:anywhere}
.merchant-rule-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
.merchant-rule-fields label{display:grid;gap:5px;min-width:0;color:var(--muted);font-size:12px}
.finance-panel .merchant-rule-fields select{width:100%;min-width:0;height:44px;font-size:13px;padding:0 6px}
.merchant-rules-panel{gap:10px}
.merchant-rules-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;min-height:32px;font-weight:700;font-size:17px;list-style:none}
.merchant-rules-summary::-webkit-details-marker{display:none}
.merchant-rules-summary::before{content:'›';font-size:21px;transform:rotate(0deg);transition:transform .15s;color:var(--muted)}
.merchant-rules-panel[open] .merchant-rules-summary::before{transform:rotate(90deg)}
.merchant-rules-summary>span:first-of-type{flex:1}
.merchant-rules-count{font-size:12px;font-weight:600;color:var(--muted)}
.merchant-rule-search{display:flex;align-items:center;gap:9px;min-width:0}
.merchant-rule-search input{flex:1;min-width:0;width:100%;padding:0 10px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink)}
.merchant-rule-search span{flex:none;white-space:nowrap;font-size:12px;color:var(--muted)}
.merchant-rule-pagination{display:flex;align-items:center;justify-content:center;gap:14px}
.merchant-rule-pagination button{min-width:44px;min-height:44px;font-size:20px}
.merchant-rule-pagination span{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}

/* Mobile-first sizing for finance settings, including iPhone SE width. */
.finance-tools,.finance-panel,.merchant-rules-panel,.merchant-rule-row,.merchant-rule-fields{min-width:0;max-width:100%;box-sizing:border-box}
.merchant-rules-summary{min-height:44px;touch-action:manipulation}
.merchant-rule-row{padding-block:14px}
.merchant-rule-row strong{font-size:14px;line-height:1.4;word-break:break-word}
.merchant-rule-search input{font-size:16px;min-height:44px}
.merchant-rule-fields select{font-size:16px!important;min-height:44px}
.merchant-rule-pagination button{touch-action:manipulation}
.card-main-controls>select{font-size:16px}
.finance-panel .card-main-controls .card-icon-action{touch-action:manipulation}
@media(max-width:380px){
  .merchant-rule-fields{grid-template-columns:minmax(0,1fr);gap:10px}
  .merchant-rule-fields label{min-width:0}
  .finance-panel .merchant-rule-fields select{font-size:16px!important}
  .merchant-rule-search{gap:6px}
  .merchant-rule-search span{font-size:11px}
  .card-main-controls{grid-template-columns:minmax(0,1fr) repeat(3,40px)!important;gap:4px}
  .finance-panel .card-main-controls .card-icon-action{width:40px;min-width:40px;min-height:44px}
}
@media(min-width:381px) and (max-width:540px){
  .merchant-rule-fields{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
}
.merchant-rule-more{display:flex;align-items:center;justify-content:center;gap:12px;min-width:0}
.merchant-rule-more button{min-height:44px;padding:9px 20px}
.merchant-rule-more span{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.finance-saved-bill{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--tint);min-width:0}.finance-saved-bill-text{display:grid;gap:3px;min-width:0}.finance-saved-bill-caption{font-size:12px;color:var(--muted)}.finance-saved-bill-text strong{font-size:17px;font-variant-numeric:tabular-nums}.finance-bill-history{min-width:0;border:1px solid var(--line);border-radius:11px;background:var(--card)}.finance-bill-history summary{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:10px 12px;cursor:pointer;font-size:13px;font-weight:650;list-style:none}.finance-bill-history summary::-webkit-details-marker{display:none}.finance-bill-history summary:after{content:'⌄';margin-left:4px;color:var(--muted)}.finance-bill-history[open] summary:after{content:'⌃'}.finance-bill-history summary span{margin-left:auto;color:var(--muted);font-weight:500}.finance-bill-history-scroll{max-height:280px;overflow-y:auto;overscroll-behavior:contain;padding:0 12px 6px}.finance-bill-history-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.finance-bill-history-row span{min-width:0;overflow-wrap:anywhere}

/* The privacy controls share the finance-page panels, typography and 44px actions. */
.device-privacy-panel .device-privacy-section{display:grid;gap:8px;min-width:0}
.device-privacy-panel .device-privacy-section + .device-privacy-section{border-top:1px solid var(--line);padding-top:13px;margin-top:5px}
.device-login-field{display:grid;gap:6px}
.device-privacy-panel .device-login-field select{width:100%;min-width:0;background:var(--card);color:var(--ink);padding:0 12px;border:1px solid var(--line);border-radius:10px;font-size:16px}
.device-privacy-row{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px}
.device-privacy-row strong{font-size:14px}
.device-privacy-count{font-variant-numeric:tabular-nums;font-size:13px;color:var(--muted)}
.device-receipt-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.device-receipt-actions .device-receipt-clear{grid-column:1}
.device-privacy-panel .device-receipt-clear{color:var(--blue-dark);background:var(--card)}
@media(max-width:360px){.device-privacy-panel .device-receipt-actions button{font-size:12px;padding-inline:5px}}

/* Recurring expense manager: compact, expandable, touch-friendly and height-bounded. */
.recurring-start-month{display:grid;gap:5px;min-width:0;font-size:12px;color:var(--muted)}
.finance-panel .recurring-start-month input[type=month]{width:100%;max-width:100%;min-width:0;font-size:16px;padding:0 12px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink)}
.finance-panel .recurring-window-note{font-size:11px;color:var(--muted)}
.recurring-list-disclosure{min-width:0;border:1px solid var(--line);border-radius:13px;background:var(--card);overflow:hidden}
.recurring-list-summary{display:flex;flex-wrap:wrap;align-items:center;gap:3px 12px;min-height:54px;padding:11px 13px;cursor:pointer;list-style:none}
.recurring-list-summary::-webkit-details-marker{display:none}
.recurring-list-summary:after{content:'⌄';margin-left:auto;color:var(--muted);font-size:19px;line-height:1}
.recurring-list-disclosure[open] .recurring-list-summary:after{content:'⌃'}
.recurring-list-summary-title{display:inline-flex;gap:7px;align-items:center;min-width:0;font-weight:700;font-size:14px;color:var(--ink)}
.recurring-list-summary-title strong{font-variant-numeric:tabular-nums}
.recurring-list-summary-total{font-size:12px;color:var(--muted);white-space:normal}
.recurring-list-body{display:grid;gap:9px;padding:0 10px 10px;min-width:0}
.recurring-list-filters{display:grid;grid-template-columns:minmax(0,1fr) 102px;gap:8px}
.finance-panel .recurring-list-filters input,.finance-panel .recurring-list-filters select{width:100%;min-width:0;max-width:100%;height:44px;min-height:44px;padding:0 9px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;font-size:16px}
.recurring-plan-scroll{display:grid;gap:6px;max-height:320px;overflow-y:auto;overscroll-behavior:contain;padding:1px 3px 3px 1px}
.recurring-plan-item{min-width:0;border:1px solid var(--line);border-radius:11px;background:var(--tint);overflow:hidden}
.finance-panel .recurring-plan-toggle{display:grid;grid-template-columns:minmax(0,1fr) auto 16px;align-items:center;gap:7px;width:100%;min-width:0;min-height:57px;text-align:left;padding:9px 10px;border:0;border-radius:0;background:transparent;box-shadow:none;color:var(--ink)}
.recurring-plan-text{display:grid;gap:3px;min-width:0}
.recurring-plan-name{font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recurring-plan-meta{font-size:11px;line-height:1.3;color:var(--muted);overflow-wrap:anywhere}
.recurring-plan-amount{font-size:14px;font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums}
.recurring-plan-chevron{color:var(--muted);font-size:16px}
.recurring-plan-more{display:grid;gap:8px;padding:8px 10px 10px;border-top:1px solid var(--line)}
.recurring-plan-category{font-size:11px;color:var(--muted)}
.recurring-plan-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.finance-panel .recurring-plan-actions button{padding:8px 4px;min-height:44px;font-size:12px}
.recurring-list-empty{padding:12px 6px;text-align:center;color:var(--muted);font-size:13px}
.finance-panel p.recurring-list-count{font-size:11px;text-align:right;margin:0;color:var(--muted)}
.recurring-candidate-list{display:grid;gap:5px;max-height:240px;overflow-y:auto;overscroll-behavior:contain;min-width:0;padding-right:3px}
@media(max-width:360px){.recurring-list-filters{grid-template-columns:minmax(0,1fr) 92px;gap:5px}.recurring-list-summary{padding:10px}.recurring-plan-meta{font-size:10px}}

/* Fixed expenses: iPhone-first form, review cards and stable disclosure headers. */
.recurring-manager-panel{min-width:0;max-width:100%;box-sizing:border-box}
.recurring-manager-panel .recurring-name-amount,
.recurring-manager-panel .recurring-details{min-width:0;max-width:100%;box-sizing:border-box}
.recurring-manager-panel .recurring-name-amount > *,
.recurring-manager-panel .recurring-details > *{min-width:0;max-width:100%;box-sizing:border-box}
.recurring-manager-panel .recurring-start-month{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-width:0;max-width:100%;width:100%;box-sizing:border-box;overflow:hidden}
.finance-panel .recurring-start-month input[type=month]{display:block;width:100%!important;max-width:100%!important;min-width:0!important;min-inline-size:0!important;box-sizing:border-box!important;overflow:hidden;padding-inline:10px!important;-webkit-appearance:none;appearance:none}
.finance-panel .recurring-start-month input[type=month]::-webkit-date-and-time-value{min-width:0;text-align:left}
.finance-panel .recurring-start-month input[type=month]::-webkit-datetime-edit{min-width:0;padding:0}
.finance-panel .recurring-start-month input[type=month]::-webkit-calendar-picker-indicator{flex:none;max-width:24px}
.finance-panel .recurring-save-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
.finance-panel .recurring-save-actions button{min-width:0;width:100%}
.finance-panel .recurring-save-actions button:only-child{grid-column:1/-1}
.finance-panel p.recurring-window-note{margin:2px 0 0;font-size:11px;line-height:1.45}
.finance-panel .recurring-review-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.finance-panel .recurring-review-actions.has-preview{grid-template-columns:repeat(2,minmax(0,1fr))}
.finance-panel .recurring-review-actions button{min-width:0;width:100%;padding-inline:5px;font-size:12px;line-height:1.3}
.recurring-candidate-list{box-sizing:border-box;max-width:100%}
.recurring-swipe-row{position:relative;overflow:hidden;min-width:0;border-radius:11px;touch-action:pan-y}
.recurring-swipe-row .recurring-candidate{position:relative;z-index:1;box-sizing:border-box;width:100%;transition:transform .18s ease}
.recurring-swipe-row.is-open .recurring-candidate{transform:translateX(-96px)}
.finance-panel .recurring-swipe-dismiss{position:absolute;top:0;right:0;bottom:0;width:96px;min-height:100%;padding:8px;border:0;border-radius:0;background:#b74242;color:white;font-size:13px}
.finance-panel .recurring-dismiss-desktop{display:none}
.recurring-swipe-tip{margin:0;text-align:right;color:var(--muted);font-size:11px}
.recurring-excluded-disclosure{min-width:0;padding:0 10px;border:1px solid var(--line);border-radius:11px}
.recurring-excluded-disclosure summary{display:flex;align-items:center;gap:6px;min-height:44px;font-size:12px;cursor:pointer}
.recurring-excluded-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
.recurring-excluded-item span{min-width:0;overflow-wrap:anywhere}
.finance-panel .recurring-excluded-item button{flex:none;min-width:84px;padding:6px;font-size:12px}
@media(hover:hover) and (pointer:fine){
  .recurring-swipe-row .recurring-candidate{padding-right:68px!important}
  .finance-panel .recurring-dismiss-desktop{display:block;position:absolute;z-index:2;top:50%;right:4px;transform:translateY(-50%);padding:5px 6px;min-height:44px;font-size:11px}
}
@media(prefers-reduced-motion:reduce){.recurring-swipe-row .recurring-candidate{transition:none}}
.finance-panel label.recurring-candidate{display:grid;grid-template-columns:20px minmax(0,1fr);align-items:start;gap:10px;min-width:0;max-width:100%;margin:0;padding:10px;border:1px solid var(--line);border-radius:11px;background:var(--card);cursor:pointer}
.finance-panel label.recurring-candidate.recurring-conflict{opacity:.72;background:var(--tint)}
.finance-panel .recurring-candidate input.recurring-candidate-checkbox[type=checkbox]{display:block;appearance:checkbox;-webkit-appearance:checkbox;width:18px!important;height:18px!important;min-width:18px!important;max-width:18px!important;min-height:18px!important;max-height:18px!important;margin:2px 0 0!important;padding:0!important;box-sizing:border-box!important;flex:none;accent-color:var(--blue);align-self:start}
.recurring-candidate-content{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;min-width:0}
.recurring-candidate-top{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:8px;min-width:0}
.recurring-candidate-name{font-size:13px;line-height:1.35;min-width:0;overflow-wrap:anywhere}
.recurring-candidate-amount{font-size:14px;white-space:nowrap;font-variant-numeric:tabular-nums}
.recurring-candidate-date{font-size:12px;line-height:1.3;color:var(--muted);font-variant-numeric:tabular-nums}
.recurring-candidate-state{display:flex;flex-wrap:wrap;align-items:center;gap:5px 9px;min-width:0;font-size:11px;line-height:1.3;color:var(--muted)}
.recurring-candidate-estimated{color:var(--blue-dark)}
.recurring-status-selected{color:var(--blue-dark);font-weight:700}
.recurring-status-conflict{color:var(--muted)}
/* First line reserves a permanent right-side chevron; totals use their own row. */
.recurring-list-summary{display:grid;grid-template-columns:minmax(0,1fr) 18px;grid-template-rows:auto auto;align-items:center;gap:5px 8px;min-width:0;min-height:60px}
.recurring-list-summary-title{grid-column:1;grid-row:1;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.recurring-list-summary:after{grid-column:2;grid-row:1;justify-self:end;margin:0;line-height:1}
.recurring-list-summary-total{grid-column:1/-1;grid-row:2;min-width:0;font-size:11px;line-height:1.35;overflow-wrap:anywhere}
.finance-panel .recurring-plan-toggle{display:grid;grid-template-columns:minmax(0,1fr) auto 16px;grid-template-rows:auto auto;gap:7px 6px;align-items:center;min-width:0;padding:10px;width:100%}
.recurring-plan-name{grid-column:1;grid-row:1;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.recurring-plan-amount{grid-column:2;grid-row:1;justify-self:end}
.recurring-plan-chevron{grid-column:3;grid-row:1;justify-self:end}
.recurring-plan-meta{grid-column:1/-1;grid-row:2;display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px;min-width:0;max-width:100%;line-height:1.4;overflow-wrap:normal}
.recurring-plan-meta-item{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.recurring-plan-meta-item.recurring-payment-source{max-width:min(100%,160px)}
@media(max-width:380px){
  .finance-panel .recurring-review-actions.has-preview{gap:5px}
  .finance-panel .recurring-review-actions button{font-size:11px}
  .recurring-plan-amount{font-size:13px}
  .recurring-plan-meta{gap:4px 7px}
}

/* Adding a card is a form, not the three-icon card toolbar. Never share its grid. */
.card-add-editor{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0;padding:10px 12px 12px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
.card-add-editor .card-add-field{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;min-width:0;font-size:12px;font-weight:700;color:var(--muted)}
.card-add-editor .card-add-field input,.card-add-editor .card-add-field select{display:block;width:100%;min-width:0;height:44px;min-height:44px;padding:0 11px;font-size:16px;line-height:normal;box-sizing:border-box}
.card-add-editor .card-type-hint{margin:-2px 0 0;font-size:11px;line-height:1.5}
.card-add-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0}
.finance-panel .card-add-actions button{display:inline-flex;align-items:center;justify-content:center;min-width:0;width:100%;min-height:44px;padding:10px 6px;white-space:nowrap;word-break:keep-all;overflow-wrap:normal;font-size:13px;font-weight:750}
.finance-panel .card-add-cancel{background:var(--card);border-color:var(--line)}
.finance-panel .card-add-save{background:var(--blue);border-color:var(--blue);color:#fff}
@media(max-width:360px){.card-add-editor{padding:9px 10px 10px;gap:7px}.card-add-actions{gap:8px}}
.finance-investment-panel{display:grid;gap:9px;min-width:0}
.finance-investment-panel .sbi-portfolio{min-width:0}
/* Four management destinations stay in one compact row on narrow iPhones. */
.finance-tools > .finance-section-tabs{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;grid-auto-flow:row;gap:4px;width:100%;min-width:0;padding:4px;border-radius:13px;border:1px solid var(--line);background:var(--paper);box-sizing:border-box;overflow:hidden}
.finance-tools > .finance-section-tabs>button{display:grid;place-items:center;grid-column:auto!important;min-width:0!important;max-width:100%;width:100%;min-height:44px;padding:8px 2px;white-space:nowrap!important;font-size:12px;font-weight:750;color:var(--muted);border:1px solid transparent;border-radius:10px;background:transparent;cursor:pointer;box-sizing:border-box}
.finance-section-tabs>button.selected{color:var(--blue-dark);background:var(--card);border-color:color-mix(in srgb,var(--blue) 16%,var(--line));box-shadow:0 1px 5px #0000000b}
.finance-section-tabs>button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
@media(max-width:360px){.finance-tools > .finance-section-tabs{gap:2px}.finance-tools > .finance-section-tabs>button{font-size:11px;padding-inline:1px}}
</style>

<style scoped>
/* Mobile: card selector is full width; closing month and usage share a row. */
@media (max-width: 520px) {
  .card-billing-fields {
    display:grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap:10px;
    align-items:end;
  }
  .card-billing-fields > label:first-child {grid-column:1 / -1}
  .card-billing-fields > label:nth-child(2) {grid-column:1}
  .card-billing-fields > label:nth-child(3) {grid-column:2}
  .card-billing-fields .card-closing-month {min-width:0;padding-inline:5px!important;font-size:14px!important}
  .card-billing-fields .card-usage-total {font-size:15px;padding-inline:10px}
}
.card-billing-panel .card-billing-period{font-size:12px;color:var(--muted);line-height:1.45}
.card-billing-panel .card-billing-actions{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:8px;width:100%;min-width:0}
.card-billing-panel .card-billing-actions button{min-width:0;width:100%;min-height:44px;padding:10px 6px;font-size:clamp(11px,3.3vw,13px);font-weight:700;white-space:nowrap;border-radius:10px}
.card-billing-panel .card-billing-actions .card-billing-detail{background:var(--card);color:var(--blue-dark);border:1px solid var(--line)}
.card-billing-panel .card-billing-actions .card-billing-save{background:var(--blue);color:white;border:1px solid transparent}
.backup-receipt-group{display:grid;gap:8px;min-width:0;padding-top:12px;border-top:1px solid var(--line)}
.backup-receipt-group .device-privacy-row{align-items:center}
.backup-receipt-group>button{width:100%;min-height:44px}

</style>
