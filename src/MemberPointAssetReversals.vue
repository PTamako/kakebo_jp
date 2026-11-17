<script setup>
import {computed,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true}})
const emit=defineEmits(['changed'])
const open=ref(false),busy=ref(false),error=ref(''),notice=ref(''),loaded=ref(false)
const eligible=ref([]),selectedId=ref(''),issuerRef=ref(''),targetRef=ref('')
const date=ref(new Date(Date.now()+32400000).toISOString().slice(0,10))
const brokerRef=ref(''),brokerDate=ref(''),pointsDate=ref('')
const issuerConfirmed=ref(false),targetConfirmed=ref(false),brokerConfirmed=ref(false)
let seq=0,alive=true,pending=null
const operationLabels={transfer_prepaid:'プリペイドカード',offset_card:'クレジットカード',
 redeem_asset:'SBI買付',transfer_out:'ポイント移動',exchange_out:'ポイント交換'}
const selected=computed(()=>eligible.value.find(r=>r.homeflow_request_id===selectedId.value))
const isSbi=computed(()=>selected.value?.operation==='redeem_asset')
const validRef=s=>s.trim().length>=8&&s.length<=160
const validDate=s=>s&&s<=new Date(Date.now()+32400000).toISOString().slice(0,10)
const enabled=computed(()=>!busy.value&&loaded.value&&!!selected.value&&
 issuerConfirmed.value&&targetConfirmed.value&&validRef(issuerRef.value)&&
 validRef(targetRef.value)&&validDate(date.value)&&date.value>=selected.value.effective_date&&
 (!isSbi.value||(brokerConfirmed.value&&
  /^[a-z0-9._:-]{8,128}$/i.test(brokerRef.value)&&
  validDate(brokerDate.value)&&validDate(pointsDate.value)&&
  brokerDate.value<=pointsDate.value&&pointsDate.value<=date.value)))
function reset(){
 seq++;open.value=false;busy.value=false;error.value='';notice.value='';
 eligible.value=[];selectedId.value='';issuerRef.value='';targetRef.value='';
 brokerRef.value='';brokerDate.value='';pointsDate.value='';issuerConfirmed.value=false;
 targetConfirmed.value=false;brokerConfirmed.value=false;pending=null;loaded.value=false
}
watch(()=>[props.userId,props.householdId],reset)
function changed(){if(pending)error.value='前回の訂正結果が未確認です。同じ内容で再試行してください'}
async function api(options={}){
 const r=await fetch('/api/family-finance/member-point-asset-reversals',{
  credentials:'same-origin',cache:'no-store',...options})
 const d=await r.json().catch(()=>({}))
 if(!r.ok||d.ok!==true)throw Error(d.code||'本人のポイント訂正を確認できません')
 return d
}
async function reload(){
 const revision=seq,actor=props.userId,household=props.householdId
 try{
  const d=await api()
  if(!alive||revision!==seq||actor!==props.userId||household!==props.householdId)return
  if(d.scope!=='personal'||d.viewer_user_id!==actor||d.read_only!==true||
   !Array.isArray(d.eligible)||d.ledger_changed!==false)
   throw Error('本人の取引の範囲を確認できません')
  eligible.value=d.eligible
  if(!eligible.value.some(x=>x.homeflow_request_id===selectedId.value))
   selectedId.value=eligible.value[0]?.homeflow_request_id||''
  loaded.value=true;error.value=''
 }catch(e){if(revision===seq){loaded.value=false;error.value=e.message}}
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value;seq++;error.value='';notice.value='';pending=null
 if(open.value)await reload()
 else{eligible.value=[];loaded.value=false}
}
async function save(){
 if(!enabled.value)return
 const ticket=seq,actor=props.userId,household=props.householdId,old=selected.value
 const body={expected_user_id:actor,original_request_id:old.homeflow_request_id,
  effective_date:date.value,issuer_refund_reference:issuerRef.value.trim(),
  counterpart_reversal_reference:targetRef.value.trim(),
  issuer_points_returned_confirmed:true,counterpart_reverted_confirmed:true,
  ...(isSbi.value?{broker_cancel_reference:brokerRef.value.trim(),
   broker_cancel_date:brokerDate.value,points_returned_date:pointsDate.value,
   broker_cancel_confirmed:true}:{})}
 const snapshot=JSON.stringify(body)
 if(pending&&pending.snapshot!==snapshot){
  error.value='送信結果を確認するまで申請内容は変更できません';return
 }
 if(!pending)pending={snapshot,key:'personal-asset-refund:'+crypto.randomUUID()}
 if(!window.confirm('元の資産移動を全額取り消し、発行元のポイント返還と受取先の反映取り消しを確認しましたか？このアプリは実際の返金やSBI注文取消を行いません。'))return
 busy.value=true;error.value='';notice.value=''
 try{
  const d=await api({method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({...body,idempotency_key:pending.key})})
  if(!alive||ticket!==seq||actor!==props.userId||household!==props.householdId)return
  if(d.scope!=='personal'||d.applied!==true||d.ledger_changed!==false||
   d.counterpart_refunded!==true||d.issuer_api_verified!==false)
   throw Error('両側の訂正結果を確認できません')
  pending=null;issuerRef.value='';targetRef.value='';brokerRef.value=''
  issuerConfirmed.value=false;targetConfirmed.value=false;brokerConfirmed.value=false
  notice.value='元の取引を訂正し、'+Number(d.delta_units).toLocaleString('ja-JP')+
   'pt を記録上で返還しました。発行元の実残高は別途ご確認ください。'
  await reload();emit('changed')
 }catch(e){if(ticket===seq)error.value=e.message}
 finally{if(ticket===seq)busy.value=false}
}
onUnmounted(()=>{alive=false;reset()})
</script>
<template>
 <section class="asset-refunds" aria-label="本人のポイント資産訂正">
  <div class="heading">
   <strong>ポイントの振替・交換を訂正</strong>
   <button type="button" :disabled="busy" @click="toggle">{{open?'閉じる':'訂正を記録'}}</button>
  </div>
  <template v-if="open">
   <p class="note">実際に発行元のポイントが戻り、受取先でも入金やSBI注文の取消が確定している場合だけ、元の記録を全額反転します。現金取引・家庭明細は書き換えません。</p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <p v-if="notice" class="note" role="status">{{notice}}</p>
   <p v-if="loaded&&!eligible.length" class="note">訂正できる本人の未取消取引はありません。</p>
   <form v-if="loaded&&eligible.length" @submit.prevent="save">
    <label>元のポイント資産取引
     <select v-model="selectedId" :disabled="busy" @change="changed">
      <option v-for="r in eligible" :key="r.homeflow_request_id" :value="r.homeflow_request_id">
       {{r.effective_date}} · {{operationLabels[r.operation]}} · {{Math.abs(r.delta_units)}}pt / ¥{{r.yen_value}}
      </option>
     </select>
    </label>
    <p v-if="selected" class="note">取消先：{{selected.target_label}}。全額の訂正のみ対応します。残額不足の場合は保存できません。</p>
    <label>両方の返還が完了した日
     <input v-model="date" type="date" :disabled="busy" required @change="changed"/>
    </label>
    <label>ポイント返還の明細参照番号
     <input v-model.trim="issuerRef" :disabled="busy" maxlength="160" minlength="8"
      placeholder="発行元の返還番号" @input="changed"/>
    </label>
    <label>受取先取消の明細参照番号
     <input v-model.trim="targetRef" :disabled="busy" maxlength="160" minlength="8"
      placeholder="返金・請求復帰・口座移動取消の番号" @input="changed"/>
    </label>
    <template v-if="isSbi">
     <label>SBI 約定取消番号
      <input v-model.trim="brokerRef" maxlength="128" :disabled="busy" @input="changed"/>
     </label>
     <label>SBI取消日<input v-model="brokerDate" type="date" :disabled="busy" @change="changed"/></label>
     <label>ポイント返還日<input v-model="pointsDate" type="date" :disabled="busy" @change="changed"/></label>
     <label class="check"><input v-model="brokerConfirmed" type="checkbox" :disabled="busy"/>
      SBI の取消通知と全口数返還を確認しました</label>
    </template>
    <label class="check"><input v-model="issuerConfirmed" type="checkbox" :disabled="busy"/>
     ポイントが実際に全額返還されました</label>
    <label class="check"><input v-model="targetConfirmed" type="checkbox" :disabled="busy"/>
     受取側も全額取り消されています</label>
    <button type="submit" class="primary" :disabled="!enabled">
     {{busy?'確認中…':'元のポイント資産取引を全額訂正'}}</button>
   </form>
   <button v-if="loaded" type="button" :disabled="busy" @click="reload">最新の取引を確認</button>
  </template>
 </section>
</template>
<style scoped>
.asset-refunds{display:grid;gap:9px;padding:12px;border:1px solid var(--line,#ddd);border-radius:12px;min-width:0}
.heading{display:flex;align-items:center;justify-content:space-between;gap:7px}
.heading strong{font-size:13px}
.asset-refunds form{display:grid;gap:9px;min-width:0}
.asset-refunds label{display:grid;gap:5px;font-size:12px;min-width:0}
.asset-refunds .check{display:flex;gap:8px;flex-direction:row;align-items:center}
.asset-refunds select,.asset-refunds input:not([type=checkbox]){min-width:0;max-width:100%;width:100%;min-height:44px;
 padding:9px;border-radius:9px;border:1px solid var(--line,#ddd);
 color:inherit;background:var(--card,#fff);font-size:16px}
.asset-refunds button{min-height:44px;padding:8px 10px;font-size:12px;font-weight:600;
 border:1px solid var(--line,#ddd);border-radius:10px;color:inherit;background:var(--card,#fff)}
.asset-refunds button.primary{background:var(--primary,#357a60);color:white}
.asset-refunds button:disabled{opacity:.5}
.note{font-size:11px;line-height:1.55;color:var(--muted,#777);margin:0}
.error{font-size:12px;color:#b43b3b}
</style>
