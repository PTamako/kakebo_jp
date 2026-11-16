<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true},accounts:{type:Array,required:true}})
const nowJst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const cards=computed(()=>props.accounts.filter(a=>
 a.account_kind==='credit_card'&&a.origin==='member_created'&&
 a.owner_user_id===props.userId&&a.is_archived===0))
const open=ref(false),busy=ref(false),error=ref(''),notice=ref(''),
 list=ref([]),prepared=ref(null),accountId=ref(''),date=ref(nowJst()),
 amount=ref(''),merchant=ref(''),category=ref('食費'),note=ref('')
let revision=0,active=true,requestKey=''
const yen=v=>new Intl.NumberFormat('ja-JP',{style:'currency',
 currency:'JPY',maximumFractionDigits:0}).format(Number(v||0))
const ownerAccount=computed(()=>cards.value.find(x=>x.account_id===accountId.value))
function reset(){
 revision++;open.value=false;list.value=[];prepared.value=null;accountId.value='';
 amount.value='';merchant.value='';category.value='食費';note.value='';
 busy.value=false;error.value='';notice.value='';requestKey=''
}
async function api(url,opt={}){
 const r=await fetch(url,{cache:'no-store',credentials:'same-origin',...opt})
 const b=await r.json().catch(()=>({}))
 if(!r.ok||b.ok!==true)throw Error(String(b.code||'服务不可用'))
 return b
}
const post=body=>({method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify(body)})
async function load(){
 const n=revision,user=props.userId,household=props.householdId
 try{
  const r=await api('/api/family-finance/card-purchases')
  if(n!==revision||!active||!open.value||user!==props.userId||
   household!==props.householdId)return
  list.value=Array.isArray(r.items)?r.items:[]
 }catch(e){if(n===revision&&open.value)error.value=e.message}
}
async function show(){
 if(busy.value)return
 open.value=!open.value
 revision++;error.value='';notice.value=''
 if(!open.value){list.value=[];prepared.value=null;return}
 accountId.value=cards.value[0]?.account_id||''
 await load()
}
async function prepare(){
 if(busy.value||!ownerAccount.value||prepared.value)return
 const n=revision,user=props.userId,account=ownerAccount.value
 error.value='';notice.value=''
 const value=Number(amount.value)
 if(!Number.isSafeInteger(value)||value<1||value>10000000||
  !merchant.value.trim()||!category.value.trim()){
  error.value='请填写金额、商家和分类';return
 }
 // Retain the same idempotency key across a failed network response, but
 // never reuse an existing key after the user edits a different purchase.
 if(!requestKey)requestKey='card:'+crypto.randomUUID()
 busy.value=true
 try{
  const r=await api('/api/family-finance/card-purchases',
   post({expected_user_id:user,idempotency_key:requestKey,
    account_id:account.account_id,account_version:account.version,
    date:date.value,amount_jpy:value,merchant:merchant.value.trim(),
    category:category.value.trim(),note:note.value.trim()}))
  if(!active||n!==revision||user!==props.userId)return
  if(r.prepared?.account_id!==account.account_id||
   r.prepared?.account_version!==account.version||
   r.prepared?.status!=='prepared')throw Error('申请需要重新核对')
  prepared.value=r.prepared
  notice.value='已保存申请，请确认提交管理员审批'
  await load()
 }catch(e){if(active&&n===revision)error.value=e.message}
 finally{if(active&&n===revision)busy.value=false}
}
async function submit(){
 if(busy.value||!prepared.value)return
 const n=revision,user=props.userId,p=prepared.value
 busy.value=true;error.value='';notice.value=''
 try{
  const r=await api('/api/family-finance/card-purchases/'+p.request_id+'/submit',
   post({expected_user_id:user}))
  if(!active||n!==revision||user!==props.userId)return
  if(r.applied!==false||r.status!=='submitted_status_unknown')
   throw Error('审批提交回执需要核对')
  notice.value='已提交审批；管理员需在 HomeFlow 审批并执行'
  prepared.value=null;requestKey='';amount.value='';merchant.value='';note.value=''
  await load()
 }catch(e){if(active&&n===revision)error.value=e.message}
 finally{if(active&&n===revision)busy.value=false}
}
function changed(){if(!prepared.value)requestKey=''}
function onForeground(){if(document.visibilityState==='visible'&&open.value){
 revision++;prepared.value=null;requestKey='';void load()
}}
watch(()=>[props.userId,props.householdId],()=>reset())
onMounted(()=>document.addEventListener('visibilitychange',onForeground))
onUnmounted(()=>{active=false;reset();document.removeEventListener('visibilitychange',onForeground)})
</script>
<template>
 <section class="card-finance" aria-label="信用卡家庭审批">
  <div class="head">
   <strong>信用卡消费审批</strong>
   <button type="button" :aria-expanded="open" :disabled="busy" @click="show">
    {{open?'收起':'记信用卡消费'}}
   </button>
  </div>
  <template v-if="open">
   <p class="hint">消费记入家庭支出，同时生成待核对信用卡应付；不会立即扣现金。</p>
   <p v-if="error" role="alert" class="error">{{error}}</p>
   <p v-if="notice" role="status" class="hint">{{notice}}</p>
   <p v-if="!cards.length" class="hint">请先建立本人信用卡账户。</p>
   <form v-else class="fields" @submit.prevent="prepared?submit():prepare()">
    <label>本人信用卡
     <select v-model="accountId" :disabled="busy||!!prepared" @change="changed">
      <option v-for="a in cards" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
    <div class="two">
     <label>消费日期<input v-model="date" type="date" required :disabled="busy||!!prepared" @input="changed"/></label>
     <label>金额（日元）<input v-model="amount" type="number" min="1" max="10000000"
      step="1" required :disabled="busy||!!prepared" @input="changed"/></label>
    </div>
    <label>商家<input v-model="merchant" maxlength="160" required
     :disabled="busy||!!prepared" @input="changed" placeholder="例如：セブン-イレブン"/></label>
    <div class="two">
     <label>分类<input v-model="category" maxlength="40" required
      :disabled="busy||!!prepared" @input="changed"/></label>
     <label>备注<input v-model="note" maxlength="300" :disabled="busy||!!prepared"
      @input="changed"/></label>
    </div>
    <button type="submit" :disabled="busy||!ownerAccount||!amount||!merchant.trim()">
     {{prepared?'确认提交审批':'保存信用卡消费申请'}}
    </button>
    <button v-if="prepared" type="button" :disabled="busy" @click="prepared=null;requestKey=''">
     重新填写
    </button>
   </form>
   <div class="history">
    <div class="head"><strong>最近申请</strong>
     <button type="button" :disabled="busy" @click="load">刷新状态</button>
    </div>
    <p v-for="item in list" :key="item.request_id">
     <span>{{cards.find(a=>a.account_id===item.account_id)?.label||'信用卡'}} ·
      {{item.status==='applied'?'已实际记账':item.status==='submitted_status_unknown'?
      '等待管理员执行':item.status==='prepared'?'待提交':item.status}}</span>
     <small v-if="item.bill_month">{{item.bill_month}} 截止账期</small>
    </p>
    <p v-if="!list.length" class="hint">暂无信用卡审批记录</p>
   </div>
  </template>
 </section>
</template>
<style scoped>
.card-finance{display:grid;gap:10px;min-width:0;border-top:1px solid var(--line,#ddd);
 padding-top:12px}.head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.card-finance strong{font-size:13px}.card-finance button,.card-finance select,
.card-finance input{min-height:42px;box-sizing:border-box;border:1px solid var(--line,#ccc);
 border-radius:12px;padding:8px 11px;color:inherit;background:var(--card,#fff);
 max-width:100%;min-width:0;font:inherit;font-size:12px}
.card-finance button:disabled{opacity:.5}.card-finance label{display:grid;gap:5px;
 min-width:0;font-size:11px}.fields{display:grid;gap:10px;min-width:0}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
@media(max-width:330px){.two{grid-template-columns:1fr}}
.hint,.history small{font-size:11px;color:var(--muted,#777);margin:0}
.error{font-size:12px;color:#b44444;overflow-wrap:anywhere}
.history{display:grid;gap:8px;min-width:0}.history p:not(.hint){margin:0;
 padding:10px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;
 border:1px solid var(--line,#ddd);border-radius:11px;font-size:12px}
</style>
