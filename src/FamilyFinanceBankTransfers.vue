<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true},accounts:{type:Array,required:true}})
const open=ref(false),busy=ref(false),error=ref(''),notice=ref(''),
 sourceId=ref(''),targetId=ref(''),debitDate=ref(''),creditDate=ref(''),
 amount=ref(''),sourceRef=ref(''),targetRef=ref(''),sourcePosted=ref(false),
 targetPosted=ref(false),prepared=ref(null),history=ref([]),serviceAvailable=ref(false)
const banks=computed(()=>props.accounts.filter(a=>
 a.account_kind==='bank'&&a.origin==='member_created'&&
 a.owner_user_id===props.userId&&Number(a.is_archived)===0))
const source=computed(()=>banks.value.find(a=>a.account_id===sourceId.value))
const target=computed(()=>banks.value.find(a=>a.account_id===targetId.value))
const ready=computed(()=>source.value&&target.value&&sourceId.value!==targetId.value&&
 debitDate.value&&creditDate.value&&debitDate.value<=creditDate.value&&
 Number.isSafeInteger(Number(amount.value))&&Number(amount.value)>=1&&
 Number(amount.value)<=10000000&&sourceRef.value.trim().length>=8&&
 targetRef.value.trim().length>=8&&sourcePosted.value&&targetPosted.value)
let epoch=0,alive=true,stableKey=''
function reset(){
 epoch++;open.value=false;busy.value=false;error.value='';notice.value=''
 sourceId.value='';targetId.value='';debitDate.value='';creditDate.value=''
 amount.value='';sourceRef.value='';targetRef.value='';sourcePosted.value=false
 targetPosted.value=false;prepared.value=null;history.value=[];stableKey=''
 serviceAvailable.value=false
}
function edited(){if(!prepared.value)stableKey=''}
async function api(path,opt={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...opt})
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true)throw Error(data.code||'银行转账审批服务不可用')
 return data
}
const post=data=>({method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify(data)})
async function load(){
 const generation=epoch,user=props.userId,hh=props.householdId
 try{
  const data=await api('/api/family-finance/bank-transfers')
  if(!alive||generation!==epoch||!open.value||
   user!==props.userId||hh!==props.householdId)return
  serviceAvailable.value=true
  history.value=Array.isArray(data.items)?data.items:[]
 }catch(e){
  if(generation===epoch&&open.value){
   serviceAvailable.value=false;history.value=[]
   error.value=e.message==='BANK_TRANSFER_DISABLED'
    ?'银行双向已到账转账功能暂未开放，现有账本不受影响。':e.message
  }
 }
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value;epoch++;error.value='';notice.value=''
 if(!open.value){prepared.value=null;history.value=[];serviceAvailable.value=false;return}
 if(!banks.value.some(x=>x.account_id===sourceId.value))
  sourceId.value=banks.value[0]?.account_id||''
 if(!banks.value.some(x=>x.account_id===targetId.value)||
  targetId.value===sourceId.value)
  targetId.value=banks.value.find(x=>x.account_id!==sourceId.value)?.account_id||''
 await load()
}
async function prepare(){
 if(busy.value||prepared.value||!serviceAvailable.value||!ready.value)return
 const generation=epoch,user=props.userId,hh=props.householdId,
  first=source.value,second=target.value
 error.value='';notice.value=''
 if(!first||!second||first.account_id===second.account_id)return
 const payload={expected_user_id:user,
  idempotency_key:stableKey||('bank-transfer:'+crypto.randomUUID()),
  source_account_id:first.account_id,source_version:first.version,
  target_account_id:second.account_id,target_version:second.version,
  debit_date:debitDate.value,credit_date:creditDate.value,
  amount_jpy:Number(amount.value),source_bank_reference:sourceRef.value.trim(),
  target_bank_reference:targetRef.value.trim(),
  bank_debit_posted:true,bank_credit_posted:true}
 // Reuse the SAME key after uncertain network acknowledgement, never create a second transfer.
 stableKey=payload.idempotency_key;busy.value=true
 try{
  const result=await api('/api/family-finance/bank-transfers',post(payload))
  if(!alive||generation!==epoch||user!==props.userId||hh!==props.householdId)return
  if(result.prepared?.status!=='prepared'||
   result.prepared.source_account_id!==first.account_id||
   result.prepared.target_account_id!==second.account_id||
   result.prepared.applied!==false)throw Error('申请回执未确认，不会修改正式账本')
  prepared.value=result.prepared
  notice.value='双方银行流水证据已加密保存，尚未发生家庭账本入账。'
  await load()
 }catch(e){if(alive&&generation===epoch&&user===props.userId)error.value=e.message}
 finally{if(alive&&generation===epoch)busy.value=false}
}
function resume(item){
 if(!alive||!open.value||busy.value||!serviceAvailable.value||
  item?.status!=='prepared'||prepared.value||
  !/^[a-f0-9]{32}$/i.test(item.request_id||'')||
  !banks.value.some(a=>a.account_id===item.source_account_id&&a.version===item.source_version)||
  !banks.value.some(a=>a.account_id===item.target_account_id&&a.version===item.target_version)||
  item.source_account_id===item.target_account_id)return
 sourceId.value=item.source_account_id
 targetId.value=item.target_account_id
 prepared.value=item
 stableKey=''
 sourceRef.value='';targetRef.value=''
 sourcePosted.value=false;targetPosted.value=false
 notice.value='已恢复原加密申请。仅提交原申请 ID，不会重复创建银行转账。'
 error.value=''
}
async function submit(){
 if(!prepared.value||busy.value||!serviceAvailable.value)return
 const generation=epoch,user=props.userId,hh=props.householdId,p=prepared.value
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/bank-transfers/'+p.request_id+'/submit',
   post({expected_user_id:user}))
  if(!alive||generation!==epoch||user!==props.userId||hh!==props.householdId)return
  if(result.applied!==false||result.status!=='submitted_status_unknown')
   throw Error('HomeFlow 状态不明确，需按原申请 ID 核对，不能创建新转账')
  notice.value='已提交 HomeFlow。管理员批准后仍须独立执行并确认银行间转账记账回执。'
  prepared.value=null;stableKey=''
  amount.value='';sourceRef.value='';targetRef.value=''
  sourcePosted.value=false;targetPosted.value=false
  await load()
 }catch(e){if(alive&&generation===epoch&&user===props.userId)error.value=e.message}
 finally{if(alive&&generation===epoch)busy.value=false}
}
async function cancel(){
 if(!prepared.value||busy.value||!serviceAvailable.value)return
 const generation=epoch,user=props.userId,p=prepared.value
 busy.value=true;error.value='';notice.value=''
 try{
  const r=await api('/api/family-finance/bank-transfers/'+p.request_id+'/cancel',
   post({expected_user_id:user}))
  if(!alive||generation!==epoch||user!==props.userId)return
  if(r.status!=='cancelled')throw Error('仅能撤回未提交 HomeFlow 的申请')
  prepared.value=null;stableKey='';notice.value='尚未提交的草稿已撤回，原银行流水不受影响'
  await load()
 }catch(e){if(alive&&generation===epoch)error.value=e.message}
 finally{if(alive&&generation===epoch)busy.value=false}
}
function foreground(){
 if(document.visibilityState==='visible'&&open.value){
  epoch++;prepared.value=null;stableKey='';sourceRef.value='';targetRef.value=''
  sourcePosted.value=false;targetPosted.value=false;void load()
 }
}
watch(()=>[props.userId,props.householdId],reset)
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{alive=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
<section class="bank-transfers" aria-label="家庭银行已到账资产转移">
 <div class="head">
  <strong>银行↔银行 · 已到账转账</strong>
  <button type="button" :disabled="busy" :aria-expanded="open" @click="toggle">{{open?'收起':'记录转账'}}</button>
 </div>
 <template v-if="open">
  <p class="hint">仅记录本人两个稳定银行账户之间，转出已扣款且转入已到账的转账。不会发起真实银行汇款，不算收入或消费。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="hint">{{notice}}</p>
  <p v-if="banks.length<2" class="hint">请先建立至少两个本人银行账户。跨家庭成员、证券、储值卡和现金转账尚未开放。</p>
  <form v-if="serviceAvailable&&banks.length>=2" class="form" :novalidate="!!prepared"
   @submit.prevent="prepared?submit():prepare()">
   <div class="two">
    <label>转出银行
     <select v-model="sourceId" :disabled="busy||!!prepared" @change="edited">
      <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
    <label>转入银行
     <select v-model="targetId" :disabled="busy||!!prepared" @change="edited">
      <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
   </div>
   <p v-if="sourceId===targetId" role="alert" class="error">转入与转出必须是两个不同银行账户。</p>
   <div class="two">
    <label>实际扣款日<input v-model="debitDate" type="date" required
     :disabled="busy||!!prepared" @input="edited"/></label>
    <label>实际到账日<input v-model="creditDate" type="date" required
     :disabled="busy||!!prepared" @input="edited"/></label>
   </div>
   <label>准确转账金额（日元）
    <input v-model="amount" type="number" min="1" max="10000000" step="1" required
     :disabled="busy||!!prepared" @input="edited"/></label>
   <label>转出银行已扣款的参考号
    <input v-model="sourceRef" maxlength="160" minlength="8" required
     placeholder="根据银行扣款明细填写" :disabled="busy||!!prepared" @input="edited"/></label>
   <label>转入银行已到账的参考号
    <input v-model="targetRef" maxlength="160" minlength="8" required
     placeholder="根据转入银行的入账明细填写" :disabled="busy||!!prepared" @input="edited"/></label>
   <label class="check"><input v-model="sourcePosted" type="checkbox" :disabled="busy||!!prepared"/>
    我已核实转出银行实际完成扣款，不是待处理请求</label>
   <label class="check"><input v-model="targetPosted" type="checkbox" :disabled="busy||!!prepared"/>
    我已核实转入银行实际完成入账，不是预计到账</label>
   <p class="hint">这是一笔内部双向资产移动。保存申请不会增加银行余额；批准后执行器还会核验版本、余额与双边流水。</p>
   <button type="submit" :disabled="busy||!(prepared||ready)">
    {{prepared?'提交 HomeFlow 家庭审批':'加密保存已到账转账证据'}}
   </button>
   <button v-if="prepared" type="button" :disabled="busy" @click="cancel">撤回未提交草稿</button>
  </form>
  <div class="head"><strong>转账申请记录</strong>
   <button type="button" :disabled="busy||!serviceAvailable" @click="load">刷新</button>
  </div>
  <div v-for="r in history" :key="r.request_id" class="history">
   <span>{{r.source_account_id?.slice(0,8)}} → {{r.target_account_id?.slice(0,8)}} ·
    {{r.status==='applied'?'已得到家庭账本双向回执':
      r.status==='submitted_status_unknown'?'等待 HomeFlow 审核与执行':
      r.status==='prepared'?'仅草稿':r.status}}
   </span>
   <button v-if="r.status==='prepared'" type="button" :disabled="busy||!!prepared||!serviceAvailable"
    @click="resume(r)">继续原申请</button>
  </div>
  <p v-if="!history.length&&serviceAvailable" class="hint">暂无本人已到账转账记录。</p>
 </template>
</section>
</template>
<style scoped>
.bank-transfers{display:grid;gap:9px;border:1px solid var(--line,#ddd);
 border-radius:12px;padding:11px;min-width:0;max-width:100%;overflow-wrap:anywhere}
.head{display:flex;align-items:center;gap:9px;justify-content:space-between}
.head strong{font-size:14px}
.form{display:grid;gap:10px;min-width:0}
.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
label{display:grid;gap:6px;min-width:0;font-size:12px}
input,select,button{box-sizing:border-box;max-width:100%;min-width:0;min-height:43px;
 border:1px solid var(--line,#ddd);border-radius:9px;padding:7px 10px;
 background:var(--card,#fff);color:inherit;font:inherit}
input[type=checkbox]{min-height:17px;width:19px;height:19px;padding:0}
button{cursor:pointer}
button:disabled{opacity:.55;cursor:default}
.check{display:flex;gap:7px;align-items:center;line-height:1.5}
.hint,.history{font-size:12px;color:var(--muted,#777);line-height:1.5;margin:0}
.error{font-size:12px;color:#b44646;margin:0}
.history{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:7px 2px;border-bottom:1px solid var(--line,#ddd)}
.history span{min-width:0;overflow-wrap:anywhere}
.history button{flex:none}
@media(max-width:480px){.two{grid-template-columns:minmax(0,1fr)}}
</style>
