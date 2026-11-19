<script setup>
import {computed,onMounted,ref,watch,nextTick} from 'vue'
import RecurringFormSheet from './RecurringFormSheet.vue'
import RecurringCostOverview from './RecurringCostOverview.vue'
import AmountInput from './AmountInput.vue'
import {selectPendingBill} from './variable-recurring-display.js'
const props=defineProps({
 api:{type:Function,required:true},
 categories:{type:Array,default:()=>[]},
 paymentSources:{type:Array,default:()=>[]},
 categoryLabel:{type:Function,default:x=>x},
 inline:{type:Boolean,default:false},
 refreshKey:{type:Number,default:0},
 active:{type:Boolean,default:true}
})
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const thisMonth=()=>today().slice(0,7)
const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
const ready=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const plans=ref([]),bills=ref([])
const expanded=ref(false),planEditor=ref(false),billEditor=ref(false)
const planEditorElement=ref(null),billEditorElement=ref(null)
function focusVariableEditor(node){
 void nextTick(()=>node.value?.scrollIntoView({block:'start',behavior:'smooth'}))
}
function closePlanEditor(){planEditor.value=false;editing.value=false;form.value=emptyPlan()}
const editing=ref(false),selectedPlan=ref(null)
const emptyPlan=()=>({id:crypto.randomUUID(),name:'',category:'',paymentSource:'',
 startMonth:thisMonth(),intervalMonths:1,budgetJpy:'',enabled:true})
const form=ref(emptyPlan())
const emptyBill=(periodMonth=thisMonth())=>({periodMonth,amountJpy:'',
 expenseDate:'',paidDate:'',serviceStart:'',serviceEnd:''})
const invoice=ref(emptyBill())
// The shared money field emits 0 when cleared; keep an empty variable bill as a draft.
const invoiceAmount=computed({
 get:()=>invoice.value.amountJpy,
 set:value=>{invoice.value.amountJpy=value===0?'':value}
})
const cycleOptions=[{value:1,label:'毎月'},{value:2,label:'2か月ごと'},
 {value:3,label:'3か月ごと'},{value:6,label:'6か月ごと'},
 {value:12,label:'毎年'}]
const validatedPlan=computed(()=>form.value.name.trim()&&form.value.category&&
 form.value.paymentSource&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(form.value.startMonth)&&
 [1,2,3,6,12].includes(Number(form.value.intervalMonths))&&
 (form.value.budgetJpy===''||Number(form.value.budgetJpy)>0))
const periodIsOnCycle=(p,month)=>{
 if(!p||!month||month<p.startMonth)return false
 const [a,b]=p.startMonth.split('-').map(Number)
 const [c,d]=month.split('-').map(Number)
 return ((c-a)*12+d-b)%p.intervalMonths===0
}
const chosenSaved=computed(()=>bills.value.find(x=>
 x.planId===selectedPlan.value?.id&&x.periodMonth===invoice.value.periodMonth))
const chosenPlan=computed(()=>plans.value.find(p=>p.id===selectedPlan.value?.id))
const canSaveBill=computed(()=>!!chosenPlan.value?.enabled&&
 periodIsOnCycle(chosenPlan.value,invoice.value.periodMonth)&&
 (invoice.value.amountJpy===''||
  (Number.isSafeInteger(Number(invoice.value.amountJpy))&&Number(invoice.value.amountJpy)>0&&
    Number(invoice.value.amountJpy)<=10000000))&&
 (!invoice.value.serviceStart||!invoice.value.serviceEnd||
  invoice.value.serviceStart<=invoice.value.serviceEnd))
const canConfirm=computed(()=>chosenSaved.value?.status==='draft'&&
 Number(chosenSaved.value.amountJpy)>0&&
 !!chosenSaved.value.expenseDate&&chosenSaved.value.expenseDate<=today())
function latestPeriod(p){
 let period=p.startMonth
 if(period>thisMonth())return period
 const [y,m]=period.split('-').map(Number)
 const [yy,mm]=thisMonth().split('-').map(Number)
 const n=Math.floor(((yy-y)*12+mm-m)/p.intervalMonths)*p.intervalMonths
 const d=new Date(Date.UTC(y, m-1+n,1))
 return d.toISOString().slice(0,7)
}
const displayedPeriod=p=>selectPendingBill(p,bills.value)?.periodMonth||latestPeriod(p)
const billFor=p=>bills.value.find(b=>b.planId===p.id&&b.periodMonth===displayedPeriod(p))
const latestKnownAmount=computed(()=>plans.value.reduce((sum,p)=>sum+Number(billFor(p)?.amountJpy||0),0))
const pendingDraftCount=computed(()=>bills.value.filter(b=>b.status==='draft').length)
const billLabel=p=>{
 if(!p.enabled)return '停止中'
 const b=billFor(p)
 if(b?.status==='posted')return '記帳済み'
 if(!b)return '請求待ち'
 if(Number(b.amountJpy)>0&&b.expenseDate)
  return b.expenseDate<=today()?'記帳可能':'自動記帳待ち'
 return '入力待ち'
}
async function api(path,opt={}){
 return props.api('variable-recurring'+path,opt)
}
async function refresh(){
 busy.value=true;error.value=''
 try{
  const res=await api('')
  if(!Array.isArray(res.plans)||!Array.isArray(res.bills))throw Error('データ形式が不正です')
  plans.value=res.plans;bills.value=res.bills;ready.value=true
 }catch(e){error.value=String(e.message||e);ready.value=false}
 finally{busy.value=false}
}
function newPlan(){
 editing.value=false;form.value=emptyPlan();planEditor.value=true;billEditor.value=false
 expanded.value=true;focusVariableEditor(planEditorElement)
}
function editPlan(p){
 editing.value=true;form.value={...p,budgetJpy:p.budgetJpy??''}
 planEditor.value=true;billEditor.value=false
 expanded.value=true;focusVariableEditor(planEditorElement)
}
async function savePlan(){
 if(busy.value||!validatedPlan.value)return
 busy.value=true;error.value='';notice.value=''
 const x={...form.value,intervalMonths:Number(form.value.intervalMonths),
  budgetJpy:form.value.budgetJpy===''?null:Number(form.value.budgetJpy)}
 try{
  const res=await api(editing.value?'/'+x.id:'',{
   method:editing.value?'PUT':'POST',body:JSON.stringify(x)})
  if(!res.ok)throw Error('保存結果を確認できません')
  planEditor.value=false;notice.value='変動費の設定を保存しました（まだ記帳していません）'
  await refresh()
 }catch(e){error.value=String(e.message||e)}
 finally{busy.value=false}
}
async function togglePlan(p){
 if(busy.value)return
 if(p.enabled&&!confirm(p.name+' の予定を停止しますか？過去の記帳は残ります。'))return
 busy.value=true;error.value=''
 try{
  const res=await api('/'+p.id,{method:'PUT',body:JSON.stringify({...p,enabled:!p.enabled})})
  if(!res.ok)throw Error('設定を変更できません')
  notice.value=p.enabled?'予定を停止しました':'予定を再開しました'
  await refresh()
 }catch(e){error.value=String(e.message||e)}
 finally{busy.value=false}
}
function openBill(p){
 selectedPlan.value=p
 const periodMonth=displayedPeriod(p)
 const existing=bills.value.find(x=>x.planId===p.id&&x.periodMonth===periodMonth)
 invoice.value=existing?{...existing,
  amountJpy:existing.amountJpy??'',
  expenseDate:existing.expenseDate||'',paidDate:existing.paidDate||'',
  serviceStart:existing.serviceStart||'',serviceEnd:existing.serviceEnd||''}:
  emptyBill(periodMonth)
 billEditor.value=true;planEditor.value=false;expanded.value=true
 focusVariableEditor(billEditorElement)
}
watch(()=>invoice.value.periodMonth,month=>{
 if(!selectedPlan.value)return
 const x=bills.value.find(b=>b.planId===selectedPlan.value.id&&b.periodMonth===month)
 const selected=invoice.value
 invoice.value=x?{...x,amountJpy:x.amountJpy??'',
  expenseDate:x.expenseDate||'',paidDate:x.paidDate||'',
  serviceStart:x.serviceStart||'',serviceEnd:x.serviceEnd||''}:emptyBill(month)
})
async function saveBill(){
 if(busy.value||!canSaveBill.value)return
 busy.value=true;error.value='';notice.value=''
 try{
  const x=invoice.value
  const payload={periodMonth:x.periodMonth,
   amountJpy:x.amountJpy===''?null:Number(x.amountJpy),
   billDate:null,expenseDate:x.expenseDate||null,
   paidDate:x.paidDate||null,serviceStart:x.serviceStart||null,serviceEnd:x.serviceEnd||null}
  const res=await api('/'+chosenPlan.value.id+'/bill',{method:'POST',body:JSON.stringify(payload)})
  if(!res.ok)throw Error('請求書の保存結果を確認できません')
  notice.value=payload.amountJpy&&payload.expenseDate
   ?'保存しました。記帳日以降の19:30に自動記帳します。'
   :'下書きを保存しました。金額と記帳日を入力すると自動記帳の対象になります。'
  await refresh()
 }catch(e){error.value=String(e.message||e)}
 finally{busy.value=false}
}
async function confirmBill(){
 if(busy.value||!canConfirm.value)return
 const b=chosenSaved.value,p=chosenPlan.value
 if(!confirm(p.name+' · '+b.periodMonth+' · '+yen(b.amountJpy)+
  ' を '+b.expenseDate+' の支出として一度だけ記帳しますか？\n文書助手や手入力に同じ明細がないことを確認してください。'))return
 busy.value=true;error.value='';notice.value=''
 try{
  const res=await api('/'+p.id+'/confirm',{method:'POST',
   body:JSON.stringify({periodMonth:b.periodMonth})})
  if(!res.posted)throw Error('記帳結果を確認できません')
  notice.value='確認済み：'+yen(b.amountJpy)+' を1回だけ支出に登録しました'
  await refresh()
  billEditor.value=false
 }catch(e){error.value=String(e.message||e)}
 finally{busy.value=false}
}
onMounted(refresh)
watch(()=>props.refreshKey,()=>{if(props.inline)void refresh()})
</script>
<template>
<section class="variable-costs" :class="{'is-inline':inline}">
 <button v-if="!inline" class="open-manager" type="button" :aria-expanded="expanded"
  @click="expanded=!expanded">
  <strong>変動する定期費用</strong><span>電気・ガス・水道・通信など（請求ごとに確認） {{expanded?'⌃':'⌄'}}</span>
 </button>
 <div v-if="inline || expanded" class="body">
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="hint">{{notice}}</p>
  <RecurringCostOverview title="変動金額" kind="variable" :count="plans.length"
    primary-label="最新回の入力済み額" :primary-value="yen(latestKnownAmount)"
    secondary-label="確認待ちの請求" :secondary-value="pendingDraftCount+'件'"
    note="入力済み額には未記帳の請求も含みます。"
    add-label="変動費を追加" @add="newPlan" />
  <section class="variable-register-card" aria-label="登録済みの変動費">
   <div class="variable-list-heading"><h3>登録済みの変動費</h3><span>{{plans.length}}件</span></div>
  <p v-if="ready&&!plans.length&&!planEditor" class="variable-empty">まだ登録がありません。電気・ガス・水道などを追加できます。</p>
  <div v-if="ready&&plans.length" class="plans" aria-label="登録済みの変動費">
   <details v-for="p in plans" :key="p.id" class="plan">
    <summary class="plan-summary">
     <span class="plan-title"><strong>{{p.name}}</strong><span class="plan-state" :class="{'is-due':billLabel(p)==='記帳可能'}">{{billLabel(p)}}</span></span>
     <small class="plan-meta">{{p.intervalMonths===1?'毎月':p.intervalMonths+'か月ごと'}} · {{p.paymentSource}}</small>
     <span class="plan-month">{{displayedPeriod(p)}} · {{billFor(p)?.amountJpy?yen(billFor(p).amountJpy):'金額未確定'}}</span>
    </summary>
    <div class="plan-detail">
     <small>参考予算 {{p.budgetJpy?yen(p.budgetJpy):'なし'}} · {{p.enabled?'有効':'停止中'}}</small>
     <div class="actions">
      <button type="button" :disabled="busy" @click="openBill(p)">請求を確認</button>
      <button type="button" :disabled="busy" @click="editPlan(p)">編集</button>
      <button type="button" :disabled="busy" @click="togglePlan(p)">{{p.enabled?'停止':'再開'}}</button>
     </div>
    </div>
   </details>
  </div>
  </section>
 </div>

 <RecurringFormSheet :open="active && planEditor" :busy="busy"
    :title="editing ? '変動費を編集' : '変動費を追加'"
    subtitle="電気・ガス・水道などの請求条件を設定します。" @close="closePlanEditor">
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <form v-if="planEditor" ref="planEditorElement" class="editor recurring-editor-fields" @submit.prevent="savePlan">
   <label>名称 <input v-model="form.name" maxlength="120" placeholder="例：オクトパスエナジー" required/></label>
   <label>カテゴリ <select v-model="form.category" required>
    <option value="">選択してください</option>
    <option v-for="category in categories" :key="category" :value="category">{{categoryLabel(category)}}</option>
   </select></label>
   <label>支払方法 <select v-model="form.paymentSource" required>
    <option value="">選択してください</option>
    <option v-for="source in paymentSources" :key="source" :value="source">{{source}}</option>
   </select></label>
   <h3 class="recurring-form-section-title">周期と予算</h3>
   <label>請求周期 <select v-model.number="form.intervalMonths">
    <option v-for="cycle in cycleOptions" :key="cycle.value" :value="cycle.value">{{cycle.label}}</option>
   </select></label>
   <label>開始月 <input v-model="form.startMonth" type="month" required/></label>
   <label>参考予算（任意・実績に含めない） <input v-model="form.budgetJpy" type="number" min="1" max="10000000" placeholder="未設定"/></label>
   <div class="actions recurring-sheet-actions">
    <button class="primary" type="submit" :disabled="busy||!validatedPlan">設定を保存</button>
    <button type="button" @click="closePlanEditor">キャンセル</button>
   </div>
  </form>
 </RecurringFormSheet>
 <RecurringFormSheet :open="active && billEditor && !!chosenPlan" :busy="busy"
    :title="chosenPlan?.name ? chosenPlan.name+' · 請求を確認' : '請求を確認'"
    subtitle="記帳日以降の19:30に自動記帳" @close="billEditor=false">
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <form v-if="billEditor&&chosenPlan" ref="billEditorElement" class="editor recurring-editor-fields" @submit.prevent="saveBill">
   <h3 class="recurring-form-section-title">請求情報</h3>
   <label>対象月（サービス所属月） <input v-model="invoice.periodMonth" type="month" required/></label>
   <p v-if="!periodIsOnCycle(chosenPlan,invoice.periodMonth)" class="error">
    対象月は開始月から{{chosenPlan.intervalMonths}}か月周期で選択してください。</p>
   <div class="recurring-form-field recurring-form-amount"><span>実際の請求額</span>
    <AmountInput v-model="invoiceAmount" :required="false" input-label="実際の請求額（円）"/></div>
   <h3 class="recurring-form-section-title">記帳・引落日</h3>
   <label>記帳日（カード立替日など・変更可能） <input v-model="invoice.expenseDate" type="date"/></label>
   <label>実際の引落日（任意） <input v-model="invoice.paidDate" type="date"/></label>
   <h3 class="recurring-form-section-title">利用期間</h3>
   <div class="recurring-date-pair"><label>利用期間開始 <input v-model="invoice.serviceStart" type="date"/></label>
    <label>利用期間終了 <input v-model="invoice.serviceEnd" type="date"/></label></div>
   <p v-if="chosenSaved?.status==='posted'" class="hint">記帳済み（明細 #{{chosenSaved.postedEntryId}}）</p>
   <p v-else-if="chosenSaved?.status==='draft' && Number(chosenSaved.amountJpy)>0 && chosenSaved.expenseDate" class="hint">
    {{chosenSaved.expenseDate}}以降の19:30に自動記帳。先に手動記帳もできます。</p>
   <p v-else-if="chosenSaved?.sourceType==='document'" class="hint">文書助手の下書き。金額・記帳日を確認してください。</p>
   <p v-else class="hint">金額と記帳日が揃うと自動記帳の対象になります。</p>
   <div v-if="chosenSaved?.status!=='posted'" class="actions recurring-sheet-actions recurring-bill-actions">
    <button class="primary" type="submit" :disabled="busy||!canSaveBill">下書きを保存</button>
    <button class="primary" v-if="chosenSaved?.status==='draft'" type="button" :disabled="busy||!canConfirm" @click="confirmBill">確認して記帳</button>
   </div>
  </form>

 </RecurringFormSheet>
</section>
</template>
<style scoped>
.variable-costs{display:grid;gap:12px;min-width:0;background:transparent;border:0;padding:0}
.body,.plans,.plan-detail{display:grid;gap:9px;min-width:0}
.body{gap:12px}
.variable-register-card{display:grid;gap:10px;min-width:0;padding:13px;border:1px solid var(--line);border-radius:16px;background:var(--card)}
.variable-list-heading{display:flex;justify-content:space-between;gap:8px;align-items:center}
.variable-list-heading h3{margin:0;font-size:16px;font-weight:800}
.variable-list-heading span{color:var(--muted);font-size:12px}
.open-manager{display:grid;text-align:left;gap:4px;border:0;padding:4px;background:transparent;color:var(--ink)}
.open-manager strong{font-size:16px}
.open-manager span,.hint,.plan small{font-size:12px;color:var(--muted);line-height:1.5}
.variable-empty{margin:0;padding:18px 12px;text-align:center;border-radius:12px;background:var(--tint);color:var(--muted);font-size:13px;line-height:1.55}
.plan{border:1px solid var(--line);border-radius:12px;min-width:0;background:var(--card);overflow:hidden}
.plan-summary{display:grid;gap:5px;padding:12px 32px 12px 12px;cursor:pointer;list-style:none;position:relative}
.plan-summary::-webkit-details-marker{display:none}
.plan-summary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:-3px}
.plan-title{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.plan-title strong{font-size:14px;overflow-wrap:anywhere;min-width:0;color:var(--ink)}
.plan-state{font-size:11px;flex:none;border-radius:99px;background:var(--tint);color:var(--muted);padding:3px 8px}
.plan-state.is-due{color:var(--blue-dark);font-weight:750}
.plan-meta{color:var(--muted)}
.plan-month{font-size:12px;color:var(--ink);font-weight:650}
.plan-summary::after{content:'⌄';color:var(--muted);font-size:12px;position:absolute;right:12px;top:50%;transform:translateY(-50%)}
.plan[open] .plan-summary::after{content:'⌃'}
.plan-detail{padding:10px 12px;border-top:1px solid var(--line)}
.plan-detail .actions{display:flex;gap:7px;flex-wrap:wrap}
.plan-detail .actions button{min-height:44px;border:1px solid var(--line);border-radius:10px;background:var(--tint);color:var(--blue-dark);font-size:12px;font-weight:700;padding:8px 12px}
.plan-detail .actions button:disabled{opacity:.45}
.editor{display:grid;gap:13px;min-width:0}
.editor label{display:grid;gap:5px;min-width:0}
.editor input,.editor select{max-width:100%;min-width:0;box-sizing:border-box}
.editor .recurring-date-pair{display:grid;grid-template-columns:minmax(0,1fr);gap:13px;min-width:0}
.editor .hint{margin:0;font-size:12px;line-height:1.6}
.error{margin:0;color:var(--danger,#b43c4a);font-size:12px}
</style>