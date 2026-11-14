<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'

const props=defineProps({userId:{type:String,required:true},
 accounts:{type:Array,default:()=>[]}})
const open=ref(false),busy=ref(''),loading=ref(false)
const items=ref([]),offset=ref(0),nextOffset=ref(null)
const error=ref(''),unavailable=ref(false),message=ref('')
const myAccounts=computed(()=>props.accounts.filter(a=>
 a?.owner_user_id===props.userId&&a.origin==='member_created'&&Number(a.is_archived)===0))
const accountId=ref(''),kind=ref('expense'),amount=ref(''),merchant=ref(''),
 category=ref(''),date=ref(new Date(Date.now()+9*3600000).toISOString().slice(0,10)),
 note=ref('')
// Keep an ambiguous network retry attached to its original stable key and
// immutable payload rather than silently filing a second household approval.
let frozenDraft=null
let revision=0,alive=true
const id32=/^[a-f0-9]{32}$/i
const statuses=['prepared_not_submitted','submitted_status_unknown','applied','cancelled','expired']
const label=item=>item.status==='applied'?'已入账 · 家計簿回执已确认':
 item.status==='submitted_status_unknown'?'已提交 · HomeFlow 审批状态待核对':
 item.status==='prepared_not_submitted'?'未提交 · 仅本人的加密草稿':
 item.status==='cancelled'?'已撤回':'已过期'
function verify(item){
 if(!item||typeof item!=='object'||!id32.test(item.request_id||'')||
  !statuses.includes(item.status)||typeof item.account_id!=='string'||
  typeof item.payload_sha256!=='string')return false
 // A HomeFlow approval alone must NEVER display as an applied finance entry.
 if(item.status==='applied')
  return item.ledger_changed===true&&Number.isSafeInteger(item.entry_id)&&item.entry_id>0
 return item.ledger_changed===false&&item.entry_id===null
}
async function call(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const payload=await res.json().catch(()=>({}))
 if(!res.ok)throw Error(String(payload.code||'申请接口不可用'))
 return payload
}
async function load(at=0){
 // A blocked foreground refresh must not invalidate a pending mutation and
 // strand the submit button in busy state.
 const user=props.userId
 if(!alive||!open.value||busy.value||!Number.isSafeInteger(at)||at<0||at>500)return
 const ticket=++revision
 loading.value=true;error.value=''
 try{
  const result=await call('/api/family-finance/proposals?offset='+at)
  if(ticket!==revision||!alive||user!==props.userId||!open.value)return
  if(result.ok!==true||result.ledger_changed!==false||
   !Array.isArray(result.items)||result.items.length>5||
   result.items.some(item=>!verify(item))||
   !(result.next_offset===null||(Number.isSafeInteger(result.next_offset)&&result.next_offset===at+5)))
   throw Error('申请归属或实际入账回执需要核验')
  items.value=result.items
  offset.value=at;nextOffset.value=result.next_offset;unavailable.value=false
 }catch(e){
  if(ticket===revision&&alive&&user===props.userId){
   items.value=[];nextOffset.value=null;error.value=e.message
   unavailable.value=/ENCRYPTION_NOT_CONFIGURED|DISABLED/.test(e.message)
  }
 }finally{if(ticket===revision&&alive&&user===props.userId)loading.value=false}
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value
 if(open.value)await load(0)
 else{revision++;items.value=[];error.value='';nextOffset.value=null}
}
async function createProposal(){
 const rev=revision,user=props.userId
 const record={
  idempotency_key:crypto.randomUUID().replace(/-/g,''),
  expected_user_id:user,
  account_id:accountId.value,type:kind.value,amount_jpy:Number(amount.value),
  date:date.value,merchant:merchant.value.trim(),category:category.value.trim(),
  note:note.value
 }
 if(!alive||!open.value||busy.value||loading.value||
  !myAccounts.value.some(a=>a.account_id===record.account_id)||
  !['expense','income'].includes(record.type)||
  !Number.isSafeInteger(record.amount_jpy)||record.amount_jpy<1||record.amount_jpy>10000000||
  !/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(record.date)||
  !record.merchant||record.merchant.length>160||
  !record.category||record.category.length>40||record.note.length>300)return
 if(frozenDraft){
  const same=Object.keys(record).every(k=>k==='idempotency_key'||record[k]===frozenDraft[k])
  if(!same){error.value='上次提交未确认，请恢复原申请内容再重试，不能重新生成一笔。';return}
 }else{
  if(!window.confirm('只保存本人加密记账草稿，不会入账；之后仍需提交管理员审批。继续吗？'))return
  frozenDraft=record
 }
 if(rev!==revision||!alive||user!==props.userId||!open.value||
  !myAccounts.value.some(a=>a.account_id===record.account_id))return
 busy.value='create';error.value='';message.value=''
 let failure=''
 try{
  const result=await call('/api/family-finance/proposals',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify(frozenDraft)
  })
  if(rev!==revision||!alive||user!==props.userId||!open.value)return
  if(result.ok!==true||result.prepared?.status!=='prepared_not_submitted'||
   result.prepared?.ledger_changed!==false||!id32.test(result.prepared.request_id))
   throw Error('草稿回执未确认，绝不能视为已入账')
  frozenDraft=null;amount.value='';merchant.value='';note.value=''
  message.value='加密草稿已保存，仍需在下方点击「提交审批」，目前尚未入账。'
 }catch(e){if(rev===revision&&alive&&user===props.userId)failure=e.message}
 finally{
  if(rev===revision&&alive&&user===props.userId){
   busy.value=''
   await load(0)
   if(failure&&alive&&user===props.userId)error.value=failure
  }
 }
}
async function action(item,kind){
 const ticket=revision,user=props.userId
 if(!alive||!open.value||loading.value||busy.value||
  !verify(item)||item.status!=='prepared_not_submitted'||
  !['submit','cancel'].includes(kind))return
 const question=kind==='submit'
  ?'确认将本人的加密财务草稿提交 HomeFlow 家庭审批？提交不代表入账，管理员批准后仍需单独执行。'
  :'确认撤回这份尚未提交的草稿？此操作不会修改账本。'
 if(!window.confirm(question))return
 if(ticket!==revision||user!==props.userId||!alive||!open.value)return
 busy.value=item.request_id;error.value=''
 let mutationError=''
 try{
  const result=await call('/api/family-finance/proposals/'+
   encodeURIComponent(item.request_id)+'/'+kind,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({expected_user_id:user})
  })
  if(!alive||user!==props.userId||!open.value)return
  if(result.applied===true||result.ledger_changed!==false)
   throw Error('审批结果不是正式账本回执，请刷新后核验')
 }catch(e){if(alive&&user===props.userId)mutationError=e.message}
 finally{
  if(alive&&user===props.userId){
   busy.value=''
   await load(offset.value)
   if(alive&&user===props.userId&&mutationError)error.value=mutationError
  }
 }
}
function onForeground(){
 if(document.visibilityState==='visible'&&open.value&&!busy.value&&!loading.value)
  void load(0)
}
onMounted(()=>{alive=true;document.addEventListener('visibilitychange',onForeground)})
onUnmounted(()=>{
 alive=false;revision++;open.value=false;items.value=[]
 frozenDraft=null;accountId.value='';amount.value='';merchant.value='';category.value='';note.value=''
 document.removeEventListener('visibilitychange',onForeground)
})
</script>

<template>
 <section class="hf-proposals" aria-label="本人家庭财务申请">
  <div class="hf-header">
   <strong>我的家庭财务申请</strong>
   <button type="button" :aria-expanded="open" @click="toggle">
    {{open?'收起':'查看申请'}}
   </button>
  </div>
  <div v-if="open" class="hf-body">
   <p class="muted">仅可查看本人的申请。HomeFlow 负责审批，只有家計簿的真实入账回执才显示“已入账”。</p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <p v-if="message" class="muted" role="status">{{message}}</p>
   <form class="hf-new-request" @submit.prevent="createProposal" aria-label="创建本人加密家庭收支草稿">
    <strong>新建收支申请</strong>
    <p class="muted">仅可选择本人账户；草稿不会影响家庭余额或统计。</p>
    <select v-model="accountId" aria-label="本人账户" required :disabled="!!busy||loading">
     <option value="" disabled>选择本人账户</option>
     <option v-for="a in myAccounts" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
    </select>
    <div class="hf-form-grid">
     <select v-model="kind" aria-label="收支类型" :disabled="!!busy||loading">
      <option value="expense">支出</option><option value="income">收入</option>
     </select>
     <input v-model="amount" aria-label="金额（円）" type="number" inputmode="numeric" min="1" max="10000000" step="1" required placeholder="金额（円）" :disabled="!!busy||loading"/>
     <input v-model="date" aria-label="日期" type="date" required :disabled="!!busy||loading"/>
    </div>
    <div class="hf-form-grid">
     <input v-model="merchant" aria-label="商家或来源" maxlength="160" required placeholder="商家或收入来源" :disabled="!!busy||loading"/>
     <input v-model="category" aria-label="分类" maxlength="40" required placeholder="分类" :disabled="!!busy||loading"/>
    </div>
    <input v-model="note" aria-label="备注（可选）" maxlength="300" placeholder="备注（可选）" :disabled="!!busy||loading"/>
    <button type="submit" :disabled="!!busy||loading||!myAccounts.some(a=>a.account_id===accountId)||!merchant.trim()||!category.trim()||!Number.isSafeInteger(Number(amount))||Number(amount)<1">仅保存加密草稿</button>
    <p v-if="!myAccounts.length" class="muted">请先创建本人金融账户，再发起申请。</p>
   </form>
   <p v-if="loading" class="muted">读取中…</p>
   <p v-else-if="unavailable" class="muted">家庭申请功能尚未开放。</p>
   <p v-else-if="!items.length" class="muted">暂无申请</p>
   <ul v-else class="hf-items">
    <li v-for="item in items" :key="item.request_id">
     <strong>{{label(item)}}</strong>
     <small>账户：{{accounts.find(a=>a.account_id===item.account_id)?.label||'本人账户'}}</small>
     <small v-if="item.homeflow_approval_id">审批号：{{item.homeflow_approval_id.slice(0,8)}}…</small>
     <small v-if="item.status==='applied'">已入账记录：{{item.entry_id}}</small>
     <div v-if="item.status==='prepared_not_submitted'" class="hf-actions">
      <button type="button" :disabled="loading||!!busy" @click="action(item,'cancel')">撤回</button>
      <button type="button" :disabled="loading||!!busy" @click="action(item,'submit')">提交审批</button>
     </div>
    </li>
   </ul>
   <div class="hf-actions">
    <button type="button" :disabled="loading||!!busy||offset===0" @click="load(offset-5)">上一页</button>
    <button type="button" :disabled="loading||!!busy||nextOffset===null" @click="load(nextOffset)">下一页</button>
    <button type="button" :disabled="loading||!!busy" @click="load(0)">刷新状态</button>
   </div>
  </div>
 </section>
</template>

<style scoped>
.hf-proposals{display:grid;gap:9px;padding:12px 0;border-top:1px solid var(--line,#dde3df);min-width:0}
.hf-header,.hf-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.hf-header strong{font-size:13px}
.hf-proposals button{font:inherit;font-size:12px;min-height:42px;padding:7px 10px;border-radius:10px;color:inherit;border:1px solid var(--line,#ccd7d0);background:transparent}
.hf-proposals button:disabled{opacity:.55}
.hf-body{min-width:0;display:grid;gap:8px}
.hf-new-request{min-width:0;display:grid;gap:8px;padding:12px;border:1px solid var(--line,#ddd);border-radius:12px}
.hf-new-request strong{font-size:13px}
.hf-new-request input,.hf-new-request select{box-sizing:border-box;width:100%;min-width:0;min-height:42px;padding:8px 10px;border:1px solid var(--line,#ccd7d0);border-radius:10px;background:transparent;color:inherit;font:inherit;font-size:13px}
.hf-form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,125px),1fr));gap:8px;min-width:0}
.muted{margin:0;color:var(--muted,#71777b);font-size:12px;line-height:1.5}
.error{margin:0;color:#b34343;font-size:12px;overflow-wrap:anywhere}
.hf-items{list-style:none;padding:0;margin:0;display:grid;gap:7px}
.hf-items li{min-width:0;border-radius:10px;border:1px solid var(--line,#ddd);padding:10px;display:grid;gap:6px}
.hf-items li strong{font-size:12px}
.hf-items li small{font-size:11px;color:var(--muted,#71777b);overflow-wrap:anywhere}
</style>
