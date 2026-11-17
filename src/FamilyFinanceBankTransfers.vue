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
 if(!response.ok||data.ok!==true)throw Error(data.code||'銀行振替サービスを利用できません')
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
    ?'銀行間振替の記録は利用できません。既存の明細は保持されます。':e.message
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
   result.prepared.applied!==false)throw Error('申請受付を確認できません。家庭明細は変更しません')
  prepared.value=result.prepared
  notice.value='両側の入出金証拠を暗号化して保存しました。家庭明細にはまだ反映されていません。'
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
 notice.value='元の暗号化申請を再開しました。同じ申請番号を使用し、重複登録しません。'
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
   throw Error('HomeFlowの確認が未完了です。元の申請番号で確認し、二重登録しないでください')
  notice.value='HomeFlowに送信しました。管理者の承認後に振替の入帳処理と結果照合が必要です。'
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
  if(r.status!=='cancelled')throw Error('HomeFlowへの提出前の申請のみ取り消せます')
  prepared.value=null;stableKey='';notice.value='未提出の下書きを取り消しました。銀行側の取引には影響しません'
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
<section class="bank-transfers" aria-label="家庭帳簿の銀行間振替">
 <div class="head">
  <strong>銀行間振替 · 入出金確認済み</strong>
  <button type="button" :disabled="busy" :aria-expanded="open" @click="toggle">{{open?'閉じる':'振替を記録'}}</button>
 </div>
 <template v-if="open">
  <p class="hint">本人名義の２つの銀行口座で、実際に引き落としと入金が確認された振替だけを記録します。銀行送金は行わず、収入・支出には含めません。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="hint">{{notice}}</p>
  <p v-if="banks.length<2" class="hint">まず残高画面で本人の銀行口座を２つ登録してください。家族間や証券・電子マネー・現金との振替には対応していません。</p>
  <form v-if="serviceAvailable&&banks.length>=2" class="form" :novalidate="!!prepared"
   @submit.prevent="prepared?submit():prepare()">
   <div class="two">
    <label>振替元の銀行
     <select v-model="sourceId" :disabled="busy||!!prepared" @change="edited">
      <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
    <label>振替先の銀行
     <select v-model="targetId" :disabled="busy||!!prepared" @change="edited">
      <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
   </div>
   <p v-if="sourceId===targetId" role="alert" class="error">振替元と振替先は別々の銀行口座にしてください。</p>
   <div class="two">
    <label>実際の引落日<input v-model="debitDate" type="date" required
     :disabled="busy||!!prepared" @input="edited"/></label>
    <label>実際の入金日<input v-model="creditDate" type="date" required
     :disabled="busy||!!prepared" @input="edited"/></label>
   </div>
   <label>振替金額（円）
    <input v-model="amount" type="number" min="1" max="10000000" step="1" required
     :disabled="busy||!!prepared" @input="edited"/></label>
   <label>振替元銀行の引落参照番号
    <input v-model="sourceRef" maxlength="160" minlength="8" required
     placeholder="銀行の引落明細に記載された番号" :disabled="busy||!!prepared" @input="edited"/></label>
   <label>振替先銀行の入金参照番号
    <input v-model="targetRef" maxlength="160" minlength="8" required
     placeholder="振替先銀行の入金明細に記載された番号" :disabled="busy||!!prepared" @input="edited"/></label>
   <label class="check"><input v-model="sourcePosted" type="checkbox" :disabled="busy||!!prepared"/>
    振替元銀行で実際の引落が完了したことを確認しました</label>
   <label class="check"><input v-model="targetPosted" type="checkbox" :disabled="busy||!!prepared"/>
    振替先銀行で実際の入金が完了したことを確認しました</label>
   <p class="hint">これは家庭帳簿の資産移動です。申請だけでは残高は変わりません。承認後も口座状態と両側の入出金証拠を確認します。</p>
   <button type="submit" :disabled="busy||!(prepared||ready)">
    {{prepared?'HomeFlowで明細変更の承認を申請':'入出金証拠を暗号化して保存'}}
   </button>
   <button v-if="prepared" type="button" :disabled="busy" @click="cancel">未提出の下書きを取り消す</button>
  </form>
  <div class="head"><strong>振替申請履歴</strong>
   <button type="button" :disabled="busy||!serviceAvailable" @click="load">更新</button>
  </div>
  <div v-for="r in history" :key="r.request_id" class="history">
   <span>{{r.source_account_id?.slice(0,8)}} → {{r.target_account_id?.slice(0,8)}} ·
    {{r.status==='applied'?'家庭帳簿への振替反映済み':
      r.status==='submitted_status_unknown'?'HomeFlowの承認・実行待ち':
      r.status==='prepared'?'下書き':r.status}}
   </span>
   <button v-if="r.status==='prepared'" type="button" :disabled="busy||!!prepared||!serviceAvailable"
    @click="resume(r)">元の申請を再開</button>
  </div>
  <p v-if="!history.length&&serviceAvailable" class="hint">振替記録はまだありません。</p>
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
