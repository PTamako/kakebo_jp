<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { notify, NOTIFICATION_DURATION } from './notifications.js'
const props=defineProps({ api:{type:Function,required:true}, active:{type:Boolean,default:false}, revision:{type:Number,default:0} })
const emit=defineEmits(['summary','open-card-settings','open-history'])
const data=ref(null),error=ref(''),loading=ref(false),showAll=ref(false)
const money=value=>'¥'+Number(value||0).toLocaleString('ja-JP')
const selected=ref(null),openingDraft=ref(0),saving=ref(false),notice=ref('')
function startOpening(card){ selected.value=card;openingDraft.value=Number(card.opening_balance) }
async function saveOpening(){
  if(!selected.value||saving.value)return
  const amount=Number(openingDraft.value)
  if(!Number.isSafeInteger(amount)||amount<0||amount>100000000){error.value='期首残高を確認してください';return}
  const card=selected.value
  if(amount===Number(card.opening_balance)){selected.value=null;return}
  const changed=Math.abs(amount-Number(card.opening_balance))
  if(!window.confirm(card.name+'の期首残高を'+money(amount)+'に変更します。現在の計算残高も'+money(changed)+'変わります。記帳履歴は変更しません。よろしいですか？'))return
  saving.value=true;error.value='';notice.value=''
  try{
    await props.api('prepaid-assets/opening',{method:'POST',body:JSON.stringify({name:card.name,openingBalance:amount})})
    selected.value=null;await refresh();notice.value=card.name+'の期首残高を保存しました'
  }catch(e){error.value=e.message}
  finally{saving.value=false}
}
let requestId=0
async function refresh(){
  const id=++requestId
  loading.value=true;error.value=''
  try{
    const payload=await props.api('prepaid-assets')
    if(id===requestId){
      data.value=payload
      emit('summary',{balance:payload.cards.reduce((sum,card)=>sum+Number(card.balance),0), latestUsage:payload.latestUsage || null, latestCharge:payload.latestCharge || null})
    }
  }catch(e){
    if(id===requestId){error.value=e.message;data.value=null;emit('summary',null)}
  }finally{if(id===requestId)loading.value=false}
}
watch(()=>[props.active,props.revision],()=>{if(props.active)void refresh()})
const statusTimers = new Map()
for (const status of [error, notice]) {
  watch(status, value => {
    if (!value) return
    if (statusTimers.has(status)) clearTimeout(statusTimers.get(status))
    notify(value, status === error ? 'error' : 'success')
    statusTimers.set(status, setTimeout(() => {
      if (status.value === value) status.value = ''
      statusTimers.delete(status)
    }, NOTIFICATION_DURATION))
  })
}
onUnmounted(() => {
  for (const timer of statusTimers.values()) clearTimeout(timer)
  statusTimers.clear()
})
onMounted(()=>{if(props.active)void refresh()})
</script>
<template>
  <details class="panel wallet-panel" open aria-label="プリペイド・電子マネー">
    <summary class="wallet-section-heading">
      <span><strong>プリペイド・電子マネー</strong><small>{{data ? data.cards.length+'件' : '残高を確認'}}</small></span>
      <span class="wallet-heading-end"><b v-if="data">{{money(data.cards.reduce((sum,card)=>sum+Number(card.balance),0))}}</b><span class="wallet-chevron" aria-hidden="true">⌄</span></span>
    </summary>
    <div class="wallet-body">
      <div class="wallet-tools">
        <button type="button" class="wallet-refresh" :disabled="loading" aria-label="プリペイド残高を更新" @click="refresh"><span aria-hidden="true">↻</span> 更新</button>
        <button type="button" class="wallet-add" @click="emit('open-card-settings')">＋ カードを追加</button>
      </div>
      <p v-if="loading && !data" class="wallet-hint" role="status">残高を読み込み中…</p>
      
      
      <template v-if="data">
        <p v-if="!data.cards.length" class="wallet-hint">管理のカード設定からプリペイドカードを追加できます。</p>
        <div class="wallet-list">
          <article v-for="card in (showAll ? data.cards : data.cards.slice(0,2))" :key="card.name" class="wallet-row">
            <div class="wallet-row-top">
              <div class="wallet-card-identity">
                <span class="wallet-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h5"/></svg>
                </span>
                <div class="wallet-name"><strong :title="card.name">{{card.name}}</strong><small>プリペイド</small></div>
              </div>
              <div class="wallet-money" :class="{'wallet-negative':card.balance<0}">
                <small>現在残高</small>
                <strong>{{money(card.balance)}}</strong>
                <small v-if="card.balance<0">要確認</small>
              </div>
            </div>
            <div class="wallet-card-flow" aria-label="今月のチャージと利用">
              <div class="wallet-flow-value">
                <span>今月のチャージ</span><strong class="wallet-charge-value">＋{{money(card.charged_month)}}</strong>
              </div>
              <div class="wallet-flow-value">
                <span>今月の利用</span><strong>−{{money(card.spent_month)}}</strong>
              </div>
            </div>
            <p v-if="card.transferred_out_month > 0" class="wallet-outgoing">今月の振替出金 <strong>−{{money(card.transferred_out_month)}}</strong></p>
            <div class="wallet-row-actions">
              <nav class="wallet-history-links" :aria-label="card.name+'の履歴'">
                <button type="button" :aria-label="card.name+'の利用・振替履歴'" @click="emit('open-history',card.name,'usage')">利用・振替履歴</button>
                <button type="button" :aria-label="card.name+'のチャージ履歴'" @click="emit('open-history',card.name,'charge')">チャージ履歴</button>
              </nav>
              <button type="button" class="wallet-edit" :aria-label="card.name+'の期首残高を編集'" @click="startOpening(card)">期首残高</button>
            </div>
          </article>
        </div>
        <button v-if="data.cards.length>2" type="button" class="wallet-show-more" :aria-expanded="showAll" @click="showAll=!showAll">{{showAll?'閉じる':'あと'+(data.cards.length-2)+'件を表示'}}</button>

        
      </template>
    </div>
    <div v-if="selected" class="wallet-overlay" @click.self="selected=null">
      <form class="wallet-opening-editor" role="dialog" aria-modal="true" :aria-label="selected.name+'の期首残高'" @submit.prevent="saveOpening">
        <div class="wallet-opening-title">{{selected.name}} の期首残高</div>
        <p class="wallet-hint">{{selected.opening_date}}時点の残高。以後のチャージ・利用・振替から現在残高を計算します。</p>
        <label>期首残高（円）<input v-model.number="openingDraft" type="number" step="1" min="0" max="100000000" required /></label>
        <div class="wallet-editor-actions"><button type="button" @click="selected=null" :disabled="saving">キャンセル</button><button type="submit" :disabled="saving">{{saving?'保存中…':'保存'}}</button></div>
      </form>
    </div>
  </details>
</template>
<style scoped>
.wallet-panel{min-width:0;padding:0;overflow:visible}
.wallet-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:58px;padding:12px 14px;cursor:pointer;list-style:none}
.wallet-section-heading::-webkit-details-marker{display:none}
.wallet-section-heading>span:first-child{display:grid;gap:2px;min-width:0}.wallet-section-heading strong{font-size:15px}.wallet-section-heading small{font-size:11px;color:var(--muted)}
.wallet-heading-end{display:flex;align-items:center;gap:10px;min-width:0}.wallet-heading-end b{font-size:13px;font-variant-numeric:tabular-nums}
.wallet-chevron{font-size:20px;color:var(--muted);transition:transform .18s}.wallet-panel[open] .wallet-chevron{transform:rotate(180deg)}
.wallet-section-heading:focus-visible,.wallet-show-more:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.wallet-body{padding:0 14px 13px}
.wallet-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 9px}
.wallet-add,.wallet-refresh{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:40px;box-sizing:border-box;padding:7px 11px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:750;white-space:nowrap;cursor:pointer}
.wallet-add{background:var(--card)}
.wallet-refresh span{font-size:17px;line-height:1}
.wallet-list{display:grid;gap:9px;min-width:0}
.wallet-row{display:grid;gap:10px;min-width:0;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.wallet-row-top{display:flex;align-items:flex-start;justify-content:space-between;gap:9px;min-width:0}
.wallet-card-identity{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
.wallet-card-icon{display:grid;place-items:center;width:35px;height:35px;flex:none;border-radius:11px;background:color-mix(in srgb,var(--blue) 11%,var(--card));color:var(--blue-dark)}
.wallet-card-icon svg{width:21px;height:21px}
.wallet-name{display:grid;gap:2px;min-width:0}
.wallet-name strong{font-size:13px;line-height:1.4;overflow-wrap:anywhere}
.wallet-name small{color:var(--muted);font-size:10px;line-height:1.3}
.wallet-money{display:grid;justify-items:end;gap:1px;flex:none;max-width:48%;font-variant-numeric:tabular-nums;text-align:right}
.wallet-money strong{font-size:17px;line-height:1.35;overflow-wrap:anywhere}
.wallet-money small{font-size:10px;line-height:1.3;color:var(--muted)}
.wallet-negative strong,.wallet-negative small:last-child{color:#c54d68}
.wallet-card-flow{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;min-width:0}
.wallet-flow-value{display:grid;gap:3px;min-width:0;padding:8px 10px;border-radius:10px;background:var(--paper)}
.wallet-flow-value span{font-size:10px;line-height:1.3;color:var(--muted)}
.wallet-flow-value strong{font-size:12px;line-height:1.4;font-weight:750;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.wallet-flow-value .wallet-charge-value{color:#16816b}
.wallet-row-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;min-width:0}
.wallet-history-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;min-width:0}
.wallet-history-links button,.wallet-edit{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:42px;min-width:0;padding:7px 4px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--blue-dark);font-weight:750;font-size:11px;line-height:1.3;text-align:center;cursor:pointer}
.wallet-edit{padding:7px 9px;background:var(--paper)}
.wallet-history-links button:focus-visible,.wallet-edit:focus-visible,.wallet-add:focus-visible,.wallet-refresh:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.wallet-show-more{display:block;margin:6px auto 2px;border:0;background:transparent;color:var(--blue-dark);min-height:44px;font-size:12px;font-weight:750;padding:8px}
@media(max-width:370px){.wallet-row{padding:10px;gap:8px}.wallet-card-icon{width:31px;height:31px}.wallet-card-identity{gap:6px}.wallet-money strong{font-size:15px}.wallet-history-links{gap:4px}.wallet-row-actions{gap:4px}.wallet-history-links button,.wallet-edit{font-size:10px;padding-inline:4px}.wallet-flow-value{padding:7px 8px}}
.wallet-hint{font-size:11px;color:var(--muted);line-height:1.6;margin:0}
.wallet-error{font-size:12px;color:#9b2938}.wallet-success{font-size:11px;color:#178367;margin:0}
.wallet-overlay{position:fixed;z-index:61;inset:0;background:#23273588;display:flex;align-items:flex-end;justify-content:center}
.wallet-opening-editor{box-sizing:border-box;display:grid;gap:12px;width:100%;max-width:520px;max-height:calc(90dvh - env(safe-area-inset-bottom, 0px));overflow:auto;padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));border-radius:22px 22px 0 0;background:var(--card);box-shadow:0 -12px 30px #00000018}
.wallet-opening-title{font-size:16px;font-weight:800}.wallet-opening-editor label{display:grid;gap:6px;font-size:12px;font-weight:750}.wallet-opening-editor input{font-size:16px;min-height:44px}
.wallet-editor-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wallet-editor-actions button{min-height:46px;border-radius:11px;border:1px solid var(--line);background:var(--card);font-size:12px;font-weight:750;color:var(--ink)}.wallet-editor-actions button[type=submit]{color:#fff;background:var(--blue);border-color:var(--blue)}
@media(min-width:720px){.wallet-overlay{align-items:center;padding:16px}.wallet-opening-editor{border-radius:20px;padding:22px}}
@media(prefers-reduced-motion:reduce){.wallet-chevron{transition:none}}
</style>

<style scoped>
.wallet-outgoing{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0 0;padding:7px 2px;font-size:12px;color:var(--muted)}
.wallet-outgoing strong{font-variant-numeric:tabular-nums;color:var(--ink)}
</style>
