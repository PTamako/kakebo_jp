<script setup>
import { ref, watch, onMounted } from 'vue'
const props=defineProps({ api:{type:Function,required:true}, active:{type:Boolean,default:false}, revision:{type:Number,default:0} })
const data=ref(null),error=ref(''),loading=ref(false)
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
  try{ const payload=await props.api('prepaid-assets');if(id===requestId)data.value=payload }
  catch(e){if(id===requestId){error.value=e.message;data.value=null}}
  finally{if(id===requestId)loading.value=false}
}
watch(()=>[props.active,props.revision],()=>{if(props.active)void refresh()})
onMounted(()=>{if(props.active)void refresh()})
</script>
<template>
  <section class="panel wallet-panel" aria-label="交通系ICとプリペイド資産">
    <header class="wallet-header">
      <div><h3>交通系IC・プリペイド</h3><p>Suica・PASMOなどの残高</p></div>
      <button type="button" class="wallet-refresh" :disabled="loading" aria-label="プリペイド残高を更新" @click="refresh">↻ 更新</button>
    </header>
    <p v-if="loading && !data" class="wallet-hint">残高を読み込み中…</p>
    <p v-if="error" class="wallet-error" role="alert">{{error}}</p>
    <p v-if="notice" class="wallet-success" role="status">{{notice}}</p>
    <template v-if="data">
      <div v-if="data.cards.length" class="wallet-total">
        <small>登録済みの残高合計</small>
        <strong>{{money(data.cards.reduce((sum,card)=>sum+Number(card.balance),0))}}</strong>
      </div>
      <p v-else class="wallet-hint">管理 → カード設定で「プリペイドカード」を選んで登録できます。</p>
      <div v-for="card in data.cards" :key="card.name" class="wallet-row">
        <div><strong>{{card.name}}</strong><small>チャージ {{money(card.charged)}} · 利用 {{money(card.spent)}}</small><small>開始 {{card.opening_date}} · 期首残高 {{money(card.opening_balance)}}</small><button type="button" class="wallet-edit" @click="startOpening(card)">期首残高を設定・修正</button></div>
        <div class="wallet-money" :class="{'wallet-negative':card.balance<0}">{{money(card.balance)}}<small v-if="card.balance<0">履歴を確認してください</small></div>
      </div>
      <form v-if="selected" class="wallet-opening-editor" @submit.prevent="saveOpening">
        <div class="wallet-opening-title">{{selected.name}} の期首残高</div>
        <p class="wallet-hint">{{selected.opening_date}} を起点とした残高を設定します。後からのチャージ・利用は自動計算されます。</p>
        <label>期首残高（円）<input v-model.number="openingDraft" type="number" step="1" min="0" max="100000000" required /></label>
        <div class="wallet-editor-actions"><button type="button" @click="selected=null" :disabled="saving">キャンセル</button><button type="submit" :disabled="saving">{{saving?'保存中…':'保存'}}</button></div>
      </form>
      <details v-if="data.recharges.length" class="wallet-recharge">
        <summary>最近のチャージ（{{data.recharges.length}}件）</summary>
        <div v-for="entry in data.recharges" :key="entry.id" class="wallet-recharge-row">
          <span>{{entry.date}} · {{entry.transfer_target.slice(8)}}</span><strong>+{{money(entry.amount)}}</strong>
        </div>
      </details>
      <p class="wallet-note">チャージは資産移動、利用は支出として計算。実際のカード残高との同期ではありません。</p>
    </template>
  </section>
</template>
<style scoped>
.wallet-panel{padding:16px;display:grid;gap:10px;min-width:0}
.wallet-header{display:flex;align-items:center;justify-content:space-between;gap:10px}.wallet-header h3{font-size:15px;margin:0}.wallet-header p{font-size:11px;color:var(--muted);margin:3px 0 0}
.wallet-refresh{border:0;background:var(--paper);color:var(--blue-dark);font-weight:750;border-radius:10px;min-height:44px;padding:8px 12px;font-size:12px}
.wallet-total{display:grid;gap:3px;border-radius:14px;padding:14px;background:color-mix(in srgb,var(--teal) 10%,var(--card))}
.wallet-total small,.wallet-row small{color:var(--muted);font-size:11px}
.wallet-total strong{font-size:27px;font-variant-numeric:tabular-nums}
.wallet-row{border-top:1px solid var(--line);padding:12px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:9px}
.wallet-row>div:first-child{display:grid;gap:5px;min-width:0}.wallet-row strong{font-size:13px}
.wallet-money{display:grid;gap:3px;justify-items:end;white-space:nowrap;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}.wallet-negative{color:#c54d68}.wallet-money small{font-size:10px;white-space:normal}
.wallet-recharge summary{font-size:12px;font-weight:750;cursor:pointer;min-height:44px;padding:12px 0}
.wallet-recharge-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;padding:9px 0;border-top:1px solid var(--line)}
.wallet-hint,.wallet-note{font-size:11px;color:var(--muted);line-height:1.6;margin:0}
.wallet-note{border-top:1px solid var(--line);padding-top:10px}.wallet-error{font-size:12px;color:#9b2938}
.wallet-edit{font-size:11px;color:var(--blue-dark);background:transparent;border:0;padding:8px 0;text-align:left;min-height:36px;font-weight:750}
.wallet-opening-editor{display:grid;gap:10px;padding:14px;border-radius:14px;background:var(--paper);border:1px solid var(--line)}
.wallet-opening-title{font-size:13px;font-weight:800}
.wallet-opening-editor label{display:grid;gap:6px;font-size:12px;font-weight:750}
.wallet-opening-editor input{font-size:16px;min-height:44px;border-radius:10px}
.wallet-editor-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.wallet-editor-actions button{min-height:44px;border-radius:11px;border:1px solid var(--line);background:var(--card);font-size:12px;font-weight:750;color:var(--ink)}
.wallet-editor-actions button[type=submit]{color:white;background:var(--blue);border-color:var(--blue)}
.wallet-success{font-size:11px;color:#178367;margin:0}
</style>
