<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true},
 accounts:{type:Array,required:true},view:{type:String,default:'investment'},
 embedded:{type:Boolean,default:false}})
const emit=defineEmits(['changed'])
const nowMonth=()=>new Date(Date.now()+32400000).toISOString().slice(0,7)
const open=ref(false),editorOpen=ref(false),busy=ref(false),available=ref(false)
const error=ref(''),notice=ref(''),plans=ref([]),page=ref(0)
const form=ref({securities_account_id:'',amount_jpy:'',due_day:1,start_month:nowMonth(),
 end_month:nowMonth(),fund_code:'',fund_name:''})
const securities=computed(()=>props.accounts.filter(a=>a.owner_user_id===props.userId&&
 a.account_kind==='securities'&&a.origin==='member_created'&&Number(a.is_archived)===0))
const visible=computed(()=>plans.value.filter(p=>p.owner_user_id===props.userId))
const pageCount=computed(()=>Math.max(1,Math.ceil(visible.value.length/5)))
const shown=computed(()=>visible.value.slice(page.value*5,page.value*5+5))
const yen=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(n)
const canSave=computed(()=>securities.value.some(a=>a.account_id===form.value.securities_account_id)&&
 Number.isInteger(Number(form.value.amount_jpy))&&Number(form.value.amount_jpy)>=1&&
 Number(form.value.amount_jpy)<=10000000&&Number.isInteger(Number(form.value.due_day))&&
 Number(form.value.due_day)>=1&&Number(form.value.due_day)<=28&&
 /^20\d\d-(0[1-9]|1[0-2])$/.test(form.value.start_month)&&
 form.value.start_month>=nowMonth()&&form.value.end_month>=form.value.start_month&&
 /^[A-Z0-9]{8}$/.test(form.value.fund_code)&&form.value.fund_name.trim())
let generation=0,alive=true,pending=null
async function api(path,opt={}){
 if(navigator.onLine===false)throw Error('オフライン中の操作はできません')
 const r=await fetch('/api/family-finance/member-sbi-plans'+path,{credentials:'same-origin',cache:'no-store',...opt})
 const data=await r.json().catch(()=>({}))
 if(!r.ok||data.ok!==true)throw Error(data.code||'積立計画を確認できません')
 return data
}
const post=data=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
async function refresh(){
 const n=++generation,actor=props.userId,household=props.householdId
 try{
  const result=await api('')
  if(!alive||n!==generation||actor!==props.userId||household!==props.householdId)return
  if(result.scope!=='personal'||result.viewer_user_id!==actor||result.ledger_changed!==false)
   throw Error('本人の設定だけを取得できます')
  plans.value=Array.isArray(result.items)?result.items:[];available.value=true;error.value=''
  page.value=Math.min(page.value,pageCount.value-1)
 }catch(e){if(n===generation){error.value=e.message;available.value=false}}
}
function openPlanEditor(){
 open.value=true;editorOpen.value=true;error.value=''
 if(!form.value.securities_account_id)form.value.securities_account_id=securities.value[0]?.account_id||''
 void refresh()
}
async function save(){
 if(busy.value||!canSave.value||!available.value)return
 if(!window.confirm('本人の積立予定だけを登録します。買付や振替は実行しません。'))return
 const actor=props.userId,account=securities.value.find(a=>a.account_id===form.value.securities_account_id)
 const payload={expected_user_id:actor,securities_account_id:account.account_id,
  securities_version:account.version,amount_jpy:Number(form.value.amount_jpy),
  due_day:Number(form.value.due_day),start_month:form.value.start_month,end_month:form.value.end_month,
  fund_code:form.value.fund_code,fund_name:form.value.fund_name.trim(),account_type:'tsumitate'}
 const snapshot=JSON.stringify(payload)
 if(pending&&pending.snapshot!==snapshot){error.value='前回の保存結果を確認してから変更してください';return}
 if(!pending)pending={snapshot,key:'sbi-plan:'+crypto.randomUUID()}
 busy.value=true;error.value=''
 try{
  const r=await api('',post({...payload,idempotency_key:pending.key}))
  if(r.ledger_changed!==false||r.plan?.owner_user_id!==actor)throw Error('記録結果を確認できません')
  pending=null;editorOpen.value=false;notice.value='積立予定を保存しました。管理者の承認は不要です。'
  await refresh();emit('changed')
 }catch(e){error.value=e.message}finally{busy.value=false}
}
async function revoke(p){
 if(busy.value||!window.confirm('この積立予定を停止しますか？'))return
 busy.value=true;error.value=''
 try{
  const r=await api('/'+p.plan_resource_id+'/revoke',post({
   expected_user_id:props.userId,confirm_resource_id:p.plan_resource_id}))
  if(r.revoked!==true||r.ledger_changed!==false)throw Error('停止結果を確認できません')
  notice.value='積立予定を停止しました';await refresh();emit('changed')
 }catch(e){error.value=e.message}finally{busy.value=false}
}
function toggle(){open.value=!open.value;if(open.value)void refresh()}
watch(()=>[props.userId,props.householdId],()=>{generation++;plans.value=[];pending=null;editorOpen.value=false;void refresh()})
onMounted(()=>{void refresh()})
onUnmounted(()=>{alive=false;generation++})
defineExpose({openPlanEditor})
</script>
<template>
<section v-if="!embedded || open" class="personal-sbi-plans">
 <header v-if="!embedded"><strong>本人のSBI積立計画</strong>
  <button type="button" @click="toggle">{{open?'閉じる':'開く'}}</button></header>
 <div v-else class="embedded-plan-heading"><strong>積立設定</strong>
  <button type="button" @click="open=false;editorOpen=false">閉じる</button></div>
 <template v-if="open">
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="hint">{{notice}}</p>
  <button v-if="available&&!editorOpen" type="button" @click="openPlanEditor">＋ 積立予定を登録</button>
  <form v-if="available&&editorOpen" @submit.prevent="save">
   <p v-if="!securities.length" class="hint">残高画面で本人の証券口座を追加してください。</p>
   <label>本人の証券口座
    <select v-model="form.securities_account_id" :disabled="busy">
     <option value="">選択してください</option>
     <option v-for="a in securities" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
    </select>
   </label>
   <label>銘柄コード<input v-model.trim="form.fund_code" maxlength="8" placeholder="8文字" required/></label>
   <label>銘柄名<input v-model="form.fund_name" maxlength="120" required/></label>
   <div class="pair">
    <label>毎月の金額（円）<input v-model="form.amount_jpy" type="number" min="1" max="10000000" required/></label>
    <label>毎月の日付<input v-model.number="form.due_day" type="number" min="1" max="28" required/></label>
   </div>
   <div class="pair">
    <label>開始月<input v-model="form.start_month" type="month" required/></label>
    <label>終了月<input v-model="form.end_month" type="month" required/></label>
   </div>
   <button type="submit" :disabled="busy||!canSave">{{busy?'保存中…':'積立予定を保存'}}</button>
   <button type="button" :disabled="busy" @click="editorOpen=false">キャンセル</button>
  </form>
  <div class="items">
   <p v-if="!visible.length" class="hint">積立予定は未登録です。</p>
   <article v-for="p in shown" :key="p.plan_resource_id">
    <strong>{{p.fund_name}} · {{yen(p.amount_jpy)}}</strong>
    <span>{{p.start_month}}～{{p.end_month}} · 毎月{{p.due_day}}日 · {{p.state==='active'?'有効':'停止'}}</span>
    <button v-if="p.state==='active'" type="button" :disabled="busy" @click="revoke(p)">停止</button>
   </article>
   <nav v-if="pageCount>1"><button type="button" :disabled="page===0" @click="page--">前へ</button>
    <span>{{page+1}} / {{pageCount}}</span><button type="button" :disabled="page+1>=pageCount" @click="page++">次へ</button></nav>
  </div>
 </template>
</section>
</template>
<style scoped>
.personal-sbi-plans{display:grid;gap:10px;border:1px solid var(--line,#ddd);border-radius:12px;padding:12px;min-width:0}
header,.pair,nav{display:flex;align-items:center;justify-content:space-between;gap:10px}
header{flex-wrap:wrap}.pair>*{flex:1;min-width:0}
form,.items,article,label{display:grid;gap:8px;min-width:0}
article{padding:10px;border:1px solid var(--line,#ddd);border-radius:10px}
article span,.hint{font-size:12px;color:var(--muted,#777)}
label{font-size:13px}input,select,button{font:inherit;max-width:100%;box-sizing:border-box;min-height:42px;padding:8px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);color:inherit}
.error{color:#a33;font-size:12px}
@media(max-width:380px){.pair{flex-direction:column;align-items:stretch}}
</style>
