<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true},headless:{type:Boolean,default:false},onlyWhenOpen:{type:Boolean,default:false}})
const open=ref(false),busy=ref(false),error=ref(''),message=ref(''),
 proposals=ref([]),rows=ref([]),deleted=ref([]),available=ref(false),
 action=ref('create'),resource=ref(''),prepared=ref(null),stableKey=ref('')
const draft=ref({date:new Date(Date.now()+32400000).toISOString().slice(0,10),
 time:'',amount:'',type:'expense',category:'食費',merchant:'',note:''})
let version=0,alive=true
const chosen=computed(()=>[...rows.value,...deleted.value].find(x=>x.resource_id===resource.value)||null)
const items=computed(()=>action.value==='restore'?deleted.value:rows.value)
const canWrite=computed(()=>open.value&&available.value&&
 (action.value==='create'||!!chosen.value)&&
 (action.value!=='create'||(draft.value.date&&Number.isSafeInteger(Number(draft.value.amount))&&
 Number(draft.value.amount)>0&&draft.value.category.trim())))
const statusText=x=>x.status==='prepared'?'未提出':x.status==='submitted_status_unknown'?
 'HomeFlow に提出済み・管理者の審査待ち':x.status
function reset(){version++;open.value=false;busy.value=false;available.value=false;error.value='';message.value='';
 rows.value=[];deleted.value=[];proposals.value=[];resource.value='';prepared.value=null;stableKey.value='';
 draft.value={date:new Date(Date.now()+32400000).toISOString().slice(0,10),
 time:'',amount:'',type:'expense',category:'食費',merchant:'',note:''}}
async function api(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true)throw Error(data.code||'家庭の明細申請を利用できません')
 return data
}
const post=data=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
async function load(){
 const ticket=++version,actor=props.userId,household=props.householdId
 if(!open.value)return
 try{
  const [active,trash,pending]=await Promise.all([
   api('/api/family-finance/shared-entries?state=active'),
   api('/api/family-finance/shared-entries?state=deleted'),
   api('/api/family-finance/shared-mutation-requests')
  ])
  if(!alive||!open.value||ticket!==version||actor!==props.userId||household!==props.householdId)return
  rows.value=active.items||[];deleted.value=trash.items||[];proposals.value=pending.items||[]
  available.value=true;error.value=''
 }catch(e){
  if(ticket===version){rows.value=[];deleted.value=[];proposals.value=[];
   available.value=false;error.value=/DISABLED/.test(e.message)?'家庭明細の審査は利用できません。既存の明細は変更されません。':e.message}
 }
}
async function openForEntry(operation,entry){
 if(!['update','delete','restore'].includes(operation)||!entry?.id)return
 if(!open.value){open.value=true;await load()}
 const collection=operation==='restore'?deleted.value:rows.value
 const source=collection.find(x=>String(x.entry_id)===String(entry.id))
 if(!source){
  error.value='この明細は審査対象として未登録です。管理者に確認を依頼してください。'
  action.value=operation;resource.value=''
  return
 }
 error.value='';action.value=operation;resource.value=source.resource_id
 if(operation==='update')draft.value={...source.entry,...entry,
  amount:String(entry.amount),payment_source:undefined,transfer_target:undefined}
}
// Only household-ledger mutations enter HomeFlow. Personal accounts, cards
// and balances use their own owner-scoped APIs without these approvals.
// The normal editor calls this adapter: prepare and submit share one click.
let inlineRequest=null
function canonical(input){
 const e={date:String(input?.date||''),time:String(input?.time||''),
  amount:Number(input?.amount),type:String(input?.type||''),
  category:String(input?.category||'').trim(),
  merchant:String(input?.merchant||'').trim(),note:String(input?.note||'').trim()}
 if(e.type==='transfer'){
  if(input?.transferTarget!=='spouse')throw Error('配偶のみ振替先として選択できます')
  e.category='投資・資産移動'
  e.merchant='配偶への振替'
  e.transfer_target='spouse'
  e.transfer_date=e.date
 }
 // The normal ledger editor passes null for an unchanged/no-card payment.
 // Never turn that sentinel into the literal card name "null" on an update.
 if(input?.payment_source!=null){
  const card=String(input.payment_source)
  // Explicit empty string means the member selected cash instead of a card.
  // Absence means the historical payment method must remain unchanged.
  if(e.type!=='expense'||card.length>80||card!==card.trim())
   throw Error('共有カードを確認してください')
  e.payment_source=card
 }
 if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(e.date)||
  !/^([01]\d|2[0-3]):[0-5]\d$|^$/.test(e.time)||
  !Number.isSafeInteger(e.amount)||e.amount<1||e.amount>10000000||
  !['expense','income','transfer'].includes(e.type)||
  !e.category||e.category.length>100||e.merchant.length>120||e.note.length>500)
  throw Error('日付・金額・カテゴリ・内容を確認してください')
 return e
}
async function submitIntent(operation,entry,target=null){
 if(busy.value)throw Error('前の申請を処理中です')
 if(!['create','update','delete'].includes(operation))throw Error('操作が無効です')
 const snapshot=JSON.stringify({operation,entry,resource_id:target?.resource_id||null,
  expected_version:target?.version||0})
 if(inlineRequest&&inlineRequest.snapshot!==snapshot)
  throw Error('前の申請結果が未確定です。同じ内容で再試行してください')
 if(!inlineRequest)inlineRequest={snapshot,key:'shared-entry:'+crypto.randomUUID(),
  proposalId:null,userId:props.userId,householdId:props.householdId}
 const pending=inlineRequest
 if(pending.userId!==props.userId||pending.householdId!==props.householdId)
  throw Error('別の家族の申請を再送できません')
 busy.value=true
 try{
  if(!pending.proposalId){
   const result=await api('/api/family-finance/shared-mutation-requests',
    post({expected_user_id:props.userId,idempotency_key:pending.key,
     operation,resource_id:target?.resource_id||null,
     expected_version:target?.version||0,entry}))
   const data=result.prepared
   if(data?.applied!==false||!data?.proposal_id)
    throw Error('申請の準備結果を確認できません')
   pending.proposalId=data.proposal_id
   if(data.status==='submitted_status_unknown'&&data.homeflow_approval_id){
    inlineRequest=null
    return {proposalId:pending.proposalId,status:data.status}
   }
   if(data.status!=='prepared')throw Error('申請の受付状態を確認してください')
  }
  const result=await api('/api/family-finance/shared-mutation-requests/'+
   encodeURIComponent(pending.proposalId)+'/submit',
   post({expected_user_id:props.userId}))
  if(result.applied!==false||result.status!=='submitted_status_unknown')
   throw Error('HomeFlow の受付が未確認です。重複申請しないでください')
  inlineRequest=null
  return {proposalId:pending.proposalId,status:result.status}
 }finally{busy.value=false}
}
async function submitEntry(input){return submitIntent('create',canonical(input))}
async function submitMutation(operation,original,edited=null){
 if(!['update','delete'].includes(operation)||!Number.isSafeInteger(Number(original?.id))||
  original?.pending_approval)throw Error('承認待ちの明細は変更できません')
 if(inlineRequest&&inlineRequest.operation!==undefined&&inlineRequest.operation!==operation)
  throw Error('前の申請を確認してください')
 // Resolve an approved resource and its CAS version from the server, never
 // trust an arbitrary entry ID or browser-provided version.
 // Lookup by the immutable entry ID: a paginated 50-record registry list
 // misses older self-created spouse transfers.
 const result=await api('/api/family-finance/shared-entries?entry_id='+
  encodeURIComponent(String(original.id)))
 const target=result.action
 if(!target||target.state!=='active'||String(target.entry_id)!==String(original.id))
  throw Error('この明細は共有審査対象に登録されていません')
 const pending=await api('/api/family-finance/shared-mutation-requests?view=ledger&month='+
  encodeURIComponent(String(original.date).slice(0,7)))
 if((pending.items||[]).some(r=>String(r.source_entry_id)===String(original.id)))
  throw Error('この明細には審査中の変更があります')
 const entry=operation==='update'?canonical(edited):null
 return submitIntent(operation,entry,target)
}
defineExpose({submitEntry,submitMutation,openForEntry})
async function toggle(){
 if(busy.value)return
 open.value=!open.value
 if(!open.value){version++;prepared.value=null;rows.value=[];deleted.value=[];return}
 await load()
}
function record(){
 const p=draft.value
 return {date:p.date,time:p.time,amount:Number(p.amount),type:p.type,
  category:p.category.trim(),merchant:p.merchant.trim(),note:p.note.trim()}
}
function startChange(row,op){
 if(busy.value||prepared.value)return
 action.value=op;resource.value=row.resource_id;
 if(op==='update')draft.value={...row.entry,amount:String(row.entry.amount)}
}
async function prepare(){
 if(!canWrite.value||busy.value||prepared.value||!window.confirm(
  '明細変更を申請します。HomeFlow で管理者の承認が必要です。続けますか？'))return
 const ticket=version,actor=props.userId,household=props.householdId
 const op=action.value,selected=chosen.value
 const payload={expected_user_id:actor,
  idempotency_key:stableKey.value||'shared-entry:'+crypto.randomUUID(),
  operation:op,resource_id:op==='create'?null:selected?.resource_id,
  expected_version:op==='create'?0:selected?.version,
  entry:['create','update'].includes(op)?record():null}
 if(!payload.entry&&['create','update'].includes(op))return
 stableKey.value=payload.idempotency_key
 busy.value=true;error.value='';message.value=''
 try{
  const result=await api('/api/family-finance/shared-mutation-requests',post(payload))
  if(ticket!==version||actor!==props.userId||household!==props.householdId)return
  if(result.prepared?.status!=='prepared'||result.prepared?.applied!==false)
   throw Error('申請の受付結果を確認できません')
  prepared.value=result.prepared;message.value='申請を保存しました。明細は未変更です。HomeFlow に提出してください。'
 }catch(e){if(ticket===version)error.value=e.message}
 finally{if(ticket===version)busy.value=false}
}
async function submit(p=prepared.value){
 if(!p||busy.value||p.status!=='prepared')return
 const ticket=version,actor=props.userId,hh=props.householdId
 busy.value=true;error.value='';message.value=''
 try{
  const result=await api('/api/family-finance/shared-mutation-requests/'+p.proposal_id+'/submit',
   post({expected_user_id:actor}))
  if(ticket!==version||actor!==props.userId)return
  if(result.applied!==false||result.status!=='submitted_status_unknown')
   throw Error('審査結果を確認できません。元の申請で再確認してください')
  prepared.value=null;stableKey.value=''
  message.value='HomeFlow に申請を送信しました。承認・実行後に明細へ反映されます。'
  await load()
 }catch(e){if(ticket===version)error.value=e.message}
 finally{if(actor===props.userId&&hh===props.householdId&&alive)busy.value=false}
}
async function cancel(){
 if(!prepared.value||busy.value)return
 const ticket=version,actor=props.userId,hh=props.householdId
 busy.value=true;error.value=''
 try{
  const result=await api('/api/family-finance/shared-mutation-requests/'+prepared.value.proposal_id+'/cancel',
   post({expected_user_id:actor}))
  if(ticket!==version||actor!==props.userId)return
  if(result.status!=='cancelled')throw Error('未提出の申請だけを取り消せます')
  prepared.value=null;stableKey.value='';message.value='申請を取り消しました。明細は変更されていません'
  await load()
 }catch(e){if(ticket===version)error.value=e.message}
 finally{if(actor===props.userId&&hh===props.householdId&&alive)busy.value=false}
}
function foreground(){
 if(document.visibilityState!=='visible')return
 version++;prepared.value=null;stableKey.value='';rows.value=[];deleted.value=[];proposals.value=[]
 if(open.value)void load()
}
watch(resource,()=>{
 if(action.value==='update'&&chosen.value?.entry)
  draft.value={...chosen.value.entry,amount:String(chosen.value.entry.amount)}
})
watch(()=>[props.userId,props.householdId],reset)
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{alive=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
<section v-if="!headless && (!onlyWhenOpen || open)" class="shared-request" aria-label="家庭明細の変更申請">
 <header><strong>家庭明細の変更申請</strong>
  <button type="button" :aria-expanded="open" :disabled="busy" @click="toggle">{{open?'閉じる':'申請'}}</button></header>
 <template v-if="open">
  <p class="hint">家庭明細の追加・変更・削除・復元は管理者の承認後に反映されます。共有カード支出も対象です。</p>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <p v-if="message" class="hint" role="status">{{message}}</p>
  <form v-if="available" class="editor" @submit.prevent="prepared?submit():prepare()">
   <label>申請内容<select v-model="action" :disabled="busy||!!prepared" @change="resource=''">
    <option value="create">明細を追加</option><option value="update">明細を変更</option>
    <option value="delete">ゴミ箱へ移動</option><option value="restore">ゴミ箱から復元</option>
   </select></label>
   <label v-if="action!=='create'">対象の明細
    <select v-model="resource" :disabled="busy||!!prepared" required>
     <option value="">選択してください</option><option v-for="row in items" :key="row.resource_id"
      :value="row.resource_id">{{row.entry?.date}} · {{row.entry?.merchant||row.entry?.category}} · v{{row.version}}</option>
    </select>
   </label>
   <template v-if="action==='create'||action==='update'">
    <label>日付<input v-model="draft.date" type="date" :disabled="busy||!!prepared"/></label>
    <label>収支<select v-model="draft.type" :disabled="busy||!!prepared"><option value="expense">支出</option><option value="income">収入</option></select></label>
    <label>金額（円）<input v-model="draft.amount" type="number" min="1" max="10000000" required :disabled="busy||!!prepared"/></label>
    <label>カテゴリ<input v-model="draft.category" maxlength="100" required :disabled="busy||!!prepared"/></label>
    <label>店舗・入金元<input v-model="draft.merchant" maxlength="120" :disabled="busy||!!prepared"/></label>
    <label>メモ<textarea v-model="draft.note" maxlength="500" :disabled="busy||!!prepared" rows="2"/></label>
   </template>
   <button type="submit" :disabled="busy||(!prepared&&!canWrite)">{{prepared?'HomeFlow に審査を提出':'審査申請を保存'}}</button>
   <button v-if="prepared" type="button" :disabled="busy" @click="cancel">未提出の申請を取り消す</button>
  </form>
  <div v-if="available" class="history"><strong>最近の申請</strong>
   <div v-for="r in proposals" :key="r.proposal_id" class="item">
    <span>{{r.operation}} · {{statusText(r)}} · {{r.proposal_id.slice(0,8)}}</span>
    <button v-if="r.status==='prepared'" type="button" :disabled="busy||!!prepared"
     @click="prepared=r">元の申請を再開</button>
   </div>
  </div>
 </template>
</section>
</template>
<style scoped>
.shared-request{display:grid;gap:8px;min-width:0;border:1px solid var(--line,#d7e0df);border-radius:12px;padding:12px}
.shared-request header,.item{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.shared-request strong{font-size:14px}.shared-request button{min-height:39px;padding:7px 12px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff)}
.shared-request button:disabled{opacity:.55}.hint,.error,.item{font-size:12px;overflow-wrap:anywhere;margin:0}
.error{color:#a52f2f}.editor{display:grid;gap:8px}
.editor label{display:grid;gap:4px;font-size:12px}
.editor input,.editor textarea,.editor select{box-sizing:border-box;min-width:0;width:100%;max-width:100%;padding:9px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);color:inherit}
.history{display:grid;gap:8px}.item{padding:8px;border:1px solid var(--line,#ddd);border-radius:9px}
</style>
