<script setup>
import {computed,onMounted,watch,ref} from 'vue'
import FixedCostEditorFields from './FixedCostEditorFields.vue'
import OriginalFixedCostList from './OriginalFixedCostList.vue'
import {recurringDatesForPlanInMonth} from './recurring-posting.js'
const props=defineProps({
 userId:{type:String,required:true},paymentChoices:{type:Array,default:()=>[]},
 categories:{type:Array,default:()=>[]},
 onSubmitEntry:{type:Function,required:true}
})
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const currentMonth=()=>today().slice(0,7)
const blank=()=>({name:'',amount:'',scheduleType:'monthly',intervalMonths:1,
 monthDays:[1],weekdays:[1],category:'食費',paymentSource:'cash',startMonth:currentMonth(),
 postingMode:'manual'})
const plan=ref(blank()),items=ref([]),loaded=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const editingId=ref(''),editingVersion=ref(0),showAll=ref(false),retryKey=ref('')
const cycleOptions=[
 {value:'monthly-1',label:'毎月'},{value:'weekly',label:'毎週'},
 {value:'workday',label:'平日（土日祝を除く）'},
 {value:'monthly-2',label:'2か月ごと'},{value:'monthly-3',label:'3か月ごと'},
 {value:'monthly-6',label:'6か月ごと'},{value:'monthly-12',label:'毎年'}
]
const cycleChoice=computed({
 get(){return plan.value.scheduleType==='weekly'?'weekly':
  plan.value.scheduleType==='workday'?'workday':'monthly-'+(plan.value.intervalMonths||1)},
 set(value){
  if(value==='weekly'||value==='workday'){
   plan.value.scheduleType=value;plan.value.intervalMonths=1
  }else if(/^monthly-(1|2|3|6|12)$/.test(value)){
   plan.value.scheduleType='monthly';plan.value.intervalMonths=Number(value.slice(8))
  }
 }
})
const paymentOptions=computed(()=>[
 ...props.paymentChoices,
 ...(plan.value.paymentSource&&!props.paymentChoices.some(x=>x.value===plan.value.paymentSource)
 ?[{value:plan.value.paymentSource,label:'保存済み：'+plan.value.paymentSource}]:[])
])
const valid=computed(()=>plan.value.name.trim()&&
 Number.isSafeInteger(Number(plan.value.amount))&&Number(plan.value.amount)>=1&&
 Number(plan.value.amount)<=10000000&&plan.value.category&&plan.value.paymentSource&&
 /^20\d\d-(0[1-9]|1[0-2])$/.test(plan.value.startMonth))
const count=computed(()=>items.value.length)
const visible=computed(()=>showAll.value?items.value:items.value.slice(0,5))
const money=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
const post=x=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(x)})
async function api(path,options={}){
 const response=await fetch('/api/family-finance/member-fixed-costs'+path,{
  credentials:'same-origin',cache:'no-store',...options
 })
 const body=await response.json().catch(()=>({}))
 if(!response.ok||body.ok!==true)throw Error(body.code||'固定費の設定を保存できませんでした')
 return body
}
async function load(){
 const actor=props.userId
 busy.value=true;error.value=''
 try{
  const data=await api('')
  if(actor!==props.userId)return
  items.value=Array.isArray(data.items)?data.items.filter(x=>x.owner_user_id===actor):[]
  loaded.value=true
 }catch(e){if(actor===props.userId){error.value=e.message;loaded.value=false}}
 finally{if(actor===props.userId)busy.value=false}
}
function clear(){plan.value=blank();editingId.value='';editingVersion.value=0;retryKey.value=''}
function edit(item){
 editingId.value=item.plan_id;editingVersion.value=item.version;retryKey.value=''
 plan.value={name:item.name,amount:item.amount,scheduleType:item.scheduleType,
  intervalMonths:item.intervalMonths,monthDays:[...item.monthDays],
  weekdays:[...item.weekdays],category:item.category,
  paymentSource:item.paymentSource,startMonth:item.startMonth,postingMode:'manual'}
}
const payload=()=>({
 expected_user_id:props.userId,
 name:plan.value.name.trim(),amount_jpy:Number(plan.value.amount),
 schedule_type:plan.value.scheduleType,interval_months:plan.value.intervalMonths,
 month_days:[...plan.value.monthDays],weekdays:[...plan.value.weekdays],
 category:plan.value.category.trim(),payment_source:plan.value.paymentSource,
 start_month:plan.value.startMonth,posting_mode:'manual'
})
async function save(){
 if(!valid.value||busy.value)return
 const actor=props.userId,editing=editingId.value
 const body=payload()
 busy.value=true;error.value='';notice.value=''
 try{
  if(editing){
   await api('/'+editing,{method:'PATCH',headers:{'content-type':'application/json'},
    body:JSON.stringify({...body,version:editingVersion.value})})
  }else{
   retryKey.value||='member-fixed:'+crypto.randomUUID()
   await api('',post({...body,idempotency_key:retryKey.value}))
  }
  if(actor!==props.userId)return
  clear();notice.value='本人の固定費設定を保存しました。家庭帳簿にはまだ入帳していません。'
  await load()
 }catch(e){if(actor===props.userId)error.value=e.message}
 finally{if(actor===props.userId)busy.value=false}
}
async function toggle(item){
 if(busy.value)return
 busy.value=true;error.value=''
 try{
  await api('/'+item.plan_id+'/toggle',post({
   expected_user_id:props.userId,version:item.version,enabled:!item.enabled}))
  notice.value=item.enabled?'固定費を停止しました':'固定費を再開しました'
  await load()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function removePersonalPlan(item){
 if(busy.value||!item?.plan_id)return
 if(!confirm(item.name+' の固定費設定を削除しますか？既に承認済みの家庭明細は削除されません。'))return
 busy.value=true;error.value='';notice.value=''
 try{
  await api('/'+item.plan_id,{method:'DELETE',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({expected_user_id:props.userId,version:item.version})})
  if(editingId.value===item.plan_id)clear()
  notice.value='本人の固定費設定を削除しました。家庭帳簿の記録は変更していません。'
  await load()
 }catch(e){error.value='削除できませんでした：'+e.message}
 finally{busy.value=false}
}
async function submitDue(item){
 if(!item.enabled||busy.value)return
 if(!confirm(item.name+' '+money(item.amount)+'を記帳しますか？家庭帳簿への記録は HomeFlow で審査が必要です。'))return
 busy.value=true;error.value='';notice.value=''
 try{
  const receipt=await props.onSubmitEntry(item)
  if(!receipt?.proposalId&&!receipt?.type)throw Error('記帳の受付を確認できません')
  notice.value=receipt.proposalId?'HomeFlow へ記帳申請を送りました。承認まで未入帳です。':
   '利用記録を受け付けました。'
 }catch(e){error.value='記帳できませんでした：'+String(e.message||e)}
 finally{busy.value=false}
}
watch(()=>props.userId,()=>{clear();items.value=[];void load()})
onMounted(load)
</script>
<template>
 <div class="member-fixed-costs">
  <article class="finance-panel recurring-manager-panel">
   <h2>固定費の設定</h2>
   <FixedCostEditorFields :model="plan" v-model:cycleChoice="cycleChoice"
    :cycle-options="cycleOptions" :categories="categories" :payment-choices="paymentOptions"
    :member="true"/>
   <div class="finance-actions recurring-save-actions">
    <button type="button" :disabled="busy||!valid" @click="save">
     {{busy?'保存中…':editingId?'変更を保存':'固定費を登録'}}</button>
    <button v-if="editingId" type="button" :disabled="busy" @click="clear">編集をやめる</button>
   </div>
   <p v-if="error" class="fixed-cost-error" role="alert">{{error}}</p>
   <p v-if="notice" class="fixed-cost-notice" role="status">{{notice}}</p>
  </article>
  <OriginalFixedCostList :items="items.map(item=>({...item,id:item.plan_id}))"
    :busy="busy" :yen="money" :category-label="x=>x"
    :payment-label="source=>paymentChoices.find(p=>p.value===source)?.label||source"
    :allow-delete="true" :allow-post="true"
    @edit="edit" @toggle="toggle" @remove="removePersonalPlan" @post="submitDue"/>
 </div>
</template>
<style scoped>
.member-fixed-costs{display:grid;gap:12px;min-width:0}
.finance-panel{display:grid;gap:12px;min-width:0;padding:14px;background:var(--card);border:1px solid var(--line);border-radius:16px}
.finance-panel h2{margin:0;font-size:17px}
.finance-actions{display:flex;gap:8px;flex-wrap:wrap}
.finance-actions button{flex:1;min-height:44px;border:1px solid var(--line);border-radius:11px;background:var(--tint);color:var(--blue-dark);font-weight:750}
.finance-actions button:disabled{opacity:.5}
.fixed-cost-error{color:#b43c4a;font-size:12px}
.fixed-cost-notice,.help{font-size:12px;color:var(--muted)}
.fixed-cost-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px;padding:10px 0;border-top:1px solid var(--line)}
.fixed-cost-row-main{display:grid;gap:4px;min-width:0}
.fixed-cost-row-main strong{overflow-wrap:anywhere;font-size:13px}
.fixed-cost-row-main small{color:var(--muted);font-size:11px}
.fixed-cost-row>strong{font-size:14px}
.fixed-cost-row-actions{grid-column:1/-1;display:flex;gap:7px;flex-wrap:wrap}
.fixed-cost-row-actions button,.fixed-more{min-height:40px;background:var(--card);border:1px solid var(--line);border-radius:10px;color:var(--blue-dark);font-size:12px;padding:8px}
.fixed-more{width:100%}
</style>
