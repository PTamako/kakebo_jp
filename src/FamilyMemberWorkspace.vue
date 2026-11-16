<script setup>
import {ref,computed,provide,onMounted,onUnmounted,watch} from 'vue'
import FamilyFinanceProposals from './FamilyFinanceProposals.vue'
import FamilyRecurringFinance from './FamilyRecurringFinance.vue'
import SbiPortfolio from './SbiPortfolio.vue'
import {memberInvestmentSnapshot} from './member-investment-view.js'
import MemberFixedCosts from './MemberFixedCosts.vue'
import FamilySharedMutationRequests from './FamilySharedMutationRequests.vue'
import TransactionForm from './TransactionForm.vue'
import {SPOUSE_INCOME_CATEGORY,SPOUSE_INCOME_SOURCE} from './spouse-income.js'
import {parseEntries,parseReceipt,ocrImage} from './parse.js'
import {compressReceiptImage} from './receipt-image.js'
import EntryInputPage from './EntryInputPage.vue'
import {ICON_LIBRARY} from './icon-library.js'
import {encryptBackupBlob,decryptBackupBlob} from './backup-encryption.js'
import {parseNamedExpenseBlocks} from './named-expense.js'
import {parseRepeatedExpense} from './natural-repeat.js'
import {memberPaymentChoices as buildMemberPaymentChoices,resolveMemberPayment} from './member-payment-choices.js'
import BottomNavigation from './BottomNavigation.vue'
import OriginalKakeiboPages from './OriginalKakeiboPages.vue'
import ManagementPage from './pages/ManagementPage.vue'
import OriginalCardManagementPanel from './OriginalCardManagementPanel.vue'
import MobileMerchantRulesPanel from './MobileMerchantRulesPanel.vue'
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
const accounts=ref([]),assets=ref([]),sharedEntries=ref([]),pendingMutations=ref([]),totals=ref(null),yearly=ref(null)
const sharedCards=ref([]),cardSharingError=ref('')
const memberMerchantRules=ref([]),memberRuleError=ref('')
const month=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,7))
const year=ref(month.value.slice(0,4))
const busy=ref(false),error=ref(''),label=ref(''),kind=ref('cash')
const renameId=ref(''),rename=ref(''),notice=ref('')
const selectedCardId=ref(''),cardMode=ref('')
const preferredCardType=ref('standard')
function openMemberPrepaidAdd(){preferredCardType.value='prepaid';cardMode.value='add';tab.value='finance'}
function openMemberCardSettings(){preferredCardType.value='standard';tab.value='finance'}
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

let epoch=0,alive=true
const kinds=[['credit_card','クレジットカード'],['prepaid','プリペイドカード'],['cash','現金'],
 ['bank','銀行'],['points','ポイント'],['securities','証券'],['other','その他']]
const kindLabel=x=>kinds.find(k=>k[0]===x)?.[1]||'口座'
const yen=n=>n===null||n===undefined?'—':'¥'+Number(n).toLocaleString('ja-JP')
const myAccounts=computed(()=>accounts.value.filter(x=>x.owner_user_id===props.user.user_id))
const memberPaymentOptions=computed(()=>buildMemberPaymentChoices(myAccounts.value,sharedCards.value))
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
const entryExpenseCategories=['食費','日用品','交通','住居','医療','交際費','その他']
const entryIncomeCategories=['給与','賞与','副収入','ポイント還元',SPOUSE_INCOME_CATEGORY,'その他']
function newEntry(){return {type:'expense',amount:'',date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),
 time:'',category:'食費',merchant:'',note:'',paymentSource:'cash',transferTarget:'',
 bindRule:false,bindPaymentRule:false}}
const memberEntries=ref([])
const memberInputMode=ref('manual'),memberRawText=ref(''),memberScanMode=ref('statement')
const memberOcrBusy=ref(false),memberOcrStatus=ref(''),memberOcrWarning=ref('')
const memberScanPaymentSource=ref('cash')
const memberImportPaymentSource=ref('cash')
const memberAiQuota=ref(null)
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
function addMemberEntry(){memberEntries.value.push(newEntry())}
function removeMemberEntry(index){if(!memberEntryPending.value)memberEntries.value.splice(index,1)}
function setMemberEntryType(type,entry){
 if(!['expense','income'].includes(type))return
 entry.type=type
 entry.category=type==='expense'?'食費':'給与'
 entry.merchant=''
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
   category:String(x.category||'日用品'),note:String(x.note||''),
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
 if(!pendingPaidEntry)pendingPaidEntry={snapshot,key:'member-spend:'+crypto.randomUUID(),requestId:null}
 const pending=pendingPaidEntry
 if(choice.kind==='shared'){
  const result=await api('legacy-card-spends',request({
   expected_user_id:user,idempotency_key:pending.key,card_name:choice.card.card_name,
   date:entry.date,time:entry.time,amount_jpy:entry.amount,
   merchant:entry.merchant,category:entry.category,note:entry.note}))
  if(result.applied!==true||!Number.isSafeInteger(result.entry_id)||result.entry_id<1)
   throw Error('共有カードの入帳結果が未確認です')
  pendingPaidEntry=null
  return {type:'applied',entryId:result.entry_id}
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
  if(prepared.status==='submitted_status_unknown'&&prepared.approval_id){
   pendingPaidEntry=null
   return {type:'pending'}
  }
  if(prepared.status!=='prepared')throw Error('決済申請の状態を確認してください')
 }
 const response=await api(path+'/'+encodeURIComponent(pending.requestId)+'/submit',
  request({expected_user_id:user}))
 if(response.applied!==false||response.status!=='submitted_status_unknown')
  throw Error('HomeFlow 承認依頼の受付を確認できません')
 pendingPaidEntry=null
 return {type:'pending'}
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
 return result
}
async function submitMemberEntry(){
 if(memberEntryPending.value||memberOcrBusy.value||!memberEntries.value.length)return
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
   if(choice.kind==='shared'||choice.kind==='personal'){
    const result=await submitPaidExpense(choice,record)
    if(result.type==='applied')applied++
   }else{
    const result=await sharedMutationRef.value?.submitEntry(record)
    if(!result?.proposalId)throw Error('申請の受付を確認できません')
   }
   if(record.type==='expense'&&(record.bindRule||record.bindPaymentRule)){
    try{await rememberMemberRule(record)}catch(e){memberRuleError.value='店舗ルールの保存に失敗しました：'+e.message}
   }
   // Remove one draft only after the authenticated backend confirmed receipt.
   // A later failure leaves all unsent rows editable, not silently discarded.
   memberEntries.value.shift();sent++
  }
  memberEntryNotice.value=applied?
   sent+'件受付（うち'+applied+'件は承認済み共有カードで入帳）':
   sent+'件を HomeFlow 審査に送信しました。承認・入帳までは待入帳です。'
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
 }),...drafts]
})
async function openApproval(action,entry){
 if(!entry||entry.pending_approval)throw Error('審査中の記録は変更できません')
 const original=sharedEntries.value.find(x=>String(x.id)===String(entry.id))
 if(!original)throw Error('元の明細を確認できません')
 const result=await sharedMutationRef.value?.submitMutation(action,original,
  action==='update'?entry:null)
 if(!result?.proposalId)throw Error('HomeFlow の審査受付を確認できません')
 await refresh()
 return result
}
const memberLedger=makeFamilyLedgerContext({tab,month,selectedYear,entries:ledgerEntries,
 entryTypeFilter:selectedEntryType,load:()=>refresh(),more:()=>moreEntries(),
 openApproval,onError:message=>{error.value=message}})
provide('kakeibo-page-context',{
 ...makeFamilyStatsContext({tab,month,selectedYear,stats:monthlyReport,
   annualStats:annualReport,entryType:selectedEntryType}),
 ...memberLedger
})
watch(selectedYear,n=>{if(Number.isInteger(n)&&n>=2000&&n<=9998)year.value=String(n)})

const pageOffset=ref(null)
const ledgerLoading=ref(false)
const entryCategories=computed(()=>[...new Set(sharedEntries.value.map(x=>x.category))])
const visibleEntries=computed(()=>sharedEntries.value.filter(x=>selectedEntryType.value==='all'||x.type===selectedEntryType.value))
const entryDays=computed(()=>{
 const byDay=new Map()
 for(const entry of visibleEntries.value){
  if(!byDay.has(entry.date))byDay.set(entry.date,[])
  byDay.get(entry.date).push(entry)
 }
 return [...byDay].map(([date,items])=>({date,items,
  amount:items.reduce((sum,row)=>sum+(row.type==='income'?Number(row.amount||0):-Number(row.amount||0)),0)}))
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
const memberPortfolioVersions=ref(new Map())
async function memberPrepaidApi(path,options={}){
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
  if(!sub)throw Error('買付や積立の変更には HomeFlow 承認が必要です')
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
  api('member-recurring-plans'),api('recurring-occurrences'),api('manual-holdings')
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
 error.value='';accounts.value=[];assets.value=[];sharedEntries.value=[];pendingMutations.value=[];totals.value=null;yearly.value=null
 try{
  const [a,b,c,d,e,f]=await Promise.all([
   api('accounts'),api('personal/assets'),
   api('shared/entries?limit=100&month='+encodeURIComponent(month.value)),
   api('shared/stats?month='+month.value),
   api('shared/stats?year='+year.value),
   api('legacy-card-shares').catch(e=>({incoming:[],share_error:e.message}))
  ])
  if(!alive||ticket!==epoch||user!==props.user.user_id)return
  if(a.account_scope!=='personal'||b.scope!=='personal'||b.viewer_user_id!==user||
   c.ledger_scope!=='household'||d.ledger_scope!=='household'||e.ledger_scope!=='household')
   throw Error('帳簿のアクセス範囲を確認できません')
  if((a.items||[]).some(x=>x.owner_user_id!==user))throw Error('口座の所有者が一致しません')
  accounts.value=a.items||[];assets.value=b.accounts||[]
  cardSharingError.value=f.share_error||''
  sharedCards.value=f.scope==='granted-cards'&&Array.isArray(f.incoming)?f.incoming:[]
  sharedEntries.value=c.items||[];pageOffset.value=c.next_offset;
  await loadMemberMerchantRules()
  monthlyReport.value=d;annualReport.value=e
  totals.value={income:d.income,expense:d.total,transfer:d.transferTotal}
  yearly.value={totals:{income:e.income,expense:e.total,transfer:e.transferTotal},
   net_income_expense:Number(e.income||0)-Number(e.total||0)}
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
  if(r.ledger_changed!==false)throw Error('修改状态需要复核')
  renameId.value='';rename.value='';await refresh()
 }catch(e){if(ticket===epoch)error.value=e.message}finally{busy.value=false}
}
function edit(a){if(a.owner_user_id!==props.user.user_id||a.origin==='legacy')return
 renameId.value=a.account_id;rename.value=a.label}
const personalBackupBusy=ref(false),personalBackupMessage=ref('')
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
  personalBackupMessage.value='本人のカード・銀行・固定費・店舗ルール・カテゴリの設定を暗号化して保存しました。家庭共有明細や他人のデータは含まれません。'
 }catch(e){personalBackupMessage.value='保存できませんでした：'+e.message}
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
  if(!['kakeibo-member-account-settings-v1','kakeibo-member-personal-settings-v2'].includes(data?.format)||
   data.owner_user_id!==actor||!['personal_settings_only','personal_account_settings_only'].includes(data.scope)||
   !Array.isArray(data.accounts)||data.accounts.some(a=>a.owner_user_id!==actor))
   throw Error('このバックアップは別のユーザーのものか、形式が一致しません')
  if(data.format==='kakeibo-member-account-settings-v1'){
   personalBackupMessage.value='旧形式は口座設定の保存専用です。口座と残高の自動復元は行いません。'
   return
  }
  if(!Array.isArray(data.merchant_rules)||data.merchant_rules.length>200||
     !Array.isArray(data.categories)||data.categories.length>80||
     !Array.isArray(data.fixed_costs)||data.fixed_costs.some(p=>p.owner_user_id!==actor))
   throw Error('設定の件数や所有者を確認できません')
  const existing=await api('member-merchant-rules')
  if(existing.scope!=='personal'||existing.viewer_user_id!==actor)
   throw Error('本人のルールを確認できません')
  const existingKeys=new Set((existing.items||[]).map(r=>r.keyword))
  const recoverable=data.merchant_rules.filter(r=>r&&typeof r.keyword==='string'&&
   r.keyword.trim().length>=2&&r.keyword.length<=120&&
   typeof r.category==='string'&&r.category.length<=100&&
   typeof r.payment_source==='string'&&r.payment_source.length<=160&&
   (r.category||r.payment_source)&&!existingKeys.has(r.keyword))
  if(!confirm('本人の未登録店舗ルール'+recoverable.length+
     '件とカテゴリ設定を追加しますか？既存のルール、カード、残高、固定費、共有明細は上書きしません。'))return
  if(actor!==props.user.user_id)throw Error('アカウントが変更されました')
  let categoriesAdded=0,rulesAdded=0,rulesSkipped=0
  for(const c of data.categories){
   if(!c||!['expense','income'].includes(c.type)||typeof c.name!=='string'||
      !c.name.trim()||c.name.length>20||typeof c.icon!=='string')continue
   if(memberCategoryRecords.value.some(x=>x.type===c.type&&x.name===c.name))continue
   if(memberCategoryRecords.value.length>=80)break
   memberCategoryRecords.value.push({type:c.type,name:c.name,icon:c.icon});categoriesAdded++
  }
  localStorage.setItem('kakeibo-personal-categories:'+actor,
    JSON.stringify(memberCategoryRecords.value))
  for(const r of recoverable){
   if(actor!==props.user.user_id)throw Error('アカウントが変更されました')
   if(r.payment_source&&!memberPaymentOptions.value.some(c=>c.value===r.payment_source)){
    rulesSkipped++;continue
   }
   try{
    await api('member-merchant-rules',request({
     expected_user_id:actor,expected_version:0,keyword:r.keyword,
     category:r.category,payment_source:r.payment_source
    }))
    rulesAdded++
   }catch{rulesSkipped++}
  }
  await loadMemberMerchantRules()
  personalBackupMessage.value='復元：カテゴリ'+categoriesAdded+'件、店舗ルール'+rulesAdded+
   '件を追加。既存設定・口座・残高・固定費は変更していません。'+
   (rulesSkipped?'権限切れ・重複等で'+rulesSkipped+'件のルールをスキップしました。':'')
 }catch(e){personalBackupMessage.value='復元できませんでした：'+e.message}
 finally{personalBackupBusy.value=false}
}

function foreground(){if(document.visibilityState==='visible')void refresh()}
watch(()=>props.user.user_id,()=>{pendingPaidEntry=null;memberEntries.value=[];memberRawText.value='';label.value='';renameId.value='';void refresh()})
watch([month,year],()=>void refresh())
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;epoch++;pendingPaidEntry=null;accounts.value=[];assets.value=[];sharedEntries.value=[];pendingMutations.value=[];sharedCards.value=[];
 memberMerchantRules.value=[];memberRuleError.value='';
 document.removeEventListener('visibilitychange',foreground)})
// The original EntryInputPage renders for both identities. All writes here
// continue through the authenticated member-specific HomeFlow approval adapter.
const memberCategoryDialog=ref(false),memberCategorySaving=ref(false)
const memberCategoryEntryType=ref('expense'),memberCategoryName=ref('')
const memberCategoryIcon=ref('daily'),memberAvailableIcons=ICON_LIBRARY
const memberCategoryRecords=ref([])
function loadMemberCategories(){
 try{
  const raw=localStorage.getItem('kakeibo-personal-categories:'+props.user.user_id)
  const parsed=JSON.parse(raw||'[]')
  memberCategoryRecords.value=Array.isArray(parsed)?parsed.filter(x=>
   x&&['income','expense'].includes(x.type)&&typeof x.name==='string'&&x.name.length<=20
  ).slice(0,80):[]
 }catch{memberCategoryRecords.value=[]}
}
function saveMemberCategory(){
 const name=memberCategoryName.value.trim(),type=memberCategoryEntryType.value
 if(!name||name.length>20||!['income','expense'].includes(type))return
 if(memberCategoryRecords.value.some(x=>x.type===type&&x.name===name)){
  memberEntryError.value='すでに同じカテゴリがあります';return
 }
 memberCategorySaving.value=true
 try{
  memberCategoryRecords.value.push({type,name,icon:memberCategoryIcon.value})
  localStorage.setItem('kakeibo-personal-categories:'+props.user.user_id,
   JSON.stringify(memberCategoryRecords.value))
  memberCategoryDialog.value=false;memberCategoryName.value=''
 }catch(e){memberEntryError.value='端末へカテゴリを保存できません：'+e.message}
 finally{memberCategorySaving.value=false}
}
const memberInputBusy=computed(()=>memberEntryPending.value?'saving':memberOcrBusy.value?'読み取り中':'')
const memberReceiptImage=ref(null),memberReceiptFileName=ref('')
const memberDraftRecoveryInfo=ref('')
const memberPaymentSourceChoices=computed(()=>memberPaymentOptions.value)
const memberExpenseCategoryChoices=computed(()=>[...new Set([
 ...entryExpenseCategories,...entryCategories.value,
 ...memberCategoryRecords.value.filter(x=>x.type==='expense').map(x=>x.name)
])])
const memberIncomeCategoryChoices=computed(()=>[...new Set([
 ...entryIncomeCategories,...memberCategoryRecords.value.filter(x=>x.type==='income').map(x=>x.name)
])])
const memberRuleCategoryOptions=computed(()=>[...new Set([...memberExpenseCategoryChoices.value,...memberIncomeCategoryChoices.value])])
function clearMemberDraft(){
 if(memberEntries.value.length||memberRawText.value.trim()){
  if(!window.confirm('未保存の下書きを破棄しますか？'))return
 }
 memberEntries.value=[];memberRawText.value='';memberEntryError.value=''
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
 transferDestinations:computed(()=>[]),categories:memberExpenseCategoryChoices,
 INCOME_CATEGORIES:memberIncomeCategoryChoices,
 paymentSources:computed(()=>[]),categoryLabel:(x)=>x,
 selectDraftReceipt:()=>{},pendingReceiptImage:memberReceiptImage,
 pendingReceiptFileName:memberReceiptFileName,receiptSaveError:memberEntryError,
 setEntryType:(f,type)=>setMemberEntryType(type,f),
 applyMerchantPayment:applyMemberMerchantRule,
 manualPayment:(f,source)=>{f.paymentSource=source},
 onImage:memberScanImage,addBlank:()=>addMemberEntry(),saveAll:submitMemberEntry,
 receiptEnabled:computed(()=>false),
 allowedTypes:computed(()=>['expense','income']),
 paymentChoices:memberPaymentSourceChoices
})
loadMemberCategories()
watch(()=>props.user.user_id,loadMemberCategories)
</script>
<template>
 <div class="member-shell">
  <FamilySharedMutationRequests ref="sharedMutationRef" headless
   :key="'member-ledger-submit:'+user.user_id"
   :user-id="user.user_id" :household-id="user.household_id" />
  <section v-if="error" class="member-alert" role="alert">{{error}}
   <button type="button" @click="refresh">再試行</button>
  </section>
  <OriginalKakeiboPages :identity="user" :theme="theme" :themes="themes"
   :active-tab="tab" :member="true" :personal-assets="assets"
   :on-create-personal-account="createAccount"
   :on-open-personal-management="openMemberPrepaidAdd"
   :personal-prepaid-api="memberPrepaidApi"
   :personal-portfolio-api="memberSbiApi"
   :on-personal-opening="saveMemberPrepaidOpening"
   :on-personal-history="openMemberWalletHistory"
   :management-bindings="{memberView:true,memberBusy:busy,memberError:error,
    memberStatus:'本人のカード・残高・固定費 · '+myAccounts.length+'口座',
    memberRefresh:refresh,memberTrashCount:memberArchivedAccounts.length,api}"
   @update:active-tab="tab=$event" @ledger-open="tab='list'"
   @theme-change="emit('theme-change',$event)" @logout="emit('logout')">
   <template #member-cards>
    <OriginalCardManagementPanel
      :selected="selectedCardId"
      :options="cardAccounts.filter(a=>!a.is_archived).map(a=>({value:a.account_id,label:a.label}))"
      :default-value="defaultCard" :busy="busy"
      :mode="cardMode" :name="selectedCard?.label||''" :card="cardMeta"
      :closing-day="selectedCard?.closing_day?String(selectedCard.closing_day)+'日':'末日'"
      :payment-sources="cardLabels" :share-ready="false"
      :archived="cardAccounts.filter(a=>a.is_archived).map(a=>({value:a.account_id,
        label:a.label,kind:a.account_kind}))"
      :allow-permanent-delete="false" empty-hint="＋から本人のカードを追加できます。"
      :default-source-type="preferredCardType"
      :on-save="saveCard" :on-danger="cardDanger"
      @update:selected="selectedCardId=$event" @update:mode="next=>{if(next==='add')preferredCardType='standard';cardMode=next}"
      @default="makeDefaultCard"
      @archive="id=>modify(cardAccounts.find(a=>a.account_id===id),{is_archived:false})" />
   </template>
   <template #member-plans>
    <MemberFixedCosts :key="'member-fixed:'+user.user_id" :user-id="user.user_id"
     :payment-choices="memberPaymentOptions"
     :categories="[...new Set([...entryExpenseCategories,...entryCategories])]"
     :on-submit-entry="submitMemberFixedCost" />
   </template>
   <template #member-investment>
    <SbiPortfolio member-mode active-view="plans" :api="memberSbiApi"
      :on-member-create="()=>openMemberInvestmentPlan()"
      :on-member-edit="openMemberInvestmentPlan"/>
    <FamilyRecurringFinance ref="memberRecurringRef" view="investment"
     :key="'personal-sbi:'+user.user_id" :user-id="user.user_id"
     :household-id="user.household_id" :accounts="myAccounts" @changed="refresh"/>
   </template>
   <template #member-rules>
     <p v-if="memberRuleError" role="alert" class="member-alert">{{memberRuleError}}</p>
     <MobileMerchantRulesPanel :rules="memberMerchantRules"
       :categories="memberRuleCategoryOptions" :payment-sources="memberPaymentOptions"
       :category-label="x=>x" :on-save="saveMemberMerchantRule"/>
   </template>
   <template #member-jobs>
     <p class="help">本人の定期設定は「固定費」「積立」に保存されます。金融取引は HomeFlow の承認と実際の入出金証拠が必要です。</p>
     <button type="button" class="button-secondary" :disabled="busy" @click="refresh">
       {{busy?'確認中…':'本人の設定と審査状態を更新'}}
     </button>
     <p class="help">審査中の家庭明細 {{pendingMutations.length}}件</p>
   </template>
   <template #member-privacy>
     <div class="device-privacy-section">
       <div class="device-privacy-row"><strong>ログイン状態の保存</strong><span class="help">HomeFlow で管理</span></div>
       <p class="help">ログイン状態は本人の HomeFlow 認証で管理しています。家族のカード・口座データを端末に保存しません。</p>
       <button type="button" class="button-secondary" @click="emit('logout')">この端末からログアウト</button>
     </div>
     <div class="device-privacy-section">
       <div class="device-privacy-row"><strong>保存済みレシート画像</strong><span class="help">端末内保存なし</span></div>
       <p class="help">本人の OCR 画像は端末内で読み取り、一括保存しません。共有レシートは所有権を確認せず削除できません。</p>
     </div>
   </template>
   <template #member-backup>
    <p class="help">本人のカード・銀行・固定費・カテゴリ・店舗ルールの設定を暗号化して保存します。家庭共有明細や他人の情報は含めません。</p>
    <div class="member-backup-actions">
     <button type="button" class="button-secondary" :disabled="personalBackupBusy" @click="exportPersonalAccounts">
      {{personalBackupBusy?'処理中…':'本人の設定を暗号化して保存'}}
     </button>
     <label class="member-backup-upload button-secondary">バックアップを選択
      <input type="file" accept=".enc" :disabled="personalBackupBusy" @change="importPersonalBackup"/>
     </label>
    </div>
    <p v-if="personalBackupMessage" class="help" role="status">{{personalBackupMessage}}</p>
    <p class="help">復元は本人の未登録店舗ルール・カテゴリのみ追加します。口座・残高・固定費・家庭明細の自動上書きは行いません。</p>
   </template>
   <template #member-duplicates>
     <p v-if="!memberDuplicateGroups.length" class="help">現在表示中の家庭明細に同日・同額・同店の重複候補はありません。</p>
     <div v-for="(group,i) in memberDuplicateGroups" :key="i" class="entry">
       <strong>{{group[0].date}} · {{group[0].merchant}} · ¥{{Number(group[0].amount).toLocaleString('ja-JP')}} · {{group.length}}件</strong>
       <button type="button" @click="tab='list'">明細を見る</button>
     </div>
     <p class="help">共有明細の削除・変更は本人の承認申請から行い、管理者の確認後に反映します。</p>
   </template>
   <template #member-trash>
     <p v-if="!memberArchivedAccounts.length" class="help">本人がアーカイブした口座はありません。</p>
     <div v-for="a in memberArchivedAccounts" :key="a.account_id" class="entry">
       <strong>{{a.label}}</strong>
       <button type="button" :disabled="busy" @click="modify(a,{is_archived:false})">復元</button>
     </div>
     <p class="help">このゴミ箱は本人の口座設定だけを扱います。家庭共有明細の完全削除は管理者専用です。</p>
   </template>
  </OriginalKakeiboPages>
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
