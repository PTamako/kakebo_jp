<script setup>
import {ref,computed,provide,onMounted,onUnmounted,watch} from 'vue'
import FamilyFinanceProposals from './FamilyFinanceProposals.vue'
import FamilyRecurringFinance from './FamilyRecurringFinance.vue'
import FamilySharedMutationRequests from './FamilySharedMutationRequests.vue'
import TransactionForm from './TransactionForm.vue'
import {SPOUSE_INCOME_CATEGORY,SPOUSE_INCOME_SOURCE} from './spouse-income.js'
import {parseEntries,parseReceipt,ocrImage} from './parse.js'
import {parseNamedExpenseBlocks} from './named-expense.js'
import {parseRepeatedExpense} from './natural-repeat.js'
import {memberPaymentChoices as buildMemberPaymentChoices,resolveMemberPayment} from './member-payment-choices.js'
import BottomNavigation from './BottomNavigation.vue'
import AppTopbar from './AppTopbar.vue'
import ManagementPage from './pages/ManagementPage.vue'
import CardManagementControls from './CardManagementControls.vue'
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
const tab=ref('list')
const accounts=ref([]),assets=ref([]),sharedEntries=ref([]),pendingMutations=ref([]),totals=ref(null),yearly=ref(null)
const sharedCards=ref([]),cardSharingError=ref('')
const month=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,7))
const year=ref(month.value.slice(0,4))
const busy=ref(false),error=ref(''),label=ref(''),kind=ref('cash')
const renameId=ref(''),rename=ref(''),notice=ref('')
const selectedCardId=ref(''),cardMode=ref('')
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
    throw Error('卡片归属验证失败')
   selectedCardId.value=created.account_id
  }else{
   const a=selectedCard.value
   if(!a||a.owner_user_id!==user||a.origin!=='member_created')throw Error('只能编辑本人的卡片')
   if((payload.sourceType==='prepaid')!==(a.account_kind==='prepaid'))
    throw Error('账户类型更换尚不支持，请创建另一张个人卡片')
   const changes={label:payload.name,version:a.version,expected_user_id:user}
   if(payload.closingDay!==undefined)changes.closing_day=payload.closingDay
   const updated=await api('accounts/'+a.account_id,request(changes,'PATCH'))
   if(updated.ledger_changed!==false)throw Error('卡片更新未完成验证')
  }
  if(revision!==epoch||user!==props.user.user_id)return
  cardMode.value='';await refresh()
 }catch(e){if(revision===epoch){error.value=e.message;throw e}}
 finally{busy.value=false}
}
async function cardDanger(action,name){
 const a=selectedCard.value
 if(!a||a.owner_user_id!==props.user.user_id||a.label!==name)
  throw Error('账户身份已改变')
 if(action==='archive'){
  await modify(a,{is_archived:true});cardMode.value='';return
 }
 throw Error('永久删除卡片与余额需要独立核对，目前只能归档')
}

let epoch=0,alive=true
const kinds=[['credit_card','信用卡'],['prepaid','储值卡'],['cash','现金'],
 ['bank','银行'],['points','积分'],['securities','证券'],['other','其他']]
const kindLabel=x=>kinds.find(k=>k[0]===x)?.[1]||'账户'
const yen=n=>n===null||n===undefined?'—':'¥'+Number(n).toLocaleString('ja-JP')
const myAccounts=computed(()=>accounts.value.filter(x=>x.owner_user_id===props.user.user_id))
const memberPaymentOptions=computed(()=>buildMemberPaymentChoices(myAccounts.value,sharedCards.value))
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
const memberOcrBusy=ref(false),memberOcrStatus=ref('')
const memberTodayLabel=computed(()=>new Date(Date.now()+32400000).toLocaleString('ja-JP',{
 timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}))
function addMemberEntry(){memberEntries.value.push(newEntry())}
function removeMemberEntry(index){if(!memberEntryPending.value)memberEntries.value.splice(index,1)}
function setMemberEntryType(type,entry){
 if(!['expense','income'].includes(type))return
 entry.type=type
 entry.category=type==='expense'?'食費':'給与'
 entry.merchant=''
}
function recognizeMemberText(){
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
 const drafts=parsed.filter(x=>x&&Number.isSafeInteger(Number(x.amount))&&Number(x.amount)>0)
  .map(x=>({...newEntry(),type:x.type==='income'?'income':'expense',
   amount:Number(x.amount),date:String(x.date||newEntry().date),
   time:String(x.time||''),merchant:String(x.merchant||''),
   category:String(x.category||'日用品'),note:String(x.note||'')}))
 if(!drafts.length){memberEntryError.value='解析できる金額がありません。原文と金額を確認してください。';return}
 if(memberEntries.value.length&& !window.confirm('現在の未保存記録を読み取り結果で置き換えますか？'))return
 memberEntries.value=drafts
 memberEntryNotice.value=drafts.length+'件を読み取りました。保存する前に金額・日付・支払方法を確認してください。'
}
async function memberScanImage(event){
 const file=event.target?.files?.[0];if(event.target)event.target.value=''
 if(!file||memberOcrBusy.value)return
 memberOcrBusy.value=true;memberEntryError.value='';memberOcrStatus.value='端末内OCRで読み取り中'
 try{
  memberRawText.value=await ocrImage(file,progress=>{
   memberOcrStatus.value='端末内OCRで読み取り中 '+Math.max(0,Math.min(100,Number(progress)||0))+'%'
  })
  if(!memberRawText.value.trim())throw Error('文字が読み取れませんでした')
  recognizeMemberText()
  memberInputMode.value='scan'
  memberOcrStatus.value='端末内OCR · 読み取り完了（元画像は保存しません）'
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
  if(next.ledger_scope!=='household')throw Error('家庭账目范围验证失败')
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
   throw Error('账本权限范围核验失败')
  if((a.items||[]).some(x=>x.owner_user_id!==user))throw Error('账户归属不一致')
  accounts.value=a.items||[];assets.value=b.accounts||[]
  cardSharingError.value=f.share_error||''
  sharedCards.value=f.scope==='granted-cards'&&Array.isArray(f.incoming)?f.incoming:[]
  sharedEntries.value=c.items||[];pageOffset.value=c.next_offset;
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
async function createAccount(){
 if(busy.value||!label.value.trim())return
 const ticket=epoch,user=props.user.user_id
 busy.value=true;error.value=''
 try{
  const r=await api('accounts',request({label:label.value.trim(),account_kind:kind.value,expected_user_id:user}))
  if(ticket!==epoch||user!==props.user.user_id)return
  if(r.ledger_changed!==false||r.owner_user_id!==user)throw Error('账户所有权核验失败')
  label.value='';notice.value='账户已添加';await refresh()
 }catch(e){if(ticket===epoch)error.value=e.message}finally{busy.value=false}
}
async function modify(a,changes){
 if(busy.value||a.owner_user_id!==props.user.user_id||a.origin!=='member_created')return
 if(changes.is_archived===true&&!confirm('归档该账户？原有记录不会删除。'))return
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
function foreground(){if(document.visibilityState==='visible')void refresh()}
watch(()=>props.user.user_id,()=>{pendingPaidEntry=null;memberEntries.value=[];memberRawText.value='';label.value='';renameId.value='';void refresh()})
watch([month,year],()=>void refresh())
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;epoch++;pendingPaidEntry=null;accounts.value=[];assets.value=[];sharedEntries.value=[];pendingMutations.value=[];sharedCards.value=[];
 document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <div class="member-shell">
  <AppTopbar :identity="user" :theme="theme" :themes="themes"
    @change-theme="emit('theme-change',$event)" @logout="emit('logout')" />
  <FamilySharedMutationRequests ref="sharedMutationRef" headless
   :key="'member-ledger-submit:'+user.user_id"
   :user-id="user.user_id" :household-id="user.household_id" />
  <section v-if="error" class="member-alert" role="alert">{{error}}
   <button type="button" @click="refresh">再试一次</button>
  </section>
  <section v-if="tab==='list'" class="member-page">
   <LedgerPage member />
  </section>
  <StatisticsPage v-else-if="tab==='stat'" />
  <section v-else-if="tab==='add'" class="page-section member-page">
   <div class="page-heading">
    <div><h1>入力</h1><time class="entry-live-clock">{{memberTodayLabel}}</time></div>
   </div>
   <fieldset class="draft-controls" :disabled="memberEntryPending||memberOcrBusy">
    <div class="input-mode-switch" role="tablist" aria-label="入力方法">
     <button type="button" role="tab" :aria-selected="memberInputMode==='manual'"
      :class="{selected:memberInputMode==='manual'}" @click="memberInputMode='manual';memberScanMode='statement'">手入力</button>
     <button type="button" role="tab" :aria-selected="memberInputMode==='scan'"
      :class="{selected:memberInputMode==='scan'}" @click="memberInputMode='scan'">画像から読み取る</button>
    </div>
    <div v-if="memberInputMode==='manual'" class="panel text-paste-panel">
     <details class="text-entry-details">
      <summary>テキストを貼り付けて読み取る</summary>
      <label class="field-label" for="member-raw-text">テキスト入力</label>
      <textarea id="member-raw-text" v-model="memberRawText" rows="4"
       placeholder="ご利用明細やレシートの文字を貼り付けてください"></textarea>
      <div class="action-row">
       <button type="button" class="button-secondary" :disabled="!memberRawText.trim()" @click="memberScanMode='statement';recognizeMemberText()">テキストを読み取る</button>
      </div>
     </details>
    </div>
    <div v-else class="panel capture-panel">
     <div class="input-mode-switch" role="tablist" aria-label="読み取り対象">
      <button type="button" :class="{selected:memberScanMode==='statement'}" @click="memberScanMode='statement'">利用明細</button>
      <button type="button" :class="{selected:memberScanMode==='receipt'}" @click="memberScanMode='receipt'">レシート</button>
     </div>
     <p class="microcopy">端末内OCRを使用します。写真は自動保存されません。</p>
     <label class="button-secondary upload-button" :aria-disabled="memberOcrBusy">
      画像を読み取る
      <input type="file" accept="image/*" hidden :disabled="memberOcrBusy" @change="memberScanImage" />
     </label>
     <p v-if="memberOcrStatus" class="microcopy" role="status">{{memberOcrStatus}}</p>
     <details v-if="memberRawText.trim()" class="text-entry-details"><summary>読み取り文字を確認・修正</summary>
      <textarea v-model="memberRawText" rows="5" aria-label="読み取り文字"></textarea>
      <button type="button" class="button-secondary" @click="recognizeMemberText()">修正して再解析</button>
     </details>
    </div>
    <div v-if="memberEntries.length" class="draft-heading">
     <div><h2>入力内容の確認</h2><p>保存前に金額・日付を確認</p></div>
     <span class="count-pill">{{memberEntries.length}}件</span>
    </div>
    <div v-for="(f,i) in memberEntries" :key="i" class="entry-card">
     <div class="entry-card-heading">
      <span class="entry-number">{{String(i+1).padStart(2,'0')}}</span>
      <strong>{{f.merchant||'新しい記録'}}</strong>
      <button class="icon-button remove-button" type="button" @click="removeMemberEntry(i)" aria-label="この記録を削除">×</button>
     </div>
     <TransactionForm :record="f"
      :categories="[...new Set([...entryExpenseCategories,...entryCategories])]"
      :income-categories="entryIncomeCategories" :payment-sources="[]"
      :payment-choices="memberPaymentOptions"
      :allowed-types="['expense','income']" :show-payment-source="true"
      :receipt-enabled="false" :category-label="x=>x"
      @change-type="setMemberEntryType($event,f)"
      @payment-change="f.paymentSource=$event" />
     <label v-if="f.type==='income'&&f.category!==SPOUSE_INCOME_CATEGORY" class="form-field">
      <span>収入元</span><input v-model="f.merchant" maxlength="120" placeholder="給与・副収入など"/>
     </label>
    </div>
    <p v-if="memberEntryError" class="member-alert" role="alert">{{memberEntryError}}</p>
    <p v-if="memberEntryNotice" class="microcopy" role="status">{{memberEntryNotice}}</p>
    <div class="batch-actions" :class="{'batch-actions-empty':!memberEntries.length}">
     <button class="button-secondary" type="button" @click="addMemberEntry">＋ 記録を追加</button>
     <button class="button-primary" type="button"
      :disabled="memberEntryPending||memberOcrBusy||!memberEntries.length||memberEntries.some(f=>!(Number(f.amount)>0)||!f.category)"
      @click="submitMemberEntry">{{memberEntryPending?'送信中…':`保存 ${memberEntries.length}件`}}</button>
    </div>
   </fieldset>
   <p v-if="cardSharingError" class="member-alert" role="alert">共有カードの取得に失敗しました：{{cardSharingError}}。更新して再試行してください。</p>
  </section>
    <AssetsPage v-else-if="tab==='investments'" :personal-assets="assets"
    :open-personal-management="()=>{tab='finance'}" />
  <ManagementPage v-else-if="tab==='finance'" class="member-page"
    :member-view="true" :member-busy="busy" :member-error="error"
    :member-status="'本人のカード・残高・固定費 · '+myAccounts.length+'口座'"
    :member-refresh="refresh" :api="api">
   <template #member-cards>
    <section class="finance-panel">
     <h2>支払方法・カード管理</h2>
     <CardManagementControls v-model="selectedCardId" :busy="busy"
       :options="cardAccounts.map(a=>({value:a.account_id,label:a.label}))"
       :default-value="defaultCard" @default="makeDefaultCard"
       @edit="cardMode='edit'" @add="cardMode='add'" />
     <MobileCardEditorSheet :mode="cardMode" :card-name="selectedCard?.label||''"
      :card="cardMeta" :closing-day="selectedCard?.closing_day?String(selectedCard.closing_day)+'日':'末日'"
      :payment-sources="cardLabels" :busy="busy" :on-save="saveCard" :on-danger="cardDanger"
      @close="cardMode=''" />
     <p v-if="!cardAccounts.length" class="help">个人卡片为空白，点击＋创建自己的卡片。</p>
     <div v-for="a in cardAccounts" :key="a.account_id" class="entry">
      <div><strong>{{a.label}}</strong><small>{{kindLabel(a.account_kind)}} · {{a.is_archived?'已归档':'使用中'}}</small></div>
      <button type="button" @click="selectedCardId=a.account_id;cardMode='edit'">编辑</button>
      <button v-if="a.is_archived" type="button" @click="modify(a,{is_archived:false})">恢复</button>
     </div>
    </section>
    <div class="finance-panel new-account">
     <strong>现金、银行、积分或证券账户</strong>
     <form class="new-account" @submit.prevent="createAccount">
      <select v-model="kind" aria-label="账户类型">
       <option v-for="k in kinds.filter(x=>!['credit_card','prepaid'].includes(x[0]))" :key="k[0]" :value="k[0]">{{k[1]}}</option>
      </select>
      <input v-model="label" maxlength="80" required placeholder="账户名称" aria-label="账户名称"/>
      <button type="submit" :disabled="busy||!label.trim()">新建</button>
     </form>
    </div>
   </template>
   <template #member-plans>
    <FamilyRecurringFinance :key="'personal-recurring:'+user.user_id"
     :user-id="user.user_id" :household-id="user.household_id" :accounts="myAccounts" @changed="refresh"/>
   </template>
   <template #member-investment>
   <div class="finance-panel">
    <p class="help">个人证券账户：仅显示本人创建的账户。真实基金份额及市值在对账前不会自动填写。</p>
    <div v-for="a in myAccounts.filter(x=>x.account_kind==='securities')" :key="a.account_id">{{a.label}}</div>
   </div>
   </template>
   <template #member-tools>
   <div class="finance-panel"><p class="help">個人の金融口座は本人が直接管理できます。家庭帳簿への入帳時だけ審査が必要です。</p>
    <button type="button" @click="refresh">すべて更新</button>
   </div>
   </template>
  </ManagementPage>
  <BottomNavigation :active-tab="tab" @change="next=>tab=next" />
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
