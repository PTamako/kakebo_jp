<script setup>
import {onMounted,onUnmounted,ref} from 'vue'

const props=defineProps({userId:{type:String,required:true},
 accounts:{type:Array,default:()=>[]}})
const open=ref(false),busy=ref(''),loading=ref(false)
const items=ref([]),offset=ref(0),nextOffset=ref(null)
const error=ref(''),unavailable=ref(false)
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
 const ticket=++revision,user=props.userId
 if(!alive||!open.value||busy.value||!Number.isSafeInteger(at)||at<0||at>500)return
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
 open.value=!open.value
 if(open.value)await load(0)
 else{revision++;items.value=[];error.value='';nextOffset.value=null}
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
   method:'POST',headers:{'content-type':'application/json'},body:'{}'
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
.muted{margin:0;color:var(--muted,#71777b);font-size:12px;line-height:1.5}
.error{margin:0;color:#b34343;font-size:12px;overflow-wrap:anywhere}
.hf-items{list-style:none;padding:0;margin:0;display:grid;gap:7px}
.hf-items li{min-width:0;border-radius:10px;border:1px solid var(--line,#ddd);padding:10px;display:grid;gap:6px}
.hf-items li strong{font-size:12px}
.hf-items li small{font-size:11px;color:var(--muted,#71777b);overflow-wrap:anywhere}
</style>
