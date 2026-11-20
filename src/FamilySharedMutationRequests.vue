<script setup>
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import {readMemberDeviceState,writeMemberDeviceState,clearMemberDeviceState} from './draft-store.js'
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
const reviewLabels=Object.freeze({
 prepared:'未提出',
 submitted_status_unknown:'HomeFlow に提出済み・状態を確認中',
 pending:'審査待ち',
 approved:'承認済み・記帳待ち',
 executing:'記帳処理中',
 applied:'記帳済み',
 rejected:'却下・未記帳',
 cancelled:'取り消し済み・未記帳',
 expired:'期限切れ・未記帳',
 failed_retryable:'実行結果を再確認中',
 failed_final:'実行失敗・未記帳',
 conflict:'競合・再確認が必要'
})
const statusText=x=>reviewLabels[x.status]||'状態を確認中'
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
  if(!stableKey.value&&!prepared.value){
   const saved=await readMemberDeviceState(actor,household,'shared-editor')
   if(saved){
    if(saved.userId!==actor||saved.householdId!==household||
      !/^shared-entry:[0-9a-f-]{36}$/.test(saved.key||'')||
      typeof saved.snapshot!=='string')
     throw Error('前回の申請を復元できません。重複申請を防ぐため新規送信しないでください')
    const prior=JSON.parse(saved.snapshot)
    if(!['create','update','delete','restore'].includes(prior.operation))
     throw Error('前回の申請の操作種類を確認できません')
    if(ticket!==version||actor!==props.userId||household!==props.householdId)return
    action.value=prior.operation
    resource.value=prior.resource_id||''
    await nextTick() // let the resource watcher run before restoring edited values
    if(ticket!==version||actor!==props.userId||household!==props.householdId)return
    if(prior.entry)draft.value={...prior.entry,amount:String(prior.entry.amount)}
    stableKey.value=saved.key
    message.value='前回の申請を復元しました。元の内容で再送して受付状態を確認できます。'
   }
  }
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
// Inline approvals use a durable replay receipt, separate for each verified
// HomeFlow member. Persist BEFORE POST; a crashed PWA must replay the same key.
async function submitIntent(operation,entry,target=null){
 if(busy.value)throw Error('前の申請を処理中です')
 if(!['create','update','delete','restore'].includes(operation))throw Error('操作が無効です')
 const actor=props.userId,household=props.householdId
 const snapshot=JSON.stringify({operation,entry,resource_id:target?.resource_id||null,
  expected_version:target?.version||0})
 busy.value=true
 try{
  if(!inlineRequest){
   const saved=await readMemberDeviceState(actor,household,'shared-inline')
   if(saved){
    if(saved.userId!==actor||saved.householdId!==household||
      !/^shared-entry:[0-9a-f-]{36}$/.test(saved.key||'')||
      typeof saved.snapshot!=='string')
     throw Error('前回の申請の再送情報が破損しています。新しい申請を送信しないでください')
    inlineRequest=saved
   }
  }
  if(inlineRequest?.snapshot!==snapshot){
   if(inlineRequest?.acknowledged){
    // The old intent has a durable server receipt. A different user action
    // may start a new intent; the original has already been acknowledged.
    await clearMemberDeviceState(actor,household,'shared-inline')
    inlineRequest=null
   }else if(inlineRequest)throw Error('前回の送信結果が未確認です。元の内容で再試行してください')
  }
  if(!inlineRequest){
   inlineRequest={snapshot,key:'shared-entry:'+crypto.randomUUID(),
    proposalId:null,userId:actor,householdId:household,acknowledged:false}
   await writeMemberDeviceState(actor,household,inlineRequest,'shared-inline')
  }
  const pending=inlineRequest
  if(pending.userId!==actor||pending.householdId!==household||
    pending.snapshot!==snapshot)throw Error('別の家族の申請を再送できません')
  if(pending.acknowledged){
   if(!pending.proposalId)throw Error('提出済み申請の受付番号がありません')
   return {proposalId:pending.proposalId,status:pending.status||'submitted_status_unknown'}
  }
  if(!pending.proposalId){
   const result=await api('/api/family-finance/shared-mutation-requests',
    post({expected_user_id:actor,idempotency_key:pending.key,
     operation,resource_id:target?.resource_id||null,
     expected_version:target?.version||0,entry}))
   const data=result.prepared
   if(data?.applied!==false||!data?.proposal_id)
    throw Error('申請の準備結果を確認できません')
   pending.proposalId=data.proposal_id
   await writeMemberDeviceState(actor,household,pending,'shared-inline')
   if(data.status==='submitted_status_unknown'&&data.homeflow_approval_id){
    pending.status=data.status;pending.acknowledged=true
    await writeMemberDeviceState(actor,household,pending,'shared-inline')
    return {proposalId:pending.proposalId,status:data.status}
   }
   if(data.status!=='prepared')throw Error('申請の受付状態を確認してください')
  }
  const result=await api('/api/family-finance/shared-mutation-requests/'+
   encodeURIComponent(pending.proposalId)+'/submit',
   post({expected_user_id:actor}))
  if(result.applied!==false||result.status!=='submitted_status_unknown')
   throw Error('HomeFlow の受付が未確認です。重複申請しないでください')
  pending.status=result.status;pending.acknowledged=true
  await writeMemberDeviceState(actor,household,pending,'shared-inline')
  return {proposalId:pending.proposalId,status:result.status}
 }finally{busy.value=false}
}
// Caller clears only after its corresponding draft removal is durably stored.
async function clearAcknowledgedIntent(){
 if(!inlineRequest?.acknowledged)return
 const actor=props.userId,household=props.householdId
 await clearMemberDeviceState(actor,household,'shared-inline')
 inlineRequest=null
}
// Personal neutral transfers modify the same immutable household row directly.
 // They are transfers (not household income/expense), so no owner approval.
async function directNeutralTransfer(operation,target,entry=null){
 if(!['update','delete','restore'].includes(operation)||
  !/^[a-f0-9]{32}$/.test(target?.resource_id||'')||
  target.creator_user_id!==props.userId||target.entry?.type!=='transfer'||
  target.entry.transfer_target!=='spouse')
  throw Error('本人が作成した配偶者への資産移動だけを直接変更できます')
 const url='/api/family-finance/shared-entries/'+target.resource_id+
  (operation==='restore'?'/restore':'')
 const method=operation==='update'?'PUT':operation==='delete'?'DELETE':'POST'
 const body={expected_user_id:props.userId,expected_version:target.version,
  ...(operation==='update'?{entry}:{})}
 const receipt=await api(url,{method,headers:{'content-type':'application/json'},
  body:JSON.stringify(body)})
 if(receipt.applied!==true||receipt.action?.resource_id!==target.resource_id||
  receipt.action?.entry_id!==target.entry_id||
  receipt.action?.version!==target.version+1||
  receipt.action?.state!==(operation==='delete'?'deleted':'active'))
  throw Error('資産移動の保存結果を確認してください')
 return {applied:true,action:receipt.action}
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
 if(target.entry?.type==='transfer')return directNeutralTransfer(operation,target,entry)
 return submitIntent(operation,entry,target)
}
async function submitRestore(record){
 const id=String(record?.resource_id||'')
 if(!/^[a-f0-9]{32}$/.test(id)||record?.state!=='deleted')
  throw Error('削除した家庭明細を再読み込みしてください')
 // Resolve current immutable version on the server, not from the displayed trash.
 const current=await api('/api/family-finance/shared-entries/'+encodeURIComponent(id))
 const target=current.action
 if(!target||target.resource_id!==id||target.state!=='deleted'||
  target.entry_id!==record.entry_id||target.version!==record.version)
  throw Error('この明細の状態が変更されました。ゴミ箱を更新してください')
 if(target.entry?.type==='transfer')return directNeutralTransfer('restore',target)
 return submitIntent('restore',null,target)
}
defineExpose({submitEntry,submitMutation,submitRestore,openForEntry,clearAcknowledgedIntent})
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
// The standalone approval editor uses an independent durable replay slot.
// A lost HTTP response must not regenerate its HomeFlow request key.
async function prepareEditorReplay(payload){
 const user=props.userId,household=props.householdId
 const snapshot=JSON.stringify({operation:payload.operation,
  resource_id:payload.resource_id,expected_version:payload.expected_version,
  entry:payload.entry})
 let saved=await readMemberDeviceState(user,household,'shared-editor')
 if(saved){
  if(saved.userId!==user||saved.householdId!==household||
    typeof saved.snapshot!=='string'||!/^shared-entry:[0-9a-f-]{36}$/.test(saved.key||''))
   throw Error('前回の承認申請の再送情報が破損しています')
  if(saved.snapshot!==snapshot){
   if(!saved.acknowledged)throw Error('前回の申請結果が未確認です。同じ内容で再試行してください')
   await clearMemberDeviceState(user,household,'shared-editor')
   saved=null
  }
 }
 if(!saved){
  saved={userId:user,householdId:household,snapshot,
   key:'shared-entry:'+crypto.randomUUID(),proposalId:null,acknowledged:false}
  await writeMemberDeviceState(user,household,saved,'shared-editor')
 }
 return saved
}
async function prepare(){
 if(!canWrite.value||busy.value||prepared.value)return
 const op=action.value,selected=chosen.value
 const personalTransfer=op!=='create'&&selected?.entry?.type==='transfer'
 if(!window.confirm(personalTransfer
  ?'本人の配偶者への資産移動を直接変更します。管理者承認は不要です。続けますか？'
  :'明細変更を申請します。HomeFlow で管理者の承認が必要です。続けますか？'))return
 const ticket=version,actor=props.userId,household=props.householdId
 if(personalTransfer){
  busy.value=true;error.value='';message.value=''
  try{
   const entry=op==='update'?
    canonical({...record(),type:'transfer',transferTarget:'spouse'}):null
   const saved=await directNeutralTransfer(op,selected,entry)
   if(ticket!==version||actor!==props.userId||household!==props.householdId)return
   if(!saved.applied)throw Error('資産移動の反映を確認できません')
   message.value='本人の資産移動を直接変更しました。承認は不要です。'
   busy.value=false
   await load()
  }catch(e){if(actor===props.userId&&household===props.householdId)error.value=e.message}
  finally{busy.value=false}
  return
 }
 const payload={expected_user_id:actor,
  operation:op,resource_id:op==='create'?null:selected?.resource_id,
  expected_version:op==='create'?0:selected?.version,
  entry:['create','update'].includes(op)?record():null}
 if(!payload.entry&&['create','update'].includes(op))return
 busy.value=true;error.value='';message.value=''
 try{
  const retry=await prepareEditorReplay(payload)
  payload.idempotency_key=retry.key
  stableKey.value=retry.key
  const result=await api('/api/family-finance/shared-mutation-requests',post(payload))
  if(ticket!==version||actor!==props.userId||household!==props.householdId)return
  if(result.prepared?.applied!==false||!result.prepared?.proposal_id)
   throw Error('申請の受付結果を確認できません')
  if(result.prepared.status==='submitted_status_unknown'){
   retry.acknowledged=true
   await writeMemberDeviceState(actor,household,retry,'shared-editor')
   await clearMemberDeviceState(actor,household,'shared-editor')
   stableKey.value=''
   message.value='HomeFlow に提出済みです。審査状況を確認してください。'
   await load()
   return
  }
  if(result.prepared.status!=='prepared')throw Error('申請の受付状態を確認してください')
  retry.proposalId=result.prepared.proposal_id
  await writeMemberDeviceState(actor,household,retry,'shared-editor')
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
  await clearMemberDeviceState(actor,hh,'shared-editor')
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
  await clearMemberDeviceState(actor,hh,'shared-editor')
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
// Refresh only while a visible request still needs a HomeFlow outcome.
// Stop polling as soon as every request is final, and on unmount/logout.
const unresolved=new Set(['submitted_status_unknown','pending','approved',
 'executing','failed_retryable','conflict'])
let reviewTimer=null
onMounted(()=>{
 document.addEventListener('visibilitychange',foreground)
 reviewTimer=setInterval(()=>{
  if(!alive||!open.value||!available.value||busy.value||
   document.visibilityState!=='visible'||
   !proposals.value.some(x=>unresolved.has(x.status)))return
  void load()
 },20000)
})
onUnmounted(()=>{alive=false;clearInterval(reviewTimer);reset();
 document.removeEventListener('visibilitychange',foreground)})
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
