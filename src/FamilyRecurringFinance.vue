<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true},accounts:{type:Array,required:true},view:{type:String,default:'plans'}})
const emit=defineEmits(['changed'])
const open=ref(true),busy=ref(false),available=ref(false),error=ref(''),notice=ref('')
const plans=ref([]),occurrences=ref([]),policies=ref({})
const day=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const month=()=>day().slice(0,7)
const activeType=computed(()=>props.view==='investment'?'sbi_tsumitate':'fixed_cost')
const visiblePlans=computed(()=>plans.value.filter(p=>p.plan_type===activeType.value))
const visibleOccurrences=computed(()=>occurrences.value.filter(p=>p.plan_type===activeType.value))
const form=ref({plan_type:props.view==='investment'?'sbi_tsumitate':'fixed_cost',source_bank_account_id:'',
 securities_account_id:'',amount_jpy:'',due_day:Math.min(28,Number(day().slice(8))),
 start_month:month(),end_month:month(),category:'固定費',merchant:'',
 fund_code:'',fund_name:''})
const selected=ref(''),debit=ref(day()),period=ref(month()),bankRef=ref(''),
 units=ref(''),brokerRef=ref(''),trade=ref(day()),effective=ref(day()),
 bankPosted=ref(false),brokerExecuted=ref(false)
let generation=0,alive=true,planRetry=''
const banks=computed(()=>props.accounts.filter(a=>
 a.owner_user_id===props.userId&&a.origin==='member_created'&&
 a.account_kind==='bank'&&Number(a.is_archived)===0))
const securities=computed(()=>props.accounts.filter(a=>
 a.owner_user_id===props.userId&&a.origin==='member_created'&&
 a.account_kind==='securities'&&Number(a.is_archived)===0))
const chosen=computed(()=>plans.value.find(p=>p.plan_resource_id===selected.value))
const currency=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0))
const currentPolicy=p=>policies.value[p.plan_resource_id]
const canPlan=computed(()=>banks.value.some(a=>a.account_id===form.value.source_bank_account_id)&&
  (form.value.plan_type==='fixed_cost'||securities.value.some(a=>a.account_id===form.value.securities_account_id))&&
  form.value.amount_jpy&&Number.isSafeInteger(Number(form.value.amount_jpy))&&
  Number(form.value.amount_jpy)>=1&&Number(form.value.amount_jpy)<=10000000&&
  form.value.due_day>=1&&form.value.due_day<=28&&form.value.merchant.trim()&&
  form.value.category.trim()&&form.value.start_month<=form.value.end_month&&
  (form.value.plan_type==='fixed_cost'||(/^[A-Z0-9]{8}$/.test(form.value.fund_code)&&form.value.fund_name.trim())))
const online=()=>typeof navigator!=='undefined'&&navigator.onLine!==false
const post=data=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
async function api(path,options={}){
 if(!online())throw Error('当前离线，金融操作暂不可提交；不会进入离线重放队列')
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true)throw Error(data.code||'金融授权请求未确认，请使用原申请 ID 复核')
 return data
}
function reset(){
 generation++;open.value=true;busy.value=false;available.value=false;
 error.value='';notice.value='';plans.value=[];occurrences.value=[];policies.value={};
 selected.value='';bankRef.value='';brokerRef.value='';units.value='';planRetry='';
 bankPosted.value=false;brokerExecuted.value=false
 form.value={plan_type:props.view==='investment'?'sbi_tsumitate':'fixed_cost',source_bank_account_id:'',securities_account_id:'',
  amount_jpy:'',due_day:Math.min(28,Number(day().slice(8))),start_month:month(),
  end_month:month(),category:'固定費',merchant:'',fund_code:'',fund_name:''}
}
async function refresh(){
 const ticket=++generation,who=props.userId,hh=props.householdId
 if(!open.value)return
 try{
  const [p,o]=await Promise.all([
   api('/api/family-finance/member-recurring-plans'),
   api('/api/family-finance/recurring-occurrences')
  ])
  if(!alive||!open.value||ticket!==generation||who!==props.userId||hh!==props.householdId)return
  plans.value=Array.isArray(p.items)?p.items:[]
  occurrences.value=Array.isArray(o.items)?o.items:[]
  available.value=true;error.value=''
 }catch(e){
  if(ticket===generation){plans.value=[];occurrences.value=[];available.value=false;
   error.value=/DISABLED/.test(e.message)?'周期金融授权功能暂未开放；既有账本与旧定投不受影响':e.message}
 }
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value
 if(open.value)await refresh()
 else{generation++;plans.value=[];occurrences.value=[];policies.value={};selected.value=''}
}
function accountVersion(id){
 return props.accounts.find(a=>a.account_id===id&&a.owner_user_id===props.userId)?.version
}
async function createPlan(){
 if(!canPlan.value||busy.value||!available.value)return
 if(!window.confirm('创建本人的固定费／SBI 定投计划？新计划不会自动扣款，正式记账仍需管理员授权和逐期已到账证据。'))return
 const ticket=generation,actor=props.userId,hh=props.householdId
 const x=form.value
 const payload={expected_user_id:actor,
  idempotency_key:planRetry||'member-recurring:'+crypto.randomUUID(),
  plan_type:x.plan_type,source_bank_account_id:x.source_bank_account_id,
  source_account_version:accountVersion(x.source_bank_account_id),
  securities_account_id:x.plan_type==='fixed_cost'?null:x.securities_account_id,
  securities_version:x.plan_type==='fixed_cost'?null:accountVersion(x.securities_account_id),
  amount_jpy:Number(x.amount_jpy),due_day:Number(x.due_day),
  start_month:x.start_month,end_month:x.end_month,category:x.category.trim(),
  merchant:x.merchant.trim(),fund_code:x.plan_type==='fixed_cost'?null:x.fund_code.trim(),
  fund_name:x.plan_type==='fixed_cost'?null:x.fund_name.trim(),
  account_type:x.plan_type==='fixed_cost'?null:'tsumitate'}
 planRetry=payload.idempotency_key;busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/member-recurring-plans',post(payload))
  if(ticket!==generation||actor!==props.userId||hh!==props.householdId)return
  if(result.plan?.ledger_applied!==false||result.plan?.policy_approved!==false)
   throw Error('计划创建回执不完整，不能视为已执行')
  planRetry='';notice.value='计划已冻结保存，请点击「提交家庭授权」由 HomeFlow 管理员审批。'
  selected.value=result.plan.plan_resource_id
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function submitPolicy(p){
 if(busy.value||!available.value||p.state!=='active')return
 const ticket=generation,actor=props.userId
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/member-recurring-plans/'+
   p.plan_resource_id+'/submit-policy',post({
    expected_user_id:actor,confirm_plan_resource_id:p.plan_resource_id}))
  if(ticket!==generation||actor!==props.userId)return
  if(result.ledger_applied!==false||result.policy?.plan_resource_id!==p.plan_resource_id)
   throw Error('HomeFlow 月度审批回执不完整')
  policies.value={...policies.value,[p.plan_resource_id]:result.policy}
  notice.value=result.owner_approved?
   '管理员已授权该计划；实际资金流水需逐个月独立确认。':
   '原 HomeFlow 授权申请已送达，等待管理员批准，尚无任何正式记账。'
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function prepareOccurrence(){
 const p=chosen.value,policy=p&&currentPolicy(p)
 if(busy.value||!available.value||!p||policy?.status!=='approved'||
  !bankPosted.value||!bankRef.value.trim()||bankRef.value.trim().length<8||
  p.plan_type==='sbi_tsumitate'&&(!brokerExecuted.value||brokerRef.value.trim().length<8||
   !Number.isSafeInteger(Number(units.value))||Number(units.value)<=0))return
 if(!window.confirm('银行实际扣款和证券实际成交已由你核对？将保存已发生事项的证据，不发起真实扣款或买单。'))return
 const ticket=generation,actor=props.userId
 const isSbi=p.plan_type==='sbi_tsumitate'
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/recurring-occurrences',post({
   expected_user_id:actor,policy_id:policy.policy_id,
   plan_resource_id:p.plan_resource_id,period_key:period.value,debit_date:debit.value,
   bank_reference:bankRef.value.trim(),bank_debit_posted:true,
   confirmed_units:isSbi?Number(units.value):null,
   broker_trade_reference:isSbi?brokerRef.value.trim():null,
   trade_date:isSbi?trade.value:null,effective_date:isSbi?effective.value:null,
   broker_order_executed:isSbi}))
  if(ticket!==generation||actor!==props.userId)return
  if(result.prepared?.ledger_applied!==false)throw Error('周期证据准备回执异常')
  bankRef.value='';brokerRef.value='';units.value=''
  bankPosted.value=false;brokerExecuted.value=false
  notice.value='已保存本月唯一凭证，尚未修改正式账本；下方可依管理员授权单独核对执行。'
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function perform(o,action='execute'){
 if(busy.value||!available.value||!window.confirm(
  action==='execute'?'确认按本月已发生、已核验的银行／证券证据执行一次内部记账？不会向机构发送支付命令。':
  '仅按原凭证核对 HomeFlow 与家計簿的不可变回执，不再执行新的扣款。'))return
 const ticket=generation,actor=props.userId,hh=props.householdId
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/recurring-occurrences/'+o.occurrence_id+'/'+action,
   post(action==='execute'?{expected_user_id:actor,confirm_occurrence_id:o.occurrence_id}:
    {expected_user_id:actor}))
  if(ticket!==generation||actor!==props.userId||hh!==props.householdId)return
  if(result.ledger_applied!==true||result.applied!==true)
   throw Error('账目仍未取得真实不可变入账回执')
  if(result.homeflow_receipt_confirmed!==true){
   notice.value='家計簿已记账，但 HomeFlow 回执仍待复核。只能按原 ID 核对，不能再创建第二笔。'
  }else{
   notice.value='家計簿和 HomeFlow 已按同一凭证确认内部记账；银行/SBI 机构级核验尚未完成。'
   emit('changed')
  }
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
function foreground(){
 if(document.visibilityState!=='visible')return
 generation++;policies.value={};bankRef.value='';brokerRef.value='';
 units.value='';bankPosted.value=false;brokerExecuted.value=false
 if(open.value)void refresh()
}
watch(()=>[props.userId,props.householdId,props.view],()=>{reset();void refresh()})
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
<section class="recurring-panel finance-panel" :aria-label="view==='investment'?'毎月の積立':'固定費の設定'">
 <header><strong>{{view==='investment'?'毎月の積立':'固定費の設定'}}</strong>
  <button type="button" :aria-expanded="open" :disabled="busy" @click="toggle">{{open?'收起':'设置'}}</button></header>
 <template v-if="open">
  <p class="help">本功能仅对本人新计划使用。HomeFlow 管理员批准的是计划期限与额度，银行扣款及 SBI 成交不会由本 App 发起；必须核对真实已发生记录后逐月记账。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="help">{{notice}}</p>
  <form v-if="available" class="editor" @submit.prevent="createPlan">
   <strong>{{view==='investment'?'積立設定':'固定費の設定'}}</strong>
   <p class="help">{{view==='investment'?'本人の証券口座で行うSBI積立':'本人の銀行口座からの固定費'}} · HomeFlow で計画を一度承認します</p>
   <label>本人扣款银行<select v-model="form.source_bank_account_id" :disabled="busy" required><option value="">选择账户</option>
    <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}} · v{{a.version}}</option>
   </select></label>
   <label v-if="form.plan_type==='sbi_tsumitate'">本人证券账户<select v-model="form.securities_account_id" :disabled="busy" required><option value="">选择证券账户</option>
    <option v-for="a in securities" :key="a.account_id" :value="a.account_id">{{a.label}} · v{{a.version}}</option>
   </select></label>
   <div class="pair">
    <label>月额（円）<input v-model="form.amount_jpy" type="number" min="1" max="10000000" required :disabled="busy"/></label>
    <label>每月扣款日（1～28）<input v-model.number="form.due_day" type="number" min="1" max="28" required :disabled="busy"/></label>
   </div>
   <div class="pair">
    <label>起始月<input v-model="form.start_month" type="month" required :disabled="busy"/></label>
    <label>终止月<input v-model="form.end_month" type="month" required :disabled="busy"/></label>
   </div>
   <label>分类<input v-model="form.category" maxlength="100" required :disabled="busy"/></label>
   <label>商家／项目<input v-model="form.merchant" maxlength="120" required :disabled="busy"/></label>
   <template v-if="form.plan_type==='sbi_tsumitate'">
    <label>基金代码（8位）<input v-model="form.fund_code" maxlength="8" required :disabled="busy"/></label>
    <label>基金名称<input v-model="form.fund_name" maxlength="120" required :disabled="busy"/></label>
   </template>
   <button type="submit" :disabled="busy||!canPlan">保存计划（不记账）</button>
  </form>
  <div v-if="available" class="items">
   <strong>{{view==='investment'?'登録済みの積立':'登録済みの固定費'}} · {{visiblePlans.length}}件</strong>
   <div v-for="p in visiblePlans" :key="p.plan_resource_id" class="item">
    <div class="head"><strong>{{p.merchant}} · {{currency(p.amount_jpy)}}</strong><span>{{p.state}}</span></div>
    <p class="help">{{p.plan_type==='fixed_cost'?'固定费':'SBI 定投'}} · {{p.start_month}}～{{p.end_month}} · 每月{{p.due_day}}日</p>
    <p class="help">管理员授权：{{currentPolicy(p)?.status||'未读取，请点提交／恢复授权'}}</p>
    <button type="button" :disabled="busy||p.state!=='active'" @click="submitPolicy(p)">提交／恢复原 HomeFlow 授权</button>
    <button v-if="currentPolicy(p)?.status==='approved'" type="button" :disabled="busy" @click="selected=p.plan_resource_id">记录本期已发生事项</button>
   </div>
  </div>
  <form v-if="available&&chosen&&currentPolicy(chosen)?.status==='approved'" class="editor" @submit.prevent="prepareOccurrence">
   <strong>逐月记账凭证 · {{chosen.merchant}}</strong>
   <div class="pair">
    <label>对应月份<input v-model="period" type="month" :disabled="busy" required/></label>
    <label>银行实际扣款日<input v-model="debit" type="date" :disabled="busy" required/></label>
   </div>
   <label>实际银行流水参考号<input v-model="bankRef" maxlength="160" minlength="8" :disabled="busy" required/></label>
   <label class="checkbox"><input v-model="bankPosted" type="checkbox" :disabled="busy"/> 已核实银行扣款真正发生（非预定）</label>
   <template v-if="chosen.plan_type==='sbi_tsumitate'">
    <label>已成交基金份额／单位<input v-model="units" type="number" min="1" inputmode="numeric" :disabled="busy" required/></label>
    <label>SBI 已成交交易参考号<input v-model="brokerRef" maxlength="160" minlength="8" :disabled="busy" required/></label>
    <div class="pair">
     <label>实际交易日<input v-model="trade" type="date" :disabled="busy" required/></label>
     <label>买付适用日<input v-model="effective" type="date" :disabled="busy" required/></label>
    </div>
    <label class="checkbox"><input v-model="brokerExecuted" type="checkbox" :disabled="busy"/> 已核对券商真实成交和单位（不是待成交指令）</label>
   </template>
   <button type="submit" :disabled="busy||!bankPosted||(chosen.plan_type==='sbi_tsumitate'&&!brokerExecuted)">准备唯一月度凭证</button>
  </form>
  <div v-if="available" class="items"><strong>月度凭证与执行恢复</strong>
   <div v-for="o in visibleOccurrences" :key="o.occurrence_id" class="item">
    <p class="help">{{o.period_key}} · {{currency(o.amount_jpy)}} · {{o.occurrence_id.slice(0,8)}} · {{o.plan_type}}</p>
    <div class="head">
     <button type="button" :disabled="busy" @click="perform(o,'execute')">按原 ID 核验后执行</button>
     <button type="button" :disabled="busy" @click="perform(o,'reconcile')">仅核对已入账回执</button>
    </div>
   </div>
  </div>
 </template>
</section>
</template>
<style scoped>
.recurring-panel{display:grid;gap:10px;max-width:100%;min-width:0;border:1px solid var(--line,#ddd);border-radius:12px;padding:12px}
.recurring-panel header,.head{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
.recurring-panel strong{font-size:14px}
.recurring-panel button{min-height:40px;padding:7px 12px;border-radius:10px;border:1px solid var(--line,#ddd);background:var(--card,#fff)}
.recurring-panel button:disabled{opacity:.55}.help{font-size:12px;color:var(--muted,#6c7774);margin:0;overflow-wrap:anywhere}
.error{color:#a83737;font-size:12px;margin:0;overflow-wrap:anywhere}
.editor,.items{display:grid;gap:9px;min-width:0}
.editor{border:1px solid var(--line,#eee);padding:10px;border-radius:12px}
.editor label{display:grid;gap:4px;font-size:12px;min-width:0}
.editor input,.editor select,.editor textarea{min-width:0;max-width:100%;width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);color:inherit}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.checkbox{display:flex!important;align-items:center;gap:7px}.checkbox input{width:auto}
.item{display:grid;gap:8px;border:1px solid var(--line,#ddd);border-radius:11px;padding:10px;min-width:0}
.item span{font-size:12px}
@media(max-width:380px){.pair{grid-template-columns:minmax(0,1fr)}}
</style>
