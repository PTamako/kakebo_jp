<script setup>
import {ref,computed,provide,onMounted,onUnmounted,watch} from 'vue'
import FamilyFinanceProposals from './FamilyFinanceProposals.vue'
import FamilyRecurringFinance from './FamilyRecurringFinance.vue'
import FamilySharedMutationRequests from './FamilySharedMutationRequests.vue'
import BottomNavigation from './BottomNavigation.vue'
import FinanceManagementHeader from './FinanceManagementHeader.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import MobileCardEditorSheet from './MobileCardEditorSheet.vue'
import LedgerEntryContent from './LedgerEntryContent.vue'
import LedgerTypeFilter from './LedgerTypeFilter.vue'
import AssetsPage from './pages/AssetsPage.vue'
import StatisticsPage from './pages/StatisticsPage.vue'
import {makeFamilyStatsContext} from './family-stats-context.js'
import LedgerPage from './pages/LedgerPage.vue'
import {makeFamilyLedgerContext} from './family-ledger-context.js'
const props=defineProps({user:{type:Object,required:true}})
const tab=ref('list'),managementTab=ref('cards')
const accounts=ref([]),assets=ref([]),sharedEntries=ref([]),totals=ref(null),yearly=ref(null)
const month=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,7))
const year=ref(month.value.slice(0,4))
const busy=ref(false),error=ref(''),label=ref(''),kind=ref('cash')
const renameId=ref(''),rename=ref(''),notice=ref('')
const selectedCardId=ref(''),cardMode=ref('')
const cardAccounts=computed(()=>myAccounts.value.filter(a=>['credit_card','prepaid'].includes(a.account_kind)))
const selectedCard=computed(()=>cardAccounts.value.find(a=>a.account_id===selectedCardId.value)||null)
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
const selectedEntryType=ref('all')
const monthlyReport=ref(null),annualReport=ref(null),selectedYear=ref(Number(year.value))
const sharedMutationRef=ref(null)
function openApproval(action,entry){
 if(!entry)return
 void sharedMutationRef.value?.openForEntry(action,entry)
}
const memberLedger=makeFamilyLedgerContext({tab,month,selectedYear,entries:sharedEntries,
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
 error.value='';accounts.value=[];assets.value=[];sharedEntries.value=[];totals.value=null;yearly.value=null
 try{
  const [a,b,c,d,e]=await Promise.all([
   api('accounts'),api('personal/assets'),
   api('shared/entries?limit=100&month='+encodeURIComponent(month.value)),
   api('shared/stats?month='+month.value),
   api('shared/stats?year='+year.value)
  ])
  if(!alive||ticket!==epoch||user!==props.user.user_id)return
  if(a.account_scope!=='personal'||b.scope!=='personal'||b.viewer_user_id!==user||
   c.ledger_scope!=='household'||d.ledger_scope!=='household'||e.ledger_scope!=='household')
   throw Error('账本权限范围核验失败')
  if((a.items||[]).some(x=>x.owner_user_id!==user))throw Error('账户归属不一致')
  accounts.value=a.items||[];assets.value=b.accounts||[]
  sharedEntries.value=c.items||[];pageOffset.value=c.next_offset;
  monthlyReport.value=d;annualReport.value=e
  totals.value={income:d.income,expense:d.total,transfer:d.transferTotal}
  yearly.value={totals:{income:e.income,expense:e.total,transfer:e.transferTotal},
   net_income_expense:Number(e.income||0)-Number(e.total||0)}
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
watch(()=>props.user.user_id,()=>{label.value='';renameId.value='';void refresh()})
watch([month,year],()=>void refresh())
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;epoch++;accounts.value=[];assets.value=[];sharedEntries.value=[];
 document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <div class="member-shell">
  <header class="topbar member-topbar">
   <div class="brand">
    <img class="brand-wordmark" src="/branding/kakeibo-wordmark.png?v=4"
     alt="家計簿" width="400" height="100"/>
   </div><span class="member-family-label">家庭账本</span>
  </header>
  <section v-if="error" class="member-alert" role="alert">{{error}}
   <button type="button" @click="refresh">再试一次</button>
  </section>
  <section v-if="tab==='list'" class="member-page">
   <LedgerPage member />
   <FamilySharedMutationRequests ref="sharedMutationRef"
     :key="'personal-mutation:'+user.user_id"
     :user-id="user.user_id" :household-id="user.household_id" />
  </section>
  <StatisticsPage v-else-if="tab==='stat'" />
  <section v-else-if="tab==='add'" class="member-page">
   <h1>記録を追加</h1>
   <p class="help">家庭账目通过 HomeFlow 审批入账，不使用管理员旧账本访问码。</p>
   <FamilyFinanceProposals :key="'personal-proposal:'+user.user_id"
    :user-id="user.user_id" :accounts="myAccounts"/>
  </section>
  <AssetsPage v-else-if="tab==='investments'" :personal-assets="assets"
    :open-personal-management="()=>{tab='finance';managementTab='cards'}" />
  <section v-else-if="tab==='finance'" class="member-page">
   <FinanceManagementHeader v-model="managementTab" :busy="busy"
     :status="'本人のカード・残高・固定費のみ · '+myAccounts.length+'口座'"
     :error="error" @refresh="refresh" />
   <template v-if="managementTab==='cards'">
    <section class="finance-panel">
     <h2>支払方法・カード管理</h2>
     <div class="finance-inputs card-controls card-main-controls">
      <MobileChoiceSheet v-model="selectedCardId" label="管理するカード"
       :options="[{value:'',label:'支払方法・カードを選択'},
        ...cardAccounts.map(a=>({value:a.account_id,label:a.label}))]" />
      <button type="button" class="card-icon-action" :disabled="!selectedCard||!!busy"
       @click="cardMode='edit'" aria-label="カードを編集" title="カードを編集">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4 16.5-16.5Z"/></svg>
      </button>
      <button type="button" class="card-icon-action" @click="cardMode='add'"
       aria-label="カードを追加" title="カードを追加">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
      </button>
     </div>
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
   <FamilyRecurringFinance v-else-if="managementTab==='plans'" :key="'personal-recurring:'+user.user_id"
    :user-id="user.user_id" :household-id="user.household_id" :accounts="myAccounts" @changed="refresh"/>
   <div v-else-if="managementTab==='investment'" class="entry">
    <p class="help">个人证券账户：仅显示本人创建的账户。真实基金份额及市值在对账前不会自动填写。</p>
    <div v-for="a in myAccounts.filter(x=>x.account_kind==='securities')" :key="a.account_id">{{a.label}}</div>
   </div>
   <div v-else class="entry"><p class="help">独立个人账户 · {{user.display_name}}。家庭汇总在「統計」查看。</p>
    <button type="button" @click="refresh">すべて更新</button>
   </div>
  </section>
  <BottomNavigation :active-tab="tab" @change="next=>tab=next" />
 </div>
</template>
<style scoped>
.member-shell{max-width:680px;margin:auto;padding:12px 16px 140px;min-height:76vh;display:grid;gap:14px;align-content:start}
.member-topbar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.member-topbar .brand{display:flex;align-items:center;min-width:0}
.member-topbar .brand-wordmark{display:block;width:min(168px,43vw);height:auto;object-fit:contain}
.member-family-label{font-size:12px;color:var(--muted,#81777b);white-space:nowrap}
.member-page{display:grid;gap:12px;min-width:0}
.member-page h1{margin:0;font-size:23px}
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
