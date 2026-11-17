<script setup>
import {computed,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},accounts:{type:Array,required:true}})
const emit=defineEmits(['changed'])
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const cards=computed(()=>props.accounts.filter(x=>x.owner_user_id===props.userId&&x.origin==='member_created'&&x.account_kind==='prepaid'&&!x.is_archived))
const opened=ref(false),busy=ref(false),error=ref(''),message=ref('')
const account=ref(''),amount=ref(''),date=ref(today()),verified=ref(false),history=ref([]),page=ref(0)
const pages=computed(()=>Math.max(1,Math.ceil(history.value.length/5)))
const displayed=computed(()=>history.value.slice(page.value*5,page.value*5+5))
let pending=null,pendingCorrection=null,epoch=0
const editing=ref(null),editAccount=ref(''),editAmount=ref(''),editDate=ref(''),editReason=ref(''),editConfirmed=ref(false)
async function api(options={},endpoint='member-prepaid-topups'){
 const r=await fetch('/api/family-finance/'+endpoint,{credentials:'same-origin',cache:'no-store',...options})
 const x=await r.json().catch(()=>({}))
 if(!r.ok||x.ok!==true)throw Error(x.code||'チャージの保存状態を確認できません')
 return x
}
async function load(){
 const e=++epoch,uid=props.userId
 try{
  const x=await api({},'member-prepaid-topup-corrections')
  if(e!==epoch||uid!==props.userId)return
  if(x.scope!=='personal'||x.viewer_user_id!==uid||x.ledger_changed!==false)
   throw Error('本人の記録範囲を確認できません')
  history.value=Array.isArray(x.items)?x.items:[];page.value=Math.min(page.value,pages.value-1)
 }catch(err){if(e===epoch)error.value=err.message}
}
function toggle(){
 opened.value=!opened.value
 if(opened.value){account.value=account.value||cards.value[0]?.account_id||'';void load()}
 else{epoch++;history.value=[];editing.value=null}
}
async function save(){
 const selected=cards.value.find(x=>x.account_id===account.value),value=Number(amount.value)
 if(busy.value||!selected||!verified.value||!Number.isSafeInteger(value)||value<1||value>10000000||
  !date.value||date.value>today())return
 const payload={expected_user_id:props.userId,prepaid_account_id:selected.account_id,
  prepaid_version:selected.version,amount_jpy:value,effective_date:date.value,confirmed:true}
 const snapshot=JSON.stringify(payload)
 if(pending&&pending.snapshot!==snapshot){error.value='前回の送信結果を先に確認してください';return}
 if(!pending)pending={snapshot,key:'prepaid-topup:'+crypto.randomUUID()}
 if(!window.confirm('実際のチャージがカード残高に反映されたことを確認しますか？収入・支出は記帳しません。'))return
 busy.value=true;error.value='';message.value=''
 try{
  const x=await api({method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({...payload,idempotency_key:pending.key})})
  if(x.ledger_changed!==false||x.topup?.amount_jpy!==value)throw Error('保存結果を確認できません')
  pending=null;verified.value=false;amount.value=''
  message.value='本人のチャージ記録を保存しました。管理者の承認は不要です。'
  await load();emit('changed')
 }catch(err){error.value=err.message}finally{busy.value=false}
}
function startCorrection(row){
 if(busy.value)return
 editing.value=row;editAccount.value=row.prepaid_account_id
 editAmount.value=String(row.amount_jpy);editDate.value=row.effective_date
 editReason.value='';editConfirmed.value=false;pendingCorrection=null;error.value=''
}
async function correct(){
 const row=editing.value,selected=cards.value.find(c=>c.account_id===editAccount.value)
 const value=Number(editAmount.value)
 if(!row||busy.value||!selected||!editConfirmed.value||!Number.isSafeInteger(value)||
  value<1||value>10000000||!editDate.value||editDate.value>today()||
  editReason.value.trim().length<2||editReason.value.length>200)return
 const payload={expected_user_id:props.userId,
  expected_revision:row.correction_revision||0,prepaid_account_id:selected.account_id,
  prepaid_version:selected.version,amount_jpy:value,effective_date:editDate.value,
  reason:editReason.value.trim(),confirmed:true}
 const snapshot=JSON.stringify({request_id:row.request_id,...payload})
 if(pendingCorrection&&pendingCorrection.snapshot!==snapshot){
  error.value='前回の訂正結果が未確認です。同じ内容で再試行してください';return
 }
 if(!pendingCorrection)pendingCorrection={snapshot,key:'prepaid-correction:'+crypto.randomUUID()}
 if(!window.confirm('元の記録は残し、訂正差額を関連するカード残高に反映します。収入・支出は作成しません。よろしいですか？'))return
 busy.value=true;error.value='';message.value=''
 const actor=props.userId,ticket=epoch
 try{
  const result=await api({method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({...payload,idempotency_key:pendingCorrection.key})},
   'member-prepaid-topup-corrections/'+encodeURIComponent(row.request_id))
  if(actor!==props.userId||ticket!==epoch)return
  if(result.scope!=='personal'||result.ledger_changed!==false||
   result.correction?.request_id!==row.request_id||
   result.correction?.correction_revision!==(row.correction_revision||0)+1)
   throw Error('訂正結果を確認できません')
  pendingCorrection=null;editing.value=null;editConfirmed.value=false
  message.value='本人のチャージを訂正し、関連する残高を同期しました。'
  busy.value=false
  await load();emit('changed')
 }catch(err){if(actor===props.userId&&ticket===epoch)error.value=err.message}
 finally{if(actor===props.userId&&ticket===epoch)busy.value=false}
}
watch(()=>props.userId,()=>{epoch++;opened.value=false;pending=null;pendingCorrection=null;
 editing.value=null;account.value='';history.value=[]})
</script>
<template>
<section class="member-topup">
 <header><strong>本人の電子マネー・チャージ</strong>
  <button type="button" @click="toggle">{{opened?'閉じる':'記録を追加'}}</button></header>
 <template v-if="opened">
  <p class="hint">銀行口座不要。カードに実際に反映されたチャージだけを記録します。収入・支出には計上されません。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="message" role="status" class="hint">{{message}}</p>
  <form @submit.prevent="save">
   <p v-if="!cards.length" class="hint">本人の電子マネーを先に追加してください。</p>
   <label>チャージ先<select v-model="account" required :disabled="busy">
    <option value="">選択してください</option>
    <option v-for="c in cards" :key="c.account_id" :value="c.account_id">{{c.label}}</option>
   </select></label>
   <label>チャージ金額（円）<input v-model="amount" type="number" min="1" max="10000000" required :disabled="busy"/></label>
   <label>反映日<input v-model="date" type="date" :max="today()" required :disabled="busy"/></label>
   <label class="confirm"><input v-model="verified" type="checkbox" :disabled="busy"/>実際にカード残高への反映を確認済み</label>
   <button type="submit" :disabled="busy||!verified||!account||!amount">{{busy?'保存中…':'チャージを記録'}}</button>
  </form>
  <div v-if="history.length" class="history">
   <strong>最近のチャージ</strong>
   <div v-for="h in displayed" :key="h.request_id" class="topup-history-row">
    <span>{{h.effective_date}} · {{cards.find(c=>c.account_id===h.prepaid_account_id)?.label||'本人のカード'}} · ¥{{Number(h.amount_jpy).toLocaleString('ja-JP')}}{{h.correction_revision?' · 訂正済':''}}</span>
    <button type="button" :disabled="busy" @click="startCorrection(h)">訂正</button>
   </div>
   <form v-if="editing" class="topup-correction" @submit.prevent="correct" role="group" aria-label="チャージ記録を訂正">
    <strong>チャージ記録の訂正</strong>
    <label>訂正先の本人カード<select v-model="editAccount" :disabled="busy" required>
     <option v-for="c in cards" :key="c.account_id" :value="c.account_id">{{c.label}}</option>
    </select></label>
    <label>訂正後の金額（円）<input v-model="editAmount" type="number" min="1" max="10000000" required :disabled="busy"/></label>
    <label>訂正後の反映日<input v-model="editDate" type="date" :max="today()" required :disabled="busy"/></label>
    <label>訂正理由<input v-model="editReason" maxlength="200" minlength="2" placeholder="例：金額の誤入力を訂正" required :disabled="busy"/></label>
    <label class="confirm"><input v-model="editConfirmed" type="checkbox" :disabled="busy"/>実際の残高と明細を確認しました</label>
    <div class="correction-actions">
     <button type="button" :disabled="busy" @click="editing=null;pendingCorrection=null">キャンセル</button>
     <button type="submit" :disabled="busy||!editConfirmed||editReason.trim().length<2">{{busy?'訂正中…':'残高を同時に訂正'}}</button>
    </div>
   </form>
   <nav v-if="pages>1"><button type="button" :disabled="page===0" @click="page--">前へ</button>
    {{page+1}} / {{pages}} <button type="button" :disabled="page+1>=pages" @click="page++">次へ</button></nav>
  </div>
 </template>
</section>
</template>
<style scoped>
.member-topup,form,.history,label{display:grid;gap:8px;min-width:0}
.member-topup{padding:12px;border:1px solid var(--line,#ddd);border-radius:12px}
header,nav{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
input,select,button{font:inherit;max-width:100%;box-sizing:border-box;padding:8px;min-height:42px;border-radius:9px;border:1px solid var(--line,#ddd);background:var(--card,#fff);color:inherit}
.confirm{display:flex;align-items:center;font-size:12px}.confirm input{min-height:0}
.hint{font-size:12px;color:var(--muted,#777)}.error{font-size:12px;color:#a33}
.topup-history-row{display:flex;gap:8px;align-items:center;justify-content:space-between;min-width:0}.topup-history-row span{min-width:0;overflow-wrap:anywhere}.topup-history-row button{flex:none}.topup-correction{padding:10px;border:1px solid var(--line,#ddd);border-radius:10px}.correction-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
</style>