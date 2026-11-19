<script setup>
import {ref,computed,watch} from 'vue'
import MobileChoiceSegments from './MobileChoiceSegments.vue'
import {recurringFrequencyLabel,recurringDatesForPlanInMonth} from './recurring-posting.js'
const props=defineProps({
 items:{type:Array,default:()=>[]},
 busy:{type:Boolean,default:false},
 yen:{type:Function,required:true},
 categoryLabel:{type:Function,default:s=>s},
 paymentLabel:{type:Function,default:s=>s},
 nextLabel:{type:Function,default:()=>''},
 currentCount:{type:Number,default:null},
 monthlyTotal:{type:Number,default:null},
 allowDelete:{type:Boolean,default:true},
 allowPost:{type:Boolean,default:false},
 defaultOpen:{type:Boolean,default:false},
 compactHeader:{type:Boolean,default:false}
})
const emit=defineEmits(['edit','toggle','remove','post'])
const query=ref(''),filter=ref('all'),showAll=ref(false),expanded=ref('')
const filtered=computed(()=>{
 const search=query.value.trim().toLocaleLowerCase('ja-JP')
 return props.items.filter(item=>
  (filter.value==='all'||(filter.value==='active'?item.enabled:!item.enabled))&&
  (!search||String(item.name||'').toLocaleLowerCase('ja-JP').includes(search)))
})
const visible=computed(()=>showAll.value?filtered.value:filtered.value.slice(0,5))
const monthNow=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7)
const activeCount=computed(()=>props.currentCount??props.items.filter(p=>p.enabled).length)
const total=computed(()=>props.monthlyTotal??props.items.filter(p=>p.enabled).reduce((sum,p)=>{
 try{return sum+Number(p.amount||0)*recurringDatesForPlanInMonth(p,monthNow()).length}
 catch{return sum}
},0))
watch([query,filter],()=>{showAll.value=false;expanded.value=''})
</script>
<template>
 <article class="finance-panel recurring-plans-panel">
  <details class="recurring-list-disclosure" :open="defaultOpen">
   <summary class="recurring-list-summary">
    <span class="recurring-list-summary-title">登録済みの固定費 <strong>{{items.length}}件</strong></span>
    <span v-if="!compactHeader" class="recurring-list-summary-total">今月対象 {{activeCount}}件 · 今月予定額 {{yen(total)}}</span>
   </summary>
   <div class="recurring-list-body">
    <div class="recurring-list-filters">
     <input v-model="query" type="search" placeholder="名前で検索" aria-label="固定費を検索"/>
     <MobileChoiceSegments v-model="filter" label="固定費の状態"
      :options="[{value:'all',label:'すべて'},{value:'active',label:'有効'},{value:'stopped',label:'停止中'}]"/>
    </div>
    <div v-if="!filtered.length" class="recurring-list-empty">{{items.length?'該当する固定費はありません':'固定費はまだありません'}}</div>
    <div v-else id="recurring-plan-list" class="recurring-plan-scroll" :class="{'is-expanded':showAll}" role="list" aria-label="固定費一覧">
     <div v-for="p in visible" :key="p.id" class="recurring-plan-item" role="listitem">
      <button type="button" class="recurring-plan-toggle"
       :aria-expanded="expanded===p.id" :aria-controls="'recurring-plan-actions-'+p.id"
       @click="expanded=expanded===p.id?'':p.id">
       <span class="recurring-plan-name" :title="p.name">{{p.name}}</span>
       <span class="recurring-plan-amount">{{yen(p.amount)}}</span>
       <span class="recurring-plan-chevron" aria-hidden="true">{{expanded===p.id?'⌃':'⌄'}}</span>
       <span class="recurring-plan-meta">
        <span class="recurring-plan-meta-item">{{recurringFrequencyLabel(p)}}</span>
        <span class="recurring-plan-meta-item recurring-payment-source" :title="paymentLabel(p.paymentSource)||'未設定'">{{paymentLabel(p.paymentSource)||'未設定'}}</span>
        <span class="recurring-plan-meta-item">開始 {{p.startMonth?.replace('-','/')||'未設定'}}</span>
        <span class="recurring-plan-meta-item">{{p.postingMode==='auto'?'自動記帳':'確認して記帳'}}</span>
        <span v-if="nextLabel(p)" class="recurring-plan-meta-item">{{nextLabel(p)}}</span>
       </span>
      </button>
      <div v-if="expanded===p.id" :id="'recurring-plan-actions-'+p.id" class="recurring-plan-more">
       <span class="recurring-plan-category">{{categoryLabel(p.category)}} · {{p.enabled?'有効':'停止中'}}</span>
       <div class="recurring-plan-actions">
        <button type="button" :disabled="busy" @click="emit('edit',p)">編集</button>
        <button type="button" :disabled="busy" @click="emit('toggle',p)">{{p.enabled?'停止':'再開'}}</button>
        <button v-if="allowDelete" type="button" :disabled="busy" @click="emit('remove',p)">削除</button>
        <button v-if="allowPost&&p.enabled" type="button" :disabled="busy" @click="emit('post',p)">記帳を申請</button>
       </div>
      </div>
     </div>
    </div>
    <button v-if="filtered.length>5" type="button" class="recurring-list-more"
     :aria-expanded="showAll" aria-controls="recurring-plan-list" @click="showAll=!showAll">
     {{showAll?'折りたたむ':'もっと見る'}}
    </button>
   </div>
  </details>
 </article>
</template>
<style scoped>
.finance-panel{min-width:0;padding:12px;border:1px solid var(--line);background:var(--card);border-radius:15px}
.recurring-list-disclosure{min-width:0}
.recurring-list-summary{display:grid;grid-template-columns:minmax(0,1fr) 18px;grid-template-rows:auto auto;gap:4px;cursor:pointer;list-style:none;align-items:center}
.recurring-list-summary::-webkit-details-marker{display:none}
.recurring-list-summary:after{content:'⌄';grid-column:2;grid-row:1;text-align:center;color:var(--muted)}
details[open]>.recurring-list-summary:after{content:'⌃'}
.recurring-list-summary-title{font-size:16px;font-weight:750}
.recurring-list-summary-total{grid-column:1/-1;grid-row:2;font-size:12px;color:var(--muted)}
.recurring-list-body{display:grid;gap:10px;padding-top:12px;min-width:0}
.recurring-list-filters{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.recurring-list-filters input{min-width:0;font-size:14px;min-height:44px}
.recurring-plan-scroll{display:grid;gap:7px}
.recurring-plan-item{border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0}
.recurring-plan-toggle{width:100%;border:0;background:var(--card);color:var(--ink);display:grid;grid-template-columns:minmax(0,1fr) auto 18px;grid-template-rows:auto auto;gap:4px 8px;align-items:center;text-align:left;min-height:55px;padding:10px 12px}
.recurring-plan-name{font-size:13px;font-weight:750;overflow-wrap:anywhere}
.recurring-plan-amount{font-weight:800;font-size:13px;white-space:nowrap}
.recurring-plan-chevron{color:var(--muted);font-size:14px;text-align:center}
.recurring-plan-meta{grid-column:1/-1;grid-row:2;display:flex;gap:5px 10px;flex-wrap:wrap;min-width:0}
.recurring-plan-meta-item{font-size:11px;color:var(--muted);white-space:nowrap}
.recurring-payment-source{overflow:hidden;text-overflow:ellipsis;max-width:100%}
.recurring-plan-more{padding:10px 12px;border-top:1px solid var(--line);display:grid;gap:8px}
.recurring-plan-category{font-size:12px;color:var(--muted)}
.recurring-plan-actions{display:flex;gap:6px;flex-wrap:wrap}
.recurring-plan-actions button{min-height:40px;padding:7px 12px;background:var(--card);border:1px solid var(--line);border-radius:9px;color:var(--blue-dark);font-size:12px;font-weight:750}
.recurring-list-more{min-height:44px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--blue-dark);font-weight:750}
.recurring-list-empty{font-size:12px;color:var(--muted);padding:12px;text-align:center}

</style>
