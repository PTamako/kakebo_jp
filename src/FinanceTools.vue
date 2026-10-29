<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { sortOtherLast } from './category-sort.js'
import { findLedgerDuplicateGroups } from './duplicate-review.js'
import AmountInput from './AmountInput.vue'
import { validateBackup, transactionKey, nextScheduledDate, prepareRestoreRows, restoreMissingByKey, backupVersion } from './finance-tools.js'
import { sealBackup, verifyBackupIntegrity } from './backup-integrity.js'
import { previewRecurringEntries, postApprovedRecurringEntries } from './recurring-check.js'
import { countReceiptImages, clearAllReceiptImages } from './receipt-store.js'
const props = defineProps({ active: { type: Boolean, default: false }, ledgerRevision: { type: Number, default: 0 }, api: { type: Function, required: true }, categories: { type: Array, default: () => [] }, paymentSources: { type: Array, default: () => [] }, paymentClosingDays: { type: Object, default: () => ({}) }, defaultPaymentSource: { type: String, default: '' }, merchantPaymentRules: { type: Array, default: () => [] }, categoryRules: { type: Array, default: () => [] }, rememberDevice: { type: Boolean, default: true } })
const emit = defineEmits(['ledger-updated', 'update-payment-sources', 'open-duplicate', 'set-default-payment-source', 'settings-changed', 'merchant-rules-changed', 'payment-settings-refresh', 'change-remember-device', 'receipt-images-cleared'])

const orderedCategories = computed(() => sortOtherLast(props.categories))
const orderedPayments = computed(() => sortOtherLast(props.paymentSources))
const managementTab = ref('cards')
const localReceiptCount = ref(null)
const receiptImagesBusy = ref(false)
const receiptImagePrivacyMessage = ref('')
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
  if(active && tab === 'tools') void refreshLocalReceiptCount()
})

const cardMode = ref('')
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
const cardMessage = ref('')
// Changing the selected card must replace any unsaved name from the previous card.
// Keep the editor open so the new card's name and closing day appear immediately.
watch(selectedCard, (name) => {
  editedCardName.value = name || ''
})
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
    await props.api('payment-sources',{method:'POST',body:JSON.stringify({name})})
    emit('payment-settings-refresh')
    newPaymentSource.value = ''
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
const recurringMonthlyTotal = computed(() => activeRecurringPlans.value.reduce((sum,item) => sum + Number(item.amount || 0),0))
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
const categoryJapaneseLabels = {'餐饮':'外食','饮食料品':'飲食料品','购物':'買い物','居住':'住居費','医疗':'医療費','娱乐':'娯楽','宠物':'ペット','其他':'その他','日用品':'日用品','交通':'交通費'}
const categoryLabel = category => categoryJapaneseLabels[category] || category
const plan = ref({name:'',amount:'',day:1,category:'',paymentSource:'現金'})
const editingPlanId = ref('')
const recurringHistoricalMonths = ref(0)
const recurringPreview = ref([])
const recurringSelected = ref(new Set())
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
  plan.value = {...item, paymentSource:item.paymentSource || '現金'}
  recurringPreview.value = []
}
function cancelPlanEdit() { editingPlanId.value = ''; plan.value = {name:'',amount:'',day:1,category:'',paymentSource:'現金'} }
async function togglePlanEnabled(item) {
  if(recurringBusy.value || !settingsReady.value)return
  recurringBusy.value=true
  try {
    await props.api('recurring-plans/'+encodeURIComponent(item.id),{method:'PUT',body:JSON.stringify({...item,enabled:!item.enabled})})
    plans.value=await props.api('recurring-plans')
    recurringPreview.value=[]
    recurringMessage.value=item.enabled?'固定支出を停止しました':'固定支出を再開しました。登録前に確認してください'
    if(editingPlanId.value===item.id)cancelPlanEdit()
  }catch(e){recurringMessage.value='固定支出の状態を変更できませんでした：'+e.message}
  finally{recurringBusy.value=false}
}
const bill = ref({name:'',month:new Date().toLocaleDateString('sv-SE').slice(0,7)})
const settingsReady = ref(false)
async function loadFinanceSettings() {
  const [loadedPlans,loadedBills] = await Promise.all([props.api('recurring-plans'),props.api('card-bills')])
  if (!Array.isArray(loadedPlans) || !Array.isArray(loadedBills)) throw Error('保存データの形式が不正です')
  plans.value = loadedPlans
  bills.value = loadedBills
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
    const [nextPlans,nextBills,investments,paymentSources,merchantPaymentRules,customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata] = await Promise.all([
      props.api('recurring-plans'),props.api('card-bills'),props.api('investments'),
      props.api('payment-sources'),props.api('merchant-payment-rules'),props.api('custom-rules'),
      props.api('categories'),props.api('category-icons'),props.api('dismissed-transfer-reminders'),props.api('category-source')
    ])
    // Reject mixed-time exports when another device edited the ledger during metadata reads.
    if (!(await loadAll()) || ledgerFingerprint(rows.value)!==before)
      throw Error('明細がバックアップ作成中に変更されました。もう一度実行してください')
    // Settings have their own write APIs. Read a second time to avoid exporting
    // a mixed ledger/setting revision; a true cross-table snapshot still needs D1.
    const currentSettings = await Promise.all([
      props.api('recurring-plans'),props.api('card-bills'),props.api('investments'),
      props.api('payment-sources'),props.api('merchant-payment-rules'),props.api('custom-rules'),
      props.api('categories'),props.api('category-icons'),props.api('dismissed-transfer-reminders')
    ])
    if (JSON.stringify(currentSettings) !== JSON.stringify([
      nextPlans,nextBills,investments,paymentSources,merchantPaymentRules,
      customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata
    ])) throw Error('設定がバックアップ中に変更されました。もう一度実行してください')
    const data = validateBackup({
      format:'kakeibo-ledger-backup',version:backupVersion,exportedAt:new Date().toISOString(),
      entries:snapshot,plans:nextPlans,bills:nextBills,investments,
      paymentSources,merchantPaymentRules,customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata
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
    const settingsCount=(backup.plans?.length||0)+(backup.bills?.length||0)+(backup.paymentSources?.length||0)+(backup.customRules?.length||0)
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
  // Restore in independently atomic, idempotent batches. A failure preserves
  // committed batches and leaves uncommitted drafts visible for safe retry.
  const BATCH_SIZE=150
  // Use the same settings bound as restoreAtomic; guard before any writes.
  const settingTotal=['paymentSources','merchantPaymentRules','customRules','categories','plans','bills','investments','dismissedTransfers','categoryMetadata']
    .reduce((n,key)=>n+(Array.isArray(backup[key])?backup[key].length:0),0)
    + Object.keys(backup.categoryIcons||{}).length
  if(settingTotal<=500){
    busy.value=true
    let completed=0,settingsRestored=0,alreadyPresent=0
    try{
      const sourceRows=selectedRows.length ? selectedRows : [null]
      for(let offset=0;offset<sourceRows.length;offset+=BATCH_SIZE){
        const subset=sourceRows.slice(offset,offset+BATCH_SIZE).filter(Boolean)
        const atomicRows=[]
        for(const e of subset){
          const payload=JSON.stringify([e.id,e.backupIndex,e.date,e.time,e.amount,e.merchant,e.type,e.category,e.note,e.payment_source,e.transfer_target,e.transfer_date])
          const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))
          const clientRequestId='restore_'+Array.from(new Uint8Array(hash)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('')
          atomicRows.push({...e,clientRequestId})
          restoreOwnKeys.value=new Map([...restoreOwnKeys.value,[clientRequestId,transactionKey(e)]])
        }
        const first=offset===0
        const oldIds=new Set(subset.map(e=>Number(e.id)))
        const scopedArchive={...backup,integrity:undefined,entries:atomicRows,
          plans:first?backup.plans:[],bills:first?backup.bills:[],
          paymentSources:first?backup.paymentSources:[],merchantPaymentRules:first?backup.merchantPaymentRules:[],
          customRules:first?backup.customRules:[],categories:first?backup.categories:[],
          investments:first?backup.investments:[],categoryIcons:first?backup.categoryIcons:{},
          categoryMetadata:first?backup.categoryMetadata:[],
          dismissedTransfers:(backup.dismissedTransfers||[]).filter(id=>oldIds.has(Number(id)))}
        const result=await props.api('restore-atomic',{method:'POST',body:JSON.stringify(scopedArchive)})
        completed+=result.created
        settingsRestored+=result.settings
        alreadyPresent+=result.skipped
        for(const e of subset){
          restoreRows.value=restoreRows.value.filter(row=>row.backupIndex!==e.backupIndex)
          restoreConflicts.value=restoreConflicts.value.filter(row=>row.backupIndex!==e.backupIndex)
        }
        message.value=`復元中 ${Math.min(offset+BATCH_SIZE,sourceRows.length)}/${sourceRows.length}件`
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
    return
  }
  busy.value=true
  let count=0,settingsCount=0,skipped=0
  try{
    // Restore settings additively. Existing payment sources, rules, plans, bills
    // and snapshots always win over uploaded content.
    const existingSources=await props.api('payment-sources')
    const sources=restoreMissingByKey(existingSources,backup.paymentSources||[],x=>x.name)
    for (const source of sources) {
      if(!source || typeof source.name!=='string' || !source.name.trim() || source.name.length>80) continue
      const saved = await props.api('payment-sources/restore-missing',{method:'POST',body:JSON.stringify({
        name:source.name,closingDay:source.closing_day ?? null
      })})
      if(saved.created)settingsCount++
    }
    // Only recover a default card if the current database has no default.
    if(!existingSources.some(source=>source.is_default)){
      const source=(backup.paymentSources||[]).find(source=>source?.is_default)
      if(source?.name && (await props.api('payment-sources')).some(current=>current.name===source.name)){
        const saved = await props.api('payment-sources/restore-default',{method:'POST',body:JSON.stringify({name:source.name})})
        if(saved.restored)settingsCount++
      }
    }
    const existingCategories=await props.api('categories')
    for(const name of restoreMissingByKey(existingCategories,backup.categories||[],x=>x)){
      if(typeof name!=='string' || !name.trim() || name.length>20)continue
      await props.api('categories',{method:'POST',body:JSON.stringify({name,icon:backup.categoryIcons?.[name]||'other'})})
      settingsCount++
    }
    // A category may already exist while its restored icon is still missing.
    // Restore missing icons independently; never overwrite the current choice.
    const existingIcons=await props.api('category-icons')
    const knownCategories=await props.api('categories')
    for(const [category,icon] of Object.entries(backup.categoryIcons||{})){
      if(!knownCategories.includes(category) || existingIcons[category])continue
      const result=await props.api('category-icons/restore-missing',{method:'POST',body:JSON.stringify({category,icon})})
      if(result.created)settingsCount++
    }
    const existingCategoryRules=await props.api('custom-rules')
    for(const rule of restoreMissingByKey(existingCategoryRules,backup.customRules||[],x=>x.keyword)){
      if(!rule?.keyword || !rule?.category)continue
      await props.api('custom-rules',{method:'POST',body:JSON.stringify({keyword:rule.keyword,category:rule.category})})
      settingsCount++
    }
    const existingPaymentRules=await props.api('merchant-payment-rules')
    for(const rule of restoreMissingByKey(existingPaymentRules,backup.merchantPaymentRules||[],x=>x.keyword)){
      if(!rule?.keyword || !rule?.payment_source)continue
      await props.api('merchant-payment-rules',{method:'PUT',body:JSON.stringify({keyword:rule.keyword,paymentSource:rule.payment_source})})
      settingsCount++
    }
    const existingBills=await props.api('card-bills')
    for(const bill of restoreMissingByKey(existingBills,backup.bills||[],x=>x.name+'|'+x.month)){
      if(!bill?.name || !bill?.month)continue
      await props.api('card-bills',{method:'POST',body:JSON.stringify(bill)})
      settingsCount++
    }
    const sbi=(backup.investments||[]).find(x=>x.platform==='sbi')
    if(sbi && (sbi.current_value === null || Number.isSafeInteger(sbi.current_value)) &&
       (sbi.pnl === null || Number.isSafeInteger(sbi.pnl)) &&
       (sbi.current_value !== null || sbi.pnl !== null)){
      const saved=await props.api('investments/restore-empty',{method:'POST',body:JSON.stringify({platform:'sbi',currentValue:sbi.current_value,pnl:sbi.pnl})})
      if(saved.restored)settingsCount++;else skipped++
    }
    const restoredIds = new Map()
    for (const e of selectedRows){
      // Stable across retry; source backup identity disambiguates identical purchases.
      const payload=JSON.stringify([e.id,e.backupIndex,e.date,e.time,e.amount,e.merchant,e.type,e.category,e.note,e.payment_source,e.transfer_target,e.transfer_date])
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))
      const key='restore_'+Array.from(new Uint8Array(hash)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('')
      const {backupIndex,...entry}=e
      // Register this precise intended row before the network request: even a lost response
      // can be checked against its idempotency ID on the next read.
      restoreOwnKeys.value = new Map([...restoreOwnKeys.value,[key,transactionKey(entry)]])
      const result=await props.api('entries',{method:'POST',body:JSON.stringify({...entry,clientRequestId:key,transferTarget:e.transfer_target||'',transferDate:e.transfer_date||e.date,paymentSource:e.payment_source||''})})
      if(result.duplicate)skipped++;else count++
      if(e.id && result?.id)restoredIds.set(Number(e.id),Number(result.id))
      restoreRows.value=restoreRows.value.filter(row=>row.backupIndex!==e.backupIndex)
      restoreConflicts.value=restoreConflicts.value.filter(row=>row.backupIndex!==e.backupIndex)
    }
    // An already existing transfer may not be part of the newly inserted rows.
    // Restore its dismissal only when one unique matching transaction is found.
    const originalEntries=new Map(backup.entries.filter(e=>Number.isSafeInteger(Number(e.id))).map(e=>[Number(e.id),e]))
    for(const oldId of backup.dismissedTransfers || []) {
      let newId=restoredIds.get(Number(oldId))
      if(!newId) {
        const original=originalEntries.get(Number(oldId))
        if(original?.type==='transfer' && original.transfer_target==='sbi'){
          const matches=rows.value.filter(row=>row.type==='transfer'&&row.transfer_target==='sbi'&&transactionKey(row)===transactionKey(original))
          if(matches.length===1)newId=Number(matches[0].id)
        }
      }
      if(newId){await props.api('dismissed-transfer-reminders',{method:'POST',body:JSON.stringify({entryId:newId})});settingsCount++}
    }
    // Restore recurring plans last: ledger rows must exist before a future app
    // launch can generate scheduled records from the restored plans.
    const existingPlans=await props.api('recurring-plans')
    for(const plan of restoreMissingByKey(existingPlans,backup.plans||[],x=>x.id)){
      if(!plan?.id)continue
      await props.api('recurring-plans',{method:'POST',body:JSON.stringify(plan)})
      settingsCount++
    }
    await loadFinanceSettings()
    loaded.value=false;backupPreview.value=null;restoreIncludeConflicts.value=false
    restoreOwnKeys.value=new Map()
    message.value='復元完了：明細 '+count+'件・設定 '+settingsCount+'件（重複除外 '+skipped+'件）'
    emit('payment-settings-refresh');emit('merchant-rules-changed');emit('settings-changed');emit('ledger-updated')
  }catch(e){message.value='一部復元済み：明細 '+count+'件・設定 '+settingsCount+'件。再試行：'+e.message}
  finally{busy.value=false}
}
// Use a read-only, tolerant comparison for review; backup keys stay strict.
const duplicates=computed(() => findLedgerDuplicateGroups(rows.value))
function refreshDuplicateReview(event) {
  if (event.currentTarget?.open && props.active && managementTab.value === 'tools' && !busy.value) void loadAll()
}
async function addPlan(){
  if(!plan.value.name.trim() || !Number.isSafeInteger(Number(plan.value.amount)) || Number(plan.value.amount)<=0 ||
    !Number.isInteger(Number(plan.value.day)) || Number(plan.value.day)<1 || Number(plan.value.day)>31 ||
    !props.categories.includes(plan.value.category) || !props.paymentSources.includes(plan.value.paymentSource)) {
    message.value='名称・金額・登録日・カテゴリー・支払方法を選択してください';return
  }
  if(!settingsReady.value || recurringBusy.value)return
  recurringBusy.value=true
  try {
    const existing=plans.value.find(row=>row.id===editingPlanId.value)
    const item={...plan.value,id:existing?.id || crypto.randomUUID(),amount:Number(plan.value.amount),day:Number(plan.value.day),
      startMonth:existing?.startMonth || new Date().toLocaleDateString('sv-SE').slice(0,7),enabled:existing ? !!existing.enabled : true}
    const updated=Boolean(existing)
    const saved=await props.api(updated?'recurring-plans/'+encodeURIComponent(item.id):'recurring-plans',
      {method:updated?'PUT':'POST',body:JSON.stringify(item)})
    if(!saved.ok)throw Error('保存処理を確認できませんでした')
    plans.value=await props.api('recurring-plans')
    cancelPlanEdit()
    recurringPreview.value=[]
    recurringMessage.value=updated?'固定支出を更新しました':'固定支出を登録しました。入帳前に確認してください'
  }catch(e){message.value='固定支出の保存に失敗しました：'+e.message}
  finally {recurringBusy.value=false}
}
const recurringBusy=ref(false)
const recurringMessage=ref('')
function reviewRecurring() {
  if(recurringBusy.value || !settingsReady.value || !loaded.value) {recurringMessage.value='先に全明細を更新してください';return}
  const preview=previewRecurringEntries(plans.value,rows.value,{historicalMonths:Number(recurringHistoricalMonths.value)})
  recurringPreview.value=preview
  const current = new Date().toLocaleDateString('sv-SE').slice(0,7)
  recurringSelected.value = new Set(preview.filter(row=>!row.conflict && row.month===current).map(recurringKey))
  const conflicts=preview.filter(x=>x.conflict).length
  recurringMessage.value=preview.length ? '候補 '+preview.length+'件 · 重複 '+conflicts+'件（未登録）' : '未記録の固定支出はありません'
}
async function applyRecurring(){
  if(recurringBusy.value || !loaded.value || !recurringPreview.value.length)return
  const safe=selectedRecurring.value
  if(!safe.length){recurringMessage.value='重複候補は登録できません。明細を確認してください';return}
  const summary=safe.length+'件、合計 '+yen(safe.reduce((sum,row)=>sum+row.amount,0))+
    ' の固定支出を登録します。日付と金額を確認しましたか？'
  if(!confirm(summary))return
  recurringBusy.value=true
  try{
    const result=await postApprovedRecurringEntries(props.api,safe)
    recurringMessage.value='登録 '+result.created+'件 · 重複除外 '+result.conflicts+'件'
    recurringPreview.value=[]
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
  if (!confirm('固定支出「'+(target?.name||'')+'」を削除しますか？明細は残ります。')) return
  try {
    await props.api('recurring-plans/'+encodeURIComponent(id),{method:'DELETE'})
    plans.value = plans.value.filter(x=>x.id!==id)
    recurringPreview.value=[]
    if(editingPlanId.value===id) cancelPlanEdit()
  } catch(e) { message.value='固定支出の削除に失敗しました：'+e.message }
}
const monthExpenses=(period,source)=>period ? rows.value.filter(e=>e.date>=period.start&&e.date<=period.end&&e.type==='expense'&&e.payment_source===source) : []
const cardTransactions=computed(()=>monthExpenses(cardPeriod.value,bill.value.name))
const cardTotal=computed(()=>cardTransactions.value.reduce((sum,e)=>sum+Number(e.amount||0),0))
const selectedSavedBill = computed(() => bills.value.find(record => record.name === bill.value.name && record.month === bill.value.month) || null)
const savedBillDifference = computed(() => selectedSavedBill.value && loaded.value ? cardTotal.value - Number(selectedSavedBill.value.total) : null)
const cardBillHistory = computed(() => bills.value.filter(record => record.name === bill.value.name && record.month !== bill.value.month).slice().sort((a,b) => b.month.localeCompare(a.month)))

async function saveCardBill() {
  if (!settingsReady.value || !loaded.value || !bill.value.name || !/^\d{4}-(0[1-9]|1[0-2])$/.test(bill.value.month) || !cardPeriod.value) {
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
  <div class="finance-page-heading"><h1 class="finance-heading">管理・照合</h1><button type="button" class="finance-global-load" :disabled="busy" @click="loadAll"><span aria-hidden="true" class="finance-refresh-icon">↻</span>{{busy ? "読み込み中…" : "全明細を更新"}}</button></div>
  <p class="finance-last-loaded" role="status">{{loaded ? "更新："+lastLoadedLabel+" · "+rows.length+"件" : busy ? "明細を読み込み中…" : "未読み込み"}}</p>
  <p v-if="loadError" class="finance-load-error" role="alert">{{ loadError }}</p>
  <div class="finance-section-tabs" role="group" aria-label="管理項目">
    <button type="button" :class="{ selected: managementTab === 'cards' }" :aria-pressed="managementTab === 'cards'" @click="managementTab = 'cards'">カード</button>
    <button type="button" :class="{ selected: managementTab === 'plans' }" :aria-pressed="managementTab === 'plans'" @click="managementTab = 'plans'">固定支出</button>
    <button type="button" :class="{ selected: managementTab === 'tools' }" :aria-pressed="managementTab === 'tools'" @click="managementTab = 'tools'">その他</button>
  </div>
  <article v-show="managementTab === 'cards'" class="finance-panel">
    <h2>支払方法・カード管理</h2>
    <div class="finance-inputs card-controls card-main-controls">
      <select v-model="selectedCard" :disabled="busy" @change="cardMessage = ''" aria-label="管理するカード"><option value="" disabled>支払方法・カードを選択</option><option v-for="source in orderedPayments" :key="source" :value="source">{{source}}</option></select>
      <button type="button" class="card-icon-action" :disabled="!selectedCard || selectedCard === defaultPaymentSource" @click="emit('set-default-payment-source', selectedCard)" aria-label="デフォルトに設定" title="デフォルトに設定"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z"/></svg></button>
      <button type="button" class="card-icon-action" :disabled="!selectedCard" @click="selectCardForEdit" aria-label="カードを編集" title="カードを編集"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4L16.5 4.5Z"/></svg></button>
      <button type="button" class="card-icon-action" @click="cardMode = 'add'" aria-label="カードを追加" title="カードを追加"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>
    <p v-if="defaultPaymentSource">デフォルト：{{ defaultPaymentSource }}</p>
    <div v-if="cardMode === 'add'" class="finance-inputs card-controls">
      <input v-model="newPaymentSource" maxlength="80" placeholder="新しいカード名・支払方法" aria-label="新しい支払方法">
      <button type="button" @click="addPaymentSource">保存</button>
      <button type="button" @click="cardMode = ''">キャンセル</button>
    </div>
    <div v-if="cardMode === 'edit' && selectedCard" class="card-editor">
      <label>名称<input :key="selectedCard" v-model="editedCardName" maxlength="80" :disabled="busy || selectedCard === '現金'" aria-label="カード名を編集"></label>
      <label v-if="!['現金','その他','Suica'].includes(selectedCard)">締め日
        <select :value="closingDayFor(selectedCard)" @change="saveClosingDay(selectedCard,$event.target.value)">
          <option v-for="day in 31" :key="day" :value="String(day)">{{day}}日</option><option value="末日">月末</option>
        </select>
      </label>
      <div class="finance-inputs card-edit-actions">
        <button type="button" :disabled="busy" @click="renameCard">保存</button>
        <button type="button" :disabled="busy" @click="cardMode = ''">閉じる</button>
        <button v-if="selectedCard !== '現金'" type="button" :disabled="busy" @click="removePaymentSource(selectedCard)">削除</button>
      </div>
    </div>
    <p v-if="cardMessage" role="status">{{cardMessage}}</p>
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
  <article v-show="managementTab === 'plans'" class="finance-panel">
    <h2>毎月の固定支出</h2>
    <div class="finance-inputs recurring-name-amount"><input v-model="plan.name" placeholder="名称" aria-label="固定支出名"><AmountInput v-model="plan.amount" input-label="固定支出額（円）" /></div>
    <div class="finance-inputs recurring-details"><label>毎月の登録日<select v-model.number="plan.day" aria-label="毎月の登録日"><option v-for="day in 31" :key="day" :value="day">{{day}}日</option></select></label><label>カテゴリー<select v-model="plan.category" aria-label="固定支出カテゴリ"><option value="" disabled>選択してください</option><option v-for="category in orderedCategories" :key="category" :value="category">{{categoryLabel(category)}}</option></select></label><label>支払方法・カード<select v-model="plan.paymentSource" aria-label="固定支出支払方法"><option v-for="source in orderedPayments" :key="source" :value="source">{{source}}</option><option v-if="plan.paymentSource && !props.paymentSources.includes(plan.paymentSource)" :value="plan.paymentSource">{{plan.paymentSource}}（既存の設定）</option></select></label></div>
    <div class="finance-actions"><button type="button" @click="addPlan" :disabled="recurringBusy || !settingsReady">{{editingPlanId ? '変更を保存' : '固定支出を登録'}}</button>
    <button v-if="editingPlanId" type="button" :disabled="recurringBusy" @click="cancelPlanEdit">編集をやめる</button></div>
    <label class="form-field"><span>未記録を確認する期間</span><select v-model.number="recurringHistoricalMonths" @change="recurringPreview=[]"><option :value="0">今月のみ（初期設定）</option><option :value="3">過去3か月も確認</option><option :value="12">過去12か月も確認</option><option :value="119">過去10年分も確認</option></select></label>
    <div class="finance-actions"><button type="button" :disabled="recurringBusy || !settingsReady || !loaded" @click="reviewRecurring">未記録分を確認</button>
    <button v-if="recurringPreview.length" type="button" :disabled="recurringBusy || !selectedRecurring.length" @click="applyRecurring">選択した{{selectedRecurring.length}}件を登録</button></div>
    <p v-if="recurringPreview.length" class="microcopy" role="status">候補 {{recurringPreview.length}}件 · 選択額 {{yen(recurringPreviewTotal)}}</p>
    <div v-if="recurringPreview.length" class="recurring-candidate-list" role="group" aria-label="未登録の固定支出候補">
      <label v-for="candidate in recurringPreview" :key="recurringKey(candidate)" class="finance-row recurring-candidate" :class="{'recurring-conflict':candidate.conflict}"><input type="checkbox" :checked="recurringSelected.has(recurringKey(candidate))" :disabled="recurringBusy || candidate.conflict" @change="toggleRecurringSelection(candidate,$event.target.checked)" /><span>{{candidate.date}} {{candidate.name}} {{yen(candidate.amount)}} {{candidate.conflict ? '· 既存の明細を優先（対象外）' : recurringSelected.has(recurringKey(candidate)) ? '· 登録対象' : '· 未選択'}}</span></label>
    </div>
    <p v-if="recurringMessage" role="status">{{recurringMessage}}</p>
    <details class="recurring-list-disclosure">
      <summary class="recurring-list-summary">
        <span class="recurring-list-summary-title">登録済みの固定支出 <strong>{{plans.length}}件</strong></span>
        <span class="recurring-list-summary-total">有効 {{activeRecurringPlans.length}}件 · 月額 {{yen(recurringMonthlyTotal)}}</span>
      </summary>
      <div class="recurring-list-body">
        <div class="recurring-list-filters">
          <input v-model="recurringListQuery" type="search" placeholder="名前で検索" aria-label="固定支出を検索" />
          <select v-model="recurringListFilter" aria-label="固定支出の状態"><option value="all">すべて</option><option value="active">有効</option><option value="stopped">停止中</option></select>
        </div>
        <div v-if="!filteredRecurringPlans.length" class="recurring-list-empty">{{plans.length ? '該当する固定支出はありません' : '固定支出はまだありません'}}</div>
        <div v-else class="recurring-plan-scroll" role="list" aria-label="固定支出一覧">
          <div v-for="p in filteredRecurringPlans" :key="p.id" class="recurring-plan-item" role="listitem">
            <button type="button" class="recurring-plan-toggle" :aria-expanded="expandedRecurringPlanId===p.id" :aria-controls="'recurring-plan-actions-'+p.id" @click="toggleRecurringPlanDetails(p.id)">
              <span class="recurring-plan-text">
                <span class="recurring-plan-name">{{p.name}}</span>
                <span class="recurring-plan-meta">毎月{{p.day}}日 · {{p.paymentSource || '未設定'}} · {{p.enabled ? '次回 '+nextScheduledDate(p.day,new Date(),p.startMonth,true).slice(5).replace('-','/') : '停止中'}}</span>
              </span>
              <span class="recurring-plan-amount">{{yen(p.amount)}}</span>
              <span class="recurring-plan-chevron" aria-hidden="true">{{expandedRecurringPlanId===p.id ? '⌃' : '⌄'}}</span>
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
  <article v-show="managementTab === 'cards'" class="finance-panel">
    <h2>カード別利用額</h2>
    <div class="finance-inputs card-billing-fields">
      <label>カード<select v-model="bill.name" aria-label="カード名"><option value="" disabled>カードを選択</option><option v-for="source in orderedPayments.filter(x => !['現金','その他','Suica'].includes(x))" :key="source" :value="source">{{source}}</option><option v-if="bill.name && !props.paymentSources.includes(bill.name)" :value="bill.name">{{bill.name}}（既存の設定）</option></select></label>
      <label>締め月<input class="card-closing-month" v-model="bill.month" type="month" aria-label="締め月"></label>
      <label>利用額<output class="card-usage-total" aria-live="polite">{{loaded && bill.name && cardPeriod ? yen(cardTotal) : "—"}}</output></label>
    </div>
    <p v-if="!loaded">全明細を更新してください。</p>
    <div v-else-if="bill.name && cardPeriod" class="finance-row">
      <strong>{{bill.name}} · {{bill.month}}締め</strong><span>{{cardPeriod.start}} ～ {{cardPeriod.end}}</span>
      <strong>{{yen(cardTotal)}}</strong>
      <span>{{cardTransactions.length}}件の支出</span>
    </div>
    <p v-else>カードと締め月を選択してください。</p>
    <button type="button" :disabled="!settingsReady || !loaded || !bill.name || !cardPeriod" @click="saveCardBill">この月の利用額を保存</button>
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
      <label class="device-login-field"><span>ログイン状態</span>
        <select :value="props.rememberDevice ? 'remember' : 'session'" aria-label="ログイン状態の保存方法" @change="emit('change-remember-device', $event.target.value === 'remember')">
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
      <p>端末保存・30日（明細は保持）</p>
      <div class="finance-actions device-receipt-actions">
        <button type="button" :disabled="receiptImagesBusy" @click="refreshLocalReceiptCount">{{receiptImagesBusy ? '確認中…' : '件数を更新'}}</button>
        <button type="button" class="device-receipt-clear" :disabled="receiptImagesBusy || !localReceiptCount" @click="clearLocalReceiptImages">画像をすべて削除</button>
      </div>
      <p v-if="receiptImagePrivacyMessage" role="status">{{receiptImagePrivacyMessage}}</p>
    </div>
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure">
    <summary>バックアップ・復元</summary>
    <p>帳簿・設定をJSON保存（レシート画像は対象外）</p>
    <div class="finance-actions backup-actions"><button type="button" :disabled="busy||backupBusy||!loaded" @click="downloadBackup">{{backupBusy ? 'バックアップ作成中…' : '帳簿JSONを保存'}}</button><label class="backup-upload" :class="{ 'is-disabled': busy||backupBusy||!loaded }">バックアップを選択<input type="file" accept=".json,application/json" :disabled="busy||backupBusy||!loaded" @change="preview"></label></div>
    <div v-if="backupPreview" class="restore-preview">
      <p>追加 {{restoreRows.length}}件 · 重複候補 {{restoreConflicts.length}}件（既存データは保持）</p>
      <details v-if="restoreConflicts.length"><summary>重複候補を確認（{{restoreConflicts.length}}件）</summary><p v-for="e in restoreConflicts.slice(0,30)" :key="e.backupIndex">{{e.date}} · {{e.merchant || e.category}} · {{yen(e.amount)}} · {{e.payment_source || '未設定'}}</p><p v-if="restoreConflicts.length>30">30件まで表示</p></details>
      <label v-if="restoreConflicts.length" class="restore-confirm-duplicates"><input type="checkbox" v-model="restoreIncludeConflicts" />重複候補も別取引として追加する（再確認あり）</label>
      <button type="button" :disabled="busy||backupBusy" @click="restore">未登録の設定と明細を確認して復元</button>
    </div>
    <p v-if="message" role="status">{{message}}</p>
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure" @toggle="refreshDuplicateReview">
    <summary>重複の可能性</summary>
    <p v-if="busy">重複候補を確認中…</p>
    <p v-else-if="!loaded">{{ loadError || '全明細を更新してください。' }}</p>
    <p v-else-if="!duplicates.length">重複候補はありません。</p>
    <button v-for="(group,i) in duplicates.slice(0,30)" :key="i" type="button" class="finance-row duplicate-link" @click="emit('open-duplicate', group[0].date)">{{group[0].date}} {{group[0].merchant}} {{yen(group[0].amount)}} · {{group.length}}件 <span>明細を見る ›</span></button>
  </details>
</section>
</template>
<style scoped>
.finance-tools{display:grid;gap:10px}.finance-heading{margin:0 0 2px;font-size:21px;line-height:1.3}.finance-panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;display:grid;gap:8px}.finance-panel h2{font-size:17px;margin:0}.finance-panel p{font-size:13px;color:var(--muted);margin:0}.finance-panel button{border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);padding:9px}.finance-panel label{font-size:13px}.finance-panel input[type=file]{display:block;max-width:100%}.finance-inputs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px}.finance-inputs input,.finance-inputs select{width:100%;min-width:0;height:44px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px 5px;background:var(--card);color:var(--ink)}.finance-inputs label{min-width:0;font-size:12px;color:var(--muted)}.finance-inputs label select{display:block;color:var(--ink)}.finance-row{font-size:13px;padding:8px 0;border-bottom:1px solid var(--line)}.finance-row button{margin-left:6px}
.duplicate-link{width:100%;display:flex;justify-content:space-between;align-items:center;text-align:left;cursor:pointer;border:1px solid var(--line);background:var(--card);color:inherit;border-radius:10px;padding:10px}.duplicate-link span{white-space:nowrap;color:var(--blue-dark);font-weight:700;margin-left:8px}.card-controls{grid-template-columns:minmax(0,1fr) auto auto}.card-editor{display:grid;gap:10px}.card-editor label{display:grid;gap:4px}.card-editor input,.card-editor select{width:100%;min-width:0;height:44px;min-height:44px;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px;background:var(--card);color:var(--ink)}.recurring-name-amount{grid-template-columns:minmax(0,1fr)}@media(min-width:640px){.recurring-name-amount{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}.recurring-details{grid-template-columns:repeat(3,minmax(0,1fr))}.recurring-name-amount input,.recurring-details select{height:44px;box-sizing:border-box;font:inherit}.recurring-details label{max-width:100%;min-width:0}.card-usage-total{display:flex;align-items:center;height:44px;min-height:44px;box-sizing:border-box;padding:9px 7px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}.card-billing-fields{align-items:end}.card-billing-fields>label{display:flex;flex-direction:column;min-width:0;gap:4px}.card-billing-fields select,.card-billing-fields input.card-closing-month,.card-billing-fields .card-usage-total{display:flex;width:100%;height:44px!important;min-height:44px!important;max-height:44px!important;box-sizing:border-box;margin:0;line-height:normal;align-items:center}.card-billing-fields input.card-closing-month{-webkit-appearance:none;appearance:none;display:block;padding:0 4px;font-size:13px;min-width:0}.card-billing-fields input.card-closing-month::-webkit-date-and-time-value{min-height:0;text-align:left}.card-billing-fields input.card-closing-month::-webkit-datetime-edit{padding:0;line-height:42px}.card-billing-fields input.card-closing-month::-webkit-calendar-picker-indicator{margin:0;padding:0;max-width:16px}.finance-tools{min-width:0}.finance-panel{min-width:0}.finance-panel button,.finance-panel input,.finance-panel select,.finance-panel output{font-family:inherit}.finance-panel button{min-height:44px;box-sizing:border-box;font-size:13px;font-weight:650;line-height:1.25;cursor:pointer}.finance-panel button:disabled{opacity:.5;cursor:not-allowed}.finance-panel label{min-width:0;display:flex;flex-direction:column;gap:4px;line-height:1.3}.finance-panel input:not([type=file]),.finance-panel select{height:44px!important;min-height:44px!important;max-height:44px!important;box-sizing:border-box;margin:0;line-height:normal}.finance-panel .card-usage-total{height:44px;min-height:44px;max-height:44px;box-sizing:border-box}.finance-panel input[type=file]{width:100%;box-sizing:border-box;font-size:12px}.finance-panel input[type=file]::file-selector-button{min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--tint);color:var(--ink)}.finance-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.finance-actions button{width:100%;min-width:0}.finance-inputs{align-items:end;gap:8px}.card-controls{grid-template-columns:minmax(0,1fr) auto auto}.card-controls button{padding-inline:12px}.card-edit-actions{grid-template-columns:repeat(3,minmax(0,1fr))}.card-editor{gap:8px}.recurring-name-amount,.recurring-details{align-items:end}.finance-row{min-width:0;overflow-wrap:anywhere}.card-billing-fields{grid-template-columns:repeat(3,minmax(0,1fr))}.card-billing-fields>label{min-width:0;justify-content:flex-end}.card-billing-fields .card-closing-month{width:100%;font-size:13px!important;padding:0 4px!important}.card-billing-fields .card-usage-total{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;padding:0 5px}.finance-panel :focus-visible{outline:2px solid var(--blue);outline-offset:2px}@media(max-width:360px){.finance-panel{padding:10px}.finance-inputs{gap:5px}.card-controls button{padding-inline:8px}.card-billing-fields .card-closing-month{font-size:12px!important}}.finance-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}.finance-section-heading h2{margin:0}.finance-page-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;}.finance-page-heading .finance-heading{margin:0;min-width:0}.finance-global-load{flex:none;max-width:64%;min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--ink);font-size:12px;font-weight:600;white-space:normal;text-align:center}.finance-global-load:disabled{opacity:.6}.finance-global-load{display:inline-flex;align-items:center;justify-content:center;gap:5px}.finance-refresh-icon{font-size:19px;line-height:1}.finance-last-loaded{margin:-5px 0 12px;color:var(--muted);font-size:12px}@media(max-width:360px){.finance-global-load{font-size:11px;padding:6px 8px}}.backup-actions{grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch}.backup-upload{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:44px;padding:8px 6px;border:1px solid var(--line);border-radius:9px;background:var(--tint);color:var(--ink);font-size:12px;font-weight:600;text-align:center;cursor:pointer;box-sizing:border-box}.backup-upload input[type=file]{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none}.backup-upload.is-disabled{opacity:.55;cursor:not-allowed}.backup-upload:focus-within{outline:2px solid var(--blue);outline-offset:2px}.backup-actions button{min-width:0;min-height:44px;font-size:12px;white-space:normal}.card-main-controls{grid-template-columns:minmax(0,1fr) repeat(3,44px)!important;align-items:center;gap:6px}
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
.device-receipt-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
.device-privacy-panel .device-receipt-clear{color:var(--blue-dark);background:var(--card)}
@media(max-width:360px){.device-privacy-panel .device-receipt-actions button{font-size:12px;padding-inline:5px}}

/* Recurring expense manager: compact, expandable, touch-friendly and height-bounded. */
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
</style>
