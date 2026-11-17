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
let pending=null,epoch=0
async function api(options={}){
 const r=await fetch('/api/family-finance/member-prepaid-topups',{credentials:'same-origin',cache:'no-store',...options})
 const x=await r.json().catch(()=>({}))
 if(!r.ok||x.ok!==true)throw Error(x.code||'チャージの保存状態を確認できません')
 return x
}
async function load(){
 const e=++epoch,uid=props.userId
 try{
  const x=await api()
  if(e!==epoch||uid!==props.userId)return
  if(x.scope!=='personal'||x.viewer_user_id!==uid||x.ledger_changed!==false)
   throw Error('本人の記録範囲を確認できません')
  history.value=Array.isArray(x.items)?x.items:[];page.value=Math.min(page.value,pages.value-1)
 }catch(err){if(e===epoch)error.value=err.message}
}
function toggle(){
 opened.value=!opened.value
 if(opened.value){account.value=account.value||cards.value[0]?.account_id||'';void load()}
 else{epoch++;history.value=[]}
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
watch(()=>props.userId,()=>{epoch++;opened.value=false;pending=null;account.value='';history.value=[]})
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
   <div v-for="h in displayed" :key="h.request_id">{{h.effective_date}} · ¥{{Number(h.amount_jpy).toLocaleString('ja-JP')}}</div>
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
</style>