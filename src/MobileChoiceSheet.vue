<script>
let choiceId=0
</script>
<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { filterJapaneseChoices } from './japanese-choice-search.js'
// Short tabs and native date/time pickers are intentionally not replaced.
const props=defineProps({
  modelValue:{type:[String,Number],default:''},
  options:{type:Array,default:()=>[]},
  label:{type:String,default:'選択'},
  placeholder:{type:String,default:'選択してください'},
  disabled:{type:Boolean,default:false},
  searchable:{type:Boolean,default:null},
  searchPlaceholder:{type:String,default:'日本語で検索'}
})
const emit=defineEmits(['update:modelValue','change'])
const open=ref(false)
const query=ref('')
const trigger=ref(null)
const closeAction=ref(null)
const gestureStart=ref(null)
const sheetId='mobile-choice-'+(++choiceId)
const items=computed(()=>props.options.map(x=>typeof x==='string'||typeof x==='number'
  ? {value:x,label:String(x)}
  : {value:x.value,label:String(x.label??x.value),keywords:x.keywords||[]}))
const selected=computed(()=>items.value.find(o=>String(o.value)===String(props.modelValue)))
const visible=computed(()=>filterJapaneseChoices(items.value,query.value))
const showSearch=computed(()=>props.searchable===null?items.value.length>10:props.searchable)
const themeVars=ref({})
let previousOverflow=''
function keydown(event){
  if(!open.value)return
  if(event.key==='Escape'){event.preventDefault();close();return}
  if(event.key!=='Tab')return
  // Keep keyboard and VoiceOver navigation inside the active bottom-sheet.
  const root=document.getElementById(sheetId)
  const controls=[...(root?.querySelectorAll('button:not(:disabled),input:not(:disabled)')||[])]
    .filter(el=>el.getClientRects().length)
  if(!controls.length){event.preventDefault();return}
  const first=controls[0],last=controls.at(-1)
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  else if(!root?.contains(document.activeElement)){event.preventDefault();first.focus()}
}
function begin(){
  if(props.disabled||open.value)return
  query.value=''
  const css=getComputedStyle(trigger.value)
  const vars=['--card','--ink','--muted','--line','--blue','--blue-dark','--tint']
  themeVars.value=Object.fromEntries(vars.map(k=>[k,css.getPropertyValue(k).trim()]).filter(x=>x[1]))
  open.value=true
}
function close(){
  open.value=false
  query.value=''
  nextTick(()=>trigger.value?.focus({preventScroll:true}))
}
function pick(item){
  emit('update:modelValue',item.value)
  emit('change',item.value)
  close()
}
function touchStart(event){gestureStart.value=event.changedTouches?.[0]?.clientY??null}
function touchEnd(event){
  if(gestureStart.value===null)return
  const distance=(event.changedTouches?.[0]?.clientY??0)-gestureStart.value
  gestureStart.value=null
  if(distance>70)close()
}
watch(open,(isOpen)=>{
  if(isOpen){
    previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    document.addEventListener('keydown',keydown)
    nextTick(()=>closeAction.value?.focus({preventScroll:true}))
  }else{
    document.body.style.overflow=previousOverflow
    document.removeEventListener('keydown',keydown)
  }
})
onBeforeUnmount(()=>{
  if(open.value)document.body.style.overflow=previousOverflow
  document.removeEventListener('keydown',keydown)
})
</script>

<template>
  <button ref="trigger" type="button" class="mobile-choice-trigger"
    :class="{ 'is-empty':!selected }" :disabled="disabled"
    :aria-label="label+'：'+(selected?.label||placeholder)"
    aria-haspopup="dialog" :aria-expanded="open" :aria-controls="sheetId"
    @click="begin">
    <span class="mobile-choice-selected">{{selected?.label||placeholder}}</span>
    <svg class="mobile-choice-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
  </button>
  <Teleport to="body">
    <Transition name="mobile-choice-transition">
      <div v-if="open" class="mobile-choice-backdrop" :style="themeVars" @click.self="close">
        <section :id="sheetId" class="mobile-choice-sheet" role="dialog" aria-modal="true"
          :aria-label="label">
          <div class="mobile-choice-handle-area" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
            <span class="mobile-choice-handle" aria-hidden="true"></span>
          </div>
          <div class="mobile-choice-heading">
            <h2>{{label}}</h2>
            <button ref="closeAction" type="button" class="mobile-choice-close" aria-label="閉じる" @click="close">閉じる</button>
          </div>
          <div v-if="showSearch" class="mobile-choice-search">
            <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" aria-hidden="true"><circle cx="10.8" cy="10.8" r="7.2"/><path d="m16 16 5 5"/></svg>
            <input v-model="query" type="search" inputmode="search" enterkeyhint="search"
              autocomplete="off" :placeholder="searchPlaceholder" :aria-label="label+'を日本語で検索'" />
          </div>
          <div class="mobile-choice-list" role="listbox" :aria-label="label">
            <button v-for="(item,i) in visible" :key="String(item.value)+'-'+i" type="button"
              class="mobile-choice-option" role="option"
              :aria-selected="String(item.value)===String(modelValue)" @click="pick(item)">
              <span>{{item.label}}</span>
              <svg v-if="String(item.value)===String(modelValue)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>
            </button>
            <p v-if="!visible.length" class="mobile-choice-empty" role="status">該当する項目がありません</p>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-choice-trigger{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;max-width:100%;min-width:0;min-height:44px;border:1px solid var(--line,#dedfe7);border-radius:10px;padding:9px 12px;background:var(--card,#fff);color:var(--ink,#232631);font:inherit;font-size:16px;text-align:left;cursor:pointer}
.mobile-choice-trigger.is-empty{color:var(--muted,#737985)}
.mobile-choice-trigger:disabled{opacity:.55;cursor:not-allowed}
.mobile-choice-selected{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.mobile-choice-chevron{width:17px;height:17px;flex:none;opacity:.65}
.mobile-choice-trigger:focus-visible{outline:2px solid var(--blue,#6989bc);outline-offset:2px}
.mobile-choice-backdrop{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:flex-end;justify-content:center;background:rgba(18,21,29,.44);overscroll-behavior:contain}
.mobile-choice-sheet{box-sizing:border-box;width:min(100%,600px);max-height:min(85dvh,740px);display:flex;flex-direction:column;overflow:hidden;border-radius:22px 22px 0 0;background:var(--card,#fff);color:var(--ink,#232631);box-shadow:0 -12px 40px #0002;padding-bottom:env(safe-area-inset-bottom,0px)}
.mobile-choice-handle-area{display:flex;justify-content:center;align-items:center;height:22px;flex:none;touch-action:pan-y}
.mobile-choice-handle{width:38px;height:5px;border-radius:99px;background:var(--line,#dde1e8)}
.mobile-choice-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 18px 12px;flex:none}
.mobile-choice-heading h2{font-size:17px;margin:0;font-weight:750}
.mobile-choice-close{border:0;background:var(--tint,#f0f2f7);color:var(--blue-dark,#4f6a9e);border-radius:11px;padding:9px 12px;min-height:44px;font:inherit;font-weight:700;cursor:pointer}
.mobile-choice-search{display:flex;align-items:center;gap:9px;margin:0 16px 10px;padding:0 12px;min-height:44px;border-radius:12px;background:var(--tint,#f4f5f8);border:1px solid var(--line,#e2e4e9);flex:none}
.mobile-choice-search svg{width:18px;height:18px;color:var(--muted,#777);flex:none}
.mobile-choice-search input{flex:1;min-width:0;width:100%;min-height:44px;padding:7px 0;outline:none;border:0;background:transparent;color:var(--ink,#252a30);font-size:16px;box-shadow:none;-webkit-appearance:none}
.mobile-choice-list{overflow-y:auto;overscroll-behavior:contain;min-height:0;max-height:100%;padding:0 12px 10px;-webkit-overflow-scrolling:touch}
.mobile-choice-option{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;padding:12px 10px;border:0;border-bottom:1px solid var(--line,#eceef2);background:transparent;color:var(--ink,#242832);font:inherit;font-size:15px;text-align:left;overflow-wrap:anywhere;cursor:pointer}
.mobile-choice-option[aria-selected=true]{font-weight:750;color:var(--blue-dark,#5278b6)}
.mobile-choice-option svg{flex:none;width:20px;height:20px}
.mobile-choice-empty{padding:32px 12px;text-align:center;color:var(--muted,#777);font-size:14px}
.mobile-choice-transition-enter-active,.mobile-choice-transition-leave-active{transition:opacity .2s}
.mobile-choice-transition-enter-active .mobile-choice-sheet,.mobile-choice-transition-leave-active .mobile-choice-sheet{transition:transform .2s}
.mobile-choice-transition-enter-from,.mobile-choice-transition-leave-to{opacity:0}
.mobile-choice-transition-enter-from .mobile-choice-sheet,.mobile-choice-transition-leave-to .mobile-choice-sheet{transform:translateY(100%)}
@media(prefers-reduced-motion:reduce){.mobile-choice-transition-enter-active,.mobile-choice-transition-leave-active,.mobile-choice-transition-enter-active .mobile-choice-sheet,.mobile-choice-transition-leave-active .mobile-choice-sheet{transition:none}}
</style>
