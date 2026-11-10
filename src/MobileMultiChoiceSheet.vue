<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
const props=defineProps({
  modelValue:{type:Array,default:()=>[]},
  options:{type:Array,default:()=>[]},
  label:{type:String,default:'複数選択'},
  placeholder:{type:String,default:'選択してください'},
  disabled:{type:Boolean,default:false},
  columns:{type:Number,default:4}
})
const emit=defineEmits(['update:modelValue'])
const open=ref(false),draft=ref([]),trigger=ref(null),panel=ref(null)
const sheetId='multi-choice-'+Math.random().toString(36).slice(2)
const selectedText=computed(()=>{
  const labels=props.options.filter(item=>props.modelValue.map(Number).includes(Number(item.value))).map(x=>x.label)
  return labels.length?labels.join('・'):props.placeholder
})
let previousOverflow=''
let previousFocus=null
function start(){
  if(props.disabled)return
  draft.value=[...props.modelValue].map(Number)
  previousFocus=document.activeElement
  open.value=true
}
function toggle(value){
  const n=Number(value)
  draft.value=draft.value.includes(n)?draft.value.filter(x=>x!==n):[...draft.value,n].sort((a,b)=>a-b)
}
function close(){
  open.value=false
  // Never retain uncommitted selections after Done, Cancel, backdrop or Escape.
  draft.value=[]
  nextTick(()=>{if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});else trigger.value?.focus({preventScroll:true})})
}
function commit(){
  if(!draft.value.length)return
  emit('update:modelValue',[...draft.value])
  close()
}
function keydown(e){
  if(!open.value)return
  if(e.key==='Escape'){e.preventDefault();close();return}
  if(e.key!=='Tab')return
  const elements=[...(panel.value?.querySelectorAll('button:not(:disabled)')||[])]
  if(!elements.length)return
  const first=elements[0],last=elements.at(-1)
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  else if(!panel.value?.contains(document.activeElement)){e.preventDefault();first.focus()}
}
watch(open,async active=>{
  if(active){
    previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    document.addEventListener('keydown',keydown)
    await nextTick();panel.value?.querySelector('button')?.focus({preventScroll:true})
  }else{
    document.body.style.overflow=previousOverflow
    document.removeEventListener('keydown',keydown)
  }
})
onBeforeUnmount(()=>{if(open.value)document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',keydown)})
</script>
<template>
  <button ref="trigger" type="button" class="multi-choice-trigger" :disabled="disabled"
    :aria-label="label+'：'+selectedText" aria-haspopup="dialog" :aria-expanded="open"
    :aria-controls="sheetId" @click="start">
    <span>{{selectedText}}</span><span aria-hidden="true">⌄</span>
  </button>
  <Teleport to="body">
    <div v-if="open" class="multi-choice-overlay" @click.self="close">
      <section :id="sheetId" ref="panel" class="multi-choice-panel" role="dialog" aria-modal="true" :aria-label="label">
        <span class="multi-choice-handle" aria-hidden="true"></span>
        <div class="multi-choice-title"><h2>{{label}}</h2><button type="button" @click="close">閉じる</button></div>
        <p class="multi-choice-help">複数選択できます。選択した日ごとに記帳します。</p>
        <div class="multi-choice-options" role="group" :aria-label="label"
          :style="{'--multi-columns':columns}">
          <button v-for="item in options" :key="item.value" type="button" :class="{selected:draft.includes(Number(item.value))}"
            :aria-pressed="draft.includes(Number(item.value))" @click="toggle(item.value)">{{item.label}}</button>
        </div>
        <div class="multi-choice-footer">
          <span>{{draft.length}}件選択</span>
          <button type="button" class="multi-choice-done" :disabled="!draft.length" @click="commit">決定</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.multi-choice-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;min-height:44px;border:1px solid var(--line,#dedfe7);border-radius:10px;padding:9px 12px;background:var(--card,#fff);color:var(--ink,#242832);font:inherit;font-size:16px;text-align:left}
.multi-choice-trigger span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.multi-choice-overlay{position:fixed;inset:0;z-index:2147483601;background:rgba(18,21,29,.45);display:flex;align-items:flex-end;justify-content:center;overscroll-behavior:contain}
.multi-choice-panel{box-sizing:border-box;width:min(100%,600px);max-height:88dvh;overflow-y:auto;border-radius:22px 22px 0 0;background:var(--card,#fff);color:var(--ink,#242832);padding:10px 16px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -12px 40px #0002}
.multi-choice-handle{display:block;width:38px;height:5px;border-radius:99px;background:var(--line,#ddd);margin:0 auto 14px}
.multi-choice-title{display:flex;align-items:center;justify-content:space-between;gap:8px}
.multi-choice-title h2{font-size:17px;margin:0;font-weight:750}
.multi-choice-title>button{border:0;border-radius:10px;min-height:44px;padding:8px 12px;background:var(--tint,#f2f2f7);color:var(--ink,#242832);font:inherit}
.multi-choice-help{font-size:13px;color:var(--muted,#747882);margin:10px 0}
.multi-choice-options{display:grid;grid-template-columns:repeat(var(--multi-columns),minmax(0,1fr));gap:7px}
.multi-choice-options>button{border:1px solid var(--line,#ddd);border-radius:11px;min-width:0;min-height:46px;padding:8px 3px;background:var(--card,#fff);color:var(--ink,#242832);font:inherit;font-weight:650;font-size:14px}
.multi-choice-options>button.selected{background:var(--tint,#f9ecf2);border-color:var(--blue,#d36c93);color:var(--blue-dark,#b64b79)}
.multi-choice-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px;color:var(--muted,#777);font-size:14px}
.multi-choice-footer .multi-choice-done{min-width:130px;min-height:48px;border:0;border-radius:12px;background:var(--blue,#ce6792);color:#fff;font:inherit;font-weight:750}
.multi-choice-footer .multi-choice-done:disabled{opacity:.4}
@media(max-width:360px){.multi-choice-options{gap:5px}.multi-choice-options>button{font-size:13px}}
</style>