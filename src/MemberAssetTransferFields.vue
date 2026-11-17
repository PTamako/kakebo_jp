<script setup>
import {computed,ref,watch,onUnmounted} from 'vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import {memberOwnActiveAssets,memberTransferChoices,memberTransferOperation} from './member-transfer-options.js'
const props=defineProps({
 record:{type:Object,required:true},
 accounts:{type:Array,required:true},
 userId:{type:String,required:true}
})
const own=computed(()=>memberOwnActiveAssets(props.accounts,props.userId))
const options=computed(()=>memberTransferChoices(props.accounts,props.userId).map(x=>({
 value:x.value,label:x.label||x.name})))
const operation=computed(()=>memberTransferOperation(props.record.transferTarget))
const isPoint=computed(()=>typeof props.record.transferTarget==='string'&&
 props.record.transferTarget.startsWith('points:'))
const points=computed(()=>own.value.filter(a=>a.account_kind==='points'))
const targetKind=computed(()=>({
 'points:prepaid':'prepaid','points:card':'credit_card',
 'points:sbi':'securities','points:move':'points','points:exchange':'points'
})[props.record.transferTarget]||'')
const targets=computed(()=>own.value.filter(a=>a.account_kind===targetKind.value&&
 a.account_id!==props.record.pointSourceId))
const purchases=ref([]),loading=ref(false),error=ref('')
let seq=0
const eligiblePurchases=computed(()=>purchases.value.filter(p=>
 p.account_id===props.record.assetTargetId&&Number(p.remaining_jpy)>0&&
 p.purchase_date<=(props.record.transferDate||props.record.date)))
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
async function loadCardPurchases(){
 const ticket=++seq,uid=props.userId
 if(props.record.transferTarget!=='points:card'){purchases.value=[];error.value='';return}
 loading.value=true;error.value=''
 try{
  const response=await fetch('/api/family-finance/member-points-asset-actions',
   {credentials:'same-origin',cache:'no-store'})
  const data=await response.json().catch(()=>({}))
  if(!response.ok||data.ok!==true||data.scope!=='personal'||
   data.viewer_user_id!==uid||data.ledger_changed!==false||
   !Array.isArray(data.purchases))throw Error(data.code||'本人のカード利用履歴を確認できません')
  if(ticket!==seq||uid!==props.userId)return
  purchases.value=data.purchases
 }catch(e){if(ticket===seq)error.value=e.message}
 finally{if(ticket===seq)loading.value=false}
}
watch(()=>props.record.transferTarget,()=>{void loadCardPurchases()},{immediate:true})
watch(()=>props.userId,()=>{seq++;purchases.value=[];error.value='';void loadCardPurchases()})
onUnmounted(()=>{seq++})
</script>
<template>
 <div class="member-transfer-fields">
  <label class="form-field"><span>转移方式／振替先</span>
   <MobileChoiceSheet v-model="record.transferTarget" :options="options" label="振替先"/>
  </label>
  <template v-if="operation && operation!=='spouse'">
   <label class="form-field"><span>反映日</span>
    <input v-model="record.transferDate" type="date" :max="today()" required />
   </label>
  </template>
  <p v-if="operation==='spouse'" class="hint">配偶間の資産移動を1件記録します。双方の収入・支出に計上しません。</p>
  <template v-else-if="operation==='prepaid'">
   <p class="hint">本人の電子マネーへのチャージです。銀行口座は不要です。実際に反映された金額だけ記録します。</p>
   <label class="confirm"><input v-model="record.assetConfirmed" type="checkbox"/>
    本人のカード残高への反映を確認済み</label>
  </template>
  <template v-else-if="isPoint && operation">
   <label class="form-field"><span>利用する本人のポイント口座</span>
    <MobileChoiceSheet v-model="record.pointSourceId"
     :options="points.map(a=>({value:a.account_id,label:a.label}))" label="ポイント口座"/>
   </label>
   <label class="form-field"><span>本人の受取先</span>
    <MobileChoiceSheet v-model="record.assetTargetId"
     :options="targets.map(a=>({value:a.account_id,label:a.label}))" label="受取先"/>
   </label>
   <label class="form-field"><span>利用ポイント数（pt）</span>
    <input v-model="record.pointUnits" type="number" min="1" max="1000000000" step="1"
      inputmode="numeric" required/>
   </label>
   <p class="hint">画面上部の金額は実際に受取先へ反映された円額です。1pt=1円とは限りません。</p>
   <label v-if="record.transferTarget==='points:exchange'" class="form-field">
    <span>交換後の受取ポイント数（pt）</span>
    <input v-model="record.targetPointUnits" type="number" min="1" max="1000000000"
     step="1" inputmode="numeric" required/>
   </label>
   <template v-if="record.transferTarget==='points:card'">
    <p v-if="error" role="alert" class="hint error">{{error}}</p>
    <p v-if="loading" class="hint">本人のカード利用履歴を確認中…</p>
    <label class="form-field"><span>請求残額のある本人のカード支出</span>
     <MobileChoiceSheet v-model="record.cardPurchaseId"
      :options="eligiblePurchases.map(p=>({value:p.homeflow_request_id,
       label:p.purchase_date+' · ¥'+Number(p.remaining_jpy).toLocaleString('ja-JP')}))"
      label="カード支出"/>
    </label>
   </template>
   <template v-if="record.transferTarget==='points:sbi'">
    <label class="form-field"><span>銘柄コード（8桁）</span>
     <input v-model.trim="record.fundCode" maxlength="8" placeholder="JP123456"/>
    </label>
    <label class="form-field"><span>口座区分</span>
     <MobileChoiceSheet v-model="record.fundAccountType"
      :options="[{value:'growth',label:'NISA成長投資枠'},
       {value:'tsumitate',label:'NISAつみたて投資枠'}]" label="口座区分"/>
    </label>
    <label class="form-field"><span>実際の約定口数</span>
     <input v-model="record.fundUnits" type="number" min="1" max="1000000000000" step="1"
      inputmode="numeric"/>
    </label>
    <label class="form-field"><span>SBI の実際の約定番号</span>
     <input v-model.trim="record.brokerReference" maxlength="128"/>
    </label>
    <label class="confirm"><input v-model="record.brokerConfirmed" type="checkbox"/>
      SBIの約定報告書と口数を確認しました</label>
   </template>
   <label class="form-field"><span>発行元の利用明細参照番号</span>
    <input v-model.trim="record.issuerReference" minlength="8" maxlength="160"/>
   </label>
   <label class="form-field"><span>受取先の確定明細参照番号</span>
    <input v-model.trim="record.counterpartReference" minlength="8" maxlength="160"/>
   </label>
   <label class="confirm"><input v-model="record.issuerConfirmed" type="checkbox"/>
     発行元のポイント利用が確定しています</label>
   <label class="confirm"><input v-model="record.counterpartConfirmed" type="checkbox"/>
     受取先への実際の反映も確認しました</label>
   <p class="hint">本人の資産履歴のみ記録します。外部のカード決済・ポイント交換・SBI注文は実行しません。</p>
  </template>
  <p v-else class="hint error">現在の本人の資産に対応する振替先を選択してください。</p>
 </div>
</template>
<style scoped>
.member-transfer-fields,.form-field{display:grid;gap:10px;min-width:0}
.form-field{gap:6px;font-size:13px;color:var(--muted)}
.form-field input{box-sizing:border-box;width:100%;max-width:100%;min-width:0;
 min-height:46px;padding:9px 12px;border:1px solid var(--line,#ddd);
 border-radius:10px;background:var(--card,#fff);color:var(--ink,#222);font-size:16px}
.confirm{display:flex;align-items:center;gap:8px;font-size:12px;min-height:44px}
.confirm input{flex:none;accent-color:var(--blue)}
.hint{font-size:12px;line-height:1.55;color:var(--muted);margin:0}
.error{color:#a33}
</style>
