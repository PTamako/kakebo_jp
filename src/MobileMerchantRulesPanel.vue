<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import {filterJapaneseChoices} from './japanese-choice-search.js'

const props=defineProps({
  rules:{type:Array,default:()=>[]},
  categories:{type:Array,default:()=>[]},
  paymentSources:{type:Array,default:()=>[]},
  categoryLabel:{type:Function,required:true},
  onSave:{type:Function,required:true}
})
const open=ref(false), trigger=ref(null), closeButton=ref(null)
const query=ref(''), limit=ref(8), activeKeyword=ref('')
const category=ref(''), payment=ref(''), saving=ref(false), error=ref('')
const themeStyle=ref({})
let previousOverflow='',handleStartY=null
function handleTouchStart(event){handleStartY=event.changedTouches?.[0]?.clientY??null}
function handleTouchEnd(event){
  if(handleStartY===null)return
  const distance=(event.changedTouches?.[0]?.clientY??0)-handleStartY
  handleStartY=null
  if(distance>75)closePanel()
}
const selected=computed(()=>props.rules.find(r=>r.keyword===activeKeyword.value))
const matching=computed(()=>filterJapaneseChoices(props.rules.map(r=>({
  ...r,value:r.keyword,label:[r.keyword,props.categoryLabel(r.category),r.payment_source].join(' '),
  keywords:[r.keyword,r.category,r.payment_source]
})),query.value))
const displayed=computed(()=>matching.value.slice(0,limit.value))
const categoryOptions=computed(()=>[
  {value:'',label:'ルールなし'},
  ...props.categories.map(value=>({value,label:props.categoryLabel(value)})),
  ...(category.value&&!props.categories.includes(category.value)?[{value:category.value,label:props.categoryLabel(category.value)}]:[])
])
const paymentOptions=computed(()=>[
  {value:'',label:'ルールなし'},
  ...props.paymentSources.map(value=>({value,label:value})),
  ...(payment.value&&!props.paymentSources.includes(payment.value)?[{value:payment.value,label:payment.value}]:[])
])
const hasChanges=computed(()=>selected.value&&(category.value!==selected.value.category||payment.value!==selected.value.payment_source))
function openPanel(){
  if(open.value)return
  const css=getComputedStyle(trigger.value)
  themeStyle.value=Object.fromEntries(['--card','--ink','--muted','--line','--blue','--blue-dark','--tint','--paper'].map(k=>[k,css.getPropertyValue(k).trim()]).filter(([,v])=>v))
  query.value='';limit.value=8;activeKeyword.value='';error.value='';open.value=true
}
function closePanel(){
  if(saving.value)return
  open.value=false
  activeKeyword.value=''
  error.value=''
  nextTick(()=>trigger.value?.focus({preventScroll:true}))
}
function edit(rule){
  activeKeyword.value=rule.keyword
  category.value=rule.category||''
  payment.value=rule.payment_source||''
  error.value=''
}
function back(){if(saving.value)return;activeKeyword.value='';error.value='';nextTick(()=>closeButton.value?.focus({preventScroll:true}))}
async function save(){
  if(!selected.value||!hasChanges.value||saving.value)return
  saving.value=true;error.value=''
  try{
    await props.onSave({keyword:selected.value.keyword,oldCategory:selected.value.category||'',
      oldPayment:selected.value.payment_source||'',category:category.value,paymentSource:payment.value})
    activeKeyword.value=''
  }catch(e){error.value='保存できませんでした：'+(e?.message||'通信を確認してください')}
  finally{saving.value=false}
}
function keydown(event){
  if(!open.value)return
  // Nested choice sheets own their Escape/keyboard behavior.
  if(document.querySelector('.mobile-choice-backdrop'))return
  if(event.key==='Escape'){event.preventDefault();closePanel()}
}
function trap(event){
  if(event.key!=='Tab'||document.querySelector('.mobile-choice-backdrop'))return
  const controls=[...event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled)')]
    .filter(el=>el.getClientRects().length)
  const first=controls[0],last=controls.at(-1)
  if(!first||!last)return
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
watch(open,show=>{
  if(show){
    previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    document.addEventListener('keydown',keydown)
    nextTick(()=>closeButton.value?.focus({preventScroll:true}))
  }else{
    document.body.style.overflow=previousOverflow
    document.removeEventListener('keydown',keydown)
  }
})
onBeforeUnmount(()=>{
  if(open.value)document.body.style.overflow=previousOverflow
  document.removeEventListener('keydown',keydown)
})
watch(query,()=>{limit.value=8})
</script>

<template>
  <section class="merchant-sheet-launch finance-panel merchant-rules-panel">
    <button ref="trigger" type="button" class="merchant-sheet-launch-button"
      aria-haspopup="dialog" :aria-expanded="open" @click="openPanel">
      <span class="merchant-sheet-launch-title">店舗ルール管理</span>
      <span class="merchant-sheet-launch-count">{{rules.length}}件</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>
    </button>
  </section>
  <Teleport to="body">
    <Transition name="merchant-sheet-transition">
      <div v-if="open" class="merchant-sheet-overlay" :style="themeStyle" @click.self="closePanel">
        <section class="merchant-sheet" role="dialog" aria-modal="true" aria-label="店舗ルール管理" @keydown="trap">
          <div class="merchant-sheet-handle-area" aria-hidden="true" @touchstart.passive="handleTouchStart" @touchend.passive="handleTouchEnd"><span class="merchant-sheet-handle"></span></div>
          <header class="merchant-sheet-heading">
            <button v-if="activeKeyword" type="button" class="merchant-sheet-back" :disabled="saving" aria-label="一覧に戻る" @click="back">戻る</button>
            <h2>{{activeKeyword ? '店舗ルールを編集' : '店舗ルール管理'}}</h2>
            <button ref="closeButton" type="button" class="merchant-sheet-close" :disabled="saving" @click="closePanel">閉じる</button>
          </header>
          <template v-if="!activeKeyword">
            <div class="merchant-sheet-search">
              <input v-model="query" type="search" inputmode="search" autocomplete="off"
                placeholder="店舗名・カテゴリ・カードを日本語で検索" aria-label="店舗ルールを日本語で検索" />
              <span>{{matching.length}}件</span>
            </div>
            <div class="merchant-sheet-list">
              <p v-if="!rules.length" class="merchant-sheet-empty">記憶した店舗ルールはありません。</p>
              <p v-else-if="!matching.length" class="merchant-sheet-empty">該当するルールはありません。</p>
              <button v-for="rule in displayed" :key="rule.keyword" type="button"
                class="merchant-sheet-row" :aria-label="rule.keyword+'のルールを編集'"
                @click="edit(rule)">
                <strong>{{rule.keyword}}</strong>
                <span>{{rule.category?categoryLabel(rule.category):'カテゴリなし'}} · {{rule.payment_source||'支払方法なし'}}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 5 7 7-7 7"/></svg>
              </button>
              <button v-if="displayed.length<matching.length" type="button" class="merchant-sheet-more" @click="limit+=8">もっと見る（{{displayed.length}} / {{matching.length}}件）</button>
            </div>
          </template>
          <div v-else class="merchant-sheet-editor">
            <strong class="merchant-sheet-shop">{{activeKeyword}}</strong>
            <label><span>カテゴリ</span><MobileChoiceSheet v-model="category" :options="categoryOptions" label="カテゴリ" /></label>
            <label><span>支払方法</span><MobileChoiceSheet v-model="payment" :options="paymentOptions" label="支払方法" /></label>
            <p v-if="!category||!payment" class="merchant-sheet-note">「ルールなし」は、その項目の自動設定を解除します。過去の記帳明細は変更しません。</p>
            <p v-if="error" class="merchant-sheet-error" role="alert">{{error}}</p>
            <div class="merchant-sheet-actions">
              <button type="button" class="merchant-sheet-cancel" :disabled="saving" @click="back">キャンセル</button>
              <button type="button" class="merchant-sheet-save" :disabled="saving||!hasChanges" @click="save">{{saving?'保存中…':'変更を保存'}}</button>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.merchant-sheet-launch{box-sizing:border-box;display:block;width:100%;min-width:0;max-width:100%;margin:0;padding:0!important;overflow:hidden;border:1px solid var(--line,#e7dce3);border-radius:17px;background:var(--card,#fff)}
.merchant-sheet-launch-button{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:68px!important;height:auto;width:100%;padding:14px 13px;border:0!important;border-radius:0!important;box-shadow:none!important;background:transparent!important;color:var(--ink,#242833);font:inherit;text-align:left;cursor:pointer;touch-action:manipulation}
.merchant-sheet-launch-title{font-size:15px;font-weight:750;flex:1;min-width:0}
.merchant-sheet-launch-button:focus-visible{outline:2px solid var(--blue-dark,#be577e);outline-offset:-3px}
.merchant-sheet-launch-button:active{background:var(--tint,#f6f1f5)!important}
.merchant-sheet-launch-count{font-size:12px;color:var(--muted,#707580)}
.merchant-sheet-launch-button>svg{width:18px;height:18px;color:var(--muted,#707580)}
.merchant-sheet-overlay{position:fixed;z-index:2147483500;inset:0;display:flex;align-items:flex-end;justify-content:center;background:#161a2480;overscroll-behavior:contain}
.merchant-sheet{box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;width:min(100%,600px);max-height:min(88dvh,800px);background:var(--card,#fff);color:var(--ink,#252830);border-radius:22px 22px 0 0;padding-bottom:env(safe-area-inset-bottom,0px);box-shadow:0 -12px 42px #0002}
.merchant-sheet-handle-area{display:flex;align-items:center;justify-content:center;width:100%;height:22px;flex:none;touch-action:pan-y}
.merchant-sheet-handle{display:block;width:38px;height:5px;border-radius:99px;background:var(--line,#dde0e6)}
.merchant-sheet-heading{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:0 16px 12px;flex:none}
.merchant-sheet-heading h2{font-size:17px;font-weight:750;margin:0;min-width:0;flex:1;text-align:left}
.merchant-sheet-heading button{flex:none;min-height:44px;border:0;border-radius:10px;padding:8px 10px;background:var(--tint,#f1f4f8);color:var(--blue-dark,#476c9c);font-size:14px;font-weight:700}
.merchant-sheet-search{display:flex;align-items:center;gap:9px;padding:0 16px 12px;flex:none}
.merchant-sheet-search input{flex:1;min-width:0;min-height:46px;border:1px solid var(--line,#e3e5e9);border-radius:11px;padding:8px 12px;background:var(--tint,#f5f6f8);color:var(--ink,#252830);font:inherit;font-size:16px}
.merchant-sheet-search span{flex:none;min-width:30px;text-align:right;color:var(--muted,#747984);font-size:12px}
.merchant-sheet-list{overflow:auto;min-height:0;max-height:100%;padding:0 12px 16px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
.merchant-sheet-row{display:grid;grid-template-columns:minmax(0,1fr) 18px;gap:3px 10px;align-items:center;width:100%;min-height:60px;padding:10px 5px;border:0;border-bottom:1px solid var(--line,#e6e8ed);color:var(--ink,#252830);background:transparent;text-align:left;cursor:pointer}
.merchant-sheet-row strong{min-width:0;overflow-wrap:anywhere;font-size:14px}
.merchant-sheet-row>span{grid-column:1;grid-row:2;min-width:0;font-size:12px;color:var(--muted,#737987);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.merchant-sheet-row svg{grid-column:2;grid-row:1/3;width:17px;height:17px;color:var(--muted,#7c8490)}
.merchant-sheet-more{display:block;width:100%;min-height:48px;margin-top:6px;background:var(--tint,#f4f6f9);border:0;border-radius:10px;color:var(--blue-dark,#5478a6);font-size:14px;font-weight:700}
.merchant-sheet-empty{padding:25px 12px;text-align:center;font-size:14px;color:var(--muted,#7c828b)}
.merchant-sheet-editor{display:grid;gap:17px;padding:4px 16px 16px;overflow:auto;min-height:0;overscroll-behavior:contain}
.merchant-sheet-editor label{display:grid;gap:7px;min-width:0;font-size:13px;font-weight:700;color:var(--muted,#777)}
.merchant-sheet-shop{font-size:16px;overflow-wrap:anywhere}
.merchant-sheet-note{font-size:12px;line-height:1.5;color:var(--muted,#777);margin:0}
.merchant-sheet-error{font-size:12px;color:#b72f51}
.merchant-sheet-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding-top:5px}
.merchant-sheet-actions button{min-width:0;min-height:48px;border-radius:12px;padding:9px 8px;font-size:14px;font-weight:750}
.merchant-sheet-cancel{border:1px solid var(--line,#e3e6ed);background:var(--card,#fff);color:var(--ink,#333)}
.merchant-sheet-save{border:0;background:var(--blue,#7099d5);color:#fff}
.merchant-sheet-save:disabled{opacity:.5}
.merchant-sheet-transition-enter-active,.merchant-sheet-transition-leave-active{transition:opacity .18s}
.merchant-sheet-transition-enter-active .merchant-sheet,.merchant-sheet-transition-leave-active .merchant-sheet{transition:transform .18s}
.merchant-sheet-transition-enter-from,.merchant-sheet-transition-leave-to{opacity:0}
.merchant-sheet-transition-enter-from .merchant-sheet,.merchant-sheet-transition-leave-to .merchant-sheet{transform:translateY(100%)}
@media(prefers-reduced-motion:reduce){.merchant-sheet-transition-enter-active,.merchant-sheet-transition-leave-active,.merchant-sheet-transition-enter-active .merchant-sheet,.merchant-sheet-transition-leave-active .merchant-sheet{transition:none}}
</style>