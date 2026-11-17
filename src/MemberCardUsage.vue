<script setup>
import {ref,watch,onMounted} from 'vue'
const props=defineProps({
 userId:{type:String,required:true},
 active:{type:Boolean,default:false},
 revision:{type:Number,default:0}
})
const month=ref(new Date(Date.now()+32400000).toISOString().slice(0,7))
const rows=ref([]),busy=ref(false),error=ref(''),loaded=ref(false)
let epoch=0
const yen=n=>'¥'+Number(n||0).toLocaleString('ja-JP')
async function load(){
 if(!props.active||busy.value)return
 const actor=props.userId,ticket=++epoch
 busy.value=true;error.value=''
 try{
  const res=await fetch('/api/family-finance/member-card-usage?month='+encodeURIComponent(month.value),{
   credentials:'same-origin',cache:'no-store'})
  const body=await res.json().catch(()=>({}))
  if(!res.ok||body.ok!==true||body.viewer_user_id!==actor||
    body.month!==month.value||body.scope!=='personal-and-own-shared-usage'||
    !Array.isArray(body.items)||body.items.some(x=>!['personal','shared-own-usage'].includes(x.scope)))
   throw Error(body.code||'カード利用額を確認できません')
  if(ticket!==epoch||actor!==props.userId)return
  rows.value=body.items;loaded.value=true
 }catch(e){if(ticket===epoch&&actor===props.userId)error.value=e.message}
 finally{if(ticket===epoch)busy.value=false}
}
watch(()=>[props.userId,props.active,props.revision,month.value],()=>{
 epoch++;busy.value=false
 if(props.active)void load()
})
onMounted(()=>{if(props.active)void load()})
</script>
<template>
 <article class="member-card-usage finance-panel" aria-label="カード別利用額">
  <div class="member-card-usage-head">
   <h2>カード別利用額</h2>
   <button type="button" :disabled="busy" @click="load">{{busy?'更新中…':'更新'}}</button>
  </div>
  <label class="member-card-usage-month">締め月 <input v-model="month" type="month" aria-label="カード利用額の締め月"/></label>
  <p v-if="error" role="alert" class="card-usage-error">{{error}}</p>
  <p v-if="!loaded&&!busy" class="card-usage-note">本人のカード利用額を読み込んでください。</p>
  <p v-if="loaded&&!rows.length" class="card-usage-note">利用可能なカードはまだありません。</p>
  <details v-for="item in rows" :key="item.key" class="member-card-usage-row">
   <summary>
    <span><strong>{{item.label}}</strong>
     <small>{{item.scope==='shared-own-usage'?'共有カード・本人利用分':'本人のクレジットカード'}} · {{item.period.start}} ～ {{item.period.end}}</small></span>
    <span class="usage-value">{{yen(item.amount_jpy)}} <small>{{item.count}}件</small></span>
   </summary>
   <p v-if="!item.entries.length" class="card-usage-note">この締め期間の利用記録はありません。</p>
   <div v-for="entry in item.entries" :key="entry.id" class="member-card-usage-entry">
    <span>{{entry.date}} · {{entry.merchant||entry.category}}</span><strong>{{yen(entry.amount)}}</strong>
   </div>
   <p v-if="item.truncated" class="card-usage-note">200件を超える場合は表示を省略しています。利用額は全件から計算しています。</p>
  </details>
  <p class="card-usage-note">承認後に実際に入帳された明細を集計。共有カードは本人が利用した分のみ表示し、管理者のカード全体の利用額・限度額は公開しません。ポイント充当・発行会社の請求額とは一致しない場合があります。</p>
 </article>
</template>
<style scoped>
.member-card-usage{display:grid;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;min-width:0}
.member-card-usage-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.member-card-usage-head h2{font-size:16px;margin:0}
.member-card-usage button{min-height:40px;padding:8px 12px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-weight:700}
.member-card-usage-month{display:flex;gap:10px;align-items:center;font-size:12px}
.member-card-usage-month input{min-width:0;padding:7px 8px;background:var(--card);color:inherit;border:1px solid var(--line);border-radius:9px}
.member-card-usage-row{border:1px solid var(--line);border-radius:10px;padding:9px;min-width:0}
.member-card-usage-row>summary{display:flex;justify-content:space-between;gap:8px;align-items:center;cursor:pointer}
.member-card-usage-row summary>span{min-width:0;display:grid;gap:3px}
.member-card-usage-row summary strong{font-size:13px}
.member-card-usage-row small{font-size:10px;color:var(--muted)}
.usage-value{text-align:right;white-space:nowrap;font-weight:700}
.member-card-usage-entry{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid var(--line);padding:8px 0;font-size:12px}
.member-card-usage-entry>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}
.member-card-usage-entry strong{white-space:nowrap}
.card-usage-note{font-size:11px;color:var(--muted);line-height:1.5;margin:2px 0}
.card-usage-error{font-size:12px;color:#b33b49}
</style>
