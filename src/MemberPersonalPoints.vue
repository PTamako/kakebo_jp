<script setup>
import {computed,onUnmounted,ref,watch} from 'vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
const props=defineProps({
 userId:{type:String,required:true},householdId:{type:String,required:true},
 accounts:{type:Array,default:()=>[]}
})
const emit=defineEmits(['changed'])
const points=computed(()=>props.accounts.filter(a=>a.owner_user_id===props.userId&&
 a.account_kind==='points'&&a.origin==='member_created'&&Number(a.is_archived)===0))
const open=ref(false),busy=ref(false),error=ref(''),message=ref(''),available=ref(true),
 accountId=ref(''),operation=ref('earn_campaign'),units=ref(''),reference=ref(''),
 originalId=ref(''),confirmed=ref(false),
 effectiveDate=ref(new Date(Date.now()+32400000).toISOString().slice(0,10)),
 rows=ref([]),nextCursor=ref(null),visible=ref(5)
let alive=true,generation=0,pending=null
const kinds=[{value:'earn_campaign',label:'ポイント獲得'},
 {value:'expire',label:'ポイント失効'},{value:'reversal',label:'元の記録を訂正'}]
const originals=computed(()=>rows.value.filter(r=>['earn_campaign','expire'].includes(r.operation)))
const chosen=computed(()=>originals.value.find(r=>r.homeflow_request_id===originalId.value))
const selected=computed(()=>points.value.find(x=>x.account_id===accountId.value))
const numericUnits=computed(()=>operation.value==='reversal'?
 Math.abs(Number(chosen.value?.delta_units||0)):Number(units.value))
const ready=computed(()=>!!selected.value&&!busy.value&&confirmed.value&&
 effectiveDate.value&&reference.value.trim().length>=8&&reference.value.length<=160&&
 Number.isSafeInteger(numericUnits.value)&&numericUnits.value>0&&numericUnits.value<=10000000&&
 (operation.value!=='reversal'||!!chosen.value))
const messageFor=s=>s==='earn_campaign'?'獲得':s==='expire'?'失効':'訂正'
function reset(){
 generation++;open.value=false;busy.value=false;error.value='';message.value='';rows.value=[];
 nextCursor.value=null;visible.value=5;accountId.value='';originalId.value='';reference.value='';units.value='';
 confirmed.value=false;pending=null
}
watch(()=>[props.userId,props.householdId],reset)
const post=x=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(x)})
async function api(path,options={}){
 const r=await fetch('/api/family-finance/member-personal-points'+path,{
  credentials:'same-origin',cache:'no-store',...options})
 const d=await r.json().catch(()=>({}))
 if(!r.ok||d.ok!==true)throw Error(d.code||'本人のポイント処理が利用できません')
 return d
}
async function load(append=false){
 const turn=generation,user=props.userId,hh=props.householdId
 try{
  const data=await api(append&&nextCursor.value?
   '?before='+encodeURIComponent(nextCursor.value):'')
  if(!alive||turn!==generation||props.userId!==user||props.householdId!==hh)return
  if(data.scope!=='personal'||data.viewer_user_id!==user||!Array.isArray(data.items)||
   data.ledger_changed!==false)throw Error('本人のポイント情報の範囲が一致しません')
  rows.value=append?[...rows.value,...data.items]:data.items
  nextCursor.value=data.next_cursor||null
  available.value=true
 }catch(e){if(turn===generation){error.value=e.message;available.value=false}}
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value;generation++;error.value='';message.value='';pending=null
 if(open.value){
  if(!points.value.some(x=>x.account_id===accountId.value))accountId.value=points.value[0]?.account_id||''
  await load()
 }else{rows.value=[];nextCursor.value=null}
}
function changed(){if(pending)error.value='前回の送信結果が未確認です。同じ内容で再試行してください'}
async function submit(){
 if(!ready.value||!available.value)return
 const user=props.userId,hh=props.householdId,turn=generation
 const item=chosen.value,account=selected.value
 const body={expected_user_id:user,points_account_id:account.account_id,
  points_version:account.version,operation:operation.value,units:numericUnits.value,
  effective_date:effectiveDate.value,issuer_reference:reference.value.trim(),
  issuer_confirmed:true,original_request_id:operation.value==='reversal'?item.homeflow_request_id:null}
 const snapshot=JSON.stringify(body)
 if(pending&&pending.snapshot!==snapshot){
  error.value='前回の結果を確認してから変更してください';return
 }
 if(!pending)pending={snapshot,key:'personal-points:'+crypto.randomUUID()}
 if(!window.confirm('発行元の明細を確認しましたか？本人のポイント記録だけを変更し、家計簿の収支やカード残高は変更しません。'))return
 busy.value=true;error.value='';message.value=''
 try{
  const response=await api('',post({...body,idempotency_key:pending.key}))
  if(!alive||turn!==generation||user!==props.userId||hh!==props.householdId)return
  if(response.scope!=='personal'||response.ledger_changed!==false||
   response.points_balance_changed!==true||response.issuer_api_verified!==false)
   throw Error('本人の記帳結果を確認できません')
  pending=null;units.value='';reference.value='';confirmed.value=false;originalId.value=''
  message.value=messageFor(response.operation)+'を保存しました。残高 '+response.balance_after_units.toLocaleString('ja-JP')+' pt'
  await load();emit('changed')
 }catch(e){if(turn===generation)error.value=e.message}
 finally{if(turn===generation)busy.value=false}
}
async function more(){
 if(visible.value<rows.value.length){visible.value+=5;return}
 if(nextCursor.value){await load(true);visible.value+=5}
}
onUnmounted(()=>{alive=false;reset()})
</script>
<template>
 <section class="personal-points" aria-label="本人のポイント取引">
  <div class="head"><strong>ポイントの本人管理</strong>
   <button type="button" :disabled="busy" :aria-expanded="open" @click="toggle">{{open?'閉じる':'取引を記録'}}</button>
  </div>
  <template v-if="open">
   <p class="hint">本人のポイント獲得・失効・訂正は管理者承認不要。発行元の明細を確認して記録します。実際の残高照会や交換は行いません。</p>
   <p v-if="error" role="alert" class="error">{{error}}</p>
   <p v-if="message" role="status" class="hint">{{message}}</p>
   <p v-if="!points.length" class="hint">残高ページから本人のポイント口座を登録してください。</p>
   <form v-if="points.length&&available" @submit.prevent="submit">
    <MobileChoiceSheet v-model="accountId" label="ポイント口座"
     :options="points.map(a=>({value:a.account_id,label:a.label}))" :disabled="busy"/>
    <MobileChoiceSheet v-model="operation" label="操作" :options="kinds" :disabled="busy"/>
    <label v-if="operation==='reversal'">訂正する元の履歴
     <select v-model="originalId" :disabled="busy" @change="changed">
      <option value="">元の記録を選択</option>
      <option v-for="r in originals" :key="r.homeflow_request_id" :value="r.homeflow_request_id">
       {{r.effective_date}} · {{messageFor(r.operation)}} · {{Math.abs(r.delta_units)}}pt
      </option>
     </select>
    </label>
    <label v-else>ポイント数
     <input v-model="units" type="number" min="1" max="10000000" step="1" inputmode="numeric"
      :disabled="busy" required @input="changed"/>
    </label>
    <label>適用日<input v-model="effectiveDate" type="date" :disabled="busy" required @input="changed"/></label>
    <label>発行元の明細参照番号
     <input v-model.trim="reference" minlength="8" maxlength="160" required
      placeholder="明細に記載された参照番号" :disabled="busy" @input="changed"/>
    </label>
    <label class="check"><input v-model="confirmed" type="checkbox" :disabled="busy"/>
     発行元の実際の獲得・失効・返還を確認しました</label>
    <button type="submit" :disabled="!ready||!available">{{busy?'保存中…':'本人のポイント記録を保存'}}</button>
   </form>
   <div class="head"><strong>本人の記録</strong><button type="button" :disabled="busy" @click="load()">更新</button></div>
   <div v-for="r in rows.slice(0,visible)" :key="r.homeflow_request_id" class="history">
    <span>{{r.effective_date}} · {{messageFor(r.operation)}}</span>
    <strong>{{r.delta_units>0?'+':''}}{{r.delta_units}} pt</strong>
    <small>記録後 {{r.balance_after_units}} pt</small>
   </div>
   <button v-if="visible<rows.length||nextCursor" type="button" :disabled="busy" @click="more">さらに５件</button>
  </template>
 </section>
</template>
<style scoped>
.personal-points{display:grid;gap:9px;border:1px solid var(--line,#ddd);border-radius:12px;padding:11px;min-width:0}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.head strong{font-size:13px}.personal-points form{display:grid;gap:10px}
.personal-points label{display:grid;gap:5px;font-size:12px;min-width:0}
.personal-points input:not([type=checkbox]),.personal-points select{min-height:44px;width:100%;min-width:0;max-width:100%;padding:9px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);font-size:16px;color:inherit}
.personal-points button{min-height:40px;border:1px solid var(--line,#ddd);border-radius:9px;padding:8px 10px;background:var(--card,#fff);font-size:12px;color:inherit}
.personal-points .check{display:flex;flex-direction:row;align-items:center;gap:8px}
.hint{font-size:11px;line-height:1.6;color:var(--muted,#777);margin:0}
.error{font-size:12px;color:#b63348;overflow-wrap:anywhere}
.history{display:flex;justify-content:space-between;gap:7px;flex-wrap:wrap;padding:7px;border-top:1px solid var(--line,#ddd);font-size:12px}
.history small{color:var(--muted,#777)}
</style>