<script setup>
import {computed,onMounted,watch,ref} from 'vue'
const props=defineProps({
 userId:{type:String,required:true},paymentChoices:{type:Array,default:()=>[]},
 categories:{type:Array,default:()=>[]},
 categoryLabel:{type:Function,default:x=>x},
 defaultCategory:{type:String,default:''},
 onSubmitEntry:{type:Function,required:true}
})
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const currentMonth=()=>today().slice(0,7)
const blank=()=>({name:'',amount:'',scheduleType:'monthly',intervalMonths:1,
 monthDays:[1],weekdays:[1],category:props.defaultCategory,paymentSource:'cash',startMonth:currentMonth(),
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
watch(()=>props.defaultCategory,category=>{
 if(!editingId.value&&!plan.value.category&&category)plan.value.category=category
})
watch(()=>props.userId,()=>{clear();items.value=[];void load()})
onMounted(load)
// Controller only: the single FinanceTools/UnifiedFixedCostManagement component
// owns the visible form and list for both the owner and every family member.
const managementConfig=computed(()=>({
 memberMode:true,
 model:plan.value,cycleChoice:cycleChoice.value,cycleOptions,
 categories:props.categories,categoryLabel:props.categoryLabel,
 paymentChoices:paymentOptions.value,
 items:items.value.map(item=>({...item,id:item.plan_id})),
 busy:busy.value,canSave:!busy.value&&!!valid.value,
 editingId:editingId.value,
 error:error.value,notice:notice.value,
 yen:money,paymentLabel:source=>props.paymentChoices.find(p=>p.value===source)?.label||source,
 nextLabel:()=>'',currentCount:null,monthlyTotal:null,allowPost:true,
 onCycleChange:value=>{cycleChoice.value=value},
 onSave:save,onCancel:clear,onEdit:edit,onToggle:toggle,
 onRemove:removePersonalPlan,onPost:submitDue
}))
defineExpose({managementConfig,load})
</script>
<template><span v-if="false" aria-hidden="true"></span></template>
