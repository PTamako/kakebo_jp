<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue'
import MobileChoiceSegments from './MobileChoiceSegments.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'

const props=defineProps({
  mode:{type:String,default:''},
  cardName:{type:String,default:''},
  card:{type:Object,default:null},
  closingDay:{type:String,default:'末日'},
  paymentSources:{type:Array,default:()=>[]},
  busy:{type:Boolean,default:false},
  onSave:{type:Function,required:true},
  onDanger:{type:Function,required:true}
})
const emit=defineEmits(['close'])
const opened=computed(()=>props.mode==='add'||props.mode==='edit')
const isEdit=computed(()=>props.mode==='edit')
const isSpecial=computed(()=>isEdit.value&&['現金','その他','其他'].includes(props.cardName))
const name=ref(''),sourceType=ref('standard'),statGroup=ref('card'),closingDay=ref('末日')
const original=ref(null)
const saving=ref(false),error=ref(''),showDanger=ref(false)
const shell=ref(null),closeButton=ref(null),lastTrigger=ref(null)
const theme=ref({}),keyboardInset=ref(0),screenHeight=ref(null)
const sheetStyle=computed(()=>screenHeight.value?{maxHeight:screenHeight.value+'px'}:{})
const overlayStyle=computed(()=>({...theme.value,bottom:keyboardInset.value+'px'}))
const typeOptions=[
  {value:'standard',label:'クレジットカード'},
  {value:'prepaid',label:'プリペイドカード'}
]
const groupOptions=[
  {value:'card',label:'カード・電子決済'},
  {value:'points',label:'ポイント払い'}
]
const closingOptions=[
  ...Array.from({length:31},(_,i)=>({value:String(i+1),label:(i+1)+'日'})),
  {value:'末日',label:'月末'}
]
const canEditClosing=computed(()=>isEdit.value&&!isSpecial.value&&sourceType.value==='standard')
const normalizedName=computed(()=>name.value.trim())
const dirty=computed(()=>{
  if(!opened.value)return false
  if(!isEdit.value)return !!normalizedName.value||sourceType.value!=='standard'||statGroup.value!=='card'
  const saved=original.value
  return !!saved&&(normalizedName.value!==saved.name||sourceType.value!==saved.sourceType||
    statGroup.value!==saved.statGroup||(canEditClosing.value&&closingDay.value!==saved.effectiveClosingDay))
})
const valid=computed(()=>{
  if(!normalizedName.value||normalizedName.value.length>80)return false
  if(!isEdit.value&&props.paymentSources.includes(normalizedName.value))return false
  if(isEdit.value&&normalizedName.value!==props.cardName&&props.paymentSources.includes(normalizedName.value))return false
  return !isEdit.value||!!original.value
})
function resetDraft(){
  error.value='';showDanger.value=false;saving.value=false
  if(isEdit.value){
    const card=props.card||{}
    name.value=props.cardName
    sourceType.value=card.source_type||'standard'
    statGroup.value=card.stat_group||'card'
    closingDay.value=props.closingDay||'末日'
    original.value={
      name:props.cardName,sourceType:sourceType.value,statGroup:statGroup.value,
      closingDay:card.closing_day===null||card.closing_day===undefined?null:Number(card.closing_day),
      isArchived:Number(card.is_archived||0),effectiveClosingDay:closingDay.value
    }
  }else{
    name.value='';sourceType.value='standard';statGroup.value='card'
    closingDay.value='末日';original.value=null
  }
}
function syncViewport(){
  const vv=window.visualViewport
  if(!vv){keyboardInset.value=0;screenHeight.value=null;return}
  keyboardInset.value=Math.max(0,Math.round(window.innerHeight-(vv.height+vv.offsetTop)))
  screenHeight.value=Math.max(220,Math.floor(vv.height-8))
}
let previousOverflow=''
function onKeyDown(event){
  if(!opened.value||document.querySelector('.mobile-choice-backdrop'))return
  if(event.key==='Escape'){event.preventDefault();requestClose()}
}
function trapFocus(event){
  if(event.key!=='Tab'||document.querySelector('.mobile-choice-backdrop'))return
  const controls=[...(shell.value?.querySelectorAll('button:not(:disabled),input:not(:disabled)')||[])]
    .filter(el=>el.getClientRects().length)
  const first=controls[0],last=controls.at(-1)
  if(!first||!last)return
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
function requestClose(){
  if(saving.value||props.busy)return
  if(dirty.value&&!window.confirm('変更内容を破棄しますか？'))return
  emit('close')
}
let touchY=null
function startTouch(event){touchY=event.changedTouches?.[0]?.clientY??null}
function endTouch(event){
  if(touchY===null)return
  const distance=(event.changedTouches?.[0]?.clientY??0)-touchY
  touchY=null
  if(distance>75)requestClose()
}
async function save(){
  if(saving.value||props.busy||!valid.value||!dirty.value)return
  saving.value=true;error.value=''
  try{
    const payload={mode:props.mode,name:normalizedName.value,
      sourceType:sourceType.value,statGroup:statGroup.value}
    if(isEdit.value){
      payload.oldName=props.cardName
      payload.expected={
        sourceType:original.value.sourceType,
        statGroup:original.value.statGroup,
        closingDay:original.value.closingDay,
        isArchived:original.value.isArchived
      }
      if(canEditClosing.value&&closingDay.value!==original.value.effectiveClosingDay)
        payload.closingDay=closingDay.value==='末日'?0:Number(closingDay.value)
    }
    await props.onSave(payload)
    emit('close')
  }catch(e){error.value='保存できませんでした：'+(e?.message||'通信を確認してください')}
  finally{saving.value=false}
}
async function danger(action){
  if(saving.value||props.busy||!isEdit.value)return
  if(dirty.value&&!window.confirm('未保存の変更を破棄して操作しますか？'))return
  const name=props.cardName
  const question=action==='archive'
    ?name+'をアーカイブしますか？過去の明細・請求・残高は保持されます。'
    :name+'を完全削除しますか？履歴がある場合は削除できません。'
  if(!window.confirm(question))return
  saving.value=true;error.value=''
  try{
    await props.onDanger(action,name)
    emit('close')
  }catch(e){error.value='操作できませんでした：'+(e?.message||'通信を確認してください')}
  finally{saving.value=false}
}
watch(()=>[props.mode,props.cardName],([mode],[previous])=>{
  if(!mode)return
  if(mode!==previous)lastTrigger.value=document.activeElement
  resetDraft()
},{flush:'sync'})
watch(opened,open=>{
  if(open){
    previousOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    const root=document.querySelector('main')
    if(root){
      const css=getComputedStyle(root)
      theme.value=Object.fromEntries(['--card','--paper','--ink','--muted','--line','--blue','--blue-dark','--tint']
        .map(key=>[key,css.getPropertyValue(key).trim()]).filter(([,v])=>v))
    }
    syncViewport()
    window.visualViewport?.addEventListener('resize',syncViewport)
    window.visualViewport?.addEventListener('scroll',syncViewport)
    window.addEventListener('resize',syncViewport)
    document.addEventListener('keydown',onKeyDown)
    nextTick(()=>closeButton.value?.focus({preventScroll:true}))
  }else{
    document.body.style.overflow=previousOverflow
    window.visualViewport?.removeEventListener('resize',syncViewport)
    window.visualViewport?.removeEventListener('scroll',syncViewport)
    window.removeEventListener('resize',syncViewport)
    document.removeEventListener('keydown',onKeyDown)
    keyboardInset.value=0;screenHeight.value=null
    nextTick(()=>lastTrigger.value?.focus?.({preventScroll:true}))
  }
},{immediate:true})
onBeforeUnmount(()=>{
  if(opened.value)document.body.style.overflow=previousOverflow
  window.visualViewport?.removeEventListener('resize',syncViewport)
  window.visualViewport?.removeEventListener('scroll',syncViewport)
  window.removeEventListener('resize',syncViewport)
  document.removeEventListener('keydown',onKeyDown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="card-editor-transition">
      <div v-if="opened" class="card-editor-backdrop" :style="overlayStyle" @click.self="requestClose">
        <section ref="shell" class="card-editor-sheet" :style="sheetStyle" role="dialog"
          aria-modal="true" :aria-label="isEdit?'カードを編集':'カードを追加'" @keydown="trapFocus">
          <div class="card-editor-grab-area" @touchstart.passive="startTouch" @touchend.passive="endTouch">
            <span class="card-editor-grab" aria-hidden="true"></span>
          </div>
          <div class="card-editor-top">
            <h2>{{isEdit?'カードを編集':'カードを追加'}}</h2>
            <button ref="closeButton" type="button" class="card-editor-close" :disabled="saving||busy"
              @click="requestClose">閉じる</button>
          </div>
          <form class="card-editor-form" @submit.prevent="save">
            <div class="card-editor-body">
              <label class="card-editor-field">
                <span>名称</span>
                <input v-model="name" :disabled="saving||busy||(isEdit&&cardName==='現金')"
                  maxlength="80" type="text" autocomplete="off" enterkeyhint="done"
                  :placeholder="isEdit?'カード名':'例：Suica、楽天カード'" aria-label="カード名" />
              </label>
              <div v-if="!isSpecial" class="card-editor-field">
                <span>種類</span>
                <MobileChoiceSegments v-model="sourceType" label="カードの種類"
                  :disabled="saving||busy" :options="typeOptions"/>
              </div>
              <p v-if="sourceType==='prepaid'&&!isSpecial" class="card-editor-hint">期首残高は「残高」で設定できます。</p>
              <div v-if="cardName!=='現金'||!isEdit" class="card-editor-field">
                <span>支払集計</span>
                <MobileChoiceSegments v-model="statGroup" label="支払方法の集計区分"
                  :disabled="saving||busy" :options="groupOptions"/>
              </div>
              <div v-if="canEditClosing" class="card-editor-field">
                <span>締め日</span>
                <MobileChoiceSheet v-model="closingDay" :disabled="saving||busy"
                  label="カードの締め日" :options="closingOptions" :searchable="false"/>
              </div>
              <p v-if="isEdit" class="card-editor-hint">名称を変更しても過去の明細と保存済み請求は引き継がれます。</p>
              <p v-if="error" class="card-editor-error" role="alert">{{error}}</p>
              <details v-if="isEdit&&!isSpecial" class="card-editor-danger">
                <summary>その他の操作</summary>
                <div class="card-editor-danger-actions">
                  <button type="button" :disabled="saving||busy" @click="danger('archive')">アーカイブ</button>
                  <button type="button" class="card-editor-delete" :disabled="saving||busy" @click="danger('delete')">完全削除</button>
                </div>
              </details>
            </div>
            <div class="card-editor-footer">
              <button type="button" class="card-editor-cancel" :disabled="saving||busy" @click="requestClose">キャンセル</button>
              <button type="submit" class="card-editor-save" :disabled="saving||busy||!valid||!dirty">
                {{saving?'保存中…':'保存'}}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.card-editor-backdrop{position:fixed;inset:0;z-index:2147483500;display:flex;align-items:flex-end;justify-content:center;background:rgba(18,21,29,.5);overscroll-behavior:contain}
.card-editor-sheet{box-sizing:border-box;display:flex;flex-direction:column;width:min(100%,600px);max-height:min(90dvh,760px);overflow:hidden;background:var(--card,#fff);color:var(--ink,#242830);border-radius:22px 22px 0 0;box-shadow:0 -14px 48px #0002;padding-bottom:env(safe-area-inset-bottom,0px)}
.card-editor-grab-area{display:flex;align-items:center;justify-content:center;width:100%;height:23px;flex:none;touch-action:pan-y}
.card-editor-grab{width:38px;height:5px;background:var(--line,#dce1e9);border-radius:99px}
.card-editor-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:3px 16px 12px;flex:none}
.card-editor-top h2{font-size:18px;font-weight:800;margin:0}
.card-editor-close{min-height:44px;border:0;border-radius:11px;padding:9px 13px;color:var(--blue-dark,#526c99);background:var(--tint,#f0f2f6);font-size:14px;font-weight:700}
.card-editor-form{display:flex;flex-direction:column;min-height:0;overflow:hidden;flex:1}
.card-editor-body{display:grid;align-content:start;gap:15px;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:0 16px 16px}
.card-editor-field{display:grid;gap:7px;min-width:0;color:var(--muted,#73808b);font-size:13px;font-weight:750}
.card-editor-field>input{box-sizing:border-box;display:block;width:100%;min-width:0;min-height:48px;border:1px solid var(--line,#e1e5ec);border-radius:11px;background:var(--card,#fff);color:var(--ink,#25303a);padding:10px 12px;font:inherit;font-size:16px;font-weight:500;outline-offset:1px}
.card-editor-field :deep(.mobile-choice-trigger){background:var(--card,#fff);min-height:48px}
.card-editor-hint{font-size:12px;line-height:1.5;color:var(--muted,#78818a);margin:0}
.card-editor-error{font-size:13px;color:#b6294b;margin:0;overflow-wrap:anywhere}
.card-editor-danger{margin-top:3px;padding-top:8px;border-top:1px solid var(--line,#e2e5ea)}
.card-editor-danger summary{display:flex;align-items:center;min-height:44px;cursor:pointer;color:var(--muted,#7a8089);font-size:13px;font-weight:700}
.card-editor-danger summary:after{content:'⌄';margin-left:auto}
.card-editor-danger-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:6px 0 10px}
.card-editor-danger-actions button{min-height:46px;border:1px solid var(--line,#dbe0e5);border-radius:11px;color:var(--ink,#333);background:var(--card,#fff);font-size:13px;font-weight:700}
.card-editor-danger-actions .card-editor-delete{color:#b32b4a;border-color:#ecc9d1}
.card-editor-footer{display:grid;grid-template-columns:1fr 1fr;gap:10px;flex:none;padding:12px 16px max(12px,env(safe-area-inset-bottom,0px));border-top:1px solid var(--line,#e6e8ef);background:var(--card,#fff)}
.card-editor-footer button{box-sizing:border-box;min-width:0;min-height:48px;border-radius:12px;font:inherit;font-size:15px;font-weight:750}
.card-editor-cancel{border:1px solid var(--line,#e4e8ed);background:var(--card,#fff);color:var(--ink,#30343b)}
.card-editor-save{border:0;background:var(--blue,#d05a81);color:#fff}
.card-editor-save:disabled{opacity:.5}
.card-editor-transition-enter-active,.card-editor-transition-leave-active{transition:opacity .18s}
.card-editor-transition-enter-active .card-editor-sheet,.card-editor-transition-leave-active .card-editor-sheet{transition:transform .18s}
.card-editor-transition-enter-from,.card-editor-transition-leave-to{opacity:0}
.card-editor-transition-enter-from .card-editor-sheet,.card-editor-transition-leave-to .card-editor-sheet{transform:translateY(100%)}
@media(prefers-reduced-motion:reduce){.card-editor-transition-enter-active,.card-editor-transition-leave-active,.card-editor-transition-enter-active .card-editor-sheet,.card-editor-transition-leave-active .card-editor-sheet{transition:none}}
</style>
