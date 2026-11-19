<script setup>
import {computed,onMounted,ref,watch} from 'vue'
const props=defineProps({
 api:{type:Function,required:true},
 categories:{type:Array,default:()=>[]},
 paymentSources:{type:Array,default:()=>[]},
 categoryLabel:{type:Function,default:x=>x}
})
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const thisMonth=()=>today().slice(0,7)
const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
const ready=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const plans=ref([]),bills=ref([])
const expanded=ref(false),planEditor=ref(false),billEditor=ref(false)
const editing=ref(false),selectedPlan=ref(null)
const emptyPlan=()=>({id:crypto.randomUUID(),name:'',category:'',paymentSource:'',
 startMonth:thisMonth(),intervalMonths:1,budgetJpy:'',enabled:true})
const form=ref(emptyPlan())
const emptyBill=(periodMonth=thisMonth())=>({periodMonth,amountJpy:'',
 billDate:'',expenseDate:'',paidDate:'',serviceStart:'',serviceEnd:''})
const invoice=ref(emptyBill())
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
  (Number.isSafeInteger(Number(invoice.value.amountJpy))&&Number(invoice.value.amountJpy)>0))&&
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
const billFor=p=>bills.value.find(b=>b.planId===p.id&&b.periodMonth===latestPeriod(p))
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
}
function editPlan(p){
 editing.value=true;form.value={...p,budgetJpy:p.budgetJpy??''}
 planEditor.value=true;billEditor.value=false
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
 const periodMonth=latestPeriod(p)
 const existing=bills.value.find(x=>x.planId===p.id&&x.periodMonth===periodMonth)
 invoice.value=existing?{...existing,
  amountJpy:existing.amountJpy??'',billDate:existing.billDate||'',
  expenseDate:existing.expenseDate||'',paidDate:existing.paidDate||'',
  serviceStart:existing.serviceStart||'',serviceEnd:existing.serviceEnd||''}:
  emptyBill(periodMonth)
 billEditor.value=true;planEditor.value=false;expanded.value=true
}
watch(()=>invoice.value.periodMonth,month=>{
 if(!selectedPlan.value)return
 const x=bills.value.find(b=>b.planId===selectedPlan.value.id&&b.periodMonth===month)
 const selected=invoice.value
 invoice.value=x?{...x,amountJpy:x.amountJpy??'',billDate:x.billDate||'',
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
   billDate:x.billDate||null,expenseDate:x.expenseDate||null,
   paidDate:x.paidDate||null,serviceStart:x.serviceStart||null,serviceEnd:x.serviceEnd||null}
  const res=await api('/'+chosenPlan.value.id+'/bill',{method:'POST',body:JSON.stringify(payload)})
  if(!res.ok)throw Error('請求書の保存結果を確認できません')
  notice.value='この回の請求額を下書きとして保存しました（支出には未計上）'
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
 }catch(e){error.value=String(e.message||e)}
 finally{busy.value=false}
}
onMounted(refresh)
</script>
<template>
<section class="variable-costs">
 <button class="open-manager" type="button" :aria-expanded="expanded"
  @click="expanded=!expanded">
  <strong>変動する定期費用</strong><span>電気・ガス・水道・通信など（請求ごとに確認） {{expanded?'⌃':'⌄'}}</span>
 </button>
 <div v-if="expanded" class="body">
  <p class="hint">金額・請求日・利用日・口座引落日を別々に管理します。予算は実際の支出に計上しません。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="hint">{{notice}}</p>
  <div class="actions"><button type="button" :disabled="busy" @click="newPlan">＋ 定期費用を登録</button>
   <button type="button" :disabled="busy" @click="refresh">再読込</button></div>
  <form v-if="planEditor" class="editor" @submit.prevent="savePlan">
   <h4>{{editing?'定期費用を編集':'変動する定期費用を追加'}}</h4>
   <label>名称 <input v-model="form.name" maxlength="120" placeholder="例：オクトパスエナジー" required/></label>
   <label>カテゴリ <select v-model="form.category" required>
    <option value="">選択してください</option>
    <option v-for="category in categories" :key="category" :value="category">{{categoryLabel(category)}}</option>
   </select></label>
   <label>支払方法 <select v-model="form.paymentSource" required>
    <option value="">選択してください</option>
    <option v-for="source in paymentSources" :key="source" :value="source">{{source}}</option>
   </select></label>
   <label>請求周期 <select v-model.number="form.intervalMonths">
    <option v-for="cycle in cycleOptions" :key="cycle.value" :value="cycle.value">{{cycle.label}}</option>
   </select></label>
   <label>開始月 <input v-model="form.startMonth" type="month" required/></label>
   <label>参考予算（任意・実績に含めない） <input v-model="form.budgetJpy" type="number" min="1" max="10000000" placeholder="未設定"/></label>
   <div class="actions"><button type="submit" :disabled="busy||!validatedPlan">設定を保存</button>
    <button type="button" @click="planEditor=false">キャンセル</button></div>
  </form>
  <p v-if="ready&&!plans.length" class="hint">変動費はまだ登録されていません。</p>
  <div v-if="ready" class="plans">
   <article v-for="p in plans" :key="p.id" class="plan">
    <div class="plan-title"><strong>{{p.name}}</strong><span>{{p.enabled?'有効':'停止中'}}</span></div>
    <small>{{p.intervalMonths===1?'毎月':p.intervalMonths+'か月ごと'}} · {{p.paymentSource}} · 参考予算 {{p.budgetJpy?yen(p.budgetJpy):'なし'}}</small>
    <small v-if="billFor(p)?.status==='posted'">最新回 {{latestPeriod(p)}} · 記帳済み {{yen(billFor(p).amountJpy)}}</small>
    <small v-else-if="billFor(p)?.amountJpy">最新回 {{latestPeriod(p)}} · 確認待ち {{yen(billFor(p).amountJpy)}}</small>
    <small v-else>最新回 {{latestPeriod(p)}} · 請求待ち（金額未確定）</small>
    <div class="actions">
     <button type="button" :disabled="busy" @click="openBill(p)">請求を確認</button>
     <button type="button" :disabled="busy" @click="editPlan(p)">編集</button>
     <button type="button" :disabled="busy" @click="togglePlan(p)">{{p.enabled?'停止':'再開'}}</button>
    </div>
   </article>
  </div>
  <form v-if="billEditor&&chosenPlan" class="editor" @submit.prevent="saveBill">
   <h4>{{chosenPlan.name}} · 請求を確認</h4>
   <label>対象月（サービス所属月） <input v-model="invoice.periodMonth" type="month" required/></label>
   <p v-if="!periodIsOnCycle(chosenPlan,invoice.periodMonth)" class="error">
    対象月は開始月から{{chosenPlan.intervalMonths}}か月周期で選択してください。</p>
   <label>実際の請求額 <input v-model="invoice.amountJpy" type="number" min="1" max="10000000" placeholder="請求書が届いてから入力"/></label>
   <label>請求書発行日 <input v-model="invoice.billDate" type="date"/></label>
   <label>記帳日（実際の利用・決済日） <input v-model="invoice.expenseDate" type="date"/></label>
   <label>実際の引落日（任意） <input v-model="invoice.paidDate" type="date"/></label>
   <div class="pair"><label>利用期間開始 <input v-model="invoice.serviceStart" type="date"/></label>
    <label>利用期間終了 <input v-model="invoice.serviceEnd" type="date"/></label></div>
   <p class="hint">保存しただけでは支出になりません。文書助手ですでに記帳された同じ請求は、もう一度登録しないでください。</p>
   <p v-if="chosenSaved?.status==='posted'" class="hint">記帳済み：明細 #{{chosenSaved.postedEntryId}}。同じ回は二重記帳できません。</p>
   <p v-else-if="chosenSaved?.sourceType==='document'" class="hint">文書助手由来の下書きです。元資料を確認してください。</p>
   <div class="actions">
    <button v-if="chosenSaved?.status!=='posted'&&chosenSaved?.sourceType!=='document'" type="submit" :disabled="busy||!canSaveBill">下書きを保存</button>
    <button v-if="chosenSaved?.status==='draft'" type="button" :disabled="busy||!canConfirm" @click="confirmBill">確認して記帳</button>
    <button type="button" @click="billEditor=false">閉じる</button>
   </div>
  </form>
 </div>
</section>
</template>
<style scoped>
.variable-costs{display:grid;gap:8px;border:1px solid var(--line);border-radius:15px;background:var(--card);padding:12px;min-width:0}
.open-manager{display:grid;text-align:left;gap:4px;border:0;padding:4px;background:transparent;color:var(--ink)}
.open-manager strong{font-size:16px}.open-manager span,.hint,.plan small{font-size:12px;color:var(--muted);line-height:1.5}
.body,.plans,.editor{display:grid;gap:10px;min-width:0}
.editor,.plan{padding:12px;border:1px solid var(--line);border-radius:12px;min-width:0;display:grid;gap:9px;background:var(--card)}
.editor h4{margin:0;font-size:14px}.editor label{display:grid;gap:5px;font-size:12px;color:var(--muted);font-weight:700;min-width:0}
.editor input,.editor select{width:100%;box-sizing:border-box;min-height:44px;padding:8px 10px;font-size:16px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:10px;min-width:0}
.actions,.pair{display:flex;gap:7px;flex-wrap:wrap}
.actions button{min-height:42px;border:1px solid var(--line);background:var(--tint);border-radius:10px;color:var(--blue-dark);font-weight:700;padding:8px 12px}
.actions button:disabled{opacity:.45}.pair>*{min-width:0;flex:1}
.plan-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
.plan-title span{font-size:11px;color:var(--muted)}
.error{color:#b43c4a;font-size:12px}
@media(max-width:390px){.pair{display:grid;grid-template-columns:1fr}}
</style>
