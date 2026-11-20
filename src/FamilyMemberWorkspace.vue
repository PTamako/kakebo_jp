<script setup>
import {ref,computed,provide,onMounted,onUnmounted,watch} from 'vue'
import FamilyFinanceProposals from './FamilyFinanceProposals.vue'
import FamilyRecurringFinance from './FamilyRecurringFinance.vue'
import MemberPersonalPoints from './MemberPersonalPoints.vue'
import MemberPointAssetActions from './MemberPointAssetActions.vue'
import MemberPointAssetReversals from './MemberPointAssetReversals.vue'
import MemberPrepaidTopups from './MemberPrepaidTopups.vue'
import MemberAssetTransferFields from './MemberAssetTransferFields.vue'
import {submitMemberPersonalTransfer} from './member-asset-transfer-submit.js'
import MemberCardUsage from './MemberCardUsage.vue'
import SbiPortfolio from './SbiPortfolio.vue'
import {memberInvestmentSnapshot} from './member-investment-view.js'
import MemberFixedCosts from './MemberFixedCosts.vue'
import FamilySharedMutationRequests from './FamilySharedMutationRequests.vue'
import TransactionForm from './TransactionForm.vue'
import {parseEntries,parseReceipt,ocrImage} from './parse.js'
import {readMemberDeviceState,writeMemberDeviceState} from './draft-store.js'
import {stageMemberReceiptOutbox,bindMemberReceiptOutbox,readMemberReceiptOutbox,removeMemberReceiptOutbox} from './member-receipt-outbox.js'
import {memberDraftSnapshot,verifiedMemberDraft} from './member-draft-safety.js'
import {compressReceiptImage} from './receipt-image.js'
import EntryInputPage from './EntryInputPage.vue'
import {ICON_LIBRARY} from './icon-library.js'
import {encryptBackupBlob,decryptBackupBlob} from './backup-encryption.js'
import {collectMemberArchive,verifiedArchiveImage} from './member-private-archive.js'
import {prepareMemberRecurringRestores} from './member-recurring-restore.js'
import {parseNamedExpenseBlocks} from './named-expense.js'
import {parseRepeatedExpense} from './natural-repeat.js'
import {memberPaymentChoices as buildMemberPaymentChoices,resolveMemberPayment} from './member-payment-choices.js'
import {ledgerPaymentLabel} from './ledger-payment-label.js'
import {isOwnHouseholdEntry} from './shared-ledger-edit.js'
import BottomNavigation from './BottomNavigation.vue'
import OriginalKakeiboPages from './OriginalKakeiboPages.vue'
import ManagementPage from './pages/ManagementPage.vue'
import MobileMerchantRulesPanel from './MobileMerchantRulesPanel.vue'
import MemberReceiptManagement from './MemberReceiptManagement.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import MobileCardEditorSheet from './MobileCardEditorSheet.vue'
import LedgerEntryContent from './LedgerEntryContent.vue'
import LedgerTypeFilter from './LedgerTypeFilter.vue'
import AssetsPage from './pages/AssetsPage.vue'
import StatisticsPage from './pages/StatisticsPage.vue'
import {makeFamilyStatsContext} from './family-stats-context.js'
import LedgerPage from './pages/LedgerPage.vue'
import {makeFamilyLedgerContext} from './family-ledger-context.js'
const props=defineProps({
 user:{type:Object,required:true},
 theme:{type:String,required:true},
 themes:{type:Array,required:true}
})
const emit=defineEmits(['logout','theme-change'])
const tab=ref('add')
const memberLastRefreshAt=ref(null)
const memberStatus=computed(()=>memberLastRefreshAt.value
 ?'最終更新：'+new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(memberLastRefreshAt.value)
 :'未読み込み')
const accounts=ref([]),assets=ref([]),sharedEntries=ref([]),pendingMutations=ref([]),totals=ref(null),yearly=ref(null)
const sharedCards=ref([]),cardSharingError=ref('')
const personalDocumentSbi=ref([]),annualPersonalDocumentSbi=ref([])
const memberMerchantRules=ref([]),memberRuleError=ref('')
const memberReceipts=ref([]),memberReceiptError=ref(''),memberReceiptRetry=ref([])
const householdReceiptIndex=ref(new Map())
const householdReceiptError=ref('')
async function reloadHouseholdReceipts(entries,replace=false){
 const actor=props.user.user_id
 const ids=[...new Set(entries.map(x=>Number(x.id)).filter(
  id=>Number.isSafeInteger(id)&&id>0))]
 // Preserve the last verified index if a transient network read fails.
 const found=new Map(replace?[]:householdReceiptIndex.value)
 try{
  for(let n=0;n<ids.length;n+=99){
   const chunk=ids.slice(n,n+99)
   const response=await fetch('/api/family-finance/household-receipts?ids='+chunk.join(','),{
    credentials:'same-origin',cache:'no-store'
   })
   const body=await response.json().catch(()=>({}))
   if(!response.ok||body.ok!==true||!Array.isArray(body.items))
    throw Error('家庭小票の一覧を読み込めません（HTTP '+response.status+'）')
   for(const id of chunk)found.delete(id)
   for(const item of body.items){
    if(!chunk.includes(Number(item.entry_id)))
     throw Error('家庭小票の対象が一致しません')
    found.set(Number(item.entry_id),item)
   }
  }
  if(actor!==props.user.user_id)return
  householdReceiptIndex.value=found
  householdReceiptError.value=''
 }catch(e){
  if(actor!==props.user.user_id)return
  // An image badge lookup must never abort a committed expense or mask it.
  householdReceiptError.value='家庭小票の表示を更新できません：'+e.message
  console.warn('Household receipt index refresh skipped:',e)
 }
}
async function fetchHouseholdReceipt(entryId){
 const response=await fetch('/api/family-finance/household-receipts/'+Number(entryId),{
  credentials:'same-origin',cache:'no-store'
 })
 if(!response.ok)throw Error('家庭小票を読み込めません（HTTP '+response.status+'）')
 const blob=await response.blob()
 if(!['image/jpeg','image/webp'].includes(blob.type)||!blob.size||blob.size>204800)
  throw Error('家庭小票の画像形式・サイズを確認できません')
 return blob
}
const memberReceiptIndex=computed(()=>{
 const map=new Map()
 for(const r of [...memberReceipts.value].reverse()){
  map.set(r.receipt_ref,r)
  if(Number.isSafeInteger(Number(r.linked_entry_id))&&Number(r.linked_entry_id)>0)
   map.set('entry:'+r.linked_entry_id,r)
 }
 return map
})
async function reloadMemberReceipts(){
 const actor=props.user.user_id
 try{
  const items=[],seen=new Set()
  let cursor=''
  for(let page=0;page<50;page++){
   const data=await api('member-receipts'+(cursor?'?before='+encodeURIComponent(cursor):''))
   if(actor!==props.user.user_id)return
   if(data.scope!=='personal'||data.viewer_user_id!==actor||
      !Array.isArray(data.items)||data.items.length>200)
    throw Error('画像の所有者を確認できません')
   items.push(...data.items)
   if(!data.next_cursor){memberReceipts.value=items;memberReceiptError.value='';return}
   if(typeof data.next_cursor!=='string'||seen.has(data.next_cursor))
    throw Error('レシート一覧の読み込み位置を確認できません')
   seen.add(data.next_cursor);cursor=data.next_cursor
  }
  throw Error('一度に表示できる件数を超えました。期間別に管理してください')
 }catch(e){if(actor===props.user.user_id)memberReceiptError.value='レシート画像を読み込めません：'+e.message}
}
async function fetchMemberReceipt(id){
 if(!/^[a-f0-9]{32}$/.test(id))throw Error('画像の番号を確認してください')
 const response=await fetch('/api/family-finance/member-receipts/'+id,
  {credentials:'same-origin',cache:'no-store'})
 if(!response.ok)throw Error('HTTP '+response.status)
 const blob=await response.blob()
 if(!['image/jpeg','image/webp'].includes(blob.type)||!blob.size||blob.size>204800)
  throw Error('画像の形式・サイズを確認できません')
 return blob
}
async function deleteMemberReceipt(id){
 if(!/^[a-f0-9]{32}$/.test(id))throw Error('画像の番号を確認してください')
 const response=await fetch('/api/family-finance/member-receipts/'+id,{
  method:'DELETE',credentials:'same-origin',cache:'no-store',
  headers:{'x-confirm-receipt':id}
 })
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true||data.purged!==true)
  throw Error(data.code||'画像を削除できませんでした')
 memberReceipts.value=memberReceipts.value.filter(x=>x.receipt_id!==id)
 await reloadHouseholdReceipts(sharedEntries.value,true).catch(()=>{})
}
async function saveMemberReceipt(record,receiptRef){
 if(record.type!=='expense'||!record.receiptImage||!receiptRef)return
 const actor=props.user.user_id,blob=record.receiptImage
 if(!['image/jpeg','image/webp'].includes(blob.type)||!blob.size||blob.size>204800)
  throw Error('レシート画像を200KB以下にしてください')
 if(!record.receiptIdempotencyKey)record.receiptIdempotencyKey='receipt:'+crypto.randomUUID()
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))]
  .map(b=>b.toString(16).padStart(2,'0')).join('')
 const prepared=await api('member-receipts',request({
   expected_user_id:actor,idempotency_key:record.receiptIdempotencyKey,
   receipt_ref:receiptRef,receipt_date:record.date,merchant:String(record.merchant||'').slice(0,120),
   content_type:blob.type,size_bytes:blob.size,sha256
 }))
 if(actor!==props.user.user_id)throw Error('別のアカウントへ画像を保存できません')
 if(prepared.item?.state!=='ready'){
  const id=prepared.item?.receipt_id
  if(!/^[a-f0-9]{32}$/.test(id))throw Error('画像の保存先を確認できません')
  const res=await fetch('/api/family-finance/member-receipts/'+id,{
   method:'PUT',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':blob.type},body:blob})
  const result=await res.json().catch(()=>({}))
  if(!res.ok||result.ok!==true||result.item?.state!=='ready')
   throw Error(result.code||'画像保存に失敗しました')
 }
 await reloadMemberReceipts()
 return prepared.item?.receipt_id
}
// Shared pages live in OriginalKakeiboPages; this component only adapts
// authentication, household approvals and member-specific API calls.
const receiptScope=()=>({userId:props.user.user_id,householdId:props.user.household_id})
async function stageMemberReceipt(record){
 if(record.type!=='expense'||!record.receiptImage)return
 if(!record.receiptIdempotencyKey)
  record.receiptIdempotencyKey='receipt:'+crypto.randomUUID()
 await stageMemberReceiptOutbox({...receiptScope(),key:record.receiptIdempotencyKey,
  blob:record.receiptImage,date:record.date,merchant:record.merchant})
}
async function bindMemberReceipt(record,receiptRef){
 await bindMemberReceiptOutbox({...receiptScope(),key:record.receiptIdempotencyKey,receiptRef})
}
function noteMemberReceiptRetry(record,receiptRef,error){
 const key=record.receiptIdempotencyKey
 if(!memberReceiptRetry.value.some(item=>item.record.receiptIdempotencyKey===key))
  memberReceiptRetry.value.push({record,receiptRef})
 memberReceiptError.value='記帳は受付済みです。画像の再送が必要です：'+(error?.message||error)
}
async function retryMemberReceipt(){
 if(memberEntryPending.value||!memberReceiptRetry.value.length)return
 const actor=props.user.user_id,household=props.user.household_id
 const attempts=[...memberReceiptRetry.value];memberReceiptRetry.value=[]
 for(const item of attempts){
  if(actor!==props.user.user_id||household!==props.user.household_id)return
  try{
   await saveMemberReceipt(item.record,item.receiptRef)
   // An unconsumed ledger draft keeps its outbox receipt until finalized.
   if(!memberEntries.value.some(row=>row.receiptIdempotencyKey===item.record.receiptIdempotencyKey))
    await removeMemberReceiptOutbox(actor,household,item.record.receiptIdempotencyKey)
  }catch(e){noteMemberReceiptRetry(item.record,item.receiptRef,e)}
 }
 if(!memberReceiptRetry.value.length)memberReceiptError.value=''
}
const month=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,7))
const year=ref(month.value.slice(0,4))
const busy=ref(false),error=ref(''),label=ref(''),kind=ref('cash')
const renameId=ref(''),rename=ref(''),notice=ref('')
const selectedCardId=ref(''),cardMode=ref('')
const preferredCardType=ref('standard'),memberCardSettingsRequest=ref(0)
function openMemberPrepaidAdd(){preferredCardType.value='prepaid';cardMode.value='add';memberCardSettingsRequest.value++;tab.value='finance'}
function openMemberCardSettings(){preferredCardType.value='standard';memberCardSettingsRequest.value++;tab.value='finance'}
const memberUsageRevision=ref(0)
const cardAccounts=computed(()=>myAccounts.value.filter(a=>['credit_card','prepaid'].includes(a.account_kind)))
const selectedCard=computed(()=>cardAccounts.value.find(a=>a.account_id===selectedCardId.value)||null)
const defaultCard=computed(()=>cardAccounts.value.find(a=>Number(a.is_default)===1)?.account_id||'')
async function makeDefaultCard(){
 const target=selectedCard.value
 if(!target||busy.value||target.owner_user_id!==props.user.user_id)return
 if(defaultCard.value===target.account_id)return
 const previous=cardAccounts.value.find(a=>a.account_id===defaultCard.value)
 if(previous)await modify(previous,{is_default:false})
 // Refresh above may update account versions; select the refreshed target.
 const current=cardAccounts.value.find(a=>a.account_id===target.account_id)
 if(current)await modify(current,{is_default:true})
}
const cardLabels=computed(()=>cardAccounts.value.map(a=>a.label))
const cardMeta=computed(()=>selectedCard.value?{
 source_type:selectedCard.value.account_kind==='prepaid'?'prepaid':'standard',
 stat_group:selectedCard.value.stat_group,closing_day:selectedCard.value.closing_day,
 is_archived:selectedCard.value.is_archived}:null)
async function saveCard(payload){
 const user=props.user.user_id,revision=epoch
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  if(payload.mode==='add'){
   const kind=payload.sourceType==='prepaid'?'prepaid':'credit_card'
   const created=await api('accounts',request({label:payload.name,
    account_kind:kind,expected_user_id:user,
    closing_day:payload.closingDay===undefined?null:payload.closingDay}))
   if(created.owner_user_id!==user||created.ledger_changed!==false)
    throw Error('カードの所有者を確認できません')
   selectedCardId.value=created.account_id
  }else{
   const a=selectedCard.value
   if(!a||a.owner_user_id!==user||a.origin!=='member_created')throw Error('本人のカードのみ編集できます')
   if((payload.sourceType==='prepaid')!==(a.account_kind==='prepaid'))
    throw Error('カードの種類は変更できません。新しい個人カードを追加してください')
   const changes={label:payload.name,version:a.version,expected_user_id:user}
   if(payload.closingDay!==undefined)changes.closing_day=payload.closingDay
   const updated=await api('accounts/'+a.account_id,request(changes,'PATCH'))
   if(updated.ledger_changed!==false)throw Error('カードの更新結果を確認できません')
  }
  if(revision!==epoch||user!==props.user.user_id)return
  cardMode.value='';await refresh()
 }catch(e){if(revision===epoch){error.value=e.message;throw e}}
 finally{busy.value=false}
}
async function cardDanger(action,name){
 const a=selectedCard.value
 if(!a||a.owner_user_id!==props.user.user_id||a.label!==name)
  throw Error('口座の所有者が変更されました')
 if(action==='archive'){
  await modify(a,{is_archived:true});cardMode.value='';return
 }
 throw Error('カードと残高の完全削除には個別の確認が必要です。現在はアーカイブのみ利用できます')
}

// The management view is shared with the owner. This adapter only supplies
// the authenticated member's own cards and authorized mutations.
function getMemberCardConfig(){
 return {
  selected:selectedCardId.value,
  options:cardAccounts.value.filter(a=>!a.is_archived).map(a=>({value:a.account_id,label:a.label})),
  defaultValue:defaultCard.value,busy:busy.value,
  mode:cardMode.value,name:selectedCard.value?.label||'',card:cardMeta.value,
  closingDay:selectedCard.value?.closing_day?String(selectedCard.value.closing_day)+'日':'末日',
  paymentSources:cardLabels.value,shareReady:false,
  archived:cardAccounts.value.filter(a=>a.is_archived).map(a=>({
   value:a.account_id,label:a.label,kind:a.account_kind})),
  allowPermanentDelete:false,defaultSourceType:preferredCardType.value,
  onSave:saveCard,onDanger:cardDanger,
  onSelect:value=>{selectedCardId.value=value},
  onMode:next=>{if(next==='add')preferredCardType.value='standard';cardMode.value=next},
  onDefault:makeDefaultCard,
  onArchive:id=>{const account=cardAccounts.value.find(a=>a.account_id===id);
   if(account)void modify(account,{is_archived:false})}
 }
}

let epoch=0,alive=true
const kinds=[['credit_card','クレジットカード'],['prepaid','プリペイドカード'],['cash','現金'],
 ['points','ポイント'],['securities','証券'],['other','その他']]
const kindLabel=x=>kinds.find(k=>k[0]===x)?.[1]||'口座'
const yen=n=>n===null||n===undefined?'—':'¥'+Number(n).toLocaleString('ja-JP')
const myAccounts=computed(()=>accounts.value.filter(x=>x.owner_user_id===props.user.user_id))
const memberPaymentOptions=computed(()=>buildMemberPaymentChoices(myAccounts.value,sharedCards.value))
// Same original ledger editor for both spouses. Personal account selection
// is allowed only for its authenticated creator and goes through the signed
// account-correction executor, never ordinary text relabeling.
const memberLedgerPaymentOptions=computed(()=>memberPaymentOptions.value)
const memberPaymentReassignmentEnabled=ref(false)
const memberAccountCorrectionEnabled=ref(false)
provide('kakeibo-member-payment-choices',memberLedgerPaymentOptions)
function memberPaymentEditor(entry){
 if(entry?.document_personal_sbi)return {paymentReadOnly:true,paymentSource:'',
  transferReadOnly:true,categoryReadOnly:true,allReadOnly:false,isOwnRecorded:true};
 const isOwn=isOwnHouseholdEntry(entry,props.user.user_id)
 if(entry?.type==='transfer')return {
  paymentReadOnly:true,paymentSource:'',isOwnRecorded:isOwn,
  transferReadOnly:!isOwn,
  // Neutral transfers are personal: a member cannot change the other person's.
  allReadOnly:entry.transfer_target!=='spouse'||!isOwn
 }
 if(entry?.type==='expense'&&memberAccountCorrectionEnabled.value&&
   entry.future_paid_owner_user_id===props.user.user_id){
  const a=myAccounts.value.find(x=>x.account_id===entry.family_account_id&&
   ['credit_card','prepaid'].includes(x.account_kind)&&!x.is_archived);
  if(a||!entry.family_account_id)return {paymentReadOnly:false,
   paymentSource:a?'personal:'+a.account_id:'cash',isOwnRecorded:true,
   restrictToPersonalPayment:true};
 }
 const own=memberPaymentReassignmentEnabled.value&&entry?.type==='expense'&&
  entry.shared_entry_requester_user_id===props.user.user_id&&
  !entry.family_account_id
 if(!own)return {paymentReadOnly:true,paymentSource:ledgerPaymentLabel(entry),
  isOwnRecorded:isOwn,restrictToSharedCash:true}
 const source=typeof entry.payment_source==='string'?entry.payment_source:''
 return {paymentReadOnly:false,paymentSource:source?'shared:'+source:'cash',
  isOwnRecorded:isOwn,restrictToSharedCash:true}
}
function memberRuleFor(merchant){
 const text=String(merchant||'').normalize('NFKC').trim().toLowerCase()
 if(!text)return null
 return [...memberMerchantRules.value].sort((a,b)=>b.keyword.length-a.keyword.length)
   .find(r=>text.includes(r.keyword.normalize('NFKC').toLowerCase()))||null
}
function applyMemberMerchantRule(form){
 if(form?.type!=='expense')return
 const rule=memberRuleFor(form.merchant)
 if(!rule)return
 if(rule.category&&memberExpenseCategoryChoices.value.includes(rule.category))form.category=rule.category
 if(rule.payment_source&&memberPaymentOptions.value.some(c=>c.value===rule.payment_source))
  form.paymentSource=rule.payment_source
}
async function loadMemberMerchantRules(){
 const actor=props.user.user_id
 try{
  const result=await api('member-merchant-rules')
  if(actor!==props.user.user_id)return
  if(result.scope!=='personal'||result.viewer_user_id!==actor||!Array.isArray(result.items))
   throw Error('本人のルールの取得範囲が一致しません')
  memberMerchantRules.value=result.items
  memberRuleError.value=''
 }catch(e){if(actor===props.user.user_id)memberRuleError.value='店舗ルールを読み込めません：'+e.message}
}
async function saveMemberMerchantRule({keyword,oldCategory,oldPayment,expectedVersion,category,paymentSource}){
 const actor=props.user.user_id
 const previous=memberMerchantRules.value.find(r=>r.keyword===keyword)
 if((previous?.version||0)!==expectedVersion||
    (previous?.category||'')!==oldCategory||(previous?.payment_source||'')!==oldPayment)
  throw Error('別の端末でルールが変更されました。更新してください')
 if(category&&!memberRuleCategoryOptions.value.includes(category)&&category!==(previous?.category||''))throw Error('カテゴリを確認してください')
 if(paymentSource&&!memberPaymentOptions.value.some(o=>o.value===paymentSource))
  throw Error('支払方法を確認してください')
 if(!category&&!paymentSource){
  if(!previous)throw Error('空のルールは作成できません')
  await api('member-merchant-rules',request({
   expected_user_id:actor,expected_version:previous.version,keyword
  },'DELETE'))
 }else{
  await api('member-merchant-rules',request({
   expected_user_id:actor,expected_version:expectedVersion,
   keyword,category,payment_source:paymentSource
  }))
 }
 await loadMemberMerchantRules()
 if(actor!==props.user.user_id)throw Error('アカウントが変更されました')
}
async function rememberMemberRule(record){
 const keyword=String(record.merchant||'').trim()
 if(keyword.length<2)return
 const previous=memberMerchantRules.value.find(r=>r.keyword===keyword)
 const category=record.bindRule?record.category:(previous?.category||'')
 const paymentSource=record.bindPaymentRule?record.paymentSource:(previous?.payment_source||'')
 if(!category&&!paymentSource)return
 await saveMemberMerchantRule({keyword,oldCategory:previous?.category||'',
  oldPayment:previous?.payment_source||'',expectedVersion:previous?.version||0,
  category,paymentSource})
}

const selectedEntryType=ref('all')
const monthlyReport=ref(null),annualReport=ref(null),selectedYear=ref(Number(year.value))
const sharedMutationRef=ref(null)
const memberEntryPending=ref(false),memberEntryError=ref(''),memberEntryNotice=ref('')
// Both identities read the same canonical D1 category_source. The category
// key is the ledger ID; display_name is the Japanese label, not a new ID.
const memberCategorySource=ref([])
const entryExpenseCategories=computed(()=>memberCategorySource.value
 .filter(x=>x.entry_type==='expense').map(x=>x.category))
const entryIncomeCategories=computed(()=>memberCategorySource.value
 .filter(x=>x.entry_type==='income').map(x=>x.category))
const memberCategoryLabels=computed(()=>Object.fromEntries(memberCategorySource.value
 .map(x=>[x.category,x.display_name||x.category])))
const memberCategoryLabel=value=>memberCategoryLabels.value[value]||value
function defaultMemberCategory(type){
 const rows=memberCategorySource.value.filter(x=>x.entry_type===type)
 return rows.find(x=>Number(x.is_default)===1)?.category||rows[0]?.category||''
}
function normalizedMemberCategory(type,value){
 const name=String(value||'').trim()
 const row=memberCategorySource.value.find(x=>x.entry_type===type&&
  (x.category===name||x.display_name===name))
 if(row)return row.category
 if(memberCategoryRecords.value.some(x=>x.type===type&&x.name===name))return name
 return defaultMemberCategory(type)
}
function newEntry(){return {type:'expense',amount:'',date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),
 time:'',category:defaultMemberCategory('expense'),merchant:'',note:'',paymentSource:'cash',transferTarget:'',
 bindRule:false,bindPaymentRule:false}}
const memberEntries=ref([])
const memberInputMode=ref('manual'),memberRawText=ref(''),memberScanMode=ref('statement')
const memberOcrBusy=ref(false),memberOcrStatus=ref(''),memberOcrWarning=ref('')
const memberScanPaymentSource=ref('cash')
const memberImportPaymentSource=ref('cash')
const memberAiQuota=ref(null)

// Member drafts are partitioned by verified HomeFlow user and household.
// No receipt image blobs are placed in this store.
const memberDraftLoaded=ref(false)
let memberDraftTimer=null,memberDraftEpoch=0,memberDraftWriteQueue=Promise.resolve()
let memberDraftOwner={userId:props.user.user_id,householdId:props.user.household_id}
function memberDraftValue(nextForms=memberEntries.value){
 return memberDraftSnapshot({userId:memberDraftOwner.userId,householdId:memberDraftOwner.householdId,
  forms:nextForms,rawText:memberRawText.value,inputMode:memberInputMode.value,
  pendingPaidEntry})
}
function queueMemberDraftWrite(snapshot){
 const user=snapshot.userId,household=snapshot.householdId
 memberDraftWriteQueue=memberDraftWriteQueue.catch(()=>{}).then(()=>
  writeMemberDeviceState(user,household,snapshot))
 return memberDraftWriteQueue
}
async function persistMemberDraft(nextForms=memberEntries.value){
 if(!memberDraftLoaded.value||memberDraftOwner.userId!==props.user.user_id||
  memberDraftOwner.householdId!==props.user.household_id)
  throw Error('端末の下書き復元が完了していません。再読み込みしてください')
 if(memberDraftTimer){clearTimeout(memberDraftTimer);memberDraftTimer=null}
 const snapshot=memberDraftValue(nextForms)
 try{await queueMemberDraftWrite(snapshot)}
 catch(e){throw Error('下書きと再送防止IDを端末に保存できません：'+e.message)}
 return snapshot
}
function scheduleMemberDraftSave(){
 if(!memberDraftLoaded.value)return
 if(memberDraftTimer)clearTimeout(memberDraftTimer)
 memberDraftTimer=setTimeout(()=>{
  memberDraftTimer=null
  void persistMemberDraft().catch(e=>{memberEntryError.value=e.message})
 },300)
}
watch([memberEntries,memberRawText,memberInputMode],scheduleMemberDraftSave,{deep:true})
async function hydrateMemberDraft(){
 const ticket=++memberDraftEpoch,user=props.user.user_id,household=props.user.household_id
 memberDraftLoaded.value=false
 memberDraftOwner={userId:user,householdId:household}
 if(memberDraftTimer){clearTimeout(memberDraftTimer);memberDraftTimer=null}
 try{
  await memberDraftWriteQueue.catch(()=>{})
  const stored=await readMemberDeviceState(user,household)
  if(ticket!==memberDraftEpoch||user!==props.user.user_id||household!==props.user.household_id)return
  const data=stored?verifiedMemberDraft(stored,user,household):null
  if(stored&&!data)throw Error('保存済み下書きの本人情報または内容が一致しません')
  // Restore a saved Blob only from this verified household member's outbox.
  // OCR/text-only entries never create a receipt attachment.
  let receipts=[]
  try{receipts=await readMemberReceiptOutbox(user,household)}
  catch(e){memberReceiptError.value='保存済み小票の確認に失敗しました：'+e.message}
  if(ticket!==memberDraftEpoch||user!==props.user.user_id||household!==props.user.household_id)return
  const staged=new Map(receipts.map(item=>[item.key,item]))
  memberReceiptRetry.value=receipts.filter(item=>item.receiptRef).map(item=>({
   receiptRef:item.receiptRef,record:{type:'expense',date:item.date,merchant:item.merchant,
    receiptImage:item.blob,receiptIdempotencyKey:item.key}
  }))
  memberEntries.value=(data?.forms||[]).map(row=>{
   const photo=staged.get(row.receiptIdempotencyKey)
   return photo?{...row,receiptImage:photo.blob}:row
  })
  memberRawText.value=data?.rawText||''
  memberInputMode.value=data?.inputMode||'manual'
  pendingPaidEntry=data?.pendingPaidEntry||null
  memberDraftRecoveryInfo.value=data&&(data.forms.length||data.rawText||data.pendingPaidEntry)
   ?'端末の下書きを復元しました（画像は再選択してください）':''
  memberDraftLoaded.value=true
 }catch(e){
  if(ticket===memberDraftEpoch){memberDraftLoaded.value=false
   memberEntryError.value='下書きの復元に失敗しました。重複記帳を防ぐため保存できません：'+e.message}
 }
}
function memberDraftHidden(){
 if(document.visibilityState==='hidden'&&memberDraftLoaded.value)
  void persistMemberDraft().catch(e=>{memberEntryError.value=e.message})
}

const memberAiEnabled=ref((()=>{
 try{return localStorage.getItem('kakeibo-ai-ocr-enabled')==='true'}catch{return false}
})())
async function refreshMemberAiQuota(){
 try{memberAiQuota.value=await api('ai-ocr/quota')}
 catch{memberAiQuota.value=null}
}
function setMemberAiEnabled(enabled){
 memberAiEnabled.value=enabled===true
 try{localStorage.setItem('kakeibo-ai-ocr-enabled',String(memberAiEnabled.value))}catch{}
 if(enabled)void refreshMemberAiQuota()
}
watch(memberInputMode,mode=>{if(mode==='scan')void refreshMemberAiQuota()})
const memberImportPaymentOptions=computed(()=>
 [{value:'cash',label:'自動判定（現金）'},...memberPaymentOptions.value.filter(x=>x.value!=='cash')])
const memberTodayLabel=computed(()=>new Date().toLocaleString('ja-JP',{
 timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}))
function addMemberEntry(){
 if(!entryExpenseCategories.value.length){memberEntryError.value='カテゴリを読み込めません。再読み込みしてください';void loadMemberCategories();return}
 memberEntries.value.push(newEntry())
}
function removeMemberEntry(index){if(!memberEntryPending.value)memberEntries.value.splice(index,1)}
function setMemberEntryType(type,entry){
 if(!['expense','income','transfer'].includes(type))return
 entry.type=type
 entry.category=type==='transfer'?'投資・資産移動':defaultMemberCategory(type)
 entry.merchant=''
 entry.transferTarget=type==='transfer'?'spouse':''
 entry.transferDate=type==='transfer'?entry.date:''
 entry.paymentSource=type==='expense'?'cash':''
}
function recognizeMemberText(fromImage=false){
 memberEntryError.value='';memberEntryNotice.value=''
 const raw=memberRawText.value.trim()
 if(!raw)return
 const reference=new Date()
 const structured=parseNamedExpenseBlocks(raw,reference)
 if(structured?.error){memberEntryError.value=structured.error;return}
 const repeated=parseRepeatedExpense(raw)
 const rows=structured?.rows||repeated||
  (memberScanMode.value==='receipt'?[parseReceipt(raw,[])]:parseEntries(raw,[],reference))
 const parsed=Array.isArray(rows)?rows.slice(0,80):[]
 if(parsed.some(x=>x?.type==='transfer')){
  memberEntryError.value='資産移動を含む明細は支出として保存できません。資産移動メニューで処理してください。';return
 }
 const drafts=parsed.filter(x=>x&&Number.isSafeInteger(Number(x.amount))&&Number(x.amount)>0)
  .map(x=>{const draft={...newEntry(),type:x.type==='income'?'income':'expense',
   amount:Number(x.amount),date:String(x.date||newEntry().date),
   time:String(x.time||''),merchant:String(x.merchant||''),
   category:normalizedMemberCategory(x.type==='income'?'income':'expense',x.category),note:String(x.note||''),
   paymentSource:memberPaymentOptions.value.some(c=>c.value===(fromImage?memberScanPaymentSource.value:memberImportPaymentSource.value))
    ?(fromImage?memberScanPaymentSource.value:memberImportPaymentSource.value):'cash'};applyMemberMerchantRule(draft);return draft})
 if(!drafts.length){memberEntryError.value='解析できる金額がありません。原文と金額を確認してください。';return}
 if(memberEntries.value.length&& !window.confirm('現在の未保存記録を読み取り結果で置き換えますか？'))return
 memberEntries.value=drafts
 memberEntryNotice.value=drafts.length+'件を読み取りました。保存する前に金額・日付・支払方法を確認してください。'
}
async function memberScanImage(event){
 const file=event.target?.files?.[0];if(event.target)event.target.value=''
 if(!file||memberOcrBusy.value)return
 memberOcrBusy.value=true;memberEntryError.value='';memberOcrWarning.value=''
 memberOcrStatus.value='端末内OCR'
 const originalMode=memberScanMode.value
 try{
  if(memberAiEnabled.value){
   try{
    await refreshMemberAiQuota()
    if(memberAiQuota.value&&Number(memberAiQuota.value.remaining)<=0)
     throw Error('本日のAI上限に達しました')
    const image=await compressReceiptImage(file,2000,1024*1024)
    const body=new FormData()
    body.append('image',image,image.type==='image/jpeg'?'receipt.jpg':'receipt.webp')
    body.append('mode',originalMode)
    const response=await fetch('/api/family-finance/ai-ocr',{
     method:'POST',body,credentials:'same-origin',cache:'no-store'
    })
    const result=await response.json().catch(()=>({}))
    if(!response.ok||result.ok!==true||result.engine!=='gemma4'||!result.text?.trim())
     throw Error(result.error||'AIの応答を確認できませんでした')
    memberRawText.value=result.text
    memberOcrStatus.value='Gemma 4'
   }catch(aiError){
    memberOcrWarning.value='AIが使えないため端末内OCRへ切替：'+String(aiError.message||'通信エラー')
    memberRawText.value=await ocrImage(file)
    memberOcrStatus.value='端末内OCR'
   }finally{await refreshMemberAiQuota()}
  }else{
   memberRawText.value=await ocrImage(file)
   memberOcrStatus.value='端末内OCR'
  }
  if(!memberRawText.value.trim())throw Error('文字が読み取れませんでした')
  recognizeMemberText(true)
  if(originalMode==='receipt'&&memberEntries.value.length===1&&memberEntries.value[0].type==='expense'){
   const draft=memberEntries.value[0]
   try{
    draft.receiptImage=await compressReceiptImage(file)
    draft.receiptFileName=file.name
    draft.showReceiptAttachment=true
   }catch(e){memberOcrWarning.value='画像を添付できません：'+e.message}
  }
  memberInputMode.value='scan'
 }catch(e){memberEntryError.value='画像を読み取れませんでした：'+e.message}
 finally{memberOcrBusy.value=false}
}
// Every displayed expense uses the same record editor. The selected source
// determines the existing server-verified execution path, never just its label.
let pendingPaidEntry=null
function safeSpend(entry){
 const amount=Number(entry.amount),merchant=String(entry.merchant||'').trim()
 const category=String(entry.category||'').trim(),note=String(entry.note||'').trim()
 if(entry.type!=='expense'||!/^20\d\d-\d\d-\d\d$/.test(entry.date)||
  !Number.isSafeInteger(amount)||amount<1||amount>10000000||
  !merchant||merchant.length>120||!category||category.length>40||note.length>300)
  throw Error('金額・日付・店舗・カテゴリを確認してください')
 return {date:entry.date,time:String(entry.time||''),amount,merchant,category,note}
}
async function submitPaidExpense(choice,record){
 const entry=safeSpend(record),user=props.user.user_id
 const snapshot=JSON.stringify({user,source:record.paymentSource,entry})
 if(pendingPaidEntry&&pendingPaidEntry.snapshot!==snapshot)
  throw Error('前回の送信結果が未確認です。元の内容で再試行してください')
 if(!pendingPaidEntry)pendingPaidEntry={snapshot,key:'member-spend:'+crypto.randomUUID(),
  requestId:null,acknowledged:false,receiptRef:null}
 const pending=pendingPaidEntry
 // Retain the same replay key and submitted payload until the member draft
 // is atomically consumed. Clearing a key before removing its draft can cause
 // a duplicate if iOS closes the PWA between those two steps.
 await persistMemberDraft()
 if(pending.acknowledged){
  if(!pending.receiptRef)throw Error('前回の受付番号が不明です。審査一覧を確認してください')
  return {type:'pending',receiptRef:pending.receiptRef}
 }
 if(choice.kind==='shared'){
  const result=await sharedMutationRef.value?.submitEntry({
   ...entry,type:'expense',payment_source:choice.card.card_name
  })
  if(!result?.proposalId)throw Error('共有カードの HomeFlow 審査受付を確認できません')
  pending.receiptRef='proposal:'+result.proposalId
  pending.acknowledged=true
  await persistMemberDraft()
  return {type:'pending',receiptRef:pending.receiptRef}
 }
 if(choice.kind!=='personal')throw Error('支払方法を確認してください')
 const a=choice.account
 const prepaid=a.account_kind==='prepaid',path=prepaid?'prepaid-actions':'card-purchases'
 if(!pending.requestId){
  const base={expected_user_id:user,idempotency_key:pending.key,
   date:entry.date,amount_jpy:entry.amount,merchant:entry.merchant,
   category:entry.category,note:entry.note}
  const body=prepaid?{...base,action:'spend',
   prepaid_account_id:a.account_id,prepaid_version:a.version}:{
   ...base,account_id:a.account_id,account_version:a.version}
  const result=await api(path,request(body))
  const prepared=result.prepared
  if(!prepared?.request_id)throw Error('決済申請の準備結果が未確認です')
  pending.requestId=prepared.request_id
  await persistMemberDraft()
  if(prepared.status==='submitted_status_unknown'&&prepared.approval_id){
   pending.receiptRef='request:'+pending.requestId
   pending.acknowledged=true
   await persistMemberDraft()
   return {type:'pending',receiptRef:pending.receiptRef}
  }
  if(prepared.status!=='prepared')throw Error('決済申請の状態を確認してください')
 }
 const response=await api(path+'/'+encodeURIComponent(pending.requestId)+'/submit',
  request({expected_user_id:user}))
 if(response.applied!==false||response.status!=='submitted_status_unknown')
  throw Error('HomeFlow 承認依頼の受付を確認できません')
 pending.receiptRef='request:'+pending.requestId
 pending.acknowledged=true
 await persistMemberDraft()
 return {type:'pending',receiptRef:pending.receiptRef}
}
async function submitMemberFixedCost(item){
 if(memberEntryPending.value||busy.value)throw Error('別の操作が進行中です')
 const choice=resolveMemberPayment(item.paymentSource,myAccounts.value,sharedCards.value)
 if(!choice)throw Error('支払方法を再確認してください。共有が解除されたカードは使用できません')
 const record={...newEntry(),type:'expense',amount:item.amount,category:item.category,
  merchant:item.name,note:'固定費 '+item.name,paymentSource:item.paymentSource}
 let result
 if(choice.kind==='cash'){
  result=await sharedMutationRef.value?.submitEntry(record)
  if(!result?.proposalId)throw Error('HomeFlow の申請受付を確認できません')
 }else result=await submitPaidExpense(choice,record)
 await refresh()
 // A fixed-cost request has no entry-form draft. Consume the acknowledged
 // payment receipt in the same durable member snapshot before allowing a
 // new, intentional payment request.
 if(choice.kind==='personal'||choice.kind==='shared'){
  const previous=pendingPaidEntry
  pendingPaidEntry=null
  try{await persistMemberDraft()}catch(e){pendingPaidEntry=previous;throw e}
 }
 if(result?.receiptRef?.startsWith('proposal:')||result?.proposalId)
  await sharedMutationRef.value?.clearAcknowledgedIntent()
 return result
}
async function submitNeutralSpouseTransfer(record){
 const actor=props.user.user_id
 if(record.type!=='transfer'||record.transferTarget!=='spouse')
  throw Error('配偶への資産移動だけを記録できます')
 // Keep the key on the unsent draft so a lost HTTP response never duplicates
 // an actual transfer on retry. A transfer has no payment card or bank account.
 if(!record.neutralSpouseTransferKey)
  record.neutralSpouseTransferKey='neutral-spouse:'+crypto.randomUUID()
 await persistMemberDraft()
 const entry={date:String(record.date||''),time:String(record.time||''),
  amount:Number(record.amount),type:'transfer',category:'投資・資産移動',
  merchant:'配偶への振替',note:String(record.note||'').trim(),
  transfer_target:'spouse',transfer_date:String(record.date||'')}
 const receipt=await api('shared-entries',request({
  expected_user_id:actor,idempotency_key:record.neutralSpouseTransferKey,entry
 }))
 const row=receipt.action
 if(actor!==props.user.user_id||row?.creator_user_id!==actor||
  row?.state!=='active'||row?.entry?.type!=='transfer'||
  row.entry.transfer_target!=='spouse'||row.entry.amount!==entry.amount||
  !Number.isSafeInteger(row.entry_id)||row.entry_id<1)
  throw Error('配偶への資産移動の記録を確認できません')
 return {type:'applied',entryId:row.entry_id}
}
async function submitMemberEntry(){
 if(memberEntryPending.value||memberOcrBusy.value||!memberEntries.value.length)return
 if(!memberDraftLoaded.value){memberEntryError.value='下書きの復元が完了していません。保存は中止しました';return}
 if(!entryExpenseCategories.value.length||!entryIncomeCategories.value.length){
  memberEntryError.value='カテゴリの読み込みが必要です。再読み込みしてください';return
 }
 memberEntryPending.value=true;memberEntryError.value='';memberEntryNotice.value=''
 let sent=0,applied=0
 try{
  while(memberEntries.value.length){
   const record=memberEntries.value[0]
   const choice=record.type==='expense'
    ?resolveMemberPayment(record.paymentSource,myAccounts.value,sharedCards.value)
    :{kind:'cash'}
   if(!choice)throw Error('支払方法が変更・解除されました。もう一度選択してください')
   if(pendingPaidEntry&&choice.kind==='cash')
    throw Error('先のカード送信結果が未確認です。同じ内容で再試行してください')
   // Every member write must start with a durable, scoped draft snapshot.
   await persistMemberDraft()
   let receiptRef=''
   if(record.type==='transfer'){
    const result=record.transferTarget==='spouse'
     ?await submitNeutralSpouseTransfer(record)
     :await submitMemberPersonalTransfer({record,userId:props.user.user_id,
       accounts:myAccounts.value,persistPending:()=>persistMemberDraft()})
    applied++
    receiptRef=result.entryId?'entry:'+result.entryId:''
   }else if(choice.kind==='shared'||choice.kind==='personal'){
    const result=await submitPaidExpense(choice,record)
    if(result.type==='applied')applied++
    receiptRef=result.receiptRef||''
   }else{
    const result=await sharedMutationRef.value?.submitEntry(record)
    if(!result?.proposalId)throw Error('申請の受付を確認できません')
    receiptRef='proposal:'+result.proposalId
   }
   if(record.receiptImage&&receiptRef){
    try{await saveMemberReceipt(record,receiptRef)}
    catch(e){
     memberReceiptRetry.value.push({record,receiptRef})
     memberReceiptError.value='記帳は送信済みです。画像は再送してください：'+e.message
    }
   }
   if(record.type==='expense'&&(record.bindRule||record.bindPaymentRule)){
    try{await rememberMemberRule(record)}catch(e){memberRuleError.value='店舗ルールの保存に失敗しました：'+e.message}
   }
   // Remove one draft only after the authenticated backend confirmed receipt.
   // A later failure leaves all unsent rows editable, not silently discarded.
   // Server receipt already confirmed: persist removal before another write.
   // If local storage is unavailable, retain the same retry key on restart.
   const priorPaid=pendingPaidEntry
   if(choice.kind==='personal'||choice.kind==='shared')pendingPaidEntry=null
   try{await persistMemberDraft(memberEntries.value.slice(1))}
   catch(e){pendingPaidEntry=priorPaid;throw e}
   memberEntries.value.shift();sent++
   if(receiptRef.startsWith('proposal:'))
    await sharedMutationRef.value?.clearAcknowledgedIntent()
  }
  memberEntryNotice.value=(applied?applied+'件の資産移動を記録しました。':'')+
   (sent-applied?sent-applied+'件を HomeFlow 審査に送信しました。承認・入帳までは待入帳です。':'')
  memberRawText.value=''
  await refresh()
  tab.value='list'
 }catch(e){
  memberEntryError.value=(sent?sent+'件の受付を確認済み。残り'+memberEntries.value.length+'件：':'')+
   (e.message||'申請を送信できません')
  await refresh().catch(()=>{})
 }finally{memberEntryPending.value=false}
}
const ledgerEntries=computed(()=>{
 const byId=new Map(),drafts=[]
 for(const p of pendingMutations.value){
  if(p.operation==='create'&&p.entry){
   drafts.push({...p.entry,id:'pending:'+p.proposal_id,
    pending_approval:true,pending_operation:'create',pending_status:p.status,
    recorded_by:props.user.display_name||props.user.login_name||'家族'})
  }else if(p.source_entry_id!=null)byId.set(String(p.source_entry_id),p)
 }
 return [...sharedEntries.value.map(entry=>{
  const change=byId.get(String(entry.id))
  return change?{...entry,pending_approval:true,pending_operation:change.operation,
   pending_status:change.status,pending_preview:change.entry||null}:entry
 }),...drafts,...personalDocumentSbi.value]
})
const annualLedgerEntries=ref([])
async function loadAnnualLedgerYear(annualYear){
 const requested=String(annualYear||'')
 if(!/^[12]\d{3}$/.test(requested))throw Error('集計年を確認してください')
 const actor=props.user.user_id,ticket=epoch,all=[]
 let offset=0
 for(let page=0;page<101;page++){
  const result=await api('shared/entries?year='+encodeURIComponent(requested)+
   '&limit=100&offset='+offset)
  if(!alive||ticket!==epoch||actor!==props.user.user_id)
   throw Error('アカウントまたは集計期間が変更されました')
  if(result.ledger_scope!=='household'||!Array.isArray(result.items)||
   result.items.some(x=>!String(x.date||'').startsWith(requested)))
   throw Error('年間明細の取得範囲が一致しません')
  all.push(...result.items)
  if(result.next_offset==null){
   const personal=[];let pageOffset=0;
   for(let n=0;n<101;n++){
    const doc=await api('personal-document-sbi?year='+requested+'&offset='+pageOffset)
    if(!alive||ticket!==epoch||actor!==props.user.user_id)return
    if(doc.scope!=='personal'||doc.viewer_user_id!==actor||!Array.isArray(doc.items))
     throw Error('本人の資産移動履歴の所有者を確認できません')
    personal.push(...doc.items)
    if(doc.next_offset==null){annualPersonalDocumentSbi.value=personal;
     annualLedgerEntries.value=[...all,...personal]
     await reloadHouseholdReceipts(all,false)
     return}
    if(!Number.isInteger(doc.next_offset)||doc.next_offset<=pageOffset)throw Error('資産移動の読込位置が無効です')
    pageOffset=doc.next_offset
   }
   throw Error('資産移動履歴を全件読み込めません')
  }
  if(!Number.isInteger(result.next_offset)||result.next_offset<=offset)
   throw Error('年間明細のページ情報が無効です')
  offset=result.next_offset
 }
 throw Error('年間明細が多いため取得を完了できません')
}
async function openApproval(action,entry){
 if(!entry||entry.pending_approval)throw Error('審査中の記録は変更できません')
 if(entry.document_personal_sbi){
  const actor=props.user.user_id,original=[...personalDocumentSbi.value,...annualPersonalDocumentSbi.value]
   .find(x=>x.transfer_id===entry.transfer_id)
  if(!original||actor!==props.user.user_id)throw Error('本人の資産移動を確認できません')
  if(action!=='delete')throw Error('本人の資産移動の変更は編集画面から行ってください')
  const result=await api('personal-document-sbi/'+entry.transfer_id,
   request({expected_user_id:actor,expected_version:original.version},'DELETE'))
  if(result.item?.state!=='trashed')throw Error('削除状態を確認できません')
  await refresh()
  return result
 }
 const original=sharedEntries.value.find(x=>String(x.id)===String(entry.id))||
  annualLedgerEntries.value.find(x=>String(x.id)===String(entry.id))
 if(!original)throw Error('元の明細を確認できません')
 const result=await sharedMutationRef.value?.submitMutation(action,original,
  action==='update'?entry:null)
 if(!result?.proposalId&&!result?.applied)throw Error('明細変更の反映を確認できません')
 await refresh()
 if(result?.proposalId)await sharedMutationRef.value?.clearAcknowledgedIntent()
 if(annualLedgerEntries.value.some(x=>String(x.id)===String(entry.id)))
  await loadAnnualLedgerYear(String(selectedYear.value)).catch(e=>{error.value=e.message})
 return result
}
const memberLedger=makeFamilyLedgerContext({tab,month,selectedYear,entries:ledgerEntries,
 entryTypeFilter:selectedEntryType,load:()=>refresh(),more:()=>moreEntries(),
 annualEntries:annualLedgerEntries,loadAnnual:loadAnnualLedgerYear,
 openApproval,paymentEditor:memberPaymentEditor,memberPaymentChoices:memberLedgerPaymentOptions,
 onError:message=>{error.value=message}})
const memberReceiptLedgerIds=computed(()=>new Set([
 ...[...householdReceiptIndex.value.keys()].map(String),
 ...memberReceipts.value.flatMap(item=>{
 const ref=item.receipt_ref
 if(Number.isSafeInteger(Number(item.linked_entry_id))&&Number(item.linked_entry_id)>0)
  return [String(item.linked_entry_id)]
 if(ref.startsWith('entry:'))return [ref.slice(6)]
 if(ref.startsWith('proposal:'))return ['pending:'+ref.slice(9)]
 return []
 })
]))
let memberReceiptViewingId=''
function memberReceiptRefForId(id){
 return String(id).startsWith('pending:')?'proposal:'+String(id).slice(8):'entry:'+id
}
function closeMemberLedgerReceipt(){
 const current=memberLedger.viewedReceiptUrl.value
 if(current)URL.revokeObjectURL(current)
 memberLedger.viewedReceiptUrl.value=null;memberReceiptViewingId=''
}
async function viewMemberLedgerReceipt(id){
 const own=memberReceiptIndex.value.get(memberReceiptRefForId(id))
 const shared=householdReceiptIndex.value.get(Number(id))
 if(!own&&!shared){memberReceiptError.value='保存された小票が見つかりません';return}
 try{
  // Prefer your own uploaded image. Another member's image is read-only.
  const blob=own?await fetchMemberReceipt(own.receipt_id):await fetchHouseholdReceipt(id)
  closeMemberLedgerReceipt()
  memberReceiptViewingId=own?.receipt_id||''
  memberLedger.viewedReceiptUrl.value=URL.createObjectURL(blob)
 }catch(e){memberReceiptError.value='画像を表示できません：'+e.message}
}
async function removeMemberLedgerReceipt(){
 const id=memberReceiptViewingId
 if(!id||!confirm('画像を完全削除しますか？元の明細は残ります。'))return
 try{await deleteMemberReceipt(id);closeMemberLedgerReceipt()}
 catch(e){memberReceiptError.value='画像を削除できません：'+e.message}
}
memberLedger.receiptImageIds=memberReceiptLedgerIds
memberLedger.canDeleteReceipt=computed(()=>!!memberLedger.viewedReceiptUrl.value&&!!memberReceiptViewingId)
memberLedger.viewReceipt=viewMemberLedgerReceipt
memberLedger.closeReceipt=closeMemberLedgerReceipt
memberLedger.removeReceiptImage=removeMemberLedgerReceipt
async function selectMemberEditReceipt(event){
 const file=event.target?.files?.[0];if(event.target)event.target.value=''
 const entry=memberLedger.editingEntry.value
 if(!file||!entry||memberLedger.editSaving.value)return
 try{
  entry.receiptImage=await compressReceiptImage(file)
  entry.receiptFileName=file.name
  memberLedger.receiptSaveError.value=''
 }catch(e){memberLedger.receiptSaveError.value='画像を添付できません：'+e.message}
}
async function saveMemberLedgerEdit(){
 const edited=memberLedger.editingEntry.value
 if(!edited||memberLedger.editSaving.value)return
 const initial=sharedEntries.value.find(row=>String(row.id)===String(edited.id))||
  annualLedgerEntries.value.find(row=>String(row.id)===String(edited.id))||
  personalDocumentSbi.value.find(row=>String(row.id)===String(edited.id))
 if(!initial||edited.pending_approval){
  memberLedger.receiptSaveError.value='元の明細を確認してください';return
 }
 if(edited.allReadOnly){
  memberLedger.receiptSaveError.value='他の人の資産移動は閲覧のみ可能です';return
 }
 if(initial.document_personal_sbi){
  if(edited.type!=='transfer'||edited.transferTarget!=='sbi'||
    edited.category!=='投資・資産移動'||edited.paymentSource||edited.receiptImage){
   memberLedger.receiptSaveError.value='本人のSBI資産移動は種類・振替先・支払口座を変更できません';return
  }
  memberLedger.editSaving.value=true;memberLedger.receiptSaveError.value=''
  try{
   const applied=await api('personal-document-sbi/'+initial.transfer_id,
    request({expected_user_id:props.user.user_id,expected_version:initial.version,
     date:edited.date,effective_date:edited.transferDate||edited.transfer_date,
     amount_jpy:Number(edited.amount),merchant:String(edited.merchant||''),note:String(edited.note||'')},'PATCH'))
   if(applied.item?.version!==initial.version+1)throw Error('資産移動の更新結果を確認できません')
   memberLedger.cancelEdit();await refresh()
  }catch(e){memberLedger.receiptSaveError.value=e.message||'本人の資産移動を保存できません'}
  finally{memberLedger.editSaving.value=false}
  return
 }
 const fields=['date','time','amount','type','category','merchant','note']
 const paymentChanged=edited.type==='expense'&&!edited.paymentReadOnly&&
  edited.paymentSource!==edited.paymentOriginalChoice
 if(paymentChanged){
  const selected=resolveMemberPayment(edited.paymentSource,myAccounts.value,sharedCards.value)
  if(initial.future_paid_owner_user_id===props.user.user_id&&
     memberAccountCorrectionEnabled.value){
   if(edited.paymentReadOnly||!selected||!['personal','cash'].includes(selected.kind))
   {memberLedger.receiptSaveError.value='本人のカードまたは現金を選択してください';return}
   edited.payment_source=selected.kind==='cash'?'':(
    (selected.account.account_kind==='credit_card'?'cc:':'prepaid:')+
    selected.account.account_id)
  }else if(initial.family_account_id){
   memberLedger.receiptSaveError.value='個人カードの変更権限がありません';return
  }else{
   if(initial.shared_entry_requester_user_id!==props.user.user_id||
     edited.paymentReadOnly||!selected||!['cash','shared'].includes(selected.kind))
   {memberLedger.receiptSaveError.value='他の人の支払方法を変更できません';return}
   edited.payment_source=selected.kind==='shared'?selected.card.card_name:''
  }
 }
 if(initial.type==='expense'&&initial.payment_source&&edited.type!=='expense'){
  memberLedger.receiptSaveError.value='カード決済を収入に変更できません';return
 }
 const ledgerChanged=fields.some(key=>String(initial[key]??'')!==String(edited[key]??''))||paymentChanged
 if(!ledgerChanged&&!edited.receiptImage){memberLedger.cancelEdit();return}
 memberLedger.editSaving.value=true;memberLedger.receiptSaveError.value=''
 try{
  if(ledgerChanged){
   // A household amount/payment edit must be accepted for review before
   // its replacement image is stored; the original image remains untouched.
   const submitted=await openApproval('update',edited)
   if(edited.receiptImage){
    if(!submitted?.proposalId)throw Error('画像に必要な審査番号を確認できません')
    const receiptRef='proposal:'+submitted.proposalId
    try{await saveMemberReceipt(edited,receiptRef)}
    catch(e){
     memberReceiptRetry.value.push({record:edited,receiptRef})
     memberReceiptError.value='明細の審査は送信済みです。画像を再送してください：'+e.message
    }
   }
  }else if(edited.receiptImage){
   // Image-only changes can be applied directly to the user's own receipt.
   // Delete the old object only after the new one is durably stored.
   const current=memberReceiptIndex.value.get('entry:'+edited.id)
   const savedId=await saveMemberReceipt(edited,'entry:'+edited.id)
   if(current&&savedId!==current.receipt_id){
    try{await deleteMemberReceipt(current.receipt_id)}
    catch(e){memberReceiptError.value='古い画像を削除できません：'+e.message}
   }
  }
  memberLedger.cancelEdit()
 }catch(e){memberLedger.receiptSaveError.value=e.message||'変更を保存できません'}
 finally{memberLedger.editSaving.value=false}
}
memberLedger.selectEditReceipt=selectMemberEditReceipt
memberLedger.saveEdit=saveMemberLedgerEdit
provide('kakeibo-page-context',{
 ...makeFamilyStatsContext({tab,month,selectedYear,stats:monthlyReport,
   annualStats:annualReport,entryType:selectedEntryType,
   onPaymentMethodDetails:memberLedger.openPaymentMethodDetails,
   onCategoryDetails:memberLedger.openCategoryDetails}),
 ...memberLedger,
 // Ledger details, edit dialogs and reports use the same Japanese labels.
 categoryLabel:memberCategoryLabel
})
watch(selectedYear,n=>{if(Number.isInteger(n)&&n>=2000&&n<=9998)year.value=String(n)})

const pageOffset=ref(null)
const ledgerLoading=ref(false)
const entryCategories=computed(()=>[...new Set(ledgerEntries.value.map(x=>x.category))])
const visibleEntries=computed(()=>ledgerEntries.value.filter(x=>selectedEntryType.value==='all'||x.type===selectedEntryType.value))
const entryDays=computed(()=>{
 const byDay=new Map()
 for(const entry of visibleEntries.value){
  if(!byDay.has(entry.date))byDay.set(entry.date,[])
  byDay.get(entry.date).push(entry)
 }
 return [...byDay].map(([date,items])=>({date,items,
  amount:items.reduce((sum,row)=>sum+(row.type==='income'?Number(row.amount||0):row.type==='expense'?-Number(row.amount||0):0),0)}))
})
async function moreEntries(){
 if(ledgerLoading.value||pageOffset.value===null)return
 const user=props.user.user_id,ticket=epoch
 ledgerLoading.value=true
 try{
  const next=await api('shared/entries?limit=100&month='+encodeURIComponent(month.value)+'&offset='+pageOffset.value)
  if(user!==props.user.user_id||ticket!==epoch)return
  if(next.ledger_scope!=='household')throw Error('家庭明細のアクセス範囲を確認できません')
  const current=new Set(sharedEntries.value.map(x=>x.id))
  sharedEntries.value.push(...(next.items||[]).filter(x=>!current.has(x.id)))
  pageOffset.value=next.next_offset
 }catch(e){if(ticket===epoch)error.value=e.message}
 finally{ledgerLoading.value=false}
}

async function api(path,options={}){
 const res=await fetch('/api/family-finance/'+path,{credentials:'same-origin',
  cache:'no-store',...options})
 const data=await res.json().catch(()=>({}))
 if(!res.ok||data.ok!==true)throw Error(data.code||'读取失败')
 return data
}
const memberDuplicateGroups=computed(()=>{
 const groups=new Map()
 for(const e of sharedEntries.value){
  if(!e||!['expense','income'].includes(e.type)||e.pending_approval)continue
  const date=String(e.date||''),merchant=String(e.merchant||'').trim().toLowerCase()
  if(!date||!merchant||!Number.isSafeInteger(Number(e.amount)))continue
  const key=[date,e.type,Number(e.amount),merchant].join('|')
  const rows=groups.get(key)||[];rows.push(e);groups.set(key,rows)
 }
 return [...groups.values()].filter(g=>g.length>1).slice(0,15)
})
const memberArchivedAccounts=computed(()=>myAccounts.value.filter(a=>
 a.is_archived&&a.origin==='member_created'))
const memberSharedTrash=ref([]),memberPersonalDocumentSbiTrash=ref([]),memberTrashBusy=ref(false)
const memberTrashError=ref(''),memberTrashNotice=ref('')
async function loadMemberSharedTrash(){
 if(memberTrashBusy.value)return
 const actor=props.user.user_id,ticket=epoch
 memberTrashBusy.value=true;memberTrashError.value=''
 try{
  const [result,personalFirst]=await Promise.all([
   api('shared-entries?state=deleted'),api('personal-document-sbi?state=trashed')])
  if(ticket!==epoch||actor!==props.user.user_id)return
  if(personalFirst.scope!=='personal'||personalFirst.viewer_user_id!==actor||
   personalFirst.state!=='trashed'||!Array.isArray(personalFirst.items))
   throw Error('本人の資産移動の回収記録を確認できません')
  const personal=[...personalFirst.items]
  let offset=personalFirst.next_offset
  for(let page=0;offset!==null&&page<100;page++){
   const next=await api('personal-document-sbi?state=trashed&offset='+offset)
   if(ticket!==epoch||actor!==props.user.user_id)return
   if(next.scope!=='personal'||next.viewer_user_id!==actor||!Array.isArray(next.items)||
    next.next_offset!==null&&next.next_offset<=offset)throw Error('本人の資産移動回収ページが無効です')
   personal.push(...next.items);offset=next.next_offset
  }
  if(offset!==null)throw Error('回収済み資産移動の一覧が長すぎます')
  memberPersonalDocumentSbiTrash.value=personal
  if(!Array.isArray(result.items)||result.items.some(x=>x.state!=='deleted'))
   throw Error('回収箱の取得範囲を確認できません')
  memberSharedTrash.value=result.items
 }catch(e){if(ticket===epoch)memberTrashError.value=e.message}
 finally{memberTrashBusy.value=false}
}
async function restoreMemberSharedTrash(row){
 if(memberTrashBusy.value)return
 const personalTransfer=row?.entry?.type==='transfer'&&
  row?.creator_user_id===props.user.user_id
 if(!window.confirm(personalTransfer
  ?'本人の配偶者への資産移動を復元しますか？管理者承認は不要です。'
  :'家庭明細の復元を HomeFlow 管理者へ申請しますか？承認前は復元されません。'))return
 memberTrashBusy.value=true;memberTrashError.value='';memberTrashNotice.value=''
 try{
  const receipt=await sharedMutationRef.value?.submitRestore(row)
  if(receipt?.applied&&personalTransfer){
   memberTrashNotice.value='本人の資産移動を復元しました。管理者承認は不要です。'
   await refresh()
  }else if(receipt?.proposalId){
   memberTrashNotice.value='復元申請を HomeFlow に提出しました。承認後に明細へ反映されます。'
  }else throw Error('復元結果を確認できません')
 }catch(e){memberTrashError.value=e.message}
 finally{memberTrashBusy.value=false;await loadMemberSharedTrash()}
}
async function restoreMemberPersonalSbi(row){
 if(memberTrashBusy.value||!row?.transfer_id||row.state!=='trashed')return
 memberTrashBusy.value=true;memberTrashError.value='';memberTrashNotice.value=''
 try{
  const receipt=await api('personal-document-sbi/'+row.transfer_id,
   request({expected_user_id:props.user.user_id,expected_version:row.version,action:'restore'}))
  if(receipt.item?.state!=='active')throw Error('復元状態を確認できません')
  memberTrashNotice.value='本人のSBI資産移動を復元しました。家庭の承認は不要です。'
  await refresh()
 }catch(e){memberTrashError.value=e.message||'本人の資産移動を復元できません'}
 finally{memberTrashBusy.value=false;await loadMemberSharedTrash()}
}
const memberTrashCount=computed(()=>memberArchivedAccounts.value.length+
 memberSharedTrash.value.length+memberPersonalDocumentSbiTrash.value.length)
const memberJobs=ref({fixed:[],sbi:[],occurrences:[]}),memberJobsBusy=ref(false),memberJobsError=ref('')
async function loadMemberJobStatus(){
 if(memberJobsBusy.value)return
 const actor=props.user.user_id,ticket=epoch
 memberJobsBusy.value=true;memberJobsError.value=''
 try{
  const [fixed,sbi,occ]=await Promise.allSettled([
   api('member-fixed-costs'),api('member-sbi-plans'),api('recurring-occurrences')
  ])
  if(ticket!==epoch||actor!==props.user.user_id)return
  if(fixed.status!=='fulfilled'||fixed.value.scope!=='personal'||!Array.isArray(fixed.value.items))
   throw Error('本人の固定費の状態を確認できません')
  if(sbi.status!=='fulfilled'||sbi.value.viewer_user_id!==actor||!Array.isArray(sbi.value.items))
   throw Error('本人の積立の状態を確認できません')
  const own=rows=>rows.filter(x=>x.owner_user_id===actor)
  if(own(fixed.value.items).length!==fixed.value.items.length||own(sbi.value.items).length!==sbi.value.items.length)
   throw Error('他のユーザーの予定が含まれています')
  memberJobs.value={fixed:own(fixed.value.items),sbi:own(sbi.value.items),
   occurrences:occ.status==='fulfilled'&&Array.isArray(occ.value.items)?occ.value.items:[]}
  if(occ.status==='rejected')
   memberJobsError.value='周期実行履歴は現在利用できません。登録済み予定と家庭明細の実際の入帳は別です。'
 }catch(e){if(ticket===epoch)memberJobsError.value=e.message}
 finally{memberJobsBusy.value=false}
}
const memberPortfolioVersions=ref(new Map())
async function memberPrepaidApi(path,options={}){
 if(path==='prepaid-alerts'&&options.method==='POST'){
  const body=JSON.parse(options.body||'{}')
  const account=myAccounts.value.find(a=>a.account_id===body.accountId &&
   a.owner_user_id===props.user.user_id&&a.account_kind==='prepaid' &&
   a.origin==='member_created'&&!a.is_archived)
  if(!account)throw Error('本人のカードだけ設定できます')
  return api('prepaid-alerts',options)
 }
 if(path!=='prepaid-report'||(options.method&&options.method!=='GET'))
  throw Error('本人のプリペイド一覧のみ読み取れます')
 const result=await api('prepaid-report')
 if(result.scope!=='personal'||result.owner_user_id!==props.user.user_id)
  throw Error('カードの個人範囲を確認できません')
 return result
}
async function saveMemberPrepaidOpening(card,amount){
 if(!card?.account_id||!Number.isSafeInteger(amount)||amount<0||amount>100000000)
  throw Error('本人の期首残高を確認してください')
 const account=myAccounts.value.find(a=>a.account_id===card.account_id&&
  a.owner_user_id===props.user.user_id&&a.account_kind==='prepaid'&&
  a.origin==='member_created')
 if(!account||account.version!==card.version)throw Error('カード情報が更新されました。再読み込みしてください')
 const result=await api('accounts/'+account.account_id,request({
  version:account.version,opening_balance:amount,expected_user_id:props.user.user_id},'PATCH'))
 if(result.ledger_changed!==false)throw Error('本人の期首残高の更新を確認できません')
 await refresh()
}
function openMemberWalletHistory(name,mode){
 tab.value='list'
 notice.value=name+' の'+(mode==='charge'?'チャージ':'利用・振替')+'記録を確認してください'
}
const memberRecurringRef=ref(null)
async function memberSbiApi(path,options={}){
 const actor=props.user.user_id,ticket=epoch
 const method=options.method||'GET'
 if(path==='ai-ocr'&&method==='POST'){
  const result=await api('ai-ocr',options)
  if(result.engine!=='gemma4')throw Error('画像OCRの結果を確認できません')
  return result
 }
 if(method==='PUT'){
  const map={'investment-portfolio/holding':'holding',
   'investment-portfolio/price':'price',
   'investment-portfolio/holdings-bulk':'holdings-bulk'}
  const sub=map[path]
  if(!sub)throw Error('積立計画の設定は管理の「積立」から本人が変更できます。管理者承認は不要です')
  const body=JSON.parse(options.body||'{}')
  const key=(x)=>x.fundCode+':'+x.accountType
  const versions=memberPortfolioVersions.value
  let payload
  if(sub==='holding'){
   const found=versions.get(key(body))
   payload={expected_user_id:actor,fundCode:body.fundCode,fundName:body.fundName,
    accountType:body.accountType,units:Number(body.units),
    acquisitionCost:Number(body.acquisitionCost),expectedVersion:found?.version||0}
  }else if(sub==='price'){
   payload={expected_user_id:actor,fundCode:body.fundCode,
    navPer10000:Number(body.navPer10000),priceDate:body.priceDate}
  }else{
   payload={expected_user_id:actor,holdings:(body.holdings||[]).map(h=>({
    fundCode:h.fundCode,accountType:h.accountType,
    units:Number(h.units),acquisitionCost:Number(h.acquisitionCost),
    expectedUnits:Number(h.expectedUnits),
    expectedAcquisitionCost:Number(h.expectedAcquisitionCost),
    expectedVersion:versions.get(key(h))?.version||0
   }))}
  }
  const saved=await api('manual-holdings/'+sub,request(payload,'PUT'))
  if(actor!==props.user.user_id||ticket!==epoch)throw Error('アカウントが変更されました')
  if(saved.ledger_changed!==false)throw Error('保有情報の変更を確認できません')
  return saved
 }
 const match=/^investment-portfolio\?month=(20\d{2}-(?:0[1-9]|1[0-2]))$/.exec(path)
 if(!match||method!=='GET')throw Error('本人の投資情報だけを読み取れます')
 const [planResult,occurrenceResult,holdingsResult]=await Promise.allSettled([
  api('member-sbi-plans'),api('recurring-occurrences'),api('manual-holdings')
 ])
 if(actor!==props.user.user_id||ticket!==epoch)throw Error('利用者が切り替わりました')
 if(planResult.status!=='fulfilled'||planResult.value.ok!==true)
  throw Error('本人の積立設定を読み込めませんでした')
 if(holdingsResult.status!=='fulfilled'||holdingsResult.value.scope!=='personal'||
  holdingsResult.value.owner_user_id!==actor||!Array.isArray(holdingsResult.value.holdings))
  throw Error('本人の保有情報を読み込めませんでした')
 if(!Array.isArray(planResult.value.items)||planResult.value.items.some(p=>p.owner_user_id!==actor))
  throw Error('本人の積立設定の所有者を確認できません')
 const holdings=holdingsResult.value.holdings
 if(holdings.some(h=>h.owner_user_id!==actor))throw Error('本人以外の保有情報が含まれています')
 memberPortfolioVersions.value=new Map(holdings.map(h=>[h.fund_code+':'+h.account_type,{version:h.version}]))
 const occurrences=occurrenceResult.status==='fulfilled'&&
  Array.isArray(occurrenceResult.value.items)?occurrenceResult.value.items:null
 return memberInvestmentSnapshot({userId:actor,requestedMonth:match[1],
  plans:planResult.value.items,occurrences,manualHoldings:holdings})
}
function openMemberInvestmentPlan(plan=null){
 const target=memberRecurringRef.value
 if(!target?.openPlanEditor)throw Error('積立登録の画面を開けません。管理の積立を再表示してください')
 target.openPlanEditor(plan)
}
async function refresh(){
 const ticket=++epoch,user=props.user.user_id
 // Keep the last verified snapshot while network requests are in flight.
 // Clearing all five panels on every refresh made the spouse PWA visibly flash.
 error.value=''
 try{
  const [a,b,c,d,e,f,personalSbiResult,personalYearResult]=await Promise.all([
   api('accounts'),api('personal/assets'),
   api('shared/entries?limit=100&month='+encodeURIComponent(month.value)),
   api('shared/stats?month='+month.value),
   api('shared/stats?year='+year.value),
   api('legacy-card-shares').catch(e=>({incoming:[],share_error:e.message})),
   api('personal-document-sbi?month='+encodeURIComponent(month.value)),
   api('personal-document-sbi?year='+encodeURIComponent(year.value))
  ])
  if(!alive||ticket!==epoch||user!==props.user.user_id)return
  if(personalSbiResult.scope!=='personal'||personalSbiResult.viewer_user_id!==user||
   personalYearResult.scope!=='personal'||personalYearResult.viewer_user_id!==user||
   !Array.isArray(personalSbiResult.items)||
   !Number.isSafeInteger(personalSbiResult.transfer_total_jpy)||
   !Number.isSafeInteger(personalYearResult.transfer_total_jpy))
   throw Error('本人のSBI資産移動履歴が不完整です')
  if(a.account_scope!=='personal'||b.scope!=='personal'||b.viewer_user_id!==user||
   c.ledger_scope!=='household'||d.ledger_scope!=='household'||e.ledger_scope!=='household')
   throw Error('帳簿のアクセス範囲を確認できません')
  if((a.items||[]).some(x=>x.owner_user_id!==user))throw Error('口座の所有者が一致しません')
  accounts.value=a.items||[];assets.value=b.accounts||[]
  cardSharingError.value=f.share_error||''
  sharedCards.value=f.scope==='granted-cards'&&Array.isArray(f.incoming)?f.incoming:[]
  sharedEntries.value=c.items||[];pageOffset.value=c.next_offset;
  const personalTransfers=[...personalSbiResult.items]
  let nextPersonalOffset=personalSbiResult.next_offset
  for(let page=0;nextPersonalOffset!==null&&page<100;page++){
   const further=await api('personal-document-sbi?month='+encodeURIComponent(month.value)+
    '&offset='+nextPersonalOffset)
   if(!alive||ticket!==epoch||user!==props.user.user_id)return
   if(further.scope!=='personal'||further.viewer_user_id!==user||
    !Array.isArray(further.items)||further.transfer_total_jpy!==personalSbiResult.transfer_total_jpy)
    throw Error('本人の資産移動履歴が更新されました。再読込してください')
   personalTransfers.push(...further.items)
   if(further.next_offset!==null&&further.next_offset<=nextPersonalOffset)
    throw Error('本人の資産移動履歴の位置が無効です')
   nextPersonalOffset=further.next_offset
  }
  if(nextPersonalOffset!==null)throw Error('本人の資産移動履歴の件数が多すぎます')
  personalDocumentSbi.value=personalTransfers;
  memberPaymentReassignmentEnabled.value=c.payment_reassignment_enabled===true;
  memberAccountCorrectionEnabled.value=c.account_corrections_enabled===true;
  await Promise.all([
   loadMemberMerchantRules(),reloadMemberReceipts(),loadMemberCategories(),
   reloadHouseholdReceipts(c.items||[],true)
  ])
  monthlyReport.value={...d,
   transferTotal:Number(d.transferTotal||0)+personalSbiResult.transfer_total_jpy,
   transferCount:Number(d.transferCount||0)+personalSbiResult.transfer_count};
  annualReport.value={...e,
   transferTotal:Number(e.transferTotal||0)+personalYearResult.transfer_total_jpy,
   transferCount:Number(e.transferCount||0)+personalYearResult.transfer_count};
  memberUsageRevision.value++
  totals.value={income:d.income,expense:d.total,
   transfer:Number(d.transferTotal||0)+personalSbiResult.transfer_total_jpy}
  yearly.value={totals:{income:e.income,expense:e.total,
   transfer:Number(e.transferTotal||0)+personalYearResult.transfer_total_jpy},
   net_income_expense:Number(e.income||0)-Number(e.total||0)}
  memberLastRefreshAt.value=new Date()
  // Only the requesting member receives these read-only pending previews.
  try{
   const pending=await api('shared-mutation-requests?view=ledger&month='+
    encodeURIComponent(month.value))
   if(ticket===epoch&&user===props.user.user_id){
    if(pending.ledger_scope!=='member_pending_only'||!Array.isArray(pending.items))
     throw Error('審査状態の検証に失敗しました')
    pendingMutations.value=pending.items
   }
  }catch(pendingError){
   if(ticket===epoch)error.value='審査中の明細を確認できません：'+pendingError.message
  }
 }catch(e){if(ticket===epoch)error.value=e.message}
}
function request(body,method='POST'){return {method,headers:{'content-type':'application/json'},body:JSON.stringify(body)}}
async function createAccount(type,name){
 const source=String(type||kind.value)
 const title=String(name||label.value).trim()
 if(busy.value||!title||title.length>80||!kinds.some(k=>k[0]===source))throw Error('口座の種類と名称を確認してください')
 const ticket=epoch,user=props.user.user_id
 busy.value=true;error.value=''
 try{
  const r=await api('accounts',request({label:title,account_kind:source,expected_user_id:user}))
  if(ticket!==epoch||user!==props.user.user_id)throw Error('アカウントが変更されました')
  if(r.ledger_changed!==false||r.owner_user_id!==user)throw Error('口座の所有者を確認できません')
  label.value='';notice.value='本人の口座を追加しました';await refresh()
  return r
 }catch(e){if(ticket===epoch)error.value=e.message;throw e}
 finally{busy.value=false}
}
async function modify(a,changes){
 if(busy.value||a.owner_user_id!==props.user.user_id||a.origin!=='member_created')return
 if(changes.is_archived===true&&!confirm('この口座をアーカイブしますか？記録は削除されません。'))return
 const ticket=epoch,user=props.user.user_id;busy.value=true;error.value=''
 try{
  const r=await api('accounts/'+encodeURIComponent(a.account_id),request(
   {version:a.version,...changes,expected_user_id:user},'PATCH'))
  if(ticket!==epoch||user!==props.user.user_id)return
  if(r.ledger_changed!==false)throw Error('変更結果の確認が必要です')
  renameId.value='';rename.value='';await refresh()
 }catch(e){if(ticket===epoch)error.value=e.message}finally{busy.value=false}
}
function edit(a){if(a.owner_user_id!==props.user.user_id||a.origin==='legacy')return
 renameId.value=a.account_id;rename.value=a.label}
const personalBackupBusy=ref(false),personalBackupMessage=ref('')
const personalBackupRevision=ref(0)
async function exportPersonalAccounts(){
 if(personalBackupBusy.value)return
 const password=window.prompt('本人の設定を暗号化して保存します。10文字以上のパスワードを入力してください。')
 if(password===null)return
 if(password.length<10){personalBackupMessage.value='10文字以上のパスワードが必要です';return}
 personalBackupBusy.value=true;personalBackupMessage.value=''
 try{
  const actor=props.user.user_id
  const [accountsResult,rulesResult,fixedResult]=await Promise.all([
   api('accounts'),api('member-merchant-rules'),api('member-fixed-costs')
  ])
  if(actor!==props.user.user_id)throw Error('バックアップ中にアカウントが変更されました')
  if(accountsResult.account_scope!=='personal'||
   rulesResult.scope!=='personal'||rulesResult.viewer_user_id!==actor||
   fixedResult.scope!=='personal'||!Array.isArray(fixedResult.items)||
   accountsResult.items?.some(a=>a.owner_user_id!==actor)||
   fixedResult.items.some(p=>p.owner_user_id!==actor))
   throw Error('本人の設定を安全に取得できません')
  const record={format:'kakeibo-member-personal-settings-v2',exported_at:new Date().toISOString(),
   owner_user_id:actor,scope:'personal_settings_only',
   accounts:accountsResult.items||[],merchant_rules:rulesResult.items||[],
   fixed_costs:fixedResult.items||[],categories:memberCategoryRecords.value}
  const blob=await encryptBackupBlob(new Blob([JSON.stringify(record)],{type:'application/json'}),password)
  if(props.user.user_id!==actor)throw Error('保存中にアカウントが変更されました')
  const url=URL.createObjectURL(blob),link=document.createElement('a')
  link.href=url;link.download='kakeibo-personal-settings-'+new Date().toISOString().slice(0,10)+'.enc'
  document.body.appendChild(link);link.click();link.remove()
  setTimeout(()=>URL.revokeObjectURL(url),60000)
  personalBackupMessage.value='本人の口座・固定費・店舗ルール・カテゴリ設定を暗号化して保存しました。取引履歴・画像・投資約定・他人のデータは含まれません。'
 }catch(e){personalBackupMessage.value='保存できませんでした：'+e.message}
 finally{personalBackupBusy.value=false}
}
// Private portable archive: historic entries are evidence, never a direct
// request to re-post household entries without the ordinary HomeFlow review.
async function exportMemberArchive(){
 if(personalBackupBusy.value)return
 const password=window.prompt('本人の取引履歴・画像を暗号化して保存します。10文字以上のパスワードを入力してください。')
 if(password===null)return
 if(password.length<10){personalBackupMessage.value='10文字以上のパスワードが必要です';return}
 personalBackupBusy.value=true;personalBackupMessage.value=''
 const actor=props.user.user_id,household=props.user.household_id,ticket=epoch
 const check=()=>{if(!alive||props.user.user_id!==actor||
   props.user.household_id!==household||epoch!==ticket)
   throw Error('アーカイブ中に本人のログイン状態が変更されました')}
 try{
  const archive=await collectMemberArchive({actor,household,check,get:path=>api(path),
   image:async receiptId=>{
    check()
    const response=await fetch('/api/family-finance/member-receipts/'+
     encodeURIComponent(receiptId),{credentials:'same-origin',cache:'no-store'})
    if(!response.ok)throw Error('画像を取得できません：'+receiptId)
    return response.blob()
   }})
  check()
  const body=new Blob([JSON.stringify(archive)],{type:'application/json'})
  if(body.size>73*1024*1024)throw Error('暗号化サイズ上限を超えています')
  const encrypted=await encryptBackupBlob(body,password)
  check()
  const url=URL.createObjectURL(encrypted),link=document.createElement('a')
  link.href=url;link.download='kakeibo-personal-archive-'+new Date().toISOString().slice(0,10)+'.enc'
  document.body.appendChild(link);link.click();link.remove()
  setTimeout(()=>URL.revokeObjectURL(url),60000)
  personalBackupMessage.value='本人の設定・'+archive.receipts.length+'件の画像・本人取引の監査記録・'+
   archive.manual_holdings.length+'件の手動保有情報を暗号化しました。'+
   '実際の銀行・証券会社の履歴照合と家庭明細の復元は別途必要です。'
 }catch(e){personalBackupMessage.value='アーカイブを保存できませんでした：'+e.message}
 finally{personalBackupBusy.value=false}
}
async function importPersonalBackup(event){
 const file=event.target?.files?.[0]
 if(event.target)event.target.value=''
 if(!file||personalBackupBusy.value)return
 if(file.size>75*1024*1024){personalBackupMessage.value='バックアップが大きすぎます';return}
 const password=window.prompt('暗号化バックアップのパスワードを入力してください。')
 if(password===null)return
 personalBackupBusy.value=true;personalBackupMessage.value=''
 try{
  const actor=props.user.user_id
  const decrypted=await decryptBackupBlob(file,password)
  if(decrypted.format!=='json')throw Error('本人用JSONバックアップを選択してください')
  const data=JSON.parse(await decrypted.blob.text())
  if(!['kakeibo-member-account-settings-v1','kakeibo-member-personal-settings-v2',
   'kakeibo-member-private-archive-v3'].includes(data?.format)||
   data.owner_user_id!==actor||!['personal_settings_only','personal_account_settings_only',
   'personal_history_evidence_and_settings'].includes(data.scope)||
   !Array.isArray(data.accounts)||data.accounts.some(a=>a.owner_user_id!==actor))
   throw Error('このバックアップは別のユーザーのものか、形式が一致しません')
  const archiveV3=data.format==='kakeibo-member-private-archive-v3'
  const newer=data.format!=='kakeibo-member-account-settings-v1'
  if(archiveV3&&(data.household_id!==props.user.household_id||
    !Array.isArray(data.manual_holdings)||data.manual_holdings.length>100||
    !Array.isArray(data.receipts)||data.receipts.length>10000||
    !Array.isArray(data.recurring_plans)||data.recurring_plans.length>60||
    data.recurring_plans.some(p=>p.owner_user_id!==actor)||
    !data.history||typeof data.history!=='object'||Array.isArray(data.history)||
    data.manual_holdings.some(h=>h.owner_user_id!==actor)||
    data.receipts.some(r=>typeof r.receipt_ref!=='string'||r.receipt_ref.length>96)))
   throw Error('本人のアーカイブの所有者または形式を確認できません')
  if((newer&&(!Array.isArray(data.merchant_rules)||data.merchant_rules.length>200||
      !Array.isArray(data.categories)||data.categories.length>80||
      !Array.isArray(data.fixed_costs)||data.fixed_costs.length>200||
      data.fixed_costs.some(p=>p.owner_user_id!==actor)))||
     data.accounts.length>100||data.accounts.some(a=>a.owner_user_id!==actor))
   throw Error('設定の件数や所有者を確認できません')
  const [existing,currentAccounts,currentFixed,currentCategories]=await Promise.all([
   api('member-merchant-rules'),api('accounts'),api('member-fixed-costs'),api('member-categories')
  ])
  if(currentCategories.scope!=='personal'||currentCategories.viewer_user_id!==actor||
   !Array.isArray(currentCategories.items))throw Error('本人のカテゴリを確認できません')
  if(existing.scope!=='personal'||existing.viewer_user_id!==actor||
     currentAccounts.account_scope!=='personal'||
     currentFixed.scope!=='personal'||!Array.isArray(currentFixed.items)||
     !Array.isArray(currentAccounts.items)||
     currentAccounts.items.some(a=>a.owner_user_id!==actor))
   throw Error('本人の設定を安全に確認できません')
  const rules=newer?data.merchant_rules:[],categories=newer?data.categories:[],
   oldFixed=newer?data.fixed_costs:[]
  const existingKeys=new Set((existing.items||[]).map(r=>r.keyword))
  const recoverable=rules.filter(r=>r&&typeof r.keyword==='string'&&
   r.keyword.trim().length>=2&&r.keyword.length<=120&&
   typeof r.category==='string'&&r.category.length<=100&&
   typeof r.payment_source==='string'&&r.payment_source.length<=160&&
   (r.category||r.payment_source)&&!existingKeys.has(r.keyword))
  const accountCandidates=data.accounts.filter(a=>a.origin==='member_created'&&
    typeof a.account_id==='string'&&/^[a-f0-9]{32}$/i.test(a.account_id)&&
    typeof a.label==='string'&&a.label.trim()&&a.label.length<=80&&
    kinds.some(k=>k[0]===a.account_kind))
  if(accountCandidates.length!==data.accounts.filter(a=>a.origin==='member_created').length)
   throw Error('バックアップ内の口座情報が不正です')
  if(!confirm(archiveV3?
   '本人の不足している設定・手動保有銘柄・有効な画像を復元しますか？家庭明細や銀行・証券の実取引は直接復元しません。':
   '不足している本人の口座・固定費・店舗ルール・カテゴリを復元しますか？既存設定と家庭明細は上書きしません。'))return
  if(actor!==props.user.user_id)throw Error('アカウントが変更されました')
  let categoriesAdded=0,rulesAdded=0,rulesSkipped=0,accountsAdded=0,accountsSkipped=0,
      fixedAdded=0,fixedSkipped=0
  const accountMap=new Map(),nextAccounts=[...currentAccounts.items]
  const verifyActor=()=>{if(actor!==props.user.user_id)throw Error('復元中にユーザーが変更されました')}
  for(const a of accountCandidates){
   verifyActor()
   const match=nextAccounts.find(x=>x.origin==='member_created'&&
    x.label===a.label.trim()&&x.account_kind===a.account_kind)
   if(match){accountMap.set(a.account_id,match.account_id);accountsSkipped++;continue}
   const closing=Number.isInteger(a.closing_day)&&a.closing_day>=0&&a.closing_day<=31?a.closing_day:null
   const balance=Number.isSafeInteger(a.opening_balance)&&a.opening_balance>=0&&
    a.opening_balance<=999999999999?a.opening_balance:0
   const sort=Number.isInteger(a.sort_order)&&Math.abs(a.sort_order)<=10000?a.sort_order:0
   const created=await api('accounts',request({
    expected_user_id:actor,label:a.label.trim(),account_kind:a.account_kind,
    closing_day:closing,opening_balance:balance,sort_order:sort,
    is_default:a.is_default===1||a.is_default===true
   }))
   if(created.owner_user_id!==actor||created.ledger_changed!==false||
    !/^[a-f0-9]{32}$/.test(created.account_id||''))
    throw Error('口座の復元結果を確認できません')
   accountMap.set(a.account_id,created.account_id);accountsAdded++
   nextAccounts.push({...a,account_id:created.account_id,label:a.label.trim(),origin:'member_created',
    is_archived:0,version:1})
   if(a.is_archived===1||a.is_archived===true){
    const archived=await api('accounts/'+created.account_id,request({
     expected_user_id:actor,version:1,is_archived:true
    },'PATCH'))
    if(archived.ledger_changed!==false)throw Error('口座の保管状態を確認できません')
    nextAccounts[nextAccounts.length-1].is_archived=1
   }
  }
  const paymentChoices=buildMemberPaymentChoices(nextAccounts,sharedCards.value)
  const usableSource=(source)=>paymentChoices.some(p=>p.value===source)
  const translateSource=(source)=>typeof source!=='string'?'':
   source.startsWith('personal:')?
    ('personal:'+(accountMap.get(source.slice(9))||source.slice(9))):source
  const fixedSeen=new Set(currentFixed.items.map(p=>[
   p.name,p.amount,p.scheduleType,p.intervalMonths,
   JSON.stringify(p.monthDays),JSON.stringify(p.weekdays),p.category,
   p.paymentSource,p.startMonth].join('\u0000')))
  for(const p of oldFixed){
   verifyActor()
   const source=translateSource(p.paymentSource)
   const stamp=[p.name,p.amount,p.scheduleType,p.intervalMonths,
    JSON.stringify(p.monthDays),JSON.stringify(p.weekdays),p.category,
    source,p.startMonth].join('\u0000')
   if(fixedSeen.has(stamp)){fixedSkipped++;continue}
   if(!usableSource(source)||!['monthly','weekly','workday'].includes(p.scheduleType)||
      !Array.isArray(p.monthDays)||!Array.isArray(p.weekdays)||p.monthDays.length<1||
      p.weekdays.length<1||!Number.isSafeInteger(Number(p.amount))||
      typeof p.name!=='string'||!p.name.trim()||
      typeof p.category!=='string'||!p.category.trim()||
      typeof p.startMonth!=='string'){
    fixedSkipped++;continue
   }
   const saved=await api('member-fixed-costs',request({
    expected_user_id:actor,idempotency_key:'member-fixed:'+crypto.randomUUID(),
    name:p.name,amount_jpy:Number(p.amount),schedule_type:p.scheduleType,
    interval_months:p.intervalMonths,month_days:p.monthDays,weekdays:p.weekdays,
    category:p.category,payment_source:source,start_month:p.startMonth,posting_mode:'manual'
   }))
   if(saved.ledger_applied!==false||saved.plan?.owner_user_id!==actor)
    throw Error('固定費の復元結果を確認できません')
   fixedAdded++;fixedSeen.add(stamp)
   if(p.enabled===false){
    await api('member-fixed-costs/'+saved.plan.plan_id+'/toggle',request({
     expected_user_id:actor,version:saved.plan.version,enabled:false
    }))
   }
  }
  for(const c of categories){
   if(!c||!['expense','income'].includes(c.type)||typeof c.name!=='string'||
      !c.name.trim()||c.name.length>20||typeof c.icon!=='string')continue
   if(memberCategoryRecords.value.some(x=>x.type===c.type&&x.name===c.name))continue
   if(memberCategoryRecords.value.length>=80)break
   memberCategoryRecords.value.push({type:c.type,name:c.name,icon:c.icon});categoriesAdded++
  }
  const alreadyStored=new Set(currentCategories.items.map(c=>c.type+'\\u0000'+c.name))
  for(const c of memberCategoryRecords.value.filter(c=>!alreadyStored.has(c.type+'\\u0000'+c.name))){
   verifyActor()
   const result=await api('member-categories',request({expected_user_id:actor,
    type:c.type,name:c.name,icon:c.icon}))
   if(result.scope!=='personal'||result.ledger_changed!==false)
    throw Error('カテゴリのクラウド復元を確認できません')
  }
  for(const r of recoverable){
   verifyActor()
   const payment=translateSource(r.payment_source)
   if(payment&&!usableSource(payment)){rulesSkipped++;continue}
   try{
    await api('member-merchant-rules',request({
     expected_user_id:actor,expected_version:0,keyword:r.keyword,
     category:r.category,payment_source:payment
    }))
    rulesAdded++
   }catch{rulesSkipped++}
  }
  let restoredHoldings=0,skippedHoldings=0,restoredImages=0,skippedImages=0,
   restoredPlans=0,skippedPlans=0
  if(archiveV3){
   verifyActor()
   const currentPlans=await api('member-recurring-plans')
   if(currentPlans.ok!==true||!Array.isArray(currentPlans.items))
    throw Error('本人の積立計画を確認できません')
   const {restore,skipped}=prepareMemberRecurringRestores({
    ownerUserId:actor,oldPlans:data.recurring_plans,
    existingPlans:currentPlans.items,accounts:nextAccounts,
    accountMap,nowMonth:new Date(Date.now()+32400000).toISOString().slice(0,7)
   })
   skippedPlans=skipped.length
   for(const plan of restore){
    verifyActor()
    const saved=await api('member-recurring-plans',request(plan))
    if(saved.ok!==true||saved.plan?.owner_user_id!==actor||
     saved.plan?.ledger_applied!==false||saved.plan?.policy_approved!==false||
     saved.plan?.source_bank_account_id!==plan.source_bank_account_id||
     saved.plan?.amount_jpy!==plan.amount_jpy)
     throw Error('本人の積立計画の復元結果を確認できません')
    restoredPlans++
   }
   // A historical plan is NEVER reactivated. This imports settings only;
   // no past due installment, bank transaction or broker buy is executed.
   const existing=await api('manual-holdings')
   if(existing.scope!=='personal'||existing.owner_user_id!==actor||!Array.isArray(existing.holdings))
    throw Error('本人の投資情報の状態を確認できません')
   const known=new Set(existing.holdings.map(h=>h.fund_code+':'+h.account_type))
   for(const h of data.manual_holdings){
    verifyActor()
    const key=h.fund_code+':'+h.account_type
    if(known.has(key)){skippedHoldings++;continue}
    if(!/^[A-Z0-9]{8}$/.test(h.fund_code||'')||
      !['growth','tsumitate','combined'].includes(h.account_type)||
      typeof h.fund_name!=='string'||!h.fund_name.trim()||h.fund_name.length>120||
      !Number.isSafeInteger(h.units)||!Number.isSafeInteger(h.acquisition_cost)||
      h.units<0||h.acquisition_cost<0||(h.units===0)!==(h.acquisition_cost===0))
     throw Error('投資記録の形式が不正です')
    const saved=await api('manual-holdings/holding',request({expected_user_id:actor,
     fundCode:h.fund_code,fundName:h.fund_name,accountType:h.account_type,
     units:h.units,acquisitionCost:h.acquisition_cost,expectedVersion:0},'PUT'))
    if(saved.ledger_changed!==false||saved.holding?.owner_user_id!==actor)
     throw Error('本人の保有銘柄の復元結果を確認できません')
    if(h.nav_per_10000!=null&&h.price_date&&Number.isSafeInteger(h.nav_per_10000)&&
      h.nav_per_10000>0){
     const price=await api('manual-holdings/price',request({expected_user_id:actor,
      fundCode:h.fund_code,navPer10000:h.nav_per_10000,priceDate:h.price_date},'PUT'))
     if(price.ledger_changed!==false)throw Error('基準価額の復元を確認できません')
    }
    known.add(key);restoredHoldings++
   }
   await reloadMemberReceipts()
   const currentIds=new Set(memberReceipts.value.map(x=>x.receipt_id))
   for(const item of data.receipts){
    verifyActor()
    // Validate all archive bytes even if the original exists. Any tampering
    // aborts restoration; never silently overwrite or replay transactions.
    const blob=await verifiedArchiveImage(item)
    if(currentIds.has(item.receipt_id)){skippedImages++;continue}
    if(!/^(entry|proposal|request):/.test(item.receipt_ref||'')){
     skippedImages++;continue
    }
    let created
    try{
     created=await api('member-receipts',request({expected_user_id:actor,
      idempotency_key:'receipt:portable:'+item.receipt_id,receipt_ref:item.receipt_ref,
      receipt_date:item.date,merchant:item.merchant||'',content_type:blob.type,
      size_bytes:blob.size,sha256:item.sha256}))
    }catch(e){
     if(/MEMBER_RECEIPT_REFERENCE_FORBIDDEN|MEMBER_RECEIPT_REFERENCE_REVOKED/.test(e.message)){
      skippedImages++;continue
     }
     throw e
    }
    const newId=created.item?.receipt_id
    if(!/^[a-f0-9]{32}$/.test(newId||''))throw Error('画像の復元先が不明です')
    if(created.item.state!=='ready'){
     const up=await fetch('/api/family-finance/member-receipts/'+newId,{
      method:'PUT',credentials:'same-origin',cache:'no-store',
      headers:{'content-type':blob.type},body:blob})
     const receipt=await up.json().catch(()=>({}))
     if(!up.ok||receipt.ok!==true||receipt.item?.state!=='ready')
      throw Error(receipt.code||'画像を復元できません')
    }
    currentIds.add(item.receipt_id);restoredImages++
   }
   await reloadMemberReceipts()
  }
  await loadMemberMerchantRules()
  personalBackupRevision.value++
  await refresh()
  personalBackupMessage.value='設定を復元しました：口座'+accountsAdded+'件、固定費'+fixedAdded+
   '件、カテゴリ'+categoriesAdded+'件、店舗ルール'+rulesAdded+'件を追加。'+
   '既存の口座'+accountsSkipped+'件と固定費'+fixedSkipped+'件は維持。'+
   (rulesSkipped?'利用できない支払方法などでルール'+rulesSkipped+'件を省略。':'')+
   (archiveV3?'将来の積立計画'+restoredPlans+'件・手動保有銘柄'+restoredHoldings+
     '件・画像'+restoredImages+'件を復元。過去／重複計画'+skippedPlans+'件、既存保有'+
     skippedHoldings+'件、関連取引が存在しない画像等'+skippedImages+'件は保留。':'')+
   '家庭明細と銀行・証券の実取引は直接書き換えていません。'
 }catch(e){personalBackupMessage.value='復元できませんでした：'+e.message}
 finally{personalBackupBusy.value=false}
}

// Lightweight status probe while a member has visible pending household entries.
// Refresh the original shared ledger only when an approval status actually moves.
let approvalStatusTimer=null,approvalProbeActive=false
async function checkPendingLedgerStatus(){
 if(approvalProbeActive||document.visibilityState!=='visible'||!['list','stat','investments','finance'].includes(tab.value)||
  !pendingMutations.value.length||!alive)return
 const ticket=epoch,user=props.user.user_id,selectedMonth=month.value
 approvalProbeActive=true
 try{
  const result=await api('shared-mutation-requests?view=ledger&month='+
   encodeURIComponent(selectedMonth))
  if(ticket!==epoch||user!==props.user.user_id||selectedMonth!==month.value||
   result.ledger_scope!=='member_pending_only'||!Array.isArray(result.items))return
  const digest=items=>JSON.stringify(items.map(x=>[x.proposal_id,x.status,x.operation]))
  if(digest(pendingMutations.value)!==digest(result.items))await refresh()
 }catch{/* Preserve visible entries and use the existing foreground/manual recovery. */}
 finally{approvalProbeActive=false}
}
function foreground(){if(document.visibilityState==='visible')void refresh()}
watch(()=>[props.user.user_id,props.user.household_id],()=>{
 // Save the OLD identity's pending text under its own key before switching.
 if(memberDraftTimer){clearTimeout(memberDraftTimer);memberDraftTimer=null}
 if(memberDraftLoaded.value)void queueMemberDraftWrite(memberDraftValue()).catch(()=>{})
 memberDraftEpoch++;memberDraftLoaded.value=false
 closeMemberLedgerReceipt();pendingPaidEntry=null;memberEntries.value=[];memberReceipts.value=[]
 householdReceiptIndex.value=new Map();memberReceiptRetry.value=[];memberRawText.value=''
 label.value='';renameId.value='';void hydrateMemberDraft();void refresh()
})
watch([month,year],()=>void refresh())
onMounted(()=>{
 void hydrateMemberDraft();void refresh();document.addEventListener('visibilitychange',foreground)
 document.addEventListener('visibilitychange',memberDraftHidden)
 approvalStatusTimer=setInterval(()=>{void checkPendingLedgerStatus()},20000)
})
onUnmounted(()=>{
 if(memberDraftTimer){clearTimeout(memberDraftTimer);memberDraftTimer=null}
 if(memberDraftLoaded.value)void queueMemberDraftWrite(memberDraftValue()).catch(()=>{})
 memberDraftEpoch++;memberDraftLoaded.value=false
 document.removeEventListener('visibilitychange',memberDraftHidden)
 if(approvalStatusTimer)clearInterval(approvalStatusTimer);closeMemberLedgerReceipt();memberReceipts.value=[];householdReceiptIndex.value=new Map();memberReceiptRetry.value=[];alive=false;epoch++;pendingPaidEntry=null;accounts.value=[];assets.value=[];sharedEntries.value=[];pendingMutations.value=[];sharedCards.value=[];
 memberMerchantRules.value=[];memberRuleError.value='';
 document.removeEventListener('visibilitychange',foreground)})
// The original EntryInputPage renders for both identities. All writes here
// continue through the authenticated member-specific HomeFlow approval adapter.
const memberCategoryDialog=ref(false),memberCategorySaving=ref(false)
const memberCategoryEntryType=ref('expense'),memberCategoryName=ref('')
const memberCategoryIcon=ref('daily'),memberAvailableIcons=ICON_LIBRARY
const memberCategoryRecords=ref([])
async function loadMemberCategories(){
 const actor=props.user.user_id
 try{
  const result=await api('member-categories')
  if(result.scope!=='personal'||result.viewer_user_id!==actor||!Array.isArray(result.items)||
   !Array.isArray(result.defaults)||
   !result.defaults.some(x=>x.entry_type==='expense')||
   !result.defaults.some(x=>x.entry_type==='income'))
   throw Error('D1 の共通カテゴリ情報を確認できません')
  if(actor!==props.user.user_id)return
  memberCategorySource.value=result.defaults
  for(const entry of memberEntries.value){
   if(['expense','income'].includes(entry.type)&&!entry.category)
    entry.category=defaultMemberCategory(entry.type)
  }
  const items=[...result.items],key='kakeibo-personal-categories:'+actor
  let legacy=[]
  try{const old=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(old))legacy=old}catch{}
  // Move old device-only categories to D1, removing the old copy only
  // after every write is acknowledged by the authenticated personal route.
  for(const x of legacy){
   if(!x||!['income','expense'].includes(x.type)||typeof x.name!=='string'||
    !x.name.trim()||x.name.length>20||!/^[a-z0-9-]{1,48}$/.test(x.icon||''))continue
   if(items.some(y=>y.type===x.type&&y.name===x.name))continue
   if(actor!==props.user.user_id)return
   const stored=await api('member-categories',request({
    expected_user_id:actor,type:x.type,name:x.name.trim(),icon:x.icon}))
   if(stored.scope!=='personal'||stored.ledger_changed!==false)
    throw Error('旧カテゴリの同期を確認できません')
   items.push({type:x.type,name:x.name.trim(),icon:x.icon})
  }
  if(actor!==props.user.user_id)return
  memberCategoryRecords.value=items
  try{localStorage.removeItem(key)}catch{}
 }catch(e){if(actor===props.user.user_id)memberEntryError.value='カテゴリの同期に失敗しました：'+e.message}
}
async function saveMemberCategory(){
 const actor=props.user.user_id,name=memberCategoryName.value.trim(),type=memberCategoryEntryType.value
 if(memberCategorySaving.value||!name||name.length>20||!['income','expense'].includes(type))return
 if(memberCategoryRecords.value.some(x=>x.type===type&&x.name===name)||
  memberCategorySource.value.some(x=>x.entry_type===type&&
   (x.category===name||x.display_name===name))){
  memberEntryError.value='すでに同じカテゴリがあります';return
 }
 memberCategorySaving.value=true;memberEntryError.value=''
 try{
  const stored=await api('member-categories',request({expected_user_id:actor,
   type,name,icon:memberCategoryIcon.value}))
  if(stored.scope!=='personal'||stored.ledger_changed!==false)
   throw Error('本人の保存結果を確認できません')
  if(actor!==props.user.user_id)return
  memberCategoryRecords.value=[...memberCategoryRecords.value,{type,name,icon:memberCategoryIcon.value}]
  memberCategoryDialog.value=false;memberCategoryName.value=''
 }catch(e){if(actor===props.user.user_id)memberEntryError.value='カテゴリを保存できません：'+e.message}
 finally{memberCategorySaving.value=false}
}
const memberInputBusy=computed(()=>memberEntryPending.value?'saving':memberOcrBusy.value?'読み取り中':'')
const memberReceiptImage=ref(null),memberReceiptFileName=ref('')
const memberDraftRecoveryInfo=ref('')
const memberPaymentSourceChoices=computed(()=>memberPaymentOptions.value)
const memberExpenseCategoryChoices=computed(()=>[...new Set([
 ...entryExpenseCategories.value,
 ...memberCategoryRecords.value.filter(x=>x.type==='expense').map(x=>x.name)
])])
const memberIncomeCategoryChoices=computed(()=>[...new Set([
 ...entryIncomeCategories.value,
 ...memberCategoryRecords.value.filter(x=>x.type==='income').map(x=>x.name)
])])
provide('kakeibo-member-expense-categories',memberExpenseCategoryChoices)
provide('kakeibo-member-income-categories',memberIncomeCategoryChoices)
const memberRuleCategoryOptions=computed(()=>[...new Set([...memberExpenseCategoryChoices.value,...memberIncomeCategoryChoices.value])])
async function selectMemberDraftReceipt(event,record){
 const file=event.target?.files?.[0];if(event.target)event.target.value=''
 if(!file||!record||memberEntryPending.value)return
 try{record.receiptImage=await compressReceiptImage(file)
  record.receiptFileName=file.name;record.showReceiptAttachment=true
  memberEntryError.value=''
 }catch(e){memberEntryError.value='画像を添付できません：'+e.message}
}
async function clearMemberDraft(){
 if(!memberDraftLoaded.value)return
 if(pendingPaidEntry||
   memberEntries.value.some(row=>row.neutralSpouseTransferKey||row.memberAssetPending)){
  memberEntryError.value='送信結果が未確認の記録があります。重複を防ぐため削除を中止しました';return
 }
 let storedApproval
 try{storedApproval=await readMemberDeviceState(memberDraftOwner.userId,
  memberDraftOwner.householdId,'shared-inline')}
 catch(e){memberEntryError.value='申請状態を確認できないため下書きを削除しません：'+e.message;return}
 if(storedApproval&&!storedApproval.acknowledged){
  memberEntryError.value='家庭明細の申請結果が未確認です。同じ内容で再送し、結果を確認してください';return
 }
 if(memberEntries.value.length||memberRawText.value.trim()){
  if(!window.confirm('未保存の下書きを破棄しますか？'))return
 }
 // Tombstone first; on failure keep the editable values and retry IDs.
 const empty=memberDraftSnapshot({userId:memberDraftOwner.userId,
  householdId:memberDraftOwner.householdId,forms:[],rawText:'',inputMode:'manual'})
 try{await queueMemberDraftWrite(empty)}
 catch(e){memberEntryError.value='下書きを削除できません：'+e.message;return}
 memberEntries.value=[];memberRawText.value='';memberEntryError.value=''
 if(storedApproval?.acknowledged)
  await sharedMutationRef.value?.clearAcknowledgedIntent().catch(e=>{
   memberEntryError.value='確認済み申請の後片付けに失敗しました：'+e.message
  })
}
provide('kakeibo-entry-input',{
 liveClockIso:computed(()=>new Date().toISOString()),todayLabel:memberTodayLabel,
 addCategory:()=>{memberCategoryDialog.value=true},busy:memberInputBusy,
 categoryDialog:memberCategoryDialog,categorySaving:memberCategorySaving,
 saveCategory:saveMemberCategory,categoryEntryType:memberCategoryEntryType,
 categoryName:memberCategoryName,categoryIcon:memberCategoryIcon,
 availableIcons:memberAvailableIcons,input:memberRawText,entryInputMode:memberInputMode,
 recognitionMode:memberScanMode,importPaymentSource:memberImportPaymentSource,
 importPaymentOptions:memberImportPaymentOptions,
 recognize:()=>recognizeMemberText(false),
 aiOcrEnabled:memberAiEnabled,aiQuota:memberAiQuota,
 scanImportPaymentSource:memberScanPaymentSource,
 ocrEngine:memberOcrStatus,ocrWarning:memberOcrWarning,
 setAiOcrEnabled:setMemberAiEnabled,forms:memberEntries,
 draftRecoveryInfo:memberDraftRecoveryInfo,clearLocalDraft:clearMemberDraft,
 removeDraft:removeMemberEntry,rewardDestinations:computed(()=>[]),
 transferDestinations:computed(()=>[{value:'spouse',name:'配偶'}]),categories:memberExpenseCategoryChoices,
 INCOME_CATEGORIES:memberIncomeCategoryChoices,
 paymentSources:computed(()=>[]),categoryLabel:memberCategoryLabel,
 selectDraftReceipt:selectMemberDraftReceipt,pendingReceiptImage:memberReceiptImage,
 pendingReceiptFileName:memberReceiptFileName,receiptSaveError:memberEntryError,
 setEntryType:(f,type)=>setMemberEntryType(type,f),
 applyMerchantPayment:applyMemberMerchantRule,
 manualPayment:(f,source)=>{f.paymentSource=source},
 onImage:memberScanImage,addBlank:()=>addMemberEntry(),saveAll:submitMemberEntry,
 receiptEnabled:computed(()=>true),
 allowedTypes:computed(()=>['expense','income','transfer']),
 paymentChoices:memberPaymentSourceChoices,allowSbiTransfer:false,
  personalAssetActionsEnabled:computed(()=>true)
})
void loadMemberCategories()
watch(()=>props.user.user_id,()=>{
 memberCategorySource.value=[];memberCategoryRecords.value=[];void loadMemberCategories()
})
</script>
<template>
 <div class="member-shell">
  <FamilySharedMutationRequests ref="sharedMutationRef" headless
   :key="'member-ledger-submit:'+user.user_id"
   :user-id="user.user_id" :household-id="user.household_id" />
  <section v-if="error" class="member-alert" role="alert">{{error}}
   <button type="button" @click="refresh">再試行</button>
  </section>
  <section v-if="householdReceiptError && tab==='list'" class="member-alert" role="alert">
   {{householdReceiptError}}
   <button type="button" @click="reloadHouseholdReceipts(sharedEntries,true)">再試行</button>
  </section>
  <section v-if="memberReceiptRetry.length" class="member-alert" role="alert">
   記帳は受付済みですが画像の再送が必要です（{{memberReceiptRetry.length}}件）。
   <button type="button" @click="retryMemberReceipt">画像を再送</button>
  </section>
  <OriginalKakeiboPages :identity="user" :theme="theme" :themes="themes"
   :active-tab="tab" :member="true" :personal-assets="assets" :personal-accounts="myAccounts" :on-update-personal-account="modify"
   :on-create-personal-account="createAccount"
   :on-open-personal-management="openMemberPrepaidAdd"
   :personal-prepaid-api="memberPrepaidApi"
   :personal-portfolio-api="memberSbiApi"
   :on-personal-opening="saveMemberPrepaidOpening"
   :on-personal-history="openMemberWalletHistory"
   :management-bindings="{memberView:true,memberBusy:busy,memberError:error,
    cardSettingsRequest:memberCardSettingsRequest,
    memberStatus,memberCardConfig:getMemberCardConfig(),
    memberRefresh:refresh,memberTrashCount:memberTrashCount,memberLoadTrash:loadMemberSharedTrash,memberLoadJobs:loadMemberJobStatus,api}"
   @update:active-tab="tab=$event" @ledger-open="tab='list'"
   @theme-change="emit('theme-change',$event)" @logout="emit('logout')">
   
   <template #custom-transfer-fields="{record}">
    <MemberAssetTransferFields :key="'personal-transfer:'+user.user_id"
     :record="record" :user-id="user.user_id" :accounts="myAccounts"/>
   </template>
   <template #member-card-usage>
    <MemberCardUsage :user-id="user.user_id" :active="tab==='finance'" :revision="memberUsageRevision"/>
   </template>
   <template #member-plans>
    <MemberFixedCosts :key="'member-fixed:'+user.user_id+':'+personalBackupRevision" :user-id="user.user_id"
     :payment-choices="memberPaymentOptions" :category-label="memberCategoryLabel" :default-category="defaultMemberCategory('expense')"
     :categories="[...new Set([...memberExpenseCategoryChoices,...entryCategories])]"
     :on-submit-entry="submitMemberFixedCost" />
   </template>
   <template #member-investment>
    <SbiPortfolio member-mode active-view="plans" :api="memberSbiApi"
      :on-member-create="()=>openMemberInvestmentPlan()"
      :on-member-edit="openMemberInvestmentPlan"/>
    <FamilyRecurringFinance ref="memberRecurringRef" view="investment" embedded
     :key="'personal-sbi:'+user.user_id" :user-id="user.user_id"
     :household-id="user.household_id" :accounts="myAccounts" @changed="refresh"/>
   </template>
   <template #member-rules>
     <p v-if="memberRuleError" role="alert" class="member-alert">{{memberRuleError}}</p>
     <MobileMerchantRulesPanel :rules="memberMerchantRules"
       :categories="memberRuleCategoryOptions" :payment-sources="memberPaymentOptions"
       :category-label="memberCategoryLabel" :on-save="saveMemberMerchantRule"/>
   </template>
   <template #member-jobs>
     <p v-if="memberJobsError" class="help" role="status">{{memberJobsError}}</p>
     <p v-if="memberJobsBusy" class="help">本人の定期処理を確認中…</p>
     <p class="help">本人の固定費 {{memberJobs.fixed.length}}件 · 積立 {{memberJobs.sbi.length}}件 · 実行証跡 {{memberJobs.occurrences.length}}件</p>
     <div v-for="item in memberJobs.fixed.slice(0,10)" :key="item.plan_id" class="entry">
      <strong>{{item.name}} · {{yen(item.amount)}} · {{item.enabled?'有効':'停止中'}}</strong>
     </div>
     <div v-for="item in memberJobs.sbi.slice(0,10)" :key="item.plan_resource_id" class="entry">
      <strong>{{item.fund_name}} · {{yen(item.amount_jpy)}} · {{item.state}}</strong>
     </div>
     <div v-for="item in memberJobs.occurrences.slice(0,10)" :key="item.occurrence_id" class="entry">
      <strong>{{item.due_date}} · {{yen(item.amount_jpy)}} · {{item.state}}</strong>
     </div>
     <button type="button" class="button-secondary" :disabled="memberJobsBusy" @click="loadMemberJobStatus">状態を更新</button>
         <details class="member-asset-history">
     <summary>本人のポイント・チャージ履歴と訂正</summary>
     <MemberPrepaidTopups :key="'history-topups:'+user.user_id" :user-id="user.user_id" :accounts="myAccounts" @changed="refresh"/>
     <MemberPersonalPoints :key="'history-points:'+user.user_id"
      :user-id="user.user_id" :household-id="user.household_id" :accounts="myAccounts" @changed="refresh"/>
     <MemberPointAssetActions :key="'history-point-assets:'+user.user_id"
      :user-id="user.user_id" :household-id="user.household_id" @changed="refresh"/>
     <MemberPointAssetReversals :key="'history-point-reversals:'+user.user_id"
      :user-id="user.user_id" :household-id="user.household_id" @changed="refresh"/>
    </details>
    </template>
   <template #member-privacy>
     <p v-if="memberReceiptError" class="help" role="alert">{{memberReceiptError}}</p>
     <MemberReceiptManagement :key="'personal-receipts:'+user.user_id"
       :items="memberReceipts" :on-fetch="fetchMemberReceipt"
       :on-delete="deleteMemberReceipt" :on-refresh="reloadMemberReceipts"/>
     <button v-if="memberReceiptRetry.length" class="button-secondary" type="button"
       @click="retryMemberReceipt">画像を再送（{{memberReceiptRetry.length}}件）</button>
   </template>
   <template #member-backup>
    
    <div class="member-backup-actions">
     <button type="button" class="button-secondary" :disabled="personalBackupBusy" @click="exportMemberArchive">
     {{personalBackupBusy?'処理中…':'記録・レシートを保存'}}
    </button>
    <button type="button" class="button-secondary" :disabled="personalBackupBusy" @click="exportPersonalAccounts">
      {{personalBackupBusy?'処理中…':'設定を保存'}}
     </button>
     <label class="member-backup-upload button-secondary">バックアップを選択
      <input type="file" accept=".enc" :disabled="personalBackupBusy" @change="importPersonalBackup"/>
     </label>
    </div>
    <p v-if="personalBackupMessage" class="help" role="status">{{personalBackupMessage}}</p>
    
   </template>
   <template #member-duplicates>
     <p v-if="!memberDuplicateGroups.length" class="help">表示中の明細に重複候補はありません。</p>
     <div v-for="(group,i) in memberDuplicateGroups" :key="i" class="entry">
       <strong>{{group[0].date}} · {{group[0].merchant}} · ¥{{Number(group[0].amount).toLocaleString('ja-JP')}} · {{group.length}}件</strong>
       <button type="button" @click="tab='list'">明細を見る</button>
     </div>
     
   </template>
   <template #member-trash>
     <p v-if="memberTrashError" role="alert" class="help">{{memberTrashError}}</p>
     <p v-if="memberTrashNotice" role="status" class="help">{{memberTrashNotice}}</p>
     <p v-if="memberTrashBusy" class="help">ゴミ箱を確認中…</p>
     <div v-if="memberSharedTrash.length" class="member-trash-section">
      <strong>削除された家庭明細 · {{memberSharedTrash.length}}件</strong>
      <div v-for="row in memberSharedTrash" :key="row.resource_id" class="entry">
       <strong>{{row.entry?.date}} · {{row.entry?.merchant||row.entry?.category}} · {{yen(row.entry?.amount)}}</strong>
       <button type="button" :disabled="memberTrashBusy" @click="restoreMemberSharedTrash(row)">復元を申請</button>
      </div>
      
     </div>
     <div v-if="memberPersonalDocumentSbiTrash.length" class="member-trash-section">
      <strong>本人のSBI資産移動 · {{memberPersonalDocumentSbiTrash.length}}件</strong>
      <div v-for="row in memberPersonalDocumentSbiTrash" :key="row.transfer_id" class="entry">
       <strong>{{row.date}} · {{row.merchant}} · {{yen(row.amount)}}</strong>
       <button type="button" :disabled="memberTrashBusy" @click="restoreMemberPersonalSbi(row)">復元</button>
      </div>
      
     </div>
     <div v-if="memberArchivedAccounts.length" class="member-trash-section">
      <strong>本人のアーカイブ済み口座 · {{memberArchivedAccounts.length}}件</strong>
      <div v-for="a in memberArchivedAccounts" :key="a.account_id" class="entry">
       <strong>{{a.label}}</strong>
       <button type="button" :disabled="busy" @click="modify(a,{is_archived:false})">復元</button>
      </div>
     </div>
     <p v-if="!memberArchivedAccounts.length&&!memberSharedTrash.length&&!memberPersonalDocumentSbiTrash.length&&!memberTrashBusy" class="help">ゴミ箱は空です。</p>
    </template></OriginalKakeiboPages>
 </div>
</template>
<style scoped>
.member-shell{width:100%;max-width:100%;padding:0;margin:0;min-height:76vh;display:grid;gap:0;align-content:start}
.member-topbar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.member-topbar .brand{display:flex;align-items:center;min-width:0}
.spouse-income-shortcut{min-width:0}
.spouse-income-shortcut button{display:flex;flex-direction:column;gap:4px;align-items:flex-start;
 width:100%;min-height:64px;padding:12px 14px;border:1px solid var(--line,#f3e5e8);
 border-radius:14px;background:var(--card,#fff);color:var(--blue-dark,#bd5376);
 font:inherit;font-weight:750;text-align:left;cursor:pointer}
.spouse-income-shortcut button small{font-size:11px;font-weight:500;color:var(--muted,#8c7e88)}
.member-topbar .brand-wordmark{display:block;width:min(168px,43vw);height:auto;object-fit:contain}
.member-family-label{font-size:12px;color:var(--muted,#81777b);white-space:nowrap}
.member-page{display:grid;gap:12px;min-width:0}
.member-page h1{margin:0;font-size:23px}
.member-share-refresh{justify-self:start;font-size:12px}
.member-page h2{font-size:16px;margin:8px 0 0}
.entry,.summary-grid>div{display:flex;justify-content:space-between;gap:8px;border:1px solid var(--line,#ecdfe3);border-radius:14px;background:var(--card,#fff);padding:12px;min-width:0}
.entry{flex-wrap:wrap;align-items:center}
.entry>div:first-child{display:grid;gap:3px;min-width:0}
.entry strong{overflow-wrap:anywhere}
.entry small{font-size:11px;color:var(--muted,#81777b)}
.asset-value{text-align:right}
.help{font-size:12px;color:var(--muted,#81777b);margin:0}
.member-alert{color:#b43c4a;padding:10px;border:1px solid #e7c1c7;border-radius:10px}
.summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.summary-grid>div{display:grid;gap:6px;padding:9px}
.summary-grid strong{font-size:clamp(11px,3vw,16px);overflow-wrap:anywhere}
.summary-grid small{font-size:11px}
.member-manage-tabs,.period{display:flex;gap:6px;min-width:0;flex-wrap:wrap}
.member-manage-tabs button{flex:1;min-width:58px}
.member-manage-tabs button.active{border-color:var(--blue,#d96f91);color:var(--blue-dark,#bd5376)}
.member-page button,.member-alert button{padding:9px;border:1px solid var(--line,#ddd);border-radius:11px;background:var(--card,#fff);color:inherit;min-height:40px}
.new-account{display:grid;gap:9px;padding:12px;border:1px solid var(--line,#ddd);border-radius:14px}
.new-account input,.new-account select,.period input,.period select{min-width:0;width:100%;padding:9px;border:1px solid var(--line,#ddd);border-radius:10px;background:var(--card,#fff);color:inherit}
.actions{display:flex;gap:6px;flex-wrap:wrap}
.card-controls{display:flex;gap:8px;align-items:center;min-width:0}.card-controls>*:first-child{flex:1;min-width:0}.card-icon-action{flex:none;width:42px;height:42px;padding:9px!important;display:grid;place-items:center}.card-icon-action svg{width:19px;height:19px}.finance-panel{display:grid;gap:10px;min-width:0;border:1px solid var(--line,#ddd);border-radius:15px;padding:12px;background:var(--card,#fff)}.finance-panel h2{font-size:16px;margin:0}

.member-shell :deep(.bottom-nav){z-index:30}
@media(max-width:360px){.summary-grid{grid-template-columns:1fr}}
</style>

<style scoped>
.member-backup-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.member-backup-actions>button,.member-backup-upload{min-height:46px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:13px;font-weight:700;border:1px solid var(--line,#ecdfe3);border-radius:12px;background:var(--tint,#fff1f5);color:var(--ink,#473d46);padding:8px}
.member-backup-upload input{display:none}
@media(max-width:360px){.member-backup-actions{grid-template-columns:1fr}}
</style>
