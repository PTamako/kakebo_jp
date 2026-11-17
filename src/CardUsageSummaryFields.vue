<script setup>
import MobileChoiceSheet from './MobileChoiceSheet.vue'

// Single card-usage form for both family members. The parent supplies only
// its authenticated card choices, month, and computed utilization value.
defineProps({
 card:{type:String,default:''},
 month:{type:String,default:''},
 amount:{type:String,default:'—'},
 cardOptions:{type:Array,default:()=>[]}
})
const emit=defineEmits(['update:card','update:month'])
</script>

<template>
 <div class="card-usage-summary" role="group" aria-label="カード別利用額の確認">
  <label class="card-usage-summary-field card-usage-summary-card">
   <span>カード</span>
   <MobileChoiceSheet :model-value="card" label="カード名" :options="cardOptions"
    @update:model-value="emit('update:card',$event)"/>
  </label>
  <label class="card-usage-summary-field card-usage-summary-month">
   <span>締め月</span>
   <input type="month" :value="month" aria-label="締め月"
    @input="emit('update:month',$event.target.value)"/>
  </label>
  <label class="card-usage-summary-field card-usage-summary-amount">
   <span>利用額</span>
   <output aria-live="polite">{{amount}}</output>
  </label>
 </div>
</template>

<style scoped>
.card-usage-summary{
 display:grid;
 grid-template-columns:repeat(2,minmax(0,1fr));
 align-items:end;
 gap:9px;
 width:100%;
 min-width:0;
}
.card-usage-summary-field,
.card-usage-summary .card-usage-summary-field{
 display:flex;
 flex-direction:column;
 justify-content:flex-end;
 gap:6px;
 min-width:0;
 max-width:100%;
 margin:0;
 color:var(--muted);
 font-size:12px;
 font-weight:500;
 line-height:1.3;
}
.card-usage-summary-card{grid-column:1/-1}
.card-usage-summary-month input,
.card-usage-summary-amount output{
 display:flex;
 align-items:center;
 box-sizing:border-box;
 width:100%;
 min-width:0;
 height:44px!important;
 min-height:44px!important;
 max-height:44px!important;
 margin:0;
 padding:0 8px;
 border:1px solid var(--line);
 border-radius:11px;
 background:var(--card);
 color:var(--ink);
 font-size:16px!important;
 font-family:inherit;
 line-height:normal;
 font-variant-numeric:tabular-nums;
}
.card-usage-summary-month input{
 appearance:none;
 -webkit-appearance:none;
 display:block;
}
.card-usage-summary-month input::-webkit-date-and-time-value{text-align:left;min-height:0}
.card-usage-summary-month input::-webkit-datetime-edit{padding:0;line-height:42px}
.card-usage-summary-month input::-webkit-calendar-picker-indicator{margin:0;max-width:16px;padding:0}
.card-usage-summary-amount output{
 font-weight:700;
 overflow:hidden;
 white-space:nowrap;
 text-overflow:ellipsis;
}
</style>
