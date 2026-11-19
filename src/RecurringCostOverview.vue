<script setup>
defineProps({
 title:{type:String,required:true},
 kind:{type:String,default:'fixed'},
 count:{type:Number,default:0},
 primaryLabel:{type:String,required:true},
 primaryValue:{type:String,required:true},
 secondaryLabel:{type:String,required:true},
 secondaryValue:{type:String,required:true},
 note:{type:String,default:''},
 addLabel:{type:String,required:true}
})
const emit=defineEmits(['add'])
</script>
<template>
 <section class="recurring-overview" :class="'is-'+kind">
  <div class="recurring-overview-heading">
   <div class="recurring-overview-heading-copy">
    <span class="recurring-overview-eyebrow">固定費の管理</span>
    <h2>{{title}}</h2>
   </div>
   <span class="recurring-overview-badge">{{count}}件登録</span>
  </div>
  <div class="recurring-overview-metrics">
   <div class="recurring-overview-metric">
    <span>{{primaryLabel}}</span>
    <strong>{{primaryValue}}</strong>
   </div>
   <div class="recurring-overview-metric">
    <span>{{secondaryLabel}}</span>
    <strong>{{secondaryValue}}</strong>
   </div>
  </div>
  <p v-if="note" class="recurring-overview-note">{{note}}</p>
  <button class="recurring-overview-add" type="button" @click="emit('add')"><span aria-hidden="true">＋</span>{{addLabel}}</button>
 </section>
</template>
<style scoped>
.recurring-overview{display:grid;gap:13px;min-width:0;padding:16px;border:1px solid var(--line);border-radius:17px;background:var(--card);box-shadow:0 3px 14px color-mix(in srgb,var(--ink) 5%,transparent)}
.recurring-overview-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.recurring-overview-heading-copy{min-width:0}
.recurring-overview-eyebrow{font-size:11px;letter-spacing:.03em;color:var(--muted)}
.recurring-overview-heading h2{margin:2px 0 0;font-size:19px;line-height:1.3;font-weight:800;color:var(--ink)}
.recurring-overview-badge{flex:none;font-size:12px;font-weight:750;color:var(--blue-dark);background:var(--tint);padding:6px 9px;border-radius:99px}
.recurring-overview-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.recurring-overview-metric{display:grid;align-content:center;gap:5px;min-width:0;padding:12px 10px;border-radius:12px;background:var(--tint);border:1px solid var(--line)}
.recurring-overview-metric span{color:var(--muted);font-size:11px}
.recurring-overview-metric strong{color:var(--ink);font-size:clamp(15px,4.3vw,21px);line-height:1.3;font-weight:800;overflow-wrap:anywhere}
.recurring-overview-note{font-size:11px;line-height:1.5;color:var(--muted);margin:0}
.recurring-overview-add{display:flex;align-items:center;justify-content:center;gap:5px;width:100%;min-height:46px;border-radius:12px;background:var(--blue-dark);border:1px solid var(--blue-dark);color:#fff;font-size:14px;font-weight:750;cursor:pointer}
.recurring-overview-add span{font-size:19px;line-height:1}
.recurring-overview-add:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
@media(max-width:355px){.recurring-overview{padding:12px}.recurring-overview-metric{padding:10px 7px}}
</style>