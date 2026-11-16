<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true},accounts:{type:Array,required:true}})
const open=ref(false),busy=ref(false),error=ref(''),notice=ref(''),
 cardAccount=ref(''),bankAccount=ref(''),debitDate=ref(''),bankReference=ref(''),
 confirmed=ref(false),outstanding=ref([]),history=ref([]),
 allocations=ref({}),prepared=ref(null)
const eligible=kind=>props.accounts.filter(a=>a.account_kind===kind&&
 a.origin==='member_created'&&a.owner_user_id===props.userId&&a.is_archived===0)
const cards=computed(()=>eligible('credit_card'))
const banks=computed(()=>eligible('bank'))
const selectedCard=computed(()=>cards.value.find(c=>c.account_id===cardAccount.value))
const selectedBank=computed(()=>banks.value.find(b=>b.account_id===bankAccount.value))
const visiblePurchases=computed(()=>outstanding.value.filter(p=>p.account_id===cardAccount.value))
const chosen=computed(()=>visiblePurchases.value.map(p=>({
 purchase_request_id:p.purchase_request_id,amount_jpy:Number(allocations.value[p.purchase_request_id]||0)
})).filter(p=>Number.isSafeInteger(p.amount_jpy)&&p.amount_jpy>0))
const total=computed(()=>chosen.value.reduce((a,b)=>a+b.amount_jpy,0))
const yen=n=>new Intl.NumberFormat('ja-JP',{style:'currency',
 currency:'JPY',maximumFractionDigits:0}).format(n||0)
let generation=0,active=true,key=''
function reset(){
 generation++;open.value=false;busy.value=false;error.value='';notice.value=''
 cardAccount.value='';bankAccount.value='';debitDate.value='';bankReference.value=''
 confirmed.value=false;outstanding.value=[];history.value=[];allocations.value={}
 prepared.value=null;key=''
}
function edit(){
 if(!prepared.value)key=''
}
async function api(path,opt={}){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...opt})
 const data=await r.json().catch(()=>({}))
 if(!r.ok||data.ok!==true)throw Error(data.code||'暂时无法读取还款数据')
 return data
}
const post=v=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(v)})
async function load(){
 const n=generation,user=props.userId,household=props.householdId
 try{
  const [p,h]=await Promise.all([
   api('/api/family-finance/card-settlements/outstanding'),
   api('/api/family-finance/card-settlements')
  ])
  if(!active||n!==generation||!open.value||user!==props.userId||
   household!==props.householdId)return
  outstanding.value=Array.isArray(p.items)?p.items:[]
  history.value=Array.isArray(h.items)?h.items:[]
 }catch(e){if(n===generation&&open.value)error.value=e.message}
}
async function show(){
 if(busy.value)return
 open.value=!open.value;generation++;error.value='';notice.value=''
 if(!open.value){outstanding.value=[];history.value=[];prepared.value=null;return}
 if(!cards.value.some(c=>c.account_id===cardAccount.value))cardAccount.value=cards.value[0]?.account_id||''
 if(!banks.value.some(b=>b.account_id===bankAccount.value))bankAccount.value=banks.value[0]?.account_id||''
 await load()
}
async function prepare(){
 if(busy.value||prepared.value||!selectedCard.value||!selectedBank.value)return
 const n=generation,user=props.userId,card=selectedCard.value,bank=selectedBank.value
 if(!debitDate.value||!bankReference.value.trim()||!confirmed.value){
  error.value='请根据实际银行流水填写扣款日期与交易参考号，并确认已核对';return
 }
 if(total.value<1||total.value>10000000||
  chosen.value.some(a=>a.amount_jpy>visiblePurchases.value.find(
   p=>p.purchase_request_id===a.purchase_request_id)?.remaining_jpy)){
  error.value='请选择待还消费并填写不超过剩余欠款的金额';return
 }
 if(!key)key='cardsettlement:'+crypto.randomUUID()
 busy.value=true;error.value='';notice.value=''
 try{
  const r=await api('/api/family-finance/card-settlements',post({
   expected_user_id:user,idempotency_key:key,
   card_account_id:card.account_id,card_version:card.version,
   bank_account_id:bank.account_id,bank_version:bank.version,
   debit_date:debitDate.value,amount_jpy:total.value,
   bank_reference:bankReference.value.trim(),statement_confirmed:true,
   allocations:chosen.value
  }))
  if(!active||n!==generation||user!==props.userId)return
  if(r.prepared?.status!=='prepared'||r.prepared.card_account_id!==card.account_id||
   r.prepared.bank_account_id!==bank.account_id)throw Error('还款申请版本需要重新核对')
  prepared.value=r.prepared;notice.value='还款申请已保存，尚未变更家庭账本'
  await load()
 }catch(e){if(active&&n===generation)error.value=e.message}
 finally{if(active&&n===generation)busy.value=false}
}
async function submit(){
 if(busy.value||!prepared.value)return
 const n=generation,user=props.userId,p=prepared.value
 busy.value=true;error.value='';notice.value=''
 try{
  const r=await api('/api/family-finance/card-settlements/'+p.request_id+'/submit',
   post({expected_user_id:user}))
  if(!active||n!==generation||user!==props.userId)return
  if(r.applied!==false||r.status!=='submitted_status_unknown')
   throw Error('提交状态待核对，请刷新后检查原申请')
  notice.value='已提交 HomeFlow；管理员审批并执行后才会核销应付'
  prepared.value=null;key='';bankReference.value='';confirmed.value=false
  allocations.value={};await load()
 }catch(e){if(active&&n===generation)error.value=e.message}
 finally{if(active&&n===generation)busy.value=false}
}
function foreground(){
 if(document.visibilityState==='visible'&&open.value){
  generation++;prepared.value=null;key='';void load()
 }
}
watch(()=>[props.userId,props.householdId],reset)
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{active=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
<section class="settlements" aria-label="信用卡还款家庭审批">
 <div class="head">
  <strong>信用卡还款 · 银行扣款</strong>
  <button type="button" :disabled="busy" :aria-expanded="open" @click="show">
   {{open?'收起':'核对还款'}}
  </button>
 </div>
 <template v-if="open">
  <p class="hint">仅在已经核对实际银行流水后填写。还款不重复计算家庭支出，也不会仅凭结算日推测扣款。</p>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <p v-if="notice" class="hint" role="status">{{notice}}</p>
  <p v-if="!cards.length||!banks.length" class="hint">请先建立本人信用卡和银行账户。</p>
  <form v-else class="form" @submit.prevent="prepared?submit():prepare()">
   <div class="two">
    <label>本人信用卡
     <select v-model="cardAccount" :disabled="busy||!!prepared" @change="edit">
      <option v-for="a in cards" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
    <label>实际扣款银行账户
     <select v-model="bankAccount" :disabled="busy||!!prepared" @change="edit">
      <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
   </div>
   <div class="two">
    <label>银行实际扣款日期
     <input v-model="debitDate" type="date" required :disabled="busy||!!prepared" @input="edit"/>
    </label>
    <label>银行流水参考号
     <input v-model="bankReference" maxlength="160" required
      placeholder="从银行明细中核对" :disabled="busy||!!prepared" @input="edit"/>
    </label>
   </div>
   <strong>分配到原信用卡消费</strong>
   <p v-if="!visiblePurchases.length" class="hint">当前信用卡没有可核销的原消费。</p>
   <div v-for="p in visiblePurchases" :key="p.purchase_request_id" class="purchase">
    <span>{{p.purchase_date}} · {{p.bill_month}} 账期
     <small>剩余 {{yen(p.remaining_jpy)}} / 原消费 {{yen(p.amount_jpy)}}</small>
    </span>
    <label>本次还款
     <input v-model="allocations[p.purchase_request_id]" type="number"
      min="0" :max="p.remaining_jpy" step="1"
      :disabled="busy||!!prepared" @input="edit"/>
    </label>
   </div>
   <div class="total">合计核销 <strong>{{yen(total)}}</strong></div>
   <label class="confirm"><input v-model="confirmed" type="checkbox" :disabled="busy||!!prepared"/>
    已根据实际银行流水核对扣款日期、账户和交易参考号</label>
   <button type="submit" :disabled="busy||!total||!debitDate||!bankReference.trim()||!confirmed">
    {{prepared?'确认送交 HomeFlow 审批':'保存还款申请（不立即入账）'}}
   </button>
   <button v-if="prepared" type="button" :disabled="busy"
    @click="prepared=null;key=''">重新核对</button>
  </form>
  <div class="head"><strong>还款申请记录</strong><button type="button" :disabled="busy" @click="load">刷新</button></div>
  <p v-for="r in history" :key="r.request_id" class="history">
   {{r.debit_date||'日期待审批'}} · {{r.status==='applied'?'已核销':
   r.status==='submitted_status_unknown'?'等待 HomeFlow 执行':
   r.status==='prepared'?'待提交':r.status}}
  </p>
  <p v-if="!history.length" class="hint">暂无还款审批记录</p>
 </template>
</section>
</template>
<style scoped>
.settlements{display:grid;gap:10px;padding-top:12px;min-width:0;border-top:1px solid var(--line,#ddd)}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.head strong,.settlements strong{font-size:13px}
.settlements button,.settlements select,.settlements input:not([type=checkbox]){
 box-sizing:border-box;max-width:100%;min-width:0;min-height:42px;padding:8px;
 border:1px solid var(--line,#ddd);border-radius:11px;color:inherit;
 background:var(--card,#fff);font:inherit;font-size:12px}
.settlements button:disabled{opacity:.5}
.form{display:grid;gap:10px;min-width:0}.two{display:grid;grid-template-columns:
 repeat(2,minmax(0,1fr));gap:9px;min-width:0}
label{display:grid;gap:5px;font-size:11px;min-width:0}
.purchase{display:flex;align-items:center;justify-content:space-between;
 gap:10px;padding:9px;border:1px solid var(--line,#ddd);border-radius:12px;min-width:0}
.purchase span{font-size:12px}.purchase small{display:block;font-size:10px;
 color:var(--muted,#777)}.purchase label{min-width:100px;width:120px}
.total{display:flex;justify-content:space-between;font-size:12px;gap:10px}
.confirm{display:flex;align-items:flex-start;gap:8px;line-height:1.5}
.confirm input{width:18px;height:18px;flex:0 0 18px}
.hint{color:var(--muted,#777);font-size:11px;margin:0;line-height:1.5}
.error{color:#b44444;font-size:12px;overflow-wrap:anywhere;margin:0}
.history{margin:0;padding:8px;border:1px solid var(--line,#ddd);
 border-radius:10px;font-size:12px}
@media(max-width:350px){.two{grid-template-columns:1fr}}
</style>
