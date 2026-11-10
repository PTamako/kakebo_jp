<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch } from 'vue'
import { notify, NOTIFICATION_DURATION } from './notifications.js'
import { sortOtherLast } from './category-sort.js'
import ReviewTrashActions from './ReviewTrashActions.vue'
import { findLedgerDuplicateGroups, duplicateReviewSignature } from './duplicate-review.js'
import { duplicateTrashKey, recurringTrashKey, transferTrashKey, visibleReviewedTrash } from './review-trash.js'
import AmountInput from './AmountInput.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import MobileMultiChoiceSheet from './MobileMultiChoiceSheet.vue'
import MobileMerchantRulesPanel from './MobileMerchantRulesPanel.vue'
import MobileChoiceSegments from './MobileChoiceSegments.vue'
import MobileCardEditorSheet from './MobileCardEditorSheet.vue'
import SbiPortfolio from './SbiPortfolio.vue'
import InvestmentTransferReview from './InvestmentTransferReview.vue'
import { validateBackup, transactionKey, nextScheduledDate, prepareRestoreRows, restoreMissingByKey, backupVersion, prepaidRestoreBalances, isFuturePrepaidMovement, chunkRestoreSettings, prepareLinkedRestoreRows } from './finance-tools.js'
import { isCardBilledEntry, cardBilledAmount, billingPeriodForMonth } from './card-billing.js'
import { sealBackup, verifyBackupIntegrity } from './backup-integrity.js'
import { previewRecurringEntries, postApprovedRecurringEntries } from './recurring-check.js'
import { recurringDatesForPlanInMonth, recurringFrequencyLabel, tokyoDateAt, WEEKDAYS_JA } from './recurring-posting.js'
import { recurringPlanNextStatus, recurringPlanNextLabel } from './recurring-next-status.js'
import { recurringReviewWindow, validRecurringMonth } from './recurring-review-window.js'
import { nextCivilDay } from './stats-period-comparison.js'
import { countReceiptImages, clearAllReceiptImages, deleteReceiptImagesByIds, listReceiptImagesForExport, getReceiptImage, saveReceiptImage } from './receipt-store.js'
import { planReceiptPeriodDeletion } from './receipt-period.js'
import { receiptZip, ledgerAndReceiptsZip } from './receipt-export.js'
import { listR2Receipts, getR2Receipt, uploadR2Receipt, deleteR2ReceiptsByIds, retryDeletedReceiptCleanup, receiptInventory, listReceiptsForBackup } from './receipt-cloud.js'
import { migrateLegacyReceipts } from './receipt-migration.js'
import { readCompleteBackupZip } from './receipt-import.js'
import { planReceiptRestoration } from './receipt-restore-plan.js'
const props = defineProps({ cardSettingsRequest: { type: Number, default: 0 }, active: { type: Boolean, default: false }, ledgerRevision: { type: Number, default: 0 }, api: { type: Function, required: true }, categories: { type: Array, default: () => [] }, categoryDisplayNames: { type: Object, default: () => ({}) }, paymentSources: { type: Array, default: () => [] }, paymentClosingDays: { type: Object, default: () => ({}) }, paymentSourceMeta: { type: Object, default: () => ({}) }, defaultPaymentSource: { type: String, default: '' }, merchantPaymentRules: { type: Array, default: () => [] }, categoryRules: { type: Array, default: () => [] }, rememberDevice: { type: Boolean, default: true } })
const emit = defineEmits(['ledger-updated', 'update-payment-sources', 'open-duplicate', 'open-card-bill-details', 'set-default-payment-source', 'settings-changed', 'merchant-rules-changed', 'payment-settings-refresh', 'change-remember-device', 'receipt-images-cleared', 'receipt-images-removed', 'receipt-images-updated'])

const orderedCategories = computed(() => sortOtherLast(props.categories))
const orderedPayments = computed(() => sortOtherLast(props.paymentSources))
const archivedPaymentSources = computed(() => sortOtherLast(Object.values(props.paymentSourceMeta)
  .filter(card=>Boolean(card.is_archived)).map(card=>card.name)))
const isCreditCard = name => !!name && !['現金','その他','其他'].includes(name) && props.paymentSourceMeta[name]?.source_type === 'standard'
// Archived cards remain selectable for viewing their historical saved bills.
const creditCardSources = computed(() => sortOtherLast([...orderedPayments.value,
  ...archivedPaymentSources.value].filter(isCreditCard)))
const managementTab = ref('cards')
const appContext = inject('kakeibo-page-context', null)
const investmentRefreshKey = ref(0)
const refreshingEverything = ref(false)
async function refreshEverything() {
  if (busy.value || refreshingEverything.value) return
  refreshingEverything.value = true
  try {
    // Fetch the Worker-maintained transfer status before the ledger snapshot.
    // This refresh is read-only and never books a transfer on page entry.
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
const deviceReceiptCount = ref(null)
const receiptStorageBytes = ref(null)
const receiptMigrationStatus = ref('')
const receiptImagesBusy = ref(false)
const receiptCleanupCursor = ref(0)
const receiptCleanupBusy = ref(false)
const receiptImagePrivacyMessage = ref('')
async function checkPreviouslyDeletedImages(){
  if(receiptCleanupBusy.value || receiptImagesBusy.value || receiptPeriodBusy.value)return
  receiptCleanupBusy.value=true
  try{
    const result=await retryDeletedReceiptCleanup(receiptCleanupCursor.value)
    if(!result?.ok || !Number.isSafeInteger(result.checked))throw Error('結果を確認できません')
    receiptCleanupCursor.value=result.nextCursor||0
    receiptImagePrivacyMessage.value=result.nextCursor
      ? '削除済み画像 '+result.checked+'件を再確認しました。続きも確認できます。'
      : '削除済み画像の再確認が完了しました。'
  }catch(error){
    receiptImagePrivacyMessage.value='画像の再確認ができません：'+error.message
  }finally{receiptCleanupBusy.value=false}
}
const receiptExportMessage = ref('')
const receiptBatchCursor=ref(0)
const receiptPeriodExportCursor=ref(0)
const RECEIPTS_PER_ZIP=200
async function saveReceiptZipChunk(ids,filename){
  const rows=await listReceiptsForBackup(await listReceiptImagesForExport(),{ids})
  if(rows.length!==ids.length)throw Error('画像の件数が変わりました。もう一度確認してください')
  const blob=await receiptZip(rows)
  const url=URL.createObjectURL(blob),a=document.createElement('a')
  a.href=url;a.download=filename
  document.body.appendChild(a);a.click();a.remove()
  setTimeout(()=>URL.revokeObjectURL(url),60000)
}
async function refreshLocalReceiptCount() {
  if (receiptImagesBusy.value) return
  receiptImagesBusy.value = true
  try {
    const inventory=await receiptInventory(await listReceiptImagesForExport(),{fresh:true})
    localReceiptCount.value = inventory.length
    deviceReceiptCount.value = inventory.filter(item=>item.local).length
    receiptStorageBytes.value = inventory.reduce((sum,item)=>sum+Number(item.size||0),0)
    receiptImagePrivacyMessage.value = ''
  } catch (e) {
    localReceiptCount.value = null
    receiptImagePrivacyMessage.value = '画像の件数を確認できません：' + e.message
  } finally { receiptImagesBusy.value = false }
}
async function downloadReceiptImages(){
  if(receiptImagesBusy.value||receiptPeriodBusy.value)return
  receiptImagesBusy.value=true
  try{
    const inventory=await receiptInventory(await listReceiptImagesForExport(),{fresh:true})
    const ids=inventory.map(x=>x.entryId).sort((a,b)=>a-b)
    if(!ids.length){receiptExportMessage.value='保存対象のレシート画像はありません';return}
    let chunk=ids.filter(id=>id>receiptBatchCursor.value).slice(0,RECEIPTS_PER_ZIP)
    if(!chunk.length){receiptBatchCursor.value=0;chunk=ids.slice(0,RECEIPTS_PER_ZIP)}
    await saveReceiptZipChunk(chunk,'kakeibo-receipts-'+chunk[0]+'-'+chunk.at(-1)+'.zip')
    const finished=ids.at(-1)<=chunk.at(-1)
    receiptBatchCursor.value=finished?0:chunk.at(-1)
    receiptExportMessage.value=chunk.length+'件の画像をZIP保存しました（全'+ids.length+'件）。'+
      (finished?'全件の分割保存が完了しました。':'次の画像ZIPも保存してください。')
  }catch(e){receiptExportMessage.value='画像の保存に失敗しました：'+e.message}
  finally{receiptImagesBusy.value=false}
}
async function clearLocalReceiptImages() {
  if (receiptImagesBusy.value || !localReceiptCount.value) return
  receiptImagesBusy.value = true
  try {
    const inventory=await receiptInventory(await listReceiptImagesForExport(),{fresh:true})
    const latest=inventory.length
    if (latest !== localReceiptCount.value) {
      localReceiptCount.value = latest
      receiptImagePrivacyMessage.value = '画像の件数が変わりました。再確認してください。'
      return
    }
    if (!latest) return
    if (!confirm('R2と端末のレシート画像 '+latest+
      '件を削除しますか？画像はZIPバックアップがないと復元できません。明細・SBI評価額は残ります。')) return
    // Cloud tombstones are committed before any device copy is erased.
    await deleteR2ReceiptsByIds(inventory.map(item=>item.entryId))
    await clearAllReceiptImages()
    localReceiptCount.value = 0
    deviceReceiptCount.value = 0
    receiptStorageBytes.value = 0
    receiptImagePrivacyMessage.value = 'R2と端末の画像を削除しました（明細は保持）'
    emit('receipt-images-cleared')
  } catch (e) {
    receiptImagePrivacyMessage.value = '画像の削除に失敗しました：' + e.message
  } finally {
    receiptImagesBusy.value = false
  }
}
async function syncLegacyReceiptImages() {
  if(receiptImagesBusy.value || receiptPeriodBusy.value)return
  receiptImagesBusy.value=true
  receiptMigrationStatus.value='端末の旧画像をR2へ同期しています'
  try{
    const result=await migrateLegacyReceipts()
    receiptMigrationStatus.value='同期 '+(result.migrated+result.removedAlreadyCloud)+'件 · 端末から削除 '+
      (result.migrated+result.removedAlreadyCloud+result.removedDeleted)+'件 · 未完了 '+(result.failed+result.conflicts)+'件'
  }catch(error){receiptMigrationStatus.value='同期できません：'+error.message}
  finally{
    receiptImagesBusy.value=false
    await refreshLocalReceiptCount()
    emit('receipt-images-updated')
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
const receiptPeriodYear = ref(new Intl.DateTimeFormat('en',{timeZone:'Asia/Tokyo',year:'numeric'}).format(new Date()))
const receiptPeriodMonth = ref('')
const receiptPeriodPreview = ref(null)
const receiptPeriodBusy = ref(false)
const receiptYearOptions = computed(() => [...new Set([
  receiptPeriodYear.value,
  ...rows.value.map(entry => String(entry.date || '').slice(0,4)),
  ...deletedEntries.value.map(entry => String(entry.date || '').slice(0,4))
].filter(year => /^\d{4}$/.test(year)))].sort((a,b)=>b.localeCompare(a)))
const receiptPeriodLabel = computed(() => receiptPeriodYear.value + '年' +
  (receiptPeriodMonth.value ? Number(receiptPeriodMonth.value) + '月' : '全体'))
const receiptPeriodSize = bytes => bytes >= 1024*1024
  ? (bytes/(1024*1024)).toFixed(2)+' MB'
  : (bytes/1024).toFixed(1)+' KB'
watch([receiptPeriodYear,receiptPeriodMonth],()=>{
  receiptPeriodPreview.value=null
  receiptPeriodExportCursor.value=0
})
async function downloadSelectedReceiptPeriod(){
  if(receiptImagesBusy.value||receiptPeriodBusy.value||busy.value)return
  receiptImagesBusy.value=true
  try{
    const plan=await freshReceiptPeriodPlan()
    let chunk=plan.ids.filter(id=>id>receiptPeriodExportCursor.value).slice(0,RECEIPTS_PER_ZIP)
    if(!chunk.length){receiptPeriodExportCursor.value=0;chunk=plan.ids.slice(0,RECEIPTS_PER_ZIP)}
    if(!chunk.length){receiptExportMessage.value='選択期間に該当する画像はありません';return}
    await saveReceiptZipChunk(chunk,'kakeibo-receipts-'+receiptPeriodYear.value+
      (receiptPeriodMonth.value?'-'+receiptPeriodMonth.value:'')+'-'+chunk[0]+'-'+chunk.at(-1)+'.zip')
    const done=plan.ids.at(-1)<=chunk.at(-1)
    receiptPeriodExportCursor.value=done?0:chunk.at(-1)
    receiptExportMessage.value=receiptPeriodLabel.value+'：'+chunk.length+'件をZIP保存（対象'+plan.ids.length+
      '件）。'+(done?'この期間の保存が完了しました。':'次のZIPも保存してください。')+
      (plan.unmatched?' 日付未確認の画像は「全画像を分割ZIP保存」で保存してください。':'')
  }catch(e){receiptExportMessage.value='期間指定の画像ZIP保存に失敗しました：'+e.message}
  finally{receiptImagesBusy.value=false}
}
async function freshReceiptPeriodPlan() {
  // Reload all dated rows rather than trusting a stale management-page snapshot.
  if (!(await loadAll())) throw Error('全明細を更新できません。通信を確認してください')
  const [trash,images] = await Promise.all([
    props.api('trash-items?full=1'),receiptInventory(await listReceiptImagesForExport(),{fresh:true})
  ])
  if (!Array.isArray(trash) || trash.length >= 10000)
    throw Error('削除済み明細の確認が完了しませんでした')
  return planReceiptPeriodDeletion(images,rows.value,trash,receiptPeriodYear.value,receiptPeriodMonth.value)
}
async function previewReceiptPeriodDeletion() {
  if (receiptPeriodBusy.value || receiptImagesBusy.value || busy.value) return
  receiptPeriodBusy.value=true
  receiptPeriodPreview.value=null
  receiptImagePrivacyMessage.value=''
  try {
    const year=receiptPeriodYear.value,month=receiptPeriodMonth.value
    const planned=await freshReceiptPeriodPlan()
    // Selection may change while data is loading.
    if(year!==receiptPeriodYear.value || month!==receiptPeriodMonth.value)return
    receiptPeriodPreview.value={...planned,year,month}
    if(!planned.ids.length)
      receiptImagePrivacyMessage.value='選択期間に該当する画像はありません'
  } catch(e) {
    receiptImagePrivacyMessage.value='削除対象を確認できません：'+e.message
  } finally { receiptPeriodBusy.value=false }
}
async function deleteSelectedReceiptPeriod() {
  const preview=receiptPeriodPreview.value
  if (!preview?.ids?.length || receiptPeriodBusy.value || receiptImagesBusy.value || busy.value) return
  if(preview.year!==receiptPeriodYear.value || preview.month!==receiptPeriodMonth.value)return
  receiptPeriodBusy.value=true
  receiptImagePrivacyMessage.value=''
  try {
    const fresh=await freshReceiptPeriodPlan()
    if (preview.year!==receiptPeriodYear.value || preview.month!==receiptPeriodMonth.value) return
    if (JSON.stringify(preview.ids)!==JSON.stringify(fresh.ids) || preview.bytes!==fresh.bytes ||
        preview.unmatched!==fresh.unmatched || preview.unknownSizes!==fresh.unknownSizes) {
      receiptPeriodPreview.value={...fresh,year:preview.year,month:preview.month}
      receiptImagePrivacyMessage.value='画像または明細が変更されました。対象を再確認してください'
      return
    }
    if(!confirm(receiptPeriodLabel.value+'のレシート画像 '+fresh.ids.length+'件（'+
      (fresh.unknownSizes ? '一部の画像サイズは未取得' : '約'+receiptPeriodSize(fresh.bytes))+
      '）を削除しますか？削除後はZIPバックアップがないと復元できません。記帳済み明細・回収箱・統計は残ります。'))return
    // Server commits deletion markers first, so another device cannot re-upload stale photos.
    await deleteR2ReceiptsByIds(fresh.ids)
    await deleteReceiptImagesByIds(fresh.ids)
    const inventory=await receiptInventory(await listReceiptImagesForExport(),{fresh:true})
    localReceiptCount.value=inventory.length
    deviceReceiptCount.value=inventory.filter(item=>item.local).length
    receiptStorageBytes.value=inventory.reduce((sum,item)=>sum+Number(item.size||0),0)
    receiptPeriodPreview.value=null
    receiptImagePrivacyMessage.value=receiptPeriodLabel.value+'の画像 '+fresh.ids.length+'件を削除しました（記帳明細は保持）'
    emit('receipt-images-removed',fresh.ids)
  } catch(e) {
    receiptPeriodPreview.value=null
    receiptImagePrivacyMessage.value='期間指定の削除に失敗しました：'+e.message
  } finally { receiptPeriodBusy.value=false }
}
watch(() => props.rememberDevice, () => {
  if(props.active && managementTab.value==='tools')void refreshLocalReceiptCount()
})

const cardMode = ref('')
watch(()=>props.cardSettingsRequest,()=>{managementTab.value='cards';cardMode.value='add'})
const selectedCard = ref('')
const cardMessage = ref('')
const closingDays = computed(() => props.paymentClosingDays)
const defaultClosingDay = name => {
  const normalized = String(name || '').normalize('NFKC').toLowerCase().replace(/[\s　・（）()_-]/g, '')
  if (/セゾン|saison/.test(normalized)) return '10'
  if (/セブンカード|7card/.test(normalized)) return '15'
  return '末日'
}
const closingDayFor = name => closingDays.value[name] === 0 ? '末日' : closingDays.value[name] == null ? defaultClosingDay(name) : String(closingDays.value[name])
function selectCardForEdit() {
  if(!selectedCard.value||busy.value)return
  cardMode.value='edit'
}
watch(selectedCard,()=>{cardMessage.value=''},{flush:'sync'})
const cardPeriod = computed(() => {
  if (!isCreditCard(bill.value.name)) return null
  return billingPeriodForMonth(bill.value.month,closingDayFor(bill.value.name))
})
// A mobile draft is sent once. The edit endpoint commits card metadata and
// every linked historical reference in one guarded D1 transaction.
async function saveCardFromSheet(payload){
  if(busy.value)throw Error('別の処理が実行中です')
  const name=String(payload?.name||'').trim()
  const kind=payload?.sourceType,statGroup=payload?.statGroup
  if(!name||name.length>80||!['standard','prepaid'].includes(kind)||!['card','points'].includes(statGroup))
    throw Error('名称・種類・集計区分を確認してください')
  if(payload.mode==='add'){
    if(props.paymentSources.includes(name)||props.paymentSourceMeta[name])
      throw Error('同じ名前が登録されています')
    if(kind==='prepaid'&&['現金','その他','其他'].includes(name))
      throw Error('この名前はプリペイドに設定できません')
  }else if(payload.mode==='edit'){
    if(!selectedCard.value||selectedCard.value!==payload.oldName)throw Error('編集対象が変更されました')
    if(!props.paymentSourceMeta[selectedCard.value])throw Error('最新のカード設定を読み込んでください')
  }else throw Error('編集内容を確認してください')
  busy.value=true
  try{
    const currentName=selectedCard.value
    const response=await props.api(payload.mode==='add'?'payment-sources':'payment-sources/update',{
      method:'POST',body:JSON.stringify(payload)
    })
    if(!response?.ok)throw Error('保存結果を確認できません')
    // The backend already commits the rename and all foreign references; only
    // refresh the client snapshot and selection after that transaction succeeds.
    if(payload.mode==='edit'&&name!==currentName){
      rows.value=rows.value.map(row=>{
        const next={...row}
        if(next.payment_source===currentName)next.payment_source=name
        if(next.transfer_target==='prepaid:'+currentName){
          next.transfer_target='prepaid:'+name
          if(next.type==='transfer'&&String(next.client_request_id||'').startsWith('point_charge_')&&
            ['ポイント還元',currentName+'チャージ'].includes(next.merchant))
            next.merchant=name+'チャージ'
        }
        if(next.transfer_target==='credit:'+currentName)next.transfer_target='credit:'+name
        return next
      })
      if(bill.value.name===currentName)bill.value.name=name
    }
    selectedCard.value=name
    emit('payment-settings-refresh')
    emit('settings-changed')
    if(payload.mode==='edit')emit('ledger-updated')
    // A settings refresh failing after a successful write must not make the
    // user repeat a non-idempotent save.
    try{await loadFinanceSettings()}catch(e){loadError.value='カードは保存されましたが、関連データの更新に失敗しました：'+e.message}
    cardMessage.value=payload.mode==='add'?name+'を追加しました':name+'を更新しました'
    return response
  }finally{busy.value=false}
}
async function runCardDanger(action,name){
  if(busy.value||name!==selectedCard.value)throw Error('カードを再選択してください')
  if(!['archive','delete'].includes(action)||name==='現金'||(action==='archive'&&['その他','其他'].includes(name)))
    throw Error('この操作は利用できません')
  busy.value=true
  try{
    const url=action==='archive'?'payment-sources/archive':'payment-sources/remove'
    await props.api(url,{method:'POST',body:JSON.stringify(action==='archive'?{name,archived:true}:{name})})
    selectedCard.value=''
    emit('payment-settings-refresh')
    emit('settings-changed')
    cardMessage.value=name+(action==='archive'?'をアーカイブしました':'を完全削除しました')
  }finally{busy.value=false}
}
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
// Only explicit Save mutates remembered rules; reading/opening the sheet is local.
async function saveMerchantRule({keyword,oldCategory,oldPayment,category,paymentSource}){
  const original=merchantRulesCombined.value.find(item=>item.keyword===keyword)
  if(!original)throw Error('ルールが変更されています。一覧を更新してください')
  if(original.category!==oldCategory||original.payment_source!==oldPayment)
    throw Error('別の端末で変更されました。画面を更新してください')
  if(category && !props.categories.includes(category) && category!==original.category)
    throw Error('カテゴリを確認してください')
  if(paymentSource && !props.paymentSources.includes(paymentSource) && paymentSource!==original.payment_source)
    throw Error('支払方法を確認してください')
  let changed=false
  try{
    if(category!==original.category){
      if(category)await props.api('rules',{method:'POST',body:JSON.stringify({keyword,category})})
      else await props.api('custom-rules?keyword='+encodeURIComponent(keyword),{method:'DELETE'})
      changed=true
    }
    if(paymentSource!==original.payment_source){
      if(paymentSource)await props.api('merchant-payment-rules',{method:'POST',body:JSON.stringify({keyword,paymentSource})})
      else await props.api('merchant-payment-rules?keyword='+encodeURIComponent(keyword),{method:'DELETE'})
      changed=true
    }
    cardMessage.value='店舗ルールを更新しました'
  }finally{
    // A partial server success is refreshed too; keep the editor open on failure.
    if(changed)emit('merchant-rules-changed')
  }
}
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
    await props.api('payment-sources',{method:'POST',body:JSON.stringify({name,sourceType:newSourceType.value,statGroup:newStatGroup.value})})
    emit('payment-settings-refresh')
    newPaymentSource.value = ''
    newSourceType.value = 'standard'
    newStatGroup.value = 'card'
    cardMode.value = ''
    cardMessage.value = name + 'を追加しました'
  } catch(e) { cardMessage.value = 'カードを追加できませんでした：' + e.message }
  finally { busy.value = false }
}
async function archivePaymentSource(name, archived=true) {
  if(!name || busy.value)return
  if(archived && !confirm(name+'をアーカイブしますか？過去の明細・請求・残高は残り、いつでも復元できます。'))return
  busy.value=true
  try{
    await props.api('payment-sources/archive',{method:'POST',body:JSON.stringify({name,archived})})
    emit('payment-settings-refresh')
    emit('settings-changed')
    selectedCard.value=''
    cardMode.value=''
    cardMessage.value=name+(archived?'をアーカイブしました':'を復元しました')
  }catch(e){cardMessage.value=(archived?'アーカイブ':'復元')+'に失敗しました：'+e.message}
  finally{busy.value=false}
}
async function removePaymentSource(name) {
  if (name === '現金' || busy.value) return
  if (!confirm(name + 'を完全削除しますか？使用履歴のあるカードは削除できません。履歴を残す場合はアーカイブしてください。')) return
  busy.value = true
  try {
    await props.api('payment-sources/remove',{method:'POST',body:JSON.stringify({name})})
    emit('payment-settings-refresh')
    selectedCard.value = ''
    cardMode.value = ''
    cardMessage.value = name + 'を完全削除しました'
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
const backupReceiptImages = ref(new Map())
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
const recurringListShowAll = ref(false)
const expandedRecurringPlanId = ref('')
const activeRecurringPlans = computed(() => plans.value.filter(item => item.enabled))
const currentEligiblePlans = computed(() => activeRecurringPlans.value.filter(item =>
  validRecurringMonth(item.startMonth) && item.startMonth <= currentRecurringMonth()))
const recurringMonthlyTotal = computed(() => currentEligiblePlans.value.reduce((sum,item) => sum + Number(item.amount||0)*recurringDatesForPlanInMonth(item,currentRecurringMonth()).length,0))
const filteredRecurringPlans = computed(() => {
  const query = recurringListQuery.value.trim().toLocaleLowerCase('ja-JP')
  return plans.value.filter(item =>
    (recurringListFilter.value === 'all' || (recurringListFilter.value === 'active' ? item.enabled : !item.enabled)) &&
    (!query || String(item.name || '').toLocaleLowerCase('ja-JP').includes(query))
  )
})
const visibleRecurringPlans = computed(() => recurringListShowAll.value ? filteredRecurringPlans.value : filteredRecurringPlans.value.slice(0, 2))
watch([recurringListQuery, recurringListFilter], () => { recurringListShowAll.value = false })
function toggleRecurringPlanDetails(id) {
  expandedRecurringPlanId.value = expandedRecurringPlanId.value === id ? '' : id
}
const bills = ref([])
// D1 category_source owns both identifiers and displayed category names.
// Keep the management screen in sync with ledger/statistics without a second hard-coded map.
const categoryLabel = category => props.categoryDisplayNames[category] || category
const currentRecurringMonth = () => new Date().toLocaleDateString('sv-SE').slice(0,7)
const blankPlan = () => ({name:'',amount:'',day:1,weekday:1,weekdays:[1],monthDays:[1],intervalMonths:1,scheduleType:'monthly',category:'',paymentSource:'現金',startMonth:currentRecurringMonth(),postingMode:'manual'})
const plan = ref(blankPlan())
const planCycleChoice=computed({
  get(){
    if(plan.value.scheduleType==='weekly')return 'weekly'
    if(plan.value.scheduleType==='workday')return 'workday'
    return 'monthly-'+Number(plan.value.intervalMonths||1)
  },
  set(value){
    if(value==='weekly'||value==='workday'){plan.value.scheduleType=value;plan.value.intervalMonths=1}
    else if(/^monthly-(1|2|3|6|12)$/.test(value)){
      plan.value.scheduleType='monthly'
      plan.value.intervalMonths=Number(value.slice(8))
    }
  }
})
const planCycleOptions=[
  {value:'monthly-1',label:'毎月'},
  {value:'weekly',label:'毎週'},
  {value:'workday',label:'平日（土日祝を除く）'},
  {value:'monthly-2',label:'2か月ごと'},
  {value:'monthly-3',label:'3か月ごと'},
  {value:'monthly-6',label:'6か月ごと'},
  {value:'monthly-12',label:'毎年'}
]
const editingPlanId = ref('')
// Default to the earliest effective month among enabled plans, with an
// explicit 119-month safety limit. Manual lookback options remain available.
const recurringAutoWindow = computed(() => recurringReviewWindow(plans.value,currentRecurringMonth()))
const recurringPreview = ref([])
const recurringDueEntries = computed(() => recurringPreview.value.filter(row => !row.upcoming))
const recurringTomorrowEntries = computed(() => recurringPreview.value.filter(row => row.upcoming && !row.conflict))
const recurringSelected = ref(new Set())
const recurringExclusions = ref([])
const recurringExclusionsReady = ref(false)
const recurringClock = ref(Date.now())
// Reference the authoritative loaded D1 ledger, NOT the Cron registration time.
// The standalone historical review continues to handle earlier months.
const recurringStatusById = computed(() => {
  const clock=new Date(recurringClock.value + 9*60*60*1000)
  const afterAutoWindow=clock.getUTCHours()*60+clock.getUTCMinutes()>=9*60+30
  const today=tokyoDateAt(recurringClock.value)
  return new Map(plans.value.map(item=>[item.id, !item.enabled
    ? {state:'stopped',date:null}
    : loaded.value && settingsReady.value && recurringExclusionsReady.value
      ? recurringPlanNextStatus(item,rows.value,recurringExclusions.value,{today,afterAutoWindow})
      : {state:'unknown',date:null}
  ]))
})
const recurringStatusFor = item => recurringStatusById.value.get(item.id)||{state:'unknown',date:null}
const recurringListOpen = ref(false)
const recurringSwipeOpenKey = ref('')
let recurringTouchStart = null
const recurringExcludedRows = computed(() => recurringExclusions.value.map(item => ({
  ...item,name:plans.value.find(plan => plan.id === item.planId)?.name ||
    trashedRecurringPlans.value.find(plan => plan.id === item.planId)?.name || '固定費'
})))
const recurringKey = row => row.planId + ':' + (row.date && (row.perDate||row.scheduleType!=='monthly'||!('scheduleType' in row)) ? row.date : row.month)
const selectedRecurring = computed(() => recurringDueEntries.value.filter(row => !row.conflict && recurringSelected.value.has(recurringKey(row))))
function toggleRecurringSelection(row, checked) {
  const next = new Set(recurringSelected.value)
  if (checked && !row.conflict && !row.upcoming) next.add(recurringKey(row))
  else next.delete(recurringKey(row))
  recurringSelected.value = next
}
const recurringPreviewTotal = computed(() => selectedRecurring.value.reduce((sum,row) => sum + row.amount,0))
function beginEditPlan(item) {
  editingPlanId.value = item.id
  plan.value = {...item, paymentSource:item.paymentSource || '現金',startMonth:item.startMonth || currentRecurringMonth(),
    postingMode:item.postingMode || 'manual',scheduleType:item.scheduleType||'monthly',weekday:Number(item.weekday??1),
    weekdays:Array.isArray(item.weekdays)&&item.weekdays.length?[...item.weekdays]:[Number(item.weekday??1)],
    monthDays:Array.isArray(item.monthDays)&&item.monthDays.length?[...item.monthDays]:[Number(item.day??1)],
    intervalMonths:Number(item.intervalMonths||1)}
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
const jobHealth=ref([])
const jobHealthLoaded=ref(false)
const jobHealthBusy=ref(false)
const jobHealthError=ref('')
const jobNames={recurring:'固定費自動記帳',sbi:'SBI積立振替',nav:'投信基準価額更新'}
const jobHealthDisplay=computed(()=>Object.keys(jobNames).map(job=>
  jobHealth.value.find(row=>row.job===job) || {job,status:'missing'}))
async function loadJobHealth() {
  if(jobHealthBusy.value)return
  jobHealthBusy.value=true;jobHealthError.value=''
  try {
    const result=await props.api('job-health')
    if(!Array.isArray(result))throw Error('応答形式を確認してください')
    jobHealth.value=result
    jobHealthLoaded.value=true
  }catch(e){jobHealthLoaded.value=false;jobHealthError.value='実行履歴を取得できません：'+e.message}
  finally{jobHealthBusy.value=false}
}
function jobHealthText(row) {
  if(!row?.scheduledAt)return '実行記録なし（初回実行後に確認してください）'
  const state=row?.status==='failed'?'失敗':row?.status==='skipped'?'休場日のため対象外':'成功'
  const when=row?.scheduledAt ? new Date(row.scheduledAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}) : '日時不明'
  return when+' · '+state
}
async function loadFinanceSettings() {
  const [loadedPlans,loadedBills] = await Promise.all([props.api('recurring-plans'),props.api('card-bills?fresh=1')])
  if (!Array.isArray(loadedPlans) || !Array.isArray(loadedBills)) throw Error('保存データの形式が不正です')
  plans.value = loadedPlans
  bills.value = loadedBills
  // Keep card settings usable if the additive exclusion table is not yet migrated.
  try {
    const excluded=await props.api('recurring-exclusions')
    if(!Array.isArray(excluded))throw Error('除外設定の形式が不正です')
    recurringExclusions.value=excluded
    recurringExclusionsReady.value=true
  } catch(e) {
    recurringExclusionsReady.value=false
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
// A single sealed backup builder is shared by JSON and full ZIP.
 // Archives over 10,000 rows use the existing twice-verified cursor export
 // instead of failing at the small server-snapshot threshold.
async function createVerifiedLedgerBackup(){
  let atomicBackup=null
  try{atomicBackup=await props.api('backup-snapshot')}
  catch(e){if(!/snapshot_too_large|大容量|413/.test(String(e.message)))throw e}
  if(atomicBackup)return sealBackup(validateBackup(atomicBackup))
    // Refresh ledger and D1 metadata immediately before export. A partial fetch
    // must not be mistaken for a complete, safe recovery archive.
    if (!(await loadAll())) throw Error('明細がすべて取得できなかったため、バックアップを中止しました')
    const snapshot = rows.value.map(row=>({...row}))
    const before = ledgerFingerprint(snapshot)
    const [nextPlans,nextBills,paymentSources,merchantPaymentRules,customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata,portfolio,recurringExclusionsBackup,archivedPlansBackup,trashedEntriesBackup,mergedRules] = await Promise.all([
      props.api('recurring-plans'),props.api('card-bills'),
      props.api('payment-sources'),props.api('merchant-payment-rules'),props.api('custom-rules'),
      props.api('categories'),props.api('category-icons'),props.api('dismissed-transfer-reminders'),props.api('category-source'),exportPortfolioSafely(),props.api('recurring-exclusions'),props.api('recurring-plans?trash=1'),props.api('trash-items?full=1'),props.api('rules')
    ])
    // Reject mixed-time exports when another device edited the ledger during metadata reads.
    if (!(await loadAll()) || ledgerFingerprint(rows.value)!==before)
      throw Error('明細がバックアップ作成中に変更されました。もう一度実行してください')
    // Settings have their own write APIs. Read a second time to avoid exporting
    // a mixed ledger/setting revision; a true cross-table snapshot still needs D1.
    const currentSettings = await Promise.all([
      props.api('recurring-plans'),props.api('card-bills'),
      props.api('payment-sources'),props.api('merchant-payment-rules'),props.api('custom-rules'),
      props.api('categories'),props.api('category-icons'),props.api('dismissed-transfer-reminders'),props.api('category-source'),exportPortfolioSafely(),props.api('recurring-exclusions'),props.api('recurring-plans?trash=1'),props.api('trash-items?full=1'),props.api('rules')
    ])
    if (JSON.stringify(currentSettings) !== JSON.stringify([
      nextPlans,nextBills,paymentSources,merchantPaymentRules,
      customRules,categories,categoryIcons,dismissedTransfers,categoryMetadata,portfolio,recurringExclusionsBackup,archivedPlansBackup,trashedEntriesBackup,mergedRules
    ])) throw Error('設定がバックアップ中に変更されました。もう一度実行してください')
    const data = validateBackup({
      format:'kakeibo-ledger-backup',version:backupVersion,exportedAt:new Date().toISOString(),
      entries:snapshot,plans:nextPlans,bills:nextBills,
      paymentSources,merchantPaymentRules,customRules,defaultRules:mergedRules.filter(rule=>rule.is_custom===false).map(({keyword,category})=>({keyword,category})),categories,categoryIcons,dismissedTransfers,categoryMetadata,recurringExclusions:recurringExclusionsBackup.filter(row=>!row.date),recurringDateExclusions:recurringExclusionsBackup.filter(row=>!!row.date).map(row=>({planId:row.planId,date:row.date})),archivedPlans:archivedPlansBackup.map(({archivedAt,...p})=>p),trashedEntries:trashedEntriesBackup,...portfolio
    })
  return sealBackup(data)
}
async function downloadBackup(){
  if(busy.value || backupBusy.value)return
  backupBusy.value=true
  try{
    const sealed=await createVerifiedLedgerBackup()
    const url=URL.createObjectURL(new Blob([JSON.stringify(sealed,null,2)],{type:'application/json'}))
    const a=document.createElement('a')
    a.href=url;a.download='kakeibo-ledger-settings-'+new Date().toISOString().slice(0,10)+'.json';a.click()
    setTimeout(()=>URL.revokeObjectURL(url),30000)
    message.value='帳簿と設定を保存しました'
  }catch(e){message.value='バックアップを作成できませんでした：'+e.message}
  finally{backupBusy.value=false}
}
// Optional single-file recovery bundle. Signed v4 JSON remains compatible
// with the existing restore dialog after extracting it from the ZIP.
// Receipt files are downloaded privately from R2 for ZIP; never upload photos to D1.
async function downloadFullBackup(){
  if(busy.value || backupBusy.value || receiptImagesBusy.value)return
  backupBusy.value=true
  try{
    const sealed=await createVerifiedLedgerBackup()
    const images=await listReceiptsForBackup(await listReceiptImagesForExport())
    const archive=await ledgerAndReceiptsZip(sealed,images)
    const url=URL.createObjectURL(archive),a=document.createElement('a')
    a.href=url;a.download='kakeibo-complete-backup-'+new Date().toISOString().slice(0,10)+'.zip'
    document.body.appendChild(a);a.click();a.remove()
    setTimeout(()=>URL.revokeObjectURL(url),60000)
    message.value='帳簿JSONとレシート画像 '+images.length+'件をZIP保存しました。このZIPはバックアップ選択画面から復元できます'
  }catch(e){
    message.value='一括ZIP保存に失敗しました：'+e.message+'。帳簿JSONを保存し、画像は200件ずつ分割ZIP保存してください'
  }finally{backupBusy.value=false}
}
async function preview(event){
  const file=event.target.files?.[0];event.target.value=''
  restoreRows.value=[];restoreConflicts.value=[];backupPreview.value=null;backupReceiptImages.value=new Map();restoreIncludeConflicts.value=false
  restoreOwnKeys.value=new Map()
  if(!file)return
  try{
    if(!loaded.value)throw Error('先に全明細を読み込んでください')
    const zipped=/\.zip$/i.test(file.name)
    if(file.size>(zipped?75:25)*1024*1024)throw Error('ファイルが大きすぎます')
    const selected=zipped?await readCompleteBackupZip(file):{ledger:JSON.parse(await file.text()),images:new Map()}
    const backup=validateBackup(selected.ledger)
    await verifyBackupIntegrity(backup)
    const result=prepareRestoreRows(rows.value,backup.entries)
    backupLedgerFingerprint.value=ledgerFingerprint(rows.value)
    restoreRows.value=result.newRows
    restoreConflicts.value=result.conflicts
    backupPreview.value=backup
    backupReceiptImages.value=selected.images
    const settingsCount=(backup.recurringExclusions?.length||0)+(backup.plans?.length||0)+(backup.archivedPlans?.length||0)+(backup.trashedEntries?.length||0)+(backup.bills?.length||0)+(backup.paymentSources?.length||0)+(backup.customRules?.length||0)
    message.value=backup.entries.length+'件 · 追加 '+restoreRows.value.length+'件 · 重複 '+restoreConflicts.value.length+'件 · 設定 '+settingsCount+'件 · 画像 '+selected.images.size+'件'
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
    paymentSources:[],merchantPaymentRules:[],customRules:[],defaultRules:[],categories:[],
    plans:[],archivedPlans:[],trashedEntries:[],bills:[],recurringExclusions:[],recurringDateExclusions:[],dismissedTransfers:[],categoryMetadata:[],
    investmentPlans:[],investmentPlanHistory:[],investmentHoldings:[],
    fundPrices:[],transferLinks:[],categoryIcons:{}
  }
  // Compute cross-batch relationships BEFORE writing the first D1 batch.
  // A partial selection must not strand a generated point-charge record.
  let preparedRows
  try {
    preparedRows=await prepareLinkedRestoreRows(selectedRows,backup.entries,rows.value,
      [...(backup.plans||[]),...(backup.archivedPlans||[])])
  }catch(e){message.value='復元の関連付けを確認してください：'+e.message;return}
  const preparedByIndex=new Map(preparedRows.map(e=>[e.backupIndex,e]))
  const makeRestoreRow=e=>{
    const row=preparedByIndex.get(e.backupIndex)
    if(!row)throw Error('復元元の明細を確認してください')
    restoreOwnKeys.value=new Map([...restoreOwnKeys.value,[row.clientRequestId,transactionKey(e)]])
    return row
  }
  busy.value=true
  let completed=0,settingsRestored=0,alreadyPresent=0,processed=0,archivedImported=0,archivedSkipped=0
  try{
    for(let i=0;i<jobs.length;i++){
      const job=jobs[i]
      const atomicRows=job.rows.map(makeRestoreRow)
      const deferredPrepaidEntries=job.deferred.map(makeRestoreRow)
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
      archivedImported+=Number(result.archivedImported||0)
      archivedSkipped+=Number(result.archivedSkipped||0)
      processed+=included.length
      const keys=new Set(included.map(e=>e.backupIndex))
      restoreRows.value=restoreRows.value.filter(row=>!keys.has(row.backupIndex))
      restoreConflicts.value=restoreConflicts.value.filter(row=>!keys.has(row.backupIndex))
      message.value=`復元中 ${processed}/${selectedRows.length}件・${i+1}/${jobs.length}回`
    }
    // D1 may assign entirely new numeric IDs to restored entries. Always
    // fetch authoritative rows before attaching any device-local photos.
    const images=backupReceiptImages.value
    let imageStatus=''
    busy.value=false
    if(images.size){
      if(await loadAll()){
        const planned=planReceiptRestoration(backup.entries,images,rows.value,preparedRows)
        let written=0,existing=0,failed=0
        const cloudIds=new Set((await listR2Receipts({fresh:true})).map(item=>item.entryId))
        for(const item of planned.items){
          try{
            if(cloudIds.has(item.id) || await getReceiptImage(item.id)){existing++;continue}
            await uploadR2Receipt(item.id,item.blob)
            written++
          }catch{failed++}
        }
        imageStatus=`・画像 ${written}件復元 / ${existing}件保存済み / ${planned.unmatched+failed}件未復元`
        await refreshLocalReceiptCount()
      }else imageStatus='・画像は明細再取得エラーのため未復元（ZIPを再選択してください）'
    }
    loaded.value=false;backupPreview.value=null;backupReceiptImages.value=new Map();restoreRows.value=[];restoreConflicts.value=[]
    restoreIncludeConflicts.value=false;restoreOwnKeys.value=new Map()
    message.value=`復元完了：明細 ${completed}件・設定 ${settingsRestored}件（重複除外 ${alreadyPresent}件）`+
      (archivedImported||archivedSkipped?`・ゴミ箱 ${archivedImported}件追加、${archivedSkipped}件は既存記録優先／重複除外`:'')+imageStatus
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
    !['monthly','weekly','workday'].includes(plan.value.scheduleType) ||
    ![1,2,3,6,12].includes(Number(plan.value.intervalMonths)) ||
    !Array.isArray(plan.value.weekdays) || !plan.value.weekdays.length ||
    plan.value.weekdays.some(x=>!Number.isInteger(x)||x<0||x>6) ||
    !Array.isArray(plan.value.monthDays) || !plan.value.monthDays.length ||
    plan.value.monthDays.some(x=>!Number.isInteger(x)||x<1||x>31) ||
    !validRecurringMonth(plan.value.startMonth) ||
    !props.categories.includes(plan.value.category) || !props.paymentSources.includes(plan.value.paymentSource)) {
    message.value='名称・金額・記帳日・開始月・カテゴリ・支払方法を確認してください';return
  }
  if(!settingsReady.value || recurringBusy.value)return
  recurringBusy.value=true
  try {
    const existing=plans.value.find(row=>row.id===editingPlanId.value)
    const item={...plan.value,id:existing?.id || crypto.randomUUID(),amount:Number(plan.value.amount),
      day:plan.value.monthDays[0],weekday:plan.value.weekdays[0],
      weekdays:[...new Set(plan.value.weekdays)].sort((a,b)=>a-b),
      monthDays:[...new Set(plan.value.monthDays)].sort((a,b)=>a-b),
      intervalMonths:Number(plan.value.intervalMonths),
      startMonth:plan.value.startMonth,enabled:existing ? !!existing.enabled : true,
      postingMode:plan.value.postingMode,scheduleType:plan.value.scheduleType}
    const updated=Boolean(existing)
    const saved=await props.api(updated?'recurring-plans/'+encodeURIComponent(item.id):'recurring-plans',
      {method:updated?'PUT':'POST',body:JSON.stringify(item)})
    if(!saved.ok)throw Error('保存処理を確認できませんでした')
    plans.value=await props.api('recurring-plans')
    cancelPlanEdit()
    recurringPreview.value=[]
    recurringSelected.value=new Set()
    recurringListOpen.value=false
    recurringMessage.value=updated?'固定費を更新しました':item.postingMode==='auto'?'固定費を登録しました。次回予定日から自動記帳します':'固定費を登録しました。記帳前に内容を確認してください'
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
    const preview=previewRecurringEntries(plans.value,rows.value,{
      historicalMonths:window.historicalMonths,excluded,previewDaysAhead:1
    }).filter(row=>!row.upcoming || !row.conflict)
    recurringPreview.value=preview
    recurringListOpen.value=true
    recurringSwipeOpenKey.value=''
    const current=currentRecurringMonth()
    const today=new Date().toLocaleDateString('sv-SE')
    const tomorrow=nextCivilDay(today)
    const due=preview.filter(row=>!row.upcoming)
    const upcoming=preview.filter(row=>row.date===tomorrow)
    recurringSelected.value=new Set(due.filter(row=>!row.conflict && row.month===current && row.date<=today).map(recurringKey))
    const conflicts=due.filter(x=>x.conflict).length
    const historical=due.filter(row=>row.month<current).length
    recurringMessage.value=preview.length
      ? '未記帳 '+due.length+'件 · 明日 '+upcoming.length+'件'+
        (conflicts?' · 重複 '+conflicts+'件':'')+
        (historical?' · 過去分は現在の設定金額による推定です':'')
      : '未記帳・明日の記帳予定はありません'
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
    const result=await props.api('recurring-exclusions',{method:'POST',body:JSON.stringify({planId:row.planId,month:row.month,...(row.perDate||row.scheduleType!=='monthly'?{date:row.date}:{})})})
    if(!result.ok)throw Error('除外できませんでした')
    const key=recurringKey(row)
    recurringExclusions.value=[...recurringExclusions.value.filter(item=>recurringKey(item)!==key),{planId:row.planId,month:row.month,...(row.perDate||row.scheduleType!=='monthly'?{date:row.date}:{})}]
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
    recurringMessage.value=row.name+'（'+row.date+'）を候補から除外しました'
  }catch(e){recurringMessage.value='候補を除外できませんでした：'+e.message}
  finally{recurringBusy.value=false}
}
async function restoreRecurringExclusion(item) {
  if(recurringBusy.value)return
  recurringBusy.value=true
  try {
    const result=await props.api('recurring-exclusions',{method:'DELETE',body:JSON.stringify({planId:item.planId,month:item.month,...(item.date?{date:item.date}:{})})})
    if(!result.ok)throw Error('解除できませんでした')
    recurringExclusions.value=recurringExclusions.value.filter(row=>recurringKey(row)!==recurringKey(item))
    if(recurringListOpen.value) {
      const window=recurringReviewWindow(plans.value,currentRecurringMonth())
      recurringPreview.value=previewRecurringEntries(plans.value,rows.value,{historicalMonths:window.historicalMonths,excluded:recurringExclusions.value,previewDaysAhead:1}).filter(row=>!row.upcoming || !row.conflict)
    }
    recurringMessage.value='除外を解除しました：'+(item.date||item.month)
  }catch(e){recurringMessage.value='除外を解除できませんでした：'+e.message}
  finally{recurringBusy.value=false}
}
async function applyRecurring(){
  if(recurringBusy.value || !loaded.value || !recurringDueEntries.value.length)return
  const today=new Date().toLocaleDateString('sv-SE')
  const safe=selectedRecurring.value.filter(row=>row.date<=today)
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
// A foreground visit gets a fresh D1 status after the existing five-minute
// cache expires; the minute tick changes labels without repeatedly reading D1.
let recurringClockTimer=null
let recurringStatusRefresh=null
function refreshRecurringStatus(force=false) {
  const previous=recurringClock.value
  const now=Date.now()
  recurringClock.value=now
  if(!props.active || managementTab.value!=='plans')return
  if(!financeInitialized || !loaded.value)return void initializeFinance()
  const dateChanged=tokyoDateAt(previous)!==tokyoDateAt(now)
  const wasAfter=new Date(previous+9*3600000).getUTCHours()*60+
    new Date(previous+9*3600000).getUTCMinutes()>=570
  const isAfter=new Date(now+9*3600000).getUTCHours()*60+
    new Date(now+9*3600000).getUTCMinutes()>=570
  const stale=ledgerDirty || !lastLoadedAt.value ||
    now-lastLoadedAt.value.getTime()>=MANAGEMENT_LEDGER_TTL_MS
  if(!dateChanged && !(wasAfter!==isAfter) && !(force&&stale))return
  if(recurringStatusRefresh || busy.value)return
  recurringStatusRefresh=(async()=>{
    if(dateChanged || (force&&stale))await loadFinanceSettings()
    await loadAll()
  })().catch(e=>{loadError.value='固定費の状態を更新できませんでした：'+e.message})
    .finally(()=>{recurringStatusRefresh=null})
}
function onRecurringVisibilityChange() {
  if(document.visibilityState==='visible')refreshRecurringStatus(true)
}
onMounted(() => { if (props.active) void initializeFinance() })
onMounted(() => {
  recurringClockTimer=setInterval(()=>refreshRecurringStatus(),60*1000)
  document.addEventListener('visibilitychange',onRecurringVisibilityChange)
})
onUnmounted(() => {
  if(recurringClockTimer!==null)clearInterval(recurringClockTimer)
  document.removeEventListener('visibilitychange',onRecurringVisibilityChange)
})
watch([()=>props.active,managementTab],([active,tab])=>{
  if(active && tab==='plans')refreshRecurringStatus(true)
})
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
const cardTotal=computed(()=>Math.max(0,cardTransactions.value.reduce((sum,e)=>sum+cardBilledAmount(e),0)))
const selectedSavedBill = computed(() => isCreditCard(bill.value.name) ? bills.value.find(record => record.name === bill.value.name && record.month === bill.value.month) || null : null)
const savedBillDifference = computed(() => selectedSavedBill.value
  ? Number(selectedSavedBill.value.currentTotal ?? cardTotal.value)-Number(selectedSavedBill.value.total) : null)
const selectedSavedBillStale = computed(() => !!selectedSavedBill.value &&
  (selectedSavedBill.value.stale ||
    selectedSavedBill.value.start !== cardPeriod.value?.start ||
    selectedSavedBill.value.end !== cardPeriod.value?.end))
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
      <MobileChoiceSheet v-model="selectedCard" :disabled="busy" label="管理するカード" :options="[{value:'',label:'支払方法・カードを選択'},...orderedPayments.map(source=>({value:source,label:source})),...(selectedCard&&!orderedPayments.includes(selectedCard)?[{value:selectedCard,label:selectedCard}]:[])]" />
      <button type="button" class="card-icon-action" :disabled="!selectedCard || selectedCard === defaultPaymentSource" @click="emit('set-default-payment-source', selectedCard)" aria-label="デフォルトに設定" title="デフォルトに設定"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z"/></svg></button>
      <button type="button" class="card-icon-action" :disabled="!selectedCard" @click="selectCardForEdit" aria-label="カードを編集" title="カードを編集"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4L16.5 4.5Z"/></svg></button>
      <button type="button" class="card-icon-action" @click="cardMode = 'add'" aria-label="カードを追加" title="カードを追加"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
    </div>
    <p v-if="defaultPaymentSource">デフォルト：{{ defaultPaymentSource }}</p>
    <MobileCardEditorSheet :mode="cardMode" :card-name="selectedCard"
      :card="paymentSourceMeta[selectedCard]||null" :closing-day="closingDayFor(selectedCard)"
      :payment-sources="paymentSources" :busy="busy" :on-save="saveCardFromSheet"
      :on-danger="runCardDanger" @close="cardMode=''" />
    <details v-if="archivedPaymentSources.length" class="card-archive-disclosure">
      <summary>アーカイブ済みのカード <strong>{{archivedPaymentSources.length}}件</strong></summary>
      <p class="card-type-hint">新しい記帳には表示しません。過去の明細、請求、プリペイド残高はそのまま残ります。</p>
      <div v-for="name in archivedPaymentSources" :key="name" class="card-archived-item">
        <span>{{name}} <small>（{{props.paymentSourceMeta[name]?.source_type==='prepaid'?'プリペイド':'カード'}}）</small></span>
        <div class="card-archive-actions">
          <button type="button" :disabled="busy" @click="archivePaymentSource(name,false)">復元</button>
          <button type="button" :disabled="busy" @click="removePaymentSource(name)">完全削除</button>
        </div>
      </div>
    </details>
  </article>
  <MobileMerchantRulesPanel v-if="managementTab === 'tools'"
    :rules="merchantRulesCombined" :categories="orderedCategories"
    :payment-sources="orderedPayments" :category-label="categoryLabel" :on-save="saveMerchantRule" />
  <article v-show="managementTab === 'plans'" class="finance-panel recurring-manager-panel">
    <h2>固定費の設定</h2>
    <div class="recurring-form-layout">
      <label class="recurring-form-field recurring-form-name"><span>名称</span><input v-model="plan.name" placeholder="例：家賃" aria-label="固定費名" maxlength="120" /></label>
      <div class="recurring-form-field recurring-form-amount"><span>金額</span><AmountInput v-model="plan.amount" input-label="固定費額（円）" /></div>
      <div class="recurring-form-field recurring-form-schedule">
        <span>周期</span>
        <MobileChoiceSheet v-model="planCycleChoice" label="記帳周期" :searchable="false" :options="planCycleOptions" />
      </div>
      <div v-if="plan.scheduleType==='monthly'" class="recurring-form-field recurring-form-schedule">
        <span>{{plan.intervalMonths===12?'毎年の記帳日':'記帳日（複数選択可）'}}</span>
        <MobileMultiChoiceSheet v-model="plan.monthDays" label="記帳する日付" :columns="5"
          :options="Array.from({length:31},(_,i)=>({value:i+1,label:(i+1)+'日'}))" />
        <small v-if="plan.intervalMonths>1">開始月を基準に{{plan.intervalMonths}}か月ごとに記帳します。</small>
      </div>
      <div v-else-if="plan.scheduleType==='weekly'" class="recurring-form-field recurring-form-schedule">
        <span>曜日（複数選択可）</span>
        <MobileMultiChoiceSheet v-model="plan.weekdays" label="記帳する曜日" :columns="4"
          :options="WEEKDAYS_JA.map((name,index)=>({value:index,label:name+'曜日'}))" />
      </div>
      <label class="recurring-form-field"><span>カテゴリ</span><MobileChoiceSheet v-model="plan.category" label="固定費カテゴリ" :options="[{value:'',label:'選択してください'},...orderedCategories.map(category=>({value:category,label:categoryLabel(category)}))]" /></label>
      <label class="recurring-form-field"><span>支払方法</span><MobileChoiceSheet v-model="plan.paymentSource" label="固定費支払方法" :options="[...orderedPayments.map(source=>({value:source,label:source})),...(plan.paymentSource && !props.paymentSources.includes(plan.paymentSource)?[{value:plan.paymentSource,label:plan.paymentSource+'（既存の設定）'}]:[])]" /></label>
      <label class="recurring-form-field recurring-start-month"><span>開始月</span><input v-model="plan.startMonth" type="month" aria-label="固定費の適用開始月" /></label>
    </div>
    <fieldset class="recurring-posting-mode">
      <legend>記帳方法</legend>
      <label :class="{selected:plan.postingMode==='auto'}"><input v-model="plan.postingMode" type="radio" value="auto" name="recurring-posting-mode" /><span>自動記帳</span></label>
      <label :class="{selected:plan.postingMode==='manual'}"><input v-model="plan.postingMode" type="radio" value="manual" name="recurring-posting-mode" /><span>確認して記帳</span></label>
    </fieldset>
    <p class="recurring-posting-hint">{{plan.postingMode==='auto' ? (plan.scheduleType==='workday'?'土日・祝日を除く日に、自動で支出明細に登録します。':recurringFrequencyLabel(plan)+'になると、自動で支出明細に登録します。') : '予定日以降、内容を確認してから支出明細に登録します。'}}</p>
    <div class="finance-actions recurring-save-actions"><button type="button" @click="addPlan" :disabled="recurringBusy || !settingsReady">{{editingPlanId ? '変更を保存' : '固定費を登録'}}</button>
    <button v-if="editingPlanId" type="button" :disabled="recurringBusy" @click="cancelPlanEdit">編集をやめる</button></div>
  </article>
  <article v-show="managementTab === 'plans'" class="finance-panel recurring-review-panel" :class="{ 'is-expanded': recurringListOpen }" aria-label="固定費の記帳確認">
      <div class="recurring-review-heading">
        <div>
          <h3>記帳の確認</h3>
          <p>過去分・明日の予定</p>
        </div>
      </div>
      <p v-if="recurringAutoWindow.clipped" class="recurring-window-note">過去分は直近10年まで確認します。</p>
      <div class="finance-actions recurring-review-actions" :class="{'has-preview':recurringListOpen && recurringDueEntries.length > 0}">
        <button type="button" :disabled="recurringBusy || (!recurringListOpen && (!settingsReady || !loaded))" :aria-expanded="recurringListOpen" aria-controls="recurring-candidate-list" @click="reviewRecurring">{{recurringListOpen ? '候補を閉じる' : '未記帳分を確認'}}</button>
        <button v-if="recurringListOpen && recurringDueEntries.length" type="button" :disabled="recurringBusy || !selectedRecurring.length" @click="applyRecurring">選択した{{selectedRecurring.length}}件を登録</button>
      </div>
      <div v-if="recurringListOpen" id="recurring-candidate-list" class="recurring-review-results">
        <section v-if="recurringTomorrowEntries.length" class="recurring-review-group recurring-review-upcoming" aria-label="明日の記帳予定">
          <div class="recurring-review-group-heading">
            <div><h4>明日の記帳予定</h4><p>前日から除外できます。記帳は予定日以降。</p></div>
            <span class="recurring-review-count">{{recurringTomorrowEntries.length}}件</span>
          </div>
          <div class="recurring-upcoming-list">
            <div v-for="candidate in recurringTomorrowEntries" :key="recurringKey(candidate)" class="recurring-upcoming-item">
              <div class="recurring-upcoming-details">
                <strong class="recurring-candidate-name">{{candidate.name}}</strong>
                <span class="recurring-candidate-date">{{candidate.date}} · {{plans.find(p=>p.id===candidate.planId)?.postingMode==='auto' ? '自動記帳' : '確認して記帳'}}</span>
              </div>
              <strong class="recurring-candidate-amount">{{yen(candidate.amount)}}</strong>
              <button type="button" class="recurring-upcoming-skip" :disabled="recurringBusy" :aria-label="candidate.name+' '+candidate.date+'の記帳を除外'" @click="dismissRecurring(candidate)">この回を除外</button>
            </div>
          </div>
        </section>
        <section v-if="recurringDueEntries.length" class="recurring-review-group" aria-label="未記帳分">
          <div class="recurring-review-group-heading">
            <div><h4>未記帳分</h4><p>記帳する項目を選択してください。</p></div>
            <span class="recurring-review-count">{{recurringDueEntries.length}}件</span>
          </div>
          <p class="recurring-review-selection" role="status">選択額 {{yen(recurringPreviewTotal)}}</p>
          <div class="recurring-candidate-list" role="group" aria-label="未登録の固定費候補">
            <div v-for="candidate in recurringDueEntries" :key="recurringKey(candidate)" class="recurring-swipe-row" :class="{'is-open':recurringSwipeOpenKey === recurringKey(candidate)}"
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
          <p class="recurring-swipe-tip">左にスワイプして候補から除外</p>
        </section>
        <p v-if="!recurringPreview.length" class="recurring-review-empty">未記帳分・明日の記帳予定はありません。</p>
      </div>
  </article>
  <article v-show="managementTab === 'plans'" class="finance-panel recurring-plans-panel">
    <details class="recurring-list-disclosure">
      <summary class="recurring-list-summary">
        <span class="recurring-list-summary-title">登録済みの固定費 <strong>{{plans.length}}件</strong></span>
        <span class="recurring-list-summary-total">今月対象 {{currentEligiblePlans.length}}件 · 今月予定額 {{yen(recurringMonthlyTotal)}}</span>
      </summary>
      <div class="recurring-list-body">
        <div class="recurring-list-filters">
          <input v-model="recurringListQuery" type="search" placeholder="名前で検索" aria-label="固定費を検索" />
          <MobileChoiceSegments v-model="recurringListFilter" label="固定費の状態" :options="[{value:'all',label:'すべて'},{value:'active',label:'有効'},{value:'stopped',label:'停止中'}]" />
        </div>
        <div v-if="!filteredRecurringPlans.length" class="recurring-list-empty">{{plans.length ? '該当する固定費はありません' : '固定費はまだありません'}}</div>
        <div v-else id="recurring-plan-list" class="recurring-plan-scroll" :class="{'is-expanded': recurringListShowAll}" role="list" aria-label="固定費一覧">
          <div v-for="p in visibleRecurringPlans" :key="p.id" class="recurring-plan-item" role="listitem">
            <button type="button" class="recurring-plan-toggle" :aria-expanded="expandedRecurringPlanId===p.id" :aria-controls="'recurring-plan-actions-'+p.id" @click="toggleRecurringPlanDetails(p.id)">
              <span class="recurring-plan-name" :title="p.name">{{p.name}}</span>
              <span class="recurring-plan-amount">{{yen(p.amount)}}</span>
              <span class="recurring-plan-chevron" aria-hidden="true">{{expandedRecurringPlanId===p.id ? '⌃' : '⌄'}}</span>
              <span class="recurring-plan-meta">
                <span class="recurring-plan-meta-item">{{recurringFrequencyLabel(p)}}</span>
                <span class="recurring-plan-meta-item recurring-payment-source" :title="p.paymentSource || '未設定'">{{p.paymentSource || '未設定'}}</span>
                <span class="recurring-plan-meta-item">開始 {{p.startMonth?.replace('-', '/') || '未設定'}}</span>
                <span class="recurring-plan-meta-item">{{p.postingMode==='auto' ? '自動記帳' : '確認して記帳'}}</span>
                <span class="recurring-plan-meta-item" :class="{'recurring-plan-overdue':recurringStatusFor(p).state==='missing'}">{{recurringPlanNextLabel(recurringStatusFor(p))}}</span>
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
        <button v-if="filteredRecurringPlans.length > 2" type="button" class="recurring-list-more" :aria-expanded="recurringListShowAll" aria-controls="recurring-plan-list" @click="recurringListShowAll = !recurringListShowAll">{{recurringListShowAll ? '折りたたむ' : 'もっと見る'}}</button>
      </div>
    </details>
  </article>
  <article v-show="managementTab === 'cards'" class="finance-panel card-billing-panel">
    <h2>カード別利用額</h2>
    <div class="finance-inputs card-billing-fields">
      <label>カード<MobileChoiceSheet v-model="bill.name" label="カード名" :options="[{value:'',label:'カードを選択'},...creditCardSources.map(source=>({value:source,label:source+(props.paymentSourceMeta[source]?.is_archived?'（アーカイブ済み）':'')}))]" /></label>
      <label>締め月<input class="card-closing-month" v-model="bill.month" type="month" aria-label="締め月"></label>
      <label>利用額<output class="card-usage-total" aria-live="polite">{{loaded && bill.name && cardPeriod ? yen(cardTotal) : "—"}}</output></label>
    </div>
    <p v-if="!loaded">全明細を更新してください。</p>
    <p v-else-if="bill.name && cardPeriod" class="card-billing-period">{{cardPeriod.start}} ～ {{cardPeriod.end}} · {{cardTransactions.length}}件（資産移動・ポイント還元を含む）</p>
    <p v-if="selectedSavedBillStale" class="card-billing-period" role="status">保存済みの請求額と現在のD1明細・締め期間に差があります。再計算して保存してください。</p>
    <div v-if="bill.name" class="card-billing-actions">
      <button type="button" class="card-billing-save" :disabled="!settingsReady || !loaded || !isCreditCard(bill.name) || !cardPeriod" @click="saveCardBill">この月の利用額を保存</button>
      <button type="button" class="card-billing-detail" :disabled="!settingsReady || !isCreditCard(bill.name) || !cardPeriod" @click="viewCardBillDetails">明細を見る</button>
    </div>
    <div v-if="selectedSavedBill" class="finance-saved-bill">
      <div class="finance-saved-bill-text"><span class="finance-saved-bill-caption">保存済みの請求額 · {{selectedSavedBill.month}}</span><strong>{{yen(selectedSavedBill.total)}}</strong><span v-if="savedBillDifference !== null" role="status">{{selectedSavedBillStale ? '現在の明細との差額：'+yen(savedBillDifference)+'（更新が必要）' : '現在の明細と一致'}}</span></div>
      <button type="button" class="finance-compact-action" @click="removeCardBill(selectedSavedBill)" :aria-label="selectedSavedBill.month+' の保存済み請求額を削除'">削除</button>
    </div>
    <details v-if="bill.name && cardBillHistory.length" class="finance-bill-history">
      <summary>過去の保存済み請求 <span>{{cardBillHistory.length}}件</span></summary>
      <div class="finance-bill-history-scroll">
        <div v-for="record in cardBillHistory" :key="record.name+'-'+record.month" class="finance-row finance-bill-history-row">
          <span>{{record.month}} · {{yen(record.total)}}<span v-if="record.stale"> · 要再計算</span></span>
          <button type="button" class="finance-compact-action" @click="removeCardBill(record)" :aria-label="record.name+' '+record.month+' の請求額を削除'">削除</button>
        </div>
      </div>
    </details>
  </article>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure">
    <summary>定期処理の実行状況</summary>
    <button type="button" :disabled="jobHealthBusy" @click="loadJobHealth">{{jobHealthBusy?'確認中…':'最新の実行結果を確認'}}</button>
    <p v-if="jobHealthError" role="alert">{{jobHealthError}}</p>
    <p v-if="!jobHealthBusy && jobHealthLoaded && jobHealth.length===0">各処理の実行履歴がまだありません。</p>
    <p v-for="row in jobHealthLoaded ? jobHealthDisplay : []" :key="row.job" :role="row.status==='failed'?'alert':undefined">{{jobNames[row.job]||row.job}}：{{jobHealthText(row)}}</p>
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure device-privacy-panel">
    <summary>端末のプライバシー設定</summary>
    <div class="device-privacy-section">
      <label class="device-login-field"><span>ログイン状態の保存</span>
        <MobileChoiceSegments :model-value="props.rememberDevice ? 'remember' : 'session'" label="ログイン状態の保存方法"
          :options="[{value:'remember',label:'ログイン状態を保持（最長30日）'},{value:'session',label:'セッション内のみ保持'}]"
          @change="emit('change-remember-device', $event === 'remember')" />
      </label>
      
    </div>
    <div class="device-privacy-section">
      <div class="device-privacy-row">
        <strong>保存済みレシート画像</strong>
        <span class="device-privacy-count" aria-live="polite">{{receiptImagesBusy && localReceiptCount === null ? '確認中…' : localReceiptCount === null ? '未確認' : localReceiptCount + '件'}}</span>
      </div>
      <template v-if="deviceReceiptCount > 0">
        <p class="device-receipt-period-note">端末に未同期の旧画像：{{deviceReceiptCount}}件</p>
        <div class="device-receipt-actions">
          <button type="button" :disabled="receiptImagesBusy || receiptPeriodBusy" @click="syncLegacyReceiptImages">端末の旧画像をR2へ同期</button>
        </div>
        <p v-if="receiptMigrationStatus" role="status" class="device-receipt-period-note">{{receiptMigrationStatus}}</p>
      </template>
      <div class="device-receipt-period">
        <strong>期間を選んで画像を削除</strong>
        <div class="device-receipt-period-fields">
          <label>対象年
            <MobileChoiceSheet v-model="receiptPeriodYear" label="対象年" :searchable="false" :disabled="receiptPeriodBusy" :options="receiptYearOptions.map(year=>({value:year,label:year+'年'}))" />
          </label>
          <label>対象月
            <MobileChoiceSheet v-model="receiptPeriodMonth" label="対象月" :searchable="false" :disabled="receiptPeriodBusy" :options="[{value:'',label:'1年分'},...Array.from({length:12},(_,i)=>({value:String(i+1).padStart(2,'0'),label:(i+1)+'月'}))]" />
          </label>
        </div>
        <button type="button" :disabled="receiptPeriodBusy || receiptImagesBusy || busy || !localReceiptCount" @click="previewReceiptPeriodDeletion">{{receiptPeriodBusy?'確認中…':'削除対象を確認'}}</button>
        <button type="button" :disabled="receiptPeriodBusy || receiptImagesBusy || busy || !localReceiptCount" @click="downloadSelectedReceiptPeriod">この期間の画像を分割ZIP保存（200件ずつ）</button>
        <p v-if="receiptPeriodPreview" class="device-receipt-period-status" role="status">
          {{receiptPeriodLabel}}：{{receiptPeriodPreview.ids.length}}件 · {{receiptPeriodPreview.unknownSizes ? '一部サイズ未取得' : '約'+receiptPeriodSize(receiptPeriodPreview.bytes)}}
          <span v-if="receiptPeriodPreview.unmatched">（日付を確認できない{{receiptPeriodPreview.unmatched}}件は対象外）</span>
        </p>
        <button v-if="receiptPeriodPreview?.ids.length" type="button" class="device-receipt-period-delete" :disabled="receiptPeriodBusy || receiptImagesBusy || busy" @click="deleteSelectedReceiptPeriod">この期間の画像{{receiptPeriodPreview.ids.length}}件を削除</button>
      </div>
      <div class="device-receipt-actions">
        <button type="button" class="device-receipt-clear" :disabled="receiptImagesBusy || receiptPeriodBusy || !localReceiptCount" @click="clearLocalReceiptImages">画像をすべて削除</button>
      <button type="button" :disabled="receiptImagesBusy || receiptPeriodBusy || receiptCleanupBusy"
        @click="checkPreviouslyDeletedImages">{{receiptCleanupBusy?'確認中…':receiptCleanupCursor?'削除済み画像の続きを確認':'削除済み画像を再確認'}}</button>
      </div>
      
    </div>
  </details>
  <details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure" @toggle="$event.target.open && refreshLocalReceiptCount()">
    <summary>バックアップ・復元</summary>
    <p>JSONは帳簿のみ。ZIPにはR2と端末の画像を含めます。画像は非公開R2に保存し、既存画像は上書きしません。</p>
    <div class="finance-actions backup-actions"><button type="button" :disabled="busy||backupBusy||!loaded" @click="downloadBackup">{{backupBusy ? 'バックアップ作成中…' : '帳簿JSONを保存'}}</button><label class="backup-upload" :class="{ 'is-disabled': busy||backupBusy||!loaded }">バックアップを選択<input type="file" accept=".json,.zip,application/json,application/zip" :disabled="busy||backupBusy||!loaded" @change="preview"></label></div>
    <div class="backup-receipt-group">
      <button type="button" :disabled="busy || backupBusy || receiptImagesBusy || !loaded" @click="downloadFullBackup">{{backupBusy ? '作成中…' : '帳簿＋画像をまとめてZIP保存'}}</button>
      <button type="button" :disabled="receiptImagesBusy || !localReceiptCount" @click="downloadReceiptImages">全画像を分割ZIP保存（200件ずつ）</button>
      
    </div>
    <p v-if="receiptExportMessage" role="status">{{receiptExportMessage}}</p>
    <div v-if="backupPreview" class="restore-preview">
      <p>追加 {{restoreRows.length}}件 · 重複候補 {{restoreConflicts.length}}件 · 画像 {{backupReceiptImages.size}}件（既存データは保持）</p>
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
        <p class="review-trash-category-note">元の明細に戻します（別の帳簿から復元した記録は新しいIDになる場合があります）。レシート画像は非公開R2に保持されます。</p>
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
        <p class="review-trash-category-note">指定した月・日だけ記帳候補から除外した項目です。</p>
        <div v-for="item in reviewTrash.recurringExclusions" :key="recurringTrashKey(item)" class="review-trash-item">
          <span class="review-trash-text" :title="item.name+' '+(item.date||item.month)">{{item.name}} · {{item.date||item.month}}</span>
          <ReviewTrashActions :label="item.name+' '+(item.date||item.month)" restore-label="対象の記帳候補を再表示" remove-label="確認済み一覧から削除"
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
      <p v-if="trashCount" class="review-trash-note">削除済みの明細・固定費は完全削除されます。確認状態と記帳済み明細は残ります。</p>
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
/* Reuse the same block layout and right-hand chevron as other Tools disclosures. */
.merchant-rules-panel>.merchant-rules-summary>span:first-of-type{flex:1;min-width:0;color:var(--ink);font-size:15px;font-weight:750}
.merchant-rules-count{flex:none;font-size:11px;font-weight:500;color:var(--muted)}
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

.device-receipt-period{display:grid;gap:9px;min-width:0;padding:11px;border:1px solid var(--line);border-radius:12px}
.device-receipt-period>strong{font-size:13px}
.device-receipt-period-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.device-receipt-period-fields label{display:grid;gap:5px;min-width:0;font-size:12px;color:var(--muted)}
.device-privacy-panel .device-receipt-period select{width:100%;min-width:0;min-height:44px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:9px;font-size:16px;padding:0 8px}
.device-receipt-period>button{min-height:44px}
.device-receipt-period .device-receipt-period-delete{color:var(--red,#b23a53);background:var(--card);border:1px solid currentColor}
.device-receipt-period-status{font-size:13px;font-weight:650;overflow-wrap:anywhere}
.device-receipt-period-status span,.device-receipt-period-note{font-size:11px;line-height:1.5;color:var(--muted)}

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
/* Search gets the full width; all three status choices stay side-by-side on phones. */
.recurring-list-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.recurring-list-filters :deep(.mobile-choice-segments){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.recurring-list-filters :deep(.mobile-choice-segments > button){width:100%;min-width:0;padding-inline:6px;white-space:nowrap}
.finance-panel .recurring-list-filters input,.finance-panel .recurring-list-filters select{width:100%;min-width:0;max-width:100%;height:44px;min-height:44px;padding:0 9px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:9px;font-size:16px}
.recurring-plan-scroll{display:grid;gap:6px;max-height:320px;overflow-y:auto;overscroll-behavior:contain;padding:1px 3px 3px 1px}
.recurring-plan-scroll.is-expanded{max-height:none;overflow:visible}
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
.finance-panel .recurring-list-more{width:100%;min-height:44px;background:var(--card);color:var(--blue-dark)}
.recurring-candidate-list{display:grid;gap:5px;max-height:240px;overflow-y:auto;overscroll-behavior:contain;min-width:0;padding-right:3px}
@media(max-width:360px){.recurring-list-filters{gap:6px}.recurring-list-filters :deep(.mobile-choice-segments){gap:6px}.recurring-list-summary{padding:10px}.recurring-plan-meta{font-size:10px}}

/* Fixed expense form: the same readable hierarchy on iPhone and iPad. */
.recurring-manager-panel .recurring-form-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:9px;margin:0 0 6px;align-items:start}
.recurring-manager-panel .recurring-form-field{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%;font-size:12px;font-weight:700;color:var(--muted);box-sizing:border-box}
.recurring-manager-panel .recurring-form-field>span:first-child{font-size:12px;font-weight:700;color:var(--muted)}
.recurring-manager-panel .recurring-form-field input,.recurring-manager-panel .recurring-form-field select{max-width:100%;min-width:0;box-sizing:border-box;font-size:16px;min-height:44px}
.recurring-manager-panel .recurring-day-picker{display:flex;flex-wrap:wrap;align-items:stretch;gap:7px;min-height:44px;color:var(--ink)}
.recurring-manager-panel .recurring-day-picker select{flex:1;max-width:100%;min-width:0}
.recurring-manager-panel .recurring-start-month{width:100%}
.recurring-manager-panel .recurring-start-month input[type=month]{width:100%;max-width:100%;min-width:0;box-sizing:border-box;min-height:44px}
.recurring-manager-panel .recurring-posting-mode{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:2px 0 0;padding:0;border:0;min-width:0}
.recurring-manager-panel .recurring-posting-mode legend{font-size:12px;font-weight:700;margin-bottom:8px;color:var(--muted)}
.recurring-manager-panel .recurring-posting-mode label{display:flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);border-radius:10px;min-height:44px;padding:6px 8px;box-sizing:border-box;min-width:0;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;white-space:nowrap}
.recurring-manager-panel .recurring-posting-mode label.selected{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 9%,var(--card))}
.recurring-manager-panel .recurring-posting-mode input[type=radio]{appearance:auto;flex:none;accent-color:var(--blue);width:16px!important;min-width:16px!important;max-width:16px!important;height:16px!important;min-height:16px!important;max-height:16px!important;margin:0;padding:0!important}
.recurring-manager-panel .recurring-posting-hint{margin:5px 0 7px;font-size:12px;line-height:1.55;color:var(--muted);overflow-wrap:anywhere}
@media(min-width:680px){.recurring-manager-panel .recurring-form-layout{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:16px;row-gap:14px}.recurring-manager-panel .recurring-posting-mode{max-width:500px}}
@media(max-width:355px){.recurring-manager-panel .recurring-posting-mode{grid-template-columns:1fr}.recurring-manager-panel .recurring-posting-mode label{min-height:40px}}

/* Phone-only density: reduce scrolling, keep every tappable control >=44px. */
.recurring-manager-panel{row-gap:6px}
@media(min-width:360px) and (max-width:679px){
  .recurring-manager-panel .recurring-form-layout{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:9px;row-gap:10px}
  .recurring-manager-panel .recurring-form-name,
  .recurring-manager-panel .recurring-form-amount,
  .recurring-manager-panel .recurring-form-schedule,
  .recurring-manager-panel .recurring-start-month{grid-column:1/-1}
}
@media(max-width:679px){
  main .finance-tools .recurring-manager-panel{padding:12px;row-gap:6px}
  .recurring-manager-panel .recurring-form-layout{margin-top:0;margin-bottom:5px}
  .recurring-manager-panel .recurring-posting-mode legend{margin-bottom:5px}
  .recurring-manager-panel .recurring-posting-mode label{min-height:44px;padding:7px}
  .finance-tools .recurring-review-panel{padding:12px}
}

/* Fixed-expense review: distinct upcoming and due groups, readable on touch and desktop. */
.recurring-review-panel{--recurring-review-primary:color-mix(in srgb,var(--blue-dark) 80%,#233748);display:grid;gap:8px;min-width:0;padding:12px;border:1px solid color-mix(in srgb,var(--blue) 34%,var(--line));border-radius:16px;background:var(--card);box-shadow:0 3px 14px color-mix(in srgb,var(--blue-dark) 9%,transparent);margin:0}
.recurring-review-heading h3{margin:0;font-size:15px;line-height:1.3;color:var(--ink)}
.recurring-review-heading p{margin:4px 0 0;font-size:12px;line-height:1.45;color:color-mix(in srgb,var(--ink) 68%,var(--muted))}
.recurring-review-results{display:grid;gap:12px;min-width:0;max-width:100%}
.recurring-review-group{display:grid;gap:8px;min-width:0;padding:11px;border-radius:12px;border:1px solid var(--line);background:var(--card)}
.recurring-review-upcoming{border-color:color-mix(in srgb,var(--blue) 28%,var(--line));background:color-mix(in srgb,var(--blue) 5%,var(--card))}
.recurring-review-group-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0}
.recurring-review-group-heading h4{margin:0;font-size:13px;font-weight:750;color:var(--ink)}
.recurring-review-group-heading p{margin:3px 0 0;color:var(--muted);font-size:11px;line-height:1.45;overflow-wrap:anywhere}
.recurring-review-count{display:inline-flex;align-items:center;justify-content:center;min-width:36px;padding:3px 7px;border-radius:99px;background:var(--tint);color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.recurring-upcoming-list{display:grid;gap:7px;min-width:0;max-height:260px;overflow-y:auto;overscroll-behavior:contain}
.recurring-upcoming-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;align-items:center;min-width:0;box-sizing:border-box;padding:12px;border:1px solid var(--line);border-radius:11px;background:var(--card)}
.recurring-upcoming-details{display:grid;gap:4px;min-width:0}
.recurring-upcoming-details .recurring-candidate-name{font-size:14px}
.recurring-upcoming-item>.recurring-candidate-amount{justify-self:end}
.finance-panel .recurring-upcoming-skip{grid-column:1/-1;justify-self:end;min-height:44px;min-width:124px;padding:8px 14px;font-size:12px;font-weight:700;color:var(--ink);background:var(--tint);border:1px solid var(--line);border-radius:9px}
.recurring-review-selection{margin:0;text-align:right;font-size:12px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums}
.recurring-review-empty{margin:0;padding:16px 10px;text-align:center;font-size:12px;line-height:1.6;color:var(--muted);border:1px dashed var(--line);border-radius:11px}
.recurring-review-panel .recurring-candidate-list{max-height:260px}
.recurring-review-panel .recurring-swipe-tip{font-size:11px}
@media(min-width:680px){
  .finance-tools .recurring-review-panel{padding:16px}
  .recurring-review-results{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
  .recurring-review-results>.recurring-review-group:only-child,.recurring-review-results>.recurring-review-empty:only-child{grid-column:1/-1}
  .recurring-upcoming-item{grid-template-columns:minmax(0,1fr) auto}
}
@media(max-width:380px){.finance-tools .recurring-review-panel{padding:10px}.recurring-review-group{padding:9px}.recurring-upcoming-item{padding:10px}.recurring-upcoming-item>.recurring-candidate-amount{font-size:13px}}

/* Saved plans and reviews are siblings of registration, not form fields. */
.recurring-plans-panel{padding:6px 10px}
.recurring-plans-panel .recurring-list-disclosure{border:0;background:transparent;overflow:visible}
.recurring-plans-panel .recurring-list-summary{display:grid;grid-template-columns:minmax(0,1fr) 20px;align-items:center;gap:3px 8px;padding:8px 4px}
.recurring-plans-panel .recurring-list-summary-title{grid-column:1;grid-row:1;flex-wrap:wrap}
.recurring-plans-panel .recurring-list-summary-total{grid-column:1;grid-row:2;min-width:0;overflow-wrap:anywhere}
.recurring-plans-panel .recurring-list-summary:after{grid-column:2;grid-row:1 / span 2;justify-self:center;margin:0}
.recurring-plans-panel .recurring-list-body{padding:0 4px 6px}
@media(max-width:679px){
  .finance-tools>.recurring-review-panel{padding:12px}
  .finance-tools>.recurring-plans-panel{padding:5px 10px}
}
@media(max-width:380px){.finance-tools>.recurring-review-panel{padding:10px}}

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
/* One clear primary action: reveal candidates first, then register selection. */
.finance-panel .recurring-review-actions button:first-child{background:var(--recurring-review-primary);border-color:var(--recurring-review-primary);color:#fff;font-weight:750}
.finance-panel .recurring-review-actions.has-preview button:first-child{background:var(--card);border-color:var(--line);color:var(--ink)}
.finance-panel .recurring-review-actions.has-preview button:last-child{background:var(--recurring-review-primary);border-color:var(--recurring-review-primary);color:#fff;font-weight:750}
.finance-panel .recurring-review-actions button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}

/* Keep the review shortcut distinct from the page background in all four themes.
   When collapsed, keep its action beside the heading on iPhones. */
.finance-tools>.recurring-review-panel{
  background:#fff;
  border:1px solid color-mix(in srgb,var(--blue) 46%,#c9d8ce);
  border-left:3px solid var(--blue);
  box-shadow:0 4px 14px rgba(29,55,42,.11);
}
.finance-panel .recurring-review-heading p{
  margin:3px 0 0;
  color:color-mix(in srgb,var(--ink) 72%,var(--muted));
  font-size:11px;
  line-height:1.4;
}
.finance-tools>.recurring-review-panel .recurring-review-heading{min-width:0}
.finance-tools>.recurring-review-panel .recurring-window-note{grid-column:1/-1}
.finance-tools>.recurring-review-panel .recurring-review-results{grid-column:1/-1}
.finance-panel .recurring-review-actions button:disabled{
  opacity:1;
  color:color-mix(in srgb,var(--ink) 65%,var(--muted));
  background:color-mix(in srgb,var(--blue) 11%,#fff);
  border-color:color-mix(in srgb,var(--blue) 28%,var(--line));
}
@media(max-width:679px){
  .finance-tools>.recurring-review-panel:not(.is-expanded){
    grid-template-columns:minmax(0,1fr) minmax(120px,auto);
    align-items:center;
    gap:7px 10px;
    padding:10px 12px;
  }
  .finance-tools>.recurring-review-panel:not(.is-expanded) .recurring-review-heading{
    grid-column:1;
    grid-row:1;
  }
  .finance-tools>.recurring-review-panel:not(.is-expanded) .recurring-review-actions{
    grid-column:2;
    grid-row:1;
    min-width:0;
  }
  .finance-tools>.recurring-review-panel:not(.is-expanded) .recurring-review-actions button{
    min-height:44px;
    padding:8px;
    font-size:12px;
    white-space:nowrap;
  }
}

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
.recurring-plan-overdue{color:var(--danger,#c4445d);font-weight:750}
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


/* Four card-edit actions must remain a single touch-safe row on iPhone widths.
   Keep Save readable; icon-only secondary actions retain accessible names. */
.finance-panel .card-edit-actions{display:flex;flex-wrap:nowrap;align-items:stretch;gap:6px;min-width:0;max-width:100%;width:100%;box-sizing:border-box}
.finance-panel .card-edit-actions>button{display:inline-flex;align-items:center;justify-content:center;min-width:0;min-height:44px;height:44px;padding:0;margin:0;white-space:nowrap;box-sizing:border-box}
.finance-panel .card-edit-actions>.card-edit-save{flex:1 1 0;min-width:0;padding:0 8px;font-size:13px;font-weight:750}
.finance-panel .card-edit-actions>.card-edit-icon{flex:0 0 44px;width:44px;max-width:44px}
.finance-panel .card-edit-actions>.card-edit-icon svg{display:block;width:20px;height:20px;flex:none}
.finance-panel .card-edit-actions>.card-edit-delete{color:var(--danger,#b7495d)}
</style>
