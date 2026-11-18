<script setup>
import {computed,ref,watch,onMounted} from 'vue'
import CardUsageSummaryFields from './CardUsageSummaryFields.vue'
const props=defineProps({
 userId:{type:String,required:true},
 active:{type:Boolean,default:false},
 revision:{type:Number,default:0}
})
const month=ref(new Date(Date.now()+32400000).toISOString().slice(0,7))
const rows=ref([]),selectedKey=ref(''),busy=ref(false),error=ref(''),loaded=ref(false)
let epoch=0
const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
const selected=computed(()=>rows.value.find(item=>item.key===selectedKey.value)||null)
const options=computed(()=>[{value:'',label:'カードを選択'},
 ...rows.value.map(item=>({value:item.key,label:item.label+(item.is_archived?'（アーカイブ済み）':'')}))])
async function load(){
 if(!props.active||busy.value)return
 const actor=props.userId,ticket=++epoch,requestedMonth=month.value
 busy.value=true;error.value=''
 try{
  const res=await fetch('/api/family-finance/member-card-usage?month='+encodeURIComponent(requestedMonth),{
   credentials:'same-origin',cache:'no-store'})
  const body=await res.json().catch(()=>({}))
  if(!res.ok||body.ok!==true||body.viewer_user_id!==actor||
    body.month!==requestedMonth||body.scope!=='personal-card-usage'||
    !Array.isArray(body.items)||body.items.some(x=>x.scope!=='personal'||x.owner_user_id!==actor))
   throw Error(body.code||'カード利用額を確認できません')
  if(ticket!==epoch||actor!==props.userId||requestedMonth!==month.value)return
  rows.value=body.items
  if(!rows.value.some(item=>item.key===selectedKey.value))selectedKey.value=''
  loaded.value=true
 }catch(e){
  if(ticket===epoch&&actor===props.userId){
   rows.value=[];selectedKey.value='';loaded.value=false;error.value=e.message
  }
 }finally{if(ticket===epoch)busy.value=false}
}
watch(()=>[props.userId,props.active,props.revision,month.value],(_,previous)=>{
 epoch++;busy.value=false
 if(!previous||previous[0]!==props.userId||previous[3]!==month.value){
  rows.value=[];selectedKey.value='';loaded.value=false;error.value=''
 }
 if(props.active)void load()
})
onMounted(()=>{if(props.active)void load()})
</script>
<template>
 <article class="member-card-usage finance-panel card-billing-panel" aria-label="カード別利用額">
  <h2>カード別利用額</h2>
  <CardUsageSummaryFields :card="selectedKey" :month="month"
   :card-options="options" :amount="loaded&&selected?yen(selected.amount_jpy):'—'"
   @update:card="selectedKey=$event" @update:month="month=$event" />
  <p v-if="error" role="alert" class="card-usage-error">{{error}}</p>
  <p v-else-if="selected" class="card-billing-period">{{selected.period.start}} ～ {{selected.period.end}} · {{selected.count}}件</p>
  <details v-if="selected?.entries?.length" class="member-card-usage-detail">
   <summary>明細を見る</summary>
   <div v-for="entry in selected.entries" :key="entry.id" class="member-card-usage-entry">
    <span>{{entry.date}} · {{entry.merchant||entry.category}}</span><strong>{{yen(entry.amount)}}</strong>
   </div>
   <p v-if="selected.truncated" class="card-billing-period">先頭200件を表示しています。</p>
  </details>
 </article>
</template>
<style scoped>
.member-card-usage{display:grid;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;min-width:0}
.card-billing-period,.card-usage-error{margin:0;font-size:12px;color:var(--muted)}
.card-usage-error{color:#b33b49}
.member-card-usage-detail summary{cursor:pointer;font-size:13px;font-weight:700}
.member-card-usage-entry{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--line);padding:9px 0;font-size:12px}
.member-card-usage-entry>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.member-card-usage-entry strong{white-space:nowrap}
</style>
