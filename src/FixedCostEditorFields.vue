<script setup>
import AmountInput from './AmountInput.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import MobileMultiChoiceSheet from './MobileMultiChoiceSheet.vue'
import {WEEKDAYS_JA,recurringFrequencyLabel} from './recurring-posting.js'
const props=defineProps({
 model:{type:Object,required:true},
 cycleChoice:{type:String,required:true},
 cycleOptions:{type:Array,required:true},
 categories:{type:Array,default:()=>[]},
 paymentChoices:{type:Array,default:()=>[]},
 categoryLabel:{type:Function,default:x=>x},
 member:{type:Boolean,default:false}
})
const emit=defineEmits(['update:cycleChoice'])
</script>
<template>
 <div class="fixed-cost-common-fields">
  <div class="recurring-form-layout">
   <label class="recurring-form-field recurring-form-name"><span>名称</span>
    <input v-model="model.name" placeholder="例：家賃" aria-label="固定費名" maxlength="120"/></label>
   <label class="recurring-form-field"><span>カテゴリ</span>
    <MobileChoiceSheet v-model="model.category" label="固定費カテゴリ"
     :options="[{value:'',label:'選択してください'},...categories.map(category=>({value:category,label:categoryLabel(category)}))]"/></label>
   <label class="recurring-form-field"><span>支払方法</span>
    <MobileChoiceSheet v-model="model.paymentSource" label="固定費支払方法" :options="paymentChoices"/></label>
   <h3 class="recurring-form-section-title">金額と記帳周期</h3>
   <div class="recurring-form-field recurring-form-amount"><span>金額</span>
    <AmountInput v-model="model.amount" input-label="固定費額（円）"/></div>
   <div class="recurring-form-field recurring-form-schedule"><span>周期</span>
    <MobileChoiceSheet :model-value="cycleChoice" label="記帳周期" :searchable="false"
     :options="cycleOptions" @update:model-value="emit('update:cycleChoice',$event)"/></div>
   <div v-if="model.scheduleType==='monthly'" class="recurring-form-field recurring-form-schedule">
    <span>{{model.intervalMonths===12?'毎年の記帳日':'記帳日（複数選択可）'}}</span>
    <MobileMultiChoiceSheet v-model="model.monthDays" label="記帳する日付" :columns="5"
     :options="Array.from({length:31},(_,i)=>({value:i+1,label:(i+1)+'日'}))"/>
    <small v-if="model.intervalMonths>1">開始月を基準に{{model.intervalMonths}}か月ごとに記帳します。</small>
   </div>
   <div v-else-if="model.scheduleType==='weekly'" class="recurring-form-field recurring-form-schedule">
    <span>曜日（複数選択可）</span>
    <MobileMultiChoiceSheet v-model="model.weekdays" label="記帳する曜日" :columns="4"
     :options="WEEKDAYS_JA.map((name,index)=>({value:index,label:name+'曜日'}))"/>
   </div>
   <h3 class="recurring-form-section-title">開始日と記帳方法</h3>
   <label class="recurring-form-field recurring-start-month"><span>開始月</span>
    <input v-model="model.startMonth" type="month" aria-label="固定費の適用開始月"/></label>
  </div>
  <fieldset class="recurring-posting-mode">
   <legend>記帳方法</legend>
   <label :class="{selected:model.postingMode==='auto',unavailable:member}">
    <input v-model="model.postingMode" type="radio" value="auto"
     name="recurring-posting-mode" :disabled="member"/><span>自動記帳</span></label>
   <label :class="{selected:model.postingMode==='manual'}">
    <input v-model="model.postingMode" type="radio" value="manual"
     name="recurring-posting-mode"/><span>確認して記帳</span></label>
  </fieldset>
  <p v-if="!member" class="recurring-posting-hint">{{model.postingMode==='auto'
    ? (model.scheduleType==='workday'?'土日・祝日を除く日に、自動で支出明細に登録します。':
       recurringFrequencyLabel(model)+'になると、自動で支出明細に登録します。')
    :'予定日以降、内容を確認してから支出明細に登録します。'}}</p>
 </div>
</template>
<style scoped>
.fixed-cost-common-fields{display:grid;gap:6px;min-width:0}
.recurring-form-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:9px;margin:0 0 6px}
.recurring-form-field{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:100%;font-size:12px;font-weight:700;color:var(--muted)}
.recurring-form-field>span:first-child{font-size:12px;font-weight:700}
.recurring-form-field input{max-width:100%;min-width:0;width:100%;box-sizing:border-box;font-size:16px;min-height:44px;border-radius:11px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 12px}
/* Keep the native iOS month picker inside the SAME one-column grid width as
   category/payment controls. This must live in the child SFC's own scoped CSS:
   parent FinanceTools scoped selectors cannot style the child's input. */
.recurring-start-month{
 display:grid;
 grid-template-columns:minmax(0,1fr);
 gap:4px;
 width:100%;
 min-width:0;
 max-width:100%;
 min-inline-size:0;
 max-inline-size:100%;
 box-sizing:border-box;
 overflow:hidden;
}
.recurring-start-month input[type="month"]{
 display:inline-flex;
 align-items:center;
 justify-self:stretch;
 inline-size:100%!important;
 width:100%!important;
 min-inline-size:0!important;
 max-inline-size:100%!important;
 min-width:0!important;
 max-width:100%!important;
 box-sizing:border-box!important;
 margin:0!important;
 padding:0 12px!important;
 overflow:hidden;
 -webkit-appearance:none;
 appearance:none;
}
.recurring-start-month input[type="month"]::-webkit-date-and-time-value{
 min-width:0;
 max-width:100%;
 text-align:left;
}
.recurring-start-month input[type="month"]::-webkit-datetime-edit{
 min-width:0;
}
.recurring-start-month input[type="month"]::-webkit-calendar-picker-indicator{
 flex:none;
 max-width:18px;
 margin:0;
 padding:0;
}
.recurring-posting-mode{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:2px 0 0;padding:0;border:0;min-width:0}
.recurring-posting-mode legend{font-size:12px;font-weight:700;margin-bottom:8px;color:var(--muted)}
.recurring-posting-mode label{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line);border-radius:10px;min-height:44px;padding:6px 8px;box-sizing:border-box;min-width:0;font-size:12px;font-weight:700;color:var(--ink);cursor:pointer;white-space:nowrap}
.recurring-posting-mode label.selected{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 9%,var(--card))}
.recurring-posting-mode label.unavailable{opacity:.5}
.recurring-posting-mode input[type=radio]{appearance:auto;flex:none;accent-color:var(--blue);width:16px!important;height:16px!important;margin:0;padding:0!important}
.recurring-posting-hint{margin:5px 0 7px;font-size:12px;line-height:1.55;color:var(--muted);overflow-wrap:anywhere}
</style>
