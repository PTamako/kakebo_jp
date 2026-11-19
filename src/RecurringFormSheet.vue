<script>
// Shared by every instance: opening one cost form never unlocks another.
let activeLocks=0
let lastBodyOverflow=''
</script>
<script setup>
import {nextTick,onBeforeUnmount,ref,watch} from 'vue'
const props=defineProps({
 open:{type:Boolean,default:false},
 title:{type:String,required:true},
 subtitle:{type:String,default:''},
 busy:{type:Boolean,default:false}
})
const emit=defineEmits(['close'])
const panel=ref(null)
let scrollLocked=false
let previousFocus=null
// This component may be used by either cost tab; avoid releasing another sheet's scroll lock.
function lock(){
 if(scrollLocked || typeof document==='undefined')return
 scrollLocked=true
 if(activeLocks++===0){lastBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden'}
}
function unlock(){
 if(!scrollLocked || typeof document==='undefined')return
 scrollLocked=false
 activeLocks=Math.max(0,activeLocks-1)
 if(activeLocks===0)document.body.style.overflow=lastBodyOverflow
}
function requestClose(){if(!props.busy)emit('close')}
function keydown(event){
 if(document.querySelector('.mobile-choice-backdrop'))return
 if(event.key==='Escape'){event.preventDefault();requestClose();return}
 if(event.key!=='Tab')return
 const els=[...(panel.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')||[])]
   .filter(el=>el.getClientRects().length)
 if(!els.length)return
 const first=els[0],last=els.at(-1)
 if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus()}
 else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus()}
}
watch(()=>props.open,async open=>{
 if(open){
  previousFocus=document.activeElement
  lock()
  await nextTick()
  if(props.open)panel.value?.focus({preventScroll:true})
 }else{
  unlock()
  if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true})
  previousFocus=null
 }
},{immediate:true})
onBeforeUnmount(unlock)
</script>
<template>
 <Teleport to="body">
  <div v-if="open" class="recurring-sheet-backdrop" @click.self="requestClose" @keydown="keydown">
   <section ref="panel" class="recurring-sheet-panel" tabindex="-1" role="dialog" aria-modal="true" :aria-label="title">
    <div class="recurring-sheet-handle" aria-hidden="true"></div>
    <header class="recurring-sheet-heading">
     <div class="recurring-sheet-title">
      <h2>{{title}}</h2>
      <p v-if="subtitle">{{subtitle}}</p>
     </div>
     <button type="button" class="recurring-sheet-close" :disabled="busy" @click="requestClose" aria-label="フォームを閉じる">閉じる</button>
    </header>
    <div class="recurring-sheet-content"><slot /></div>
   </section>
  </div>
 </Teleport>
</template>
<style scoped>
.recurring-sheet-backdrop{position:fixed;inset:0;z-index:2147483100;display:flex;align-items:flex-end;justify-content:center;background:rgba(21,20,31,.42);overscroll-behavior:contain}
.recurring-sheet-panel{width:min(100%,620px);max-width:100vw;min-width:0;max-height:min(92dvh,840px);display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;border-radius:22px 22px 0 0;background:var(--card,#fff);color:var(--ink,#30303b);box-shadow:0 -18px 44px rgba(20,20,30,.18);outline:none;padding-bottom:env(safe-area-inset-bottom,0px)}
.recurring-sheet-handle{width:38px;height:5px;border-radius:99px;background:var(--line);align-self:center;flex:none;margin:10px 0 12px}
.recurring-sheet-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:0 18px 14px;border-bottom:1px solid var(--line);flex:none}
.recurring-sheet-title{min-width:0}
.recurring-sheet-title h2{margin:0;font-size:18px;line-height:1.4;font-weight:800}
.recurring-sheet-title p{margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--muted)}
.recurring-sheet-close{flex:none;min-height:40px;padding:8px 13px;border:1px solid var(--line);border-radius:11px;background:var(--tint);color:var(--ink);font-size:13px;font-weight:700}
.recurring-sheet-content{padding:17px 16px 22px;min-width:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;flex:1}
.recurring-sheet-content :deep(.recurring-editor-fields){display:grid;gap:13px;min-width:0;width:100%;max-width:100%;box-sizing:border-box}
.recurring-sheet-content :deep(.recurring-editor-fields label),
.recurring-sheet-content :deep(.recurring-form-field){min-width:0;max-width:100%;box-sizing:border-box;font-size:12px;font-weight:700;color:var(--muted);line-height:1.5}
.recurring-sheet-content :deep(.recurring-editor-fields label){display:grid;gap:5px}
.recurring-sheet-content :deep(.recurring-editor-fields input:not([type=checkbox]):not([type=radio])),
.recurring-sheet-content :deep(.recurring-editor-fields select),
.recurring-sheet-content :deep(.recurring-form-field input:not([type=checkbox]):not([type=radio])){display:block;inline-size:100%!important;width:100%!important;min-inline-size:0!important;min-width:0!important;max-inline-size:100%!important;max-width:100%!important;box-sizing:border-box!important;min-height:46px;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--ink);font-size:16px;padding:9px 12px}
.recurring-sheet-content :deep(.recurring-editor-fields input[type=date]),
.recurring-sheet-content :deep(.recurring-editor-fields input[type=month]),
.recurring-sheet-content :deep(.recurring-form-field input[type=date]),
.recurring-sheet-content :deep(.recurring-form-field input[type=month]){display:inline-flex!important;align-items:center;min-width:0!important;min-inline-size:0!important;max-width:100%!important;max-inline-size:100%!important;width:100%!important;inline-size:100%!important;box-sizing:border-box!important;overflow:hidden!important;padding:0 12px!important;-webkit-appearance:none;appearance:none}
.recurring-sheet-content :deep(input[type=date]::-webkit-date-and-time-value),
.recurring-sheet-content :deep(input[type=month]::-webkit-date-and-time-value){min-width:0!important;max-width:100%;text-align:left}
.recurring-sheet-content :deep(input[type=date]::-webkit-datetime-edit),
.recurring-sheet-content :deep(input[type=month]::-webkit-datetime-edit){min-width:0;max-width:100%;overflow:hidden}
.recurring-sheet-content :deep(input[type=date]::-webkit-calendar-picker-indicator),
.recurring-sheet-content :deep(input[type=month]::-webkit-calendar-picker-indicator){flex:none;max-width:22px;margin:0}
.recurring-sheet-content :deep(.recurring-date-pair){display:grid;grid-template-columns:minmax(0,1fr);gap:13px;min-width:0;width:100%}
.recurring-sheet-content :deep(.recurring-form-section-title){margin:9px 0 0;padding-bottom:7px;border-bottom:1px solid var(--line);font-size:13px;font-weight:800;color:var(--ink)}
.recurring-sheet-content :deep(.recurring-sheet-actions){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;position:sticky;bottom:-22px;padding:12px 0 10px;background:var(--card);z-index:2}
.recurring-sheet-content :deep(.recurring-sheet-actions button){min-width:0;min-height:46px;border:1px solid var(--line);border-radius:12px;background:var(--tint);color:var(--ink);font-size:13px;font-weight:750;padding:9px 8px}
.recurring-sheet-content :deep(.recurring-sheet-actions .primary){background:var(--blue-dark);border-color:var(--blue-dark);color:#fff}
.recurring-sheet-content :deep(.recurring-sheet-actions button:disabled){opacity:.5}
.recurring-sheet-content :deep(.recurring-manager-panel){border:0;border-radius:0;padding:0!important;background:transparent;box-shadow:none;display:grid;gap:12px;min-width:0}
.recurring-sheet-content :deep(.recurring-manager-panel h2){display:none}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-form-layout){display:grid;grid-template-columns:minmax(0,1fr);gap:13px;min-width:0}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-form-layout>*),
.recurring-sheet-content :deep(.recurring-manager-panel .fixed-cost-common-fields){min-width:0;max-width:100%}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-posting-mode){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));min-width:0}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-save-actions){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;position:sticky;bottom:-22px;padding:12px 0 10px;background:var(--card)}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-save-actions button){min-width:0;min-height:46px;border-radius:12px;font-size:13px;font-weight:750}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-save-actions button:first-child){background:var(--blue-dark);border-color:var(--blue-dark);color:#fff}
.recurring-sheet-content :deep(.recurring-manager-panel .recurring-save-actions button:last-child:not(:first-child)){background:var(--tint);color:var(--ink)}
.recurring-sheet-content :deep(.recurring-form-field .mobile-choice-trigger){width:100%;min-width:0;max-width:100%;box-sizing:border-box}
@media(min-width:680px){.recurring-sheet-panel{border-radius:22px;margin-bottom:14px;max-height:min(88dvh,840px)}}
@media(max-width:359px){.recurring-sheet-content{padding-inline:12px}.recurring-sheet-content :deep(.recurring-manager-panel .recurring-posting-mode){grid-template-columns:minmax(0,1fr)}}
</style>