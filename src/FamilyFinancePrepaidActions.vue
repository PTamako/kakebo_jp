<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true},
 accounts:{type:Array,required:true}})
const open=ref(false),busy=ref(false),error=ref(''),notice=ref(''),
 action=ref('topup'),prepaidId=ref(''),bankId=ref(''),
 actualDate=ref(''),amount=ref(''),bankReference=ref(''),statementConfirmed=ref(false),
 merchant=ref(''),category=ref('食費'),note=ref(''),balances=ref([]),history=ref([]),
 prepared=ref(null)
const owned=kind=>props.accounts.filter(a=>a.account_kind===kind&&
 a.origin==='member_created'&&a.owner_user_id===props.userId&&a.is_archived===0)
const prepaidAccounts=computed(()=>owned('prepaid'))
const bankAccounts=computed(()=>owned('bank'))
const card=computed(()=>prepaidAccounts.value.find(x=>x.account_id===prepaidId.value))
const bank=computed(()=>bankAccounts.value.find(x=>x.account_id===bankId.value))
const available=computed(()=>balances.value.find(x=>x.account_id===prepaidId.value)?.balance_jpy??null)
const yen=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',
 maximumFractionDigits:0}).format(n||0)
let seq=0,alive=true,idempotency=''
function clear(){
 seq++;open.value=false;busy.value=false;error.value='';notice.value=''
 action.value='topup';prepaidId.value='';bankId.value='';actualDate.value=''
 amount.value='';bankReference.value='';statementConfirmed.value=false
 merchant.value='';category.value='食費';note.value='';balances.value=[];history.value=[]
 prepared.value=null;idempotency=''
}
function changed(){if(!prepared.value)idempotency=''}
async function api(path,opt={}){
 const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...opt})
 const data=await r.json().catch(()=>({}))
 if(!r.ok||data.ok!==true)throw Error(data.code||'储值卡服务暂不可用')
 return data
}
const post=o=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)})
async function reload(){
 const ticket=seq,u=props.userId,h=props.householdId
 try{
  const [a,b]=await Promise.all([api('/api/family-finance/prepaid-actions/balances'),
   api('/api/family-finance/prepaid-actions')])
  if(!alive||ticket!==seq||!open.value||u!==props.userId||h!==props.householdId)return
  balances.value=Array.isArray(a.items)?a.items:[]
  history.value=Array.isArray(b.items)?b.items:[]
 }catch(e){if(ticket===seq&&open.value)error.value=e.message}
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value;seq++;error.value='';notice.value=''
 if(!open.value){balances.value=[];history.value=[];prepared.value=null;return}
 if(!prepaidAccounts.value.some(a=>a.account_id===prepaidId.value))
  prepaidId.value=prepaidAccounts.value[0]?.account_id||''
 if(!bankAccounts.value.some(a=>a.account_id===bankId.value))
  bankId.value=bankAccounts.value[0]?.account_id||''
 await reload()
}
async function prepare(){
 if(busy.value||prepared.value||!card.value)return
 const ticket=seq,u=props.userId,a=card.value,b=bank.value,amountJpy=Number(amount.value)
 error.value='';notice.value=''
 if(!Number.isSafeInteger(amountJpy)||amountJpy<1||amountJpy>10000000||!actualDate.value){
  error.value='请输入实际金额与发生日期';return
 }
 if(action.value==='topup'&&(!b||!statementConfirmed.value||!bankReference.value.trim())){
  error.value='请核对实际银行充值流水并填写交易参考号';return
 }
 if(action.value==='spend'&&(!merchant.value.trim()||!category.value.trim()||
  available.value===null||amountJpy>available.value)){
  error.value='请填写商家和分类，并检查储值卡余额';return
 }
 if(!idempotency)idempotency='prepaid:'+crypto.randomUUID()
 busy.value=true
 try{
  const body={expected_user_id:u,idempotency_key:idempotency,
   prepaid_account_id:a.account_id,prepaid_version:a.version,
   action:action.value,date:actualDate.value,amount_jpy:amountJpy,
   ...(action.value==='topup'?{
    bank_account_id:b.account_id,bank_version:b.version,
    bank_reference:bankReference.value.trim(),statement_confirmed:true
   }:{merchant:merchant.value.trim(),category:category.value.trim(),note:note.value.trim()})}
  const r=await api('/api/family-finance/prepaid-actions',post(body))
  if(!alive||ticket!==seq||u!==props.userId)return
  if(r.prepared?.status!=='prepared'||r.prepared.prepaid_account_id!==a.account_id||
   r.prepared.action!==action.value)throw Error('申请状态或账户已变化')
  prepared.value=r.prepared
  notice.value='申请已加密保存，尚未变动储值卡余额或家庭账本'
  await reload()
 }catch(e){if(alive&&ticket===seq)error.value=e.message}
 finally{if(alive&&ticket===seq)busy.value=false}
}
async function submit(){
 if(!prepared.value||busy.value)return
 const ticket=seq,u=props.userId,p=prepared.value
 busy.value=true;error.value='';notice.value=''
 try{
  const r=await api('/api/family-finance/prepaid-actions/'+p.request_id+'/submit',
   post({expected_user_id:u}))
  if(!alive||ticket!==seq||u!==props.userId)return
  if(r.applied!==false||r.status!=='submitted_status_unknown')
   throw Error('审批提交回执需要核对，请刷新原申请')
  notice.value='已交 HomeFlow；管理员审批并执行成功后才会修改余额'
  prepared.value=null;idempotency='';bankReference.value='';statementConfirmed.value=false
  amount.value='';merchant.value='';note.value=''
  await reload()
 }catch(e){if(alive&&ticket===seq)error.value=e.message}
 finally{if(alive&&ticket===seq)busy.value=false}
}
function onForeground(){
 if(document.visibilityState==='visible'&&open.value){seq++;prepared.value=null;idempotency='';void reload()}
}
watch(()=>[props.userId,props.householdId],clear)
onMounted(()=>document.addEventListener('visibilitychange',onForeground))
onUnmounted(()=>{alive=false;clear();document.removeEventListener('visibilitychange',onForeground)})
</script>
<template>
<section class="prepaid-flow" aria-label="储值卡家庭审批">
 <div class="head"><strong>储值卡 · 充值与消费</strong>
  <button type="button" :disabled="busy" :aria-expanded="open" @click="toggle">{{open?'收起':'记录变动'}}</button>
 </div>
 <template v-if="open">
  <p class="hint">仅记录本人新建立的储值卡账户。旧 Suica／PASMO 余额不会自动搬入或重算。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="hint">{{notice}}</p>
  <p v-if="!prepaidAccounts.length" class="hint">请先新增本人储值卡金融账户。</p>
  <form v-else class="form" @submit.prevent="prepared?submit():prepare()">
   <div class="two">
    <label>操作类型
     <select v-model="action" :disabled="busy||!!prepared" @change="changed">
      <option value="topup">银行充值 · 资金转移</option>
      <option value="spend">储值卡消费 · 家庭支出</option>
     </select>
    </label>
    <label>本人储值卡
     <select v-model="prepaidId" :disabled="busy||!!prepared" @change="changed">
      <option v-for="a in prepaidAccounts" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
   </div>
   <p class="hint">已批准余额：{{available===null?'待读取':yen(available)}}</p>
   <div class="two">
    <label>实际发生日期<input v-model="actualDate" type="date" required
     :disabled="busy||!!prepared" @input="changed"/></label>
    <label>金额（日元）<input v-model="amount" type="number" min="1" max="10000000"
     step="1" required :disabled="busy||!!prepared" @input="changed"/></label>
   </div>
   <template v-if="action==='topup'">
    <p v-if="!bankAccounts.length" class="hint">银行充值需要本人银行账户。</p>
    <label>实际扣款银行账户
     <select v-model="bankId" :disabled="busy||!!prepared" @change="changed">
      <option v-for="a in bankAccounts" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
    <label>银行流水交易参考号
     <input v-model="bankReference" maxlength="160" required
      placeholder="请照银行流水填写" :disabled="busy||!!prepared" @input="changed"/></label>
    <label class="confirm"><input v-model="statementConfirmed" type="checkbox" :disabled="busy||!!prepared"/>
     已核实银行确实发生这笔扣款，不能使用预计充值日期</label>
   </template>
   <template v-else>
    <div class="two">
     <label>消费商家<input v-model="merchant" maxlength="160" required
      :disabled="busy||!!prepared" @input="changed"/></label>
     <label>分类<input v-model="category" maxlength="40" required
      :disabled="busy||!!prepared" @input="changed"/></label>
    </div>
    <label>备注<input v-model="note" maxlength="300" :disabled="busy||!!prepared" @input="changed"/></label>
   </template>
   <button type="submit" :disabled="busy||!card||!actualDate||!amount||
    (action==='topup'?(!bank||!bankReference.trim()||!statementConfirmed):
     (!merchant.trim()||!category.trim()||available===null||Number(amount)>available))">
    {{prepared?'确认提交 HomeFlow 审批':'保存申请（暂不记账）'}}
   </button>
   <button v-if="prepared" type="button" :disabled="busy" @click="prepared=null;idempotency=''">
    重新核对
   </button>
  </form>
  <div class="head"><strong>最近申请</strong><button type="button" :disabled="busy" @click="reload">刷新</button></div>
  <p v-for="r in history" :key="r.request_id" class="history">
   {{r.action==='topup'?'充值':'消费'}} · {{r.status==='applied'?'已实际记账':
   r.status==='submitted_status_unknown'?'等待 HomeFlow 执行':
   r.status==='prepared'?'待提交':r.status}}
   <small v-if="r.balance_after_jpy!==null"> · 余额 {{yen(r.balance_after_jpy)}}</small>
  </p>
  <p v-if="!history.length" class="hint">暂无储值卡变动审批记录</p>
 </template>
</section>
</template>
<style scoped>
.prepaid-flow{display:grid;gap:10px;padding-top:12px;min-width:0;border-top:1px solid var(--line,#ddd)}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.prepaid-flow strong{font-size:13px}
.prepaid-flow button,.prepaid-flow select,.prepaid-flow input:not([type=checkbox]){
 box-sizing:border-box;min-height:42px;padding:8px;max-width:100%;min-width:0;
 border:1px solid var(--line,#ddd);border-radius:11px;background:var(--card,#fff);
 color:inherit;font:inherit;font-size:12px}
.prepaid-flow button:disabled{opacity:.5}.form{display:grid;gap:10px;min-width:0}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
label{display:grid;gap:5px;font-size:11px;min-width:0}
.confirm{display:flex;align-items:flex-start;gap:8px;line-height:1.5}
.confirm input{height:18px;width:18px;flex:0 0 18px}
.hint{font-size:11px;color:var(--muted,#777);line-height:1.6;margin:0}
.error{font-size:12px;color:#b44444;overflow-wrap:anywhere;margin:0}
.history{font-size:12px;border:1px solid var(--line,#ddd);border-radius:10px;padding:9px;margin:0}
@media(max-width:350px){.two{grid-template-columns:1fr}}
</style>
