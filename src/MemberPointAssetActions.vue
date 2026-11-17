<script setup>
import {computed,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true}})
const emit=defineEmits(['changed'])
const visible=ref(false),busy=ref(false),error=ref(''),message=ref(''),available=ref(false)
const accounts=ref([]),purchases=ref([]),recent=ref([]),historySize=ref(5)
const sourceId=ref(''),targetId=ref(''),operation=ref('transfer_prepaid'),units=ref(''),yen=ref('')
const targetUnits=ref(''),effectiveDate=ref(new Date(Date.now()+32400000).toISOString().slice(0,10))
const issuerReference=ref(''),counterpartReference=ref(''),purchaseId=ref('')
const fundCode=ref(''),fundAccountType=ref('growth'),fundUnits=ref(''),brokerReference=ref('')
const issuerConfirmed=ref(false),counterpartConfirmed=ref(false),brokerConfirmed=ref(false)
let alive=true,seq=0,pending=null
const kinds=[
 {value:'transfer_prepaid',label:'ポイント → プリペイド'},
 {value:'offset_card',label:'ポイント → クレジットカード請求'},
 {value:'redeem_asset',label:'ポイント → SBI 確認済み買付'},
 {value:'transfer_out',label:'本人のポイント口座へ移動'},
 {value:'exchange_out',label:'本人の別ポイントへ交換'}]
const targetKind=computed(()=>operation.value==='transfer_prepaid'?'prepaid':
 operation.value==='offset_card'?'credit_card':
 operation.value==='redeem_asset'?'securities':'points')
const points=computed(()=>accounts.value.filter(a=>a.account_kind==='points'))
const targets=computed(()=>accounts.value.filter(a=>a.account_kind===targetKind.value&&
 a.account_id!==sourceId.value))
const source=computed(()=>points.value.find(a=>a.account_id===sourceId.value))
const target=computed(()=>targets.value.find(a=>a.account_id===targetId.value))
const candidates=computed(()=>purchases.value.filter(x=>x.account_id===targetId.value&&
 Number(x.remaining_jpy)>0&&x.purchase_date<=effectiveDate.value))
const cardPurchase=computed(()=>candidates.value.find(x=>x.homeflow_request_id===purchaseId.value))
const isExchange=computed(()=>operation.value==='exchange_out')
const isTransfer=computed(()=>['transfer_out','exchange_out'].includes(operation.value))
const isSbi=computed(()=>operation.value==='redeem_asset')
const positiveInt=n=>Number.isSafeInteger(Number(n))&&Number(n)>0
const unitsAmount=computed(()=>Number(units.value))
const yenAmount=computed(()=>Number(yen.value))
const rateOk=computed(()=>positiveInt(units.value)&&positiveInt(yen.value)&&
 unitsAmount.value<=1000000000&&yenAmount.value<=10000000&&
 (!isExchange.value||(positiveInt(targetUnits.value)&&Number(targetUnits.value)<=1000000000)))
const canSubmit=computed(()=>!!source.value&&!!target.value&&!busy.value&&available.value&&
 issuerConfirmed.value&&counterpartConfirmed.value&&rateOk.value&&
 issuerReference.value.trim().length>=8&&issuerReference.value.length<=160&&
 counterpartReference.value.trim().length>=8&&counterpartReference.value.length<=160&&
 effectiveDate.value&&effectiveDate.value<=new Date(Date.now()+32400000).toISOString().slice(0,10)&&
 (operation.value!=='offset_card'||!!cardPurchase.value&&yenAmount.value<=Number(cardPurchase.value.remaining_jpy))&&
 (!isSbi.value||brokerConfirmed.value&&/^[A-Z0-9]{8}$/.test(fundCode.value)&&
 positiveInt(fundUnits.value)&&Number(fundUnits.value)<=1000000000000&&
 /^[a-z0-9._:-]{8,128}$/i.test(brokerReference.value)))
const labelOf=op=>kinds.find(x=>x.value===op)?.label||op
const yenLabel=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
function clear(){seq++;visible.value=false;busy.value=false;error.value='';message.value='';
 accounts.value=[];purchases.value=[];recent.value=[];available.value=false;
 sourceId.value='';targetId.value='';units.value='';yen.value='';targetUnits.value='';
 purchaseId.value='';issuerReference.value='';counterpartReference.value='';
 brokerReference.value='';fundUnits.value='';fundCode.value='';issuerConfirmed.value=false;
 counterpartConfirmed.value=false;brokerConfirmed.value=false;pending=null;historySize.value=5}
watch(()=>[props.userId,props.householdId],clear)
function changed(){if(pending)error.value='前回の送信結果を確認できていません。同じ内容で再試行してください'}
function resetOperation(){
 targetId.value='';purchaseId.value='';targetUnits.value='';
 changed()
}
async function api(path='',options={}){
 const response=await fetch('/api/family-finance/member-points-asset-actions'+path,{
  credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true)throw Error(data.code||'ポイントの資産処理を確認できません')
 return data
}
async function load(){
 const ticket=seq,uid=props.userId,hh=props.householdId
 try{
  const d=await api()
  if(!alive||ticket!==seq||uid!==props.userId||hh!==props.householdId)return
  if(d.scope!=='personal'||d.viewer_user_id!==uid||d.ledger_changed!==false||
   !Array.isArray(d.accounts)||!Array.isArray(d.purchases)||!Array.isArray(d.recent))
   throw Error('本人の資産情報を確認できません')
  accounts.value=d.accounts;purchases.value=d.purchases;recent.value=d.recent;
  available.value=true;error.value=''
  if(!points.value.some(a=>a.account_id===sourceId.value))sourceId.value=points.value[0]?.account_id||''
  if(!targets.value.some(a=>a.account_id===targetId.value))targetId.value=targets.value[0]?.account_id||''
 }catch(e){if(ticket===seq){error.value=e.message;available.value=false}}
}
async function toggle(){
 if(busy.value)return
 visible.value=!visible.value;seq++;error.value='';message.value='';pending=null
 if(visible.value)await load()
 else{accounts.value=[];purchases.value=[];recent.value=[];available.value=false}
}
async function submit(){
 if(!canSubmit.value)return
 const uid=props.userId,hh=props.householdId,ticket=seq
 const plan={expected_user_id:uid,operation:operation.value,
  points_account_id:source.value.account_id,points_version:source.value.version,
  target_account_id:target.value.account_id,target_version:target.value.version,
  units:unitsAmount.value,yen_value:yenAmount.value,
  // Record the issuer's EXACT rational exchange rate, avoiding rounded JPY.
  rate_numerator:yenAmount.value,rate_denominator:unitsAmount.value,
  effective_date:effectiveDate.value,issuer_reference:issuerReference.value.trim(),
  counterpart_reference:counterpartReference.value.trim(),issuer_confirmed:true,
  counterpart_confirmed:true,
  ...(operation.value==='offset_card'?{target_purchase_request_id:purchaseId.value}:{}),
  ...(isSbi.value?{sbi_fund_code:fundCode.value,sbi_account_type:fundAccountType.value,
   sbi_confirmed_units:Number(fundUnits.value),broker_trade_reference:brokerReference.value,
   broker_execution_confirmed:true}:{}),
  ...(isTransfer.value?{target_units:isExchange.value?Number(targetUnits.value):unitsAmount.value,
   target_rate_numerator:isExchange.value?yenAmount.value:yenAmount.value,
   target_rate_denominator:isExchange.value?Number(targetUnits.value):unitsAmount.value}:{})}
 const snapshot=JSON.stringify(plan)
 if(pending&&pending.snapshot!==snapshot){
  error.value='前回の記録の送信結果が不明です。変更せず再送してください';return
 }
 if(!pending)pending={snapshot,key:'personal-asset:'+crypto.randomUUID()}
 if(!window.confirm('発行元のポイント利用と、受取先の実際の反映を確認済みですか？これは記録だけを行い、外部への振込・カード決済・SBI買付は実行しません。'))return
 busy.value=true;error.value='';message.value=''
 try{
  const response=await api('',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({...plan,idempotency_key:pending.key})})
  if(!alive||ticket!==seq||uid!==props.userId||hh!==props.householdId)return
  if(response.scope!=='personal'||response.ledger_changed!==false||
   response.issuer_api_verified!==false||response.applied!==true||
   response.counterpart_confirmed!==true)throw Error('同一取引の反映確認が必要です')
  pending=null;units.value='';yen.value='';targetUnits.value='';
  issuerReference.value='';counterpartReference.value='';brokerReference.value='';
  fundUnits.value='';brokerConfirmed.value=false;
  issuerConfirmed.value=false;counterpartConfirmed.value=false;
  message.value='本人の '+labelOf(response.operation)+' を記録しました。残り '+
   Number(response.balance_after_units).toLocaleString('ja-JP')+'pt、受取 '+yenLabel(response.yen_value)+
   '（実際の発行元残高とは連携していません）'
  await load();emit('changed')
 }catch(e){if(ticket===seq)error.value=e.message}
 finally{if(ticket===seq)busy.value=false}
}
onUnmounted(()=>{alive=false;clear()})
</script>
<template>
 <section class="asset-points" aria-label="本人のポイント資産">
  <div class="heading">
   <strong>ポイントの振替・交換</strong>
   <button type="button" :disabled="busy" :aria-expanded="visible" @click="toggle">
    {{visible?'閉じる':'記録する'}}</button>
  </div>
  <template v-if="visible">
   <p class="muted">本人の口座間で、発行元側の利用と入金・請求減額・SBI約定の両方が実際に反映された記録だけを登録します。家庭明細の審査は不要です。</p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <p v-if="message" role="status" class="muted">{{message}}</p>
   <p v-if="!points.length" class="muted">本人のポイント口座を残高ページで追加してください。</p>
   <form v-if="available&&points.length" @submit.prevent="submit">
    <label>操作
     <select v-model="operation" :disabled="busy" @change="resetOperation">
      <option v-for="k in kinds" :key="k.value" :value="k.value">{{k.label}}</option>
     </select>
    </label>
    <label>利用するポイント口座
     <select v-model="sourceId" :disabled="busy" @change="resetOperation">
      <option v-for="p in points" :key="p.account_id" :value="p.account_id">{{p.label}}</option>
     </select>
    </label>
    <label>反映先の本人アカウント
     <select v-model="targetId" :disabled="busy" @change="purchaseId='';changed()">
      <option value="">振替先を選択</option>
      <option v-for="a in targets" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
     </select>
    </label>
    <label v-if="operation==='offset_card'">請求残額のあるカード支出
     <select v-model="purchaseId" :disabled="busy" @change="changed">
      <option value="">対象の記録を選択</option>
      <option v-for="r in candidates" :key="r.homeflow_request_id" :value="r.homeflow_request_id">
       {{r.purchase_date}} · 残額 {{yenLabel(r.remaining_jpy)}} · {{r.homeflow_request_id.slice(0,8)}}
      </option>
     </select>
    </label>
    <label>利用ポイント数
     <input v-model="units" type="number" min="1" max="1000000000" step="1"
      inputmode="numeric" required :disabled="busy" @input="changed"/>
    </label>
    <label>実際の反映額（円）
     <input v-model="yen" type="number" min="1" max="10000000" step="1"
      inputmode="numeric" required :disabled="busy" @input="changed"/>
    </label>
    <p class="muted">ポイント数と円額から交換レートを正確に記録します。自動で1pt=1円とは扱いません。</p>
    <label v-if="isExchange">受取先のポイント数
     <input v-model="targetUnits" type="number" min="1" max="1000000000" step="1"
      inputmode="numeric" required :disabled="busy" @input="changed"/>
    </label>
    <template v-if="isSbi">
     <label>銘柄コード（8桁）
      <input v-model.trim="fundCode" maxlength="8" placeholder="JP123456"
       :disabled="busy" @input="changed"/>
     </label>
     <label>口座区分<select v-model="fundAccountType" :disabled="busy" @change="changed">
      <option value="growth">NISA成長投資枠</option><option value="tsumitate">NISAつみたて投資枠</option>
     </select></label>
     <label>実際の約定口数
      <input v-model="fundUnits" type="number" inputmode="numeric" min="1"
       max="1000000000000" step="1" :disabled="busy" @input="changed"/>
     </label>
     <label>SBI の実際の約定番号
      <input v-model.trim="brokerReference" maxlength="128" :disabled="busy"
       placeholder="約定報告書の番号" @input="changed"/>
     </label>
     <label class="check"><input v-model="brokerConfirmed" type="checkbox" :disabled="busy"/>
      SBIの約定報告書と口数を確認しました</label>
    </template>
    <label>実際の反映日<input v-model="effectiveDate" type="date" :disabled="busy" required @change="changed"/></label>
    <label>発行元の利用明細参照番号
     <input v-model.trim="issuerReference" maxlength="160" minlength="8"
      placeholder="ポイント側の確定番号" :disabled="busy" @input="changed"/>
    </label>
    <label>受取先の確定明細参照番号
     <input v-model.trim="counterpartReference" maxlength="160" minlength="8"
      placeholder="チャージ・カード・証券などの明細番号" :disabled="busy" @input="changed"/>
    </label>
    <label class="check"><input v-model="issuerConfirmed" type="checkbox" :disabled="busy"/>
     ポイントの利用が確定しています</label>
    <label class="check"><input v-model="counterpartConfirmed" type="checkbox" :disabled="busy"/>
     相手側の受取・反映も確定しています</label>
    <button type="submit" class="primary" :disabled="!canSubmit">
     {{busy?'処理中…':'確認済みのポイント資産取引を保存'}}</button>
   </form>
   <div class="heading"><strong>本人の資産取引</strong>
    <button type="button" :disabled="busy" @click="load">更新</button></div>
   <div v-for="r in recent.slice(0,historySize)" :key="r.homeflow_request_id" class="history">
    <strong>{{r.effective_date}} · {{labelOf(r.operation)}}</strong>
    <span>{{r.delta_units}} pt · {{yenLabel(r.yen_value)}}</span>
   </div>
   <button v-if="recent.length>historySize" type="button" @click="historySize+=5">さらに５件</button>
  </template>
 </section>
</template>
<style scoped>
.asset-points{display:grid;gap:9px;padding:12px;border:1px solid var(--line,#ddd);border-radius:12px;min-width:0}
.heading{display:flex;justify-content:space-between;align-items:center;gap:8px}
.heading strong{font-size:13px}
.asset-points form{display:grid;gap:10px}
.asset-points label{display:grid;gap:5px;font-size:12px;min-width:0}
.asset-points .check{display:flex;flex-direction:row;gap:8px;align-items:center}
.asset-points input:not([type=checkbox]),.asset-points select{min-width:0;width:100%;max-width:100%;min-height:44px;
 padding:9px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);color:inherit;font-size:16px}
.asset-points button{min-height:44px;padding:8px 10px;border:1px solid var(--line,#ddd);
 border-radius:10px;background:var(--card,#fff);color:inherit;font-size:12px;font-weight:600}
.asset-points button.primary{background:var(--primary,#347e62);color:white}
.asset-points button:disabled{opacity:.5}
.muted{font-size:11px;color:var(--muted,#777);line-height:1.55;margin:0}
.error{color:#b33343;font-size:12px}
.history{display:grid;gap:2px;border-top:1px solid var(--line,#ddd);padding:8px 0;font-size:12px}
</style>
