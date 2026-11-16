<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true}})
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
const statusText=x=>x.status==='prepared'?'尚未提交':x.status==='submitted_status_unknown'?
 '已提交 HomeFlow，等待管理员审核与执行':x.status
function reset(){version++;open.value=false;busy.value=false;available.value=false;error.value='';message.value='';
 rows.value=[];deleted.value=[];proposals.value=[];resource.value='';prepared.value=null;stableKey.value='';
 draft.value={date:new Date(Date.now()+32400000).toISOString().slice(0,10),
 time:'',amount:'',type:'expense',category:'食費',merchant:'',note:''}}
async function api(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true)throw Error(data.code||'家庭申请服务暂时不可用')
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
   available.value=false;error.value=/DISABLED/.test(e.message)?'家庭审批账目修改尚未启用；现有账本不会变化。':e.message}
 }
}
async function openForEntry(operation,entry){
 if(!['update','delete','restore'].includes(operation)||!entry?.id)return
 if(!open.value){open.value=true;await load()}
 const collection=operation==='restore'?deleted.value:rows.value
 const source=collection.find(x=>String(x.entry_id)===String(entry.id))
 if(!source){
  error.value='这条旧记录还没有登记为可审批的共享账目，请管理员先核验并执行共享登记；不会修改或删除原记录。'
  action.value=operation;resource.value=''
  return
 }
 error.value='';action.value=operation;resource.value=source.resource_id
 if(operation==='update')draft.value={...source.entry,...entry,
  amount:String(entry.amount),payment_source:undefined,transfer_target:undefined}
}
defineExpose({openForEntry})
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
  '仅准备加密账目修改申请，仍需 HomeFlow 管理员审批并单独执行。继续吗？'))return
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
   throw Error('原申请回执异常，不能视为已提交')
  prepared.value=result.prepared;message.value='加密申请已保存，账目尚未修改。请提交 HomeFlow。'
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
   throw Error('审批回执待核验，请保留原申请 ID，禁止重新建立')
  prepared.value=null;stableKey.value=''
  message.value='HomeFlow 已收到申请。管理员审核并执行后，账目才会正式改变。'
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
  if(result.status!=='cancelled')throw Error('只能撤销尚未提交的草稿')
  prepared.value=null;stableKey.value='';message.value='草稿已撤回，没有改动共享账目'
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
<section class="shared-request" aria-label="家庭共享收支修改审批申请">
 <header><strong>申请修改共享账目</strong>
  <button type="button" :aria-expanded="open" :disabled="busy" @click="toggle">{{open?'收起':'申请'}}</button></header>
 <template v-if="open">
  <p class="hint">家庭成员可申请新增、修改、删除或恢复普通共享收支。HomeFlow 管理员必须独立批准并执行；既有 SBI、信用卡和银行转账凭证不得直接修改。</p>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <p v-if="message" class="hint" role="status">{{message}}</p>
  <form v-if="available" class="editor" @submit.prevent="prepared?submit():prepare()">
   <label>申请类型<select v-model="action" :disabled="busy||!!prepared" @change="resource=''">
    <option value="create">新增普通账目</option><option value="update">修改普通账目</option>
    <option value="delete">移到回收箱</option><option value="restore">从回收箱恢复</option>
   </select></label>
   <label v-if="action!=='create'">选择原账目
    <select v-model="resource" :disabled="busy||!!prepared" required>
     <option value="">请选择</option><option v-for="row in items" :key="row.resource_id"
      :value="row.resource_id">{{row.entry?.date}} · {{row.entry?.merchant||row.entry?.category}} · v{{row.version}}</option>
    </select>
   </label>
   <template v-if="action==='create'||action==='update'">
    <label>日期<input v-model="draft.date" type="date" :disabled="busy||!!prepared"/></label>
    <label>收支<select v-model="draft.type" :disabled="busy||!!prepared"><option value="expense">支出</option><option value="income">收入</option></select></label>
    <label>金额（日元）<input v-model="draft.amount" type="number" min="1" max="10000000" required :disabled="busy||!!prepared"/></label>
    <label>分类<input v-model="draft.category" maxlength="100" required :disabled="busy||!!prepared"/></label>
    <label>商家或来源<input v-model="draft.merchant" maxlength="120" :disabled="busy||!!prepared"/></label>
    <label>备注<textarea v-model="draft.note" maxlength="500" :disabled="busy||!!prepared" rows="2"/></label>
   </template>
   <button type="submit" :disabled="busy||(!prepared&&!canWrite)">{{prepared?'提交原申请审批':'准备加密申请'}}</button>
   <button v-if="prepared" type="button" :disabled="busy" @click="cancel">撤回未提交草稿</button>
  </form>
  <div v-if="available" class="history"><strong>最近申请</strong>
   <div v-for="r in proposals" :key="r.proposal_id" class="item">
    <span>{{r.operation}} · {{statusText(r)}} · {{r.proposal_id.slice(0,8)}}</span>
    <button v-if="r.status==='prepared'" type="button" :disabled="busy||!!prepared"
     @click="prepared=r">继续原申请</button>
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
