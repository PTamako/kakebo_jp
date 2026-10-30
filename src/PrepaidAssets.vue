<script setup>
import { ref, watch, onMounted } from 'vue'
const props=defineProps({ api:{type:Function,required:true}, active:{type:Boolean,default:false}, revision:{type:Number,default:0} })
const emit=defineEmits(['summary','open-card-settings'])
const data=ref(null),error=ref(''),loading=ref(false),showAll=ref(false),showAllRecharges=ref(false)
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
      emit('summary',{balance:payload.cards.reduce((sum,card)=>sum+Number(card.balance),0)})
    }
  }catch(e){
    if(id===requestId){error.value=e.message;data.value=null;emit('summary',null)}
  }finally{if(id===requestId)loading.value=false}
}
watch(()=>[props.active,props.revision],()=>{if(props.active)void refresh()})
onMounted(()=>{if(props.active)void refresh()})
</script>
<template>
  <details class="panel wallet-panel" open aria-label="交通系IC・プリペイド">
    <summary class="wallet-section-heading">
      <span><strong>交通系IC・プリペイド</strong><small>{{data ? data.cards.length+'件' : '残高を確認'}}</small></span>
      <span class="wallet-heading-end"><b v-if="data">{{money(data.cards.reduce((sum,card)=>sum+Number(card.balance),0))}}</b><span class="wallet-chevron" aria-hidden="true">⌄</span></span>
    </summary>
    <div class="wallet-body">
      <div class="wallet-tools"><button type="button" class="wallet-refresh" :disabled="loading" aria-label="プリペイド残高を更新" @click="refresh">↻ 更新</button><button type="button" class="wallet-add" @click="emit('open-card-settings')">＋ 追加</button></div>
      <p v-if="loading && !data" class="wallet-hint" role="status">残高を読み込み中…</p>
      <p v-if="error" class="wallet-error" role="alert">{{error}}</p>
      <p v-if="notice" class="wallet-success" role="status">{{notice}}</p>
      <template v-if="data">
        <p v-if="!data.cards.length" class="wallet-hint">管理のカード設定からプリペイドカードを追加できます。</p>
        <div v-for="card in (showAll ? data.cards : data.cards.slice(0,2))" :key="card.name" class="wallet-row">
          <div class="wallet-row-top">
            <div class="wallet-name"><strong>{{card.name}}</strong><small>プリペイド · チャージ {{money(card.charged)}} · 利用 {{money(card.spent)}}</small></div>
            <div class="wallet-money" :class="{'wallet-negative':card.balance<0}"><strong>{{money(card.balance)}}</strong><small v-if="card.balance<0">要確認</small></div>
          </div>
          <div class="wallet-row-actions"><button type="button" class="wallet-edit" @click="startOpening(card)">編集</button></div>
        </div>
        <button v-if="data.cards.length>2" type="button" class="wallet-show-more" :aria-expanded="showAll" @click="showAll=!showAll">{{showAll?'閉じる':'あと'+(data.cards.length-2)+'件を表示'}}</button>
        <details v-if="data.recharges.length" class="wallet-recharge">
          <summary>最近のチャージ <span>{{data.recharges.length}}件</span></summary>
          <div v-for="entry in (showAllRecharges ? data.recharges : data.recharges.slice(0,3))" :key="entry.id" class="wallet-recharge-row"><span>{{entry.date}} · {{entry.transfer_target.slice(8)}}</span><strong>+{{money(entry.amount)}}</strong></div>
          <button v-if="data.recharges.length>3" type="button" class="wallet-show-more" :aria-expanded="showAllRecharges" @click="showAllRecharges=!showAllRecharges">{{showAllRecharges?'閉じる':'あと'+(data.recharges.length-3)+'件を表示'}}</button>
        </details>
        
      </template>
    </div>
    <div v-if="selected" class="wallet-overlay" @click.self="selected=null">
      <form class="wallet-opening-editor" role="dialog" aria-modal="true" :aria-label="selected.name+'の期首残高'" @submit.prevent="saveOpening">
        <div class="wallet-opening-title">{{selected.name}} の期首残高</div>
        <p class="wallet-hint">{{selected.opening_date}}時点の残高。以後のチャージ・利用から現在残高を計算します。</p>
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
.wallet-tools{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:3px}.wallet-tools span{font-size:10px;color:var(--muted)}
.wallet-add{border:0;background:transparent;color:var(--blue-dark);font-size:12px;font-weight:750;min-height:44px;padding:7px 10px}
.wallet-refresh{min-height:44px;border:0;background:var(--paper);color:var(--blue-dark);font-weight:750;border-radius:9px;padding:7px 10px;font-size:11px;white-space:nowrap}
.wallet-row{border-top:1px solid var(--line);padding:10px 0 7px;min-width:0}
.wallet-row-top{display:flex;align-items:flex-start;justify-content:space-between;gap:7px}
.wallet-name{display:grid;gap:3px;min-width:0}.wallet-name strong{font-size:13px;overflow-wrap:anywhere}.wallet-name small{color:var(--muted);font-size:10px;line-height:1.5}
.wallet-money{display:grid;justify-items:end;flex:none;font-variant-numeric:tabular-nums;white-space:nowrap}.wallet-money strong{font-size:15px}.wallet-money small{font-size:10px;color:var(--muted)}.wallet-negative{color:#c54d68}
.wallet-row-actions{display:flex;justify-content:flex-end;margin-top:1px}.wallet-edit{border:0;background:transparent;color:var(--blue-dark);font-size:12px;font-weight:750;min-height:44px;padding:5px 8px}
.wallet-show-more{display:block;margin:2px auto 5px;border:0;background:transparent;color:var(--blue-dark);min-height:44px;font-size:12px;font-weight:750;padding:8px}
.wallet-recharge{border-top:1px solid var(--line)}
.wallet-recharge summary{font-size:11px;font-weight:750;color:var(--muted);cursor:pointer;min-height:40px;padding:12px 0}.wallet-recharge summary span{font-weight:500}
.wallet-recharge-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:9px 0;border-top:1px solid var(--line)}
.wallet-hint{font-size:11px;color:var(--muted);line-height:1.6;margin:0}
.wallet-error{font-size:12px;color:#9b2938}.wallet-success{font-size:11px;color:#178367;margin:0}
.wallet-overlay{position:fixed;z-index:61;inset:0;background:#23273588;display:flex;align-items:flex-end;justify-content:center}
.wallet-opening-editor{box-sizing:border-box;display:grid;gap:12px;width:100%;max-width:520px;max-height:calc(90dvh - env(safe-area-inset-bottom, 0px));overflow:auto;padding:20px 18px calc(20px + env(safe-area-inset-bottom,0px));border-radius:22px 22px 0 0;background:var(--card);box-shadow:0 -12px 30px #00000018}
.wallet-opening-title{font-size:16px;font-weight:800}.wallet-opening-editor label{display:grid;gap:6px;font-size:12px;font-weight:750}.wallet-opening-editor input{font-size:16px;min-height:44px}
.wallet-editor-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.wallet-editor-actions button{min-height:46px;border-radius:11px;border:1px solid var(--line);background:var(--card);font-size:12px;font-weight:750;color:var(--ink)}.wallet-editor-actions button[type=submit]{color:#fff;background:var(--blue);border-color:var(--blue)}
@media(min-width:720px){.wallet-overlay{align-items:center;padding:16px}.wallet-opening-editor{border-radius:20px;padding:22px}}
@media(prefers-reduced-motion:reduce){.wallet-chevron{transition:none}}
</style>
