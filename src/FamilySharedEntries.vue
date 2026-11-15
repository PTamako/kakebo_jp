<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true},role:{type:String,required:true}})
const emit=defineEmits(['changed'])
const open=ref(false),available=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const rows=ref([]),view=ref('active'),editing=ref(''),files=ref({})
const empty=()=>({date:new Date(Date.now()+9*3600000).toISOString().slice(0,10),time:'',
 type:'expense',amount:'',category:'食費',merchant:'',note:''})
const draft=ref(empty()),editForm=ref(empty())
let generation=0,alive=true,stableKey=''
const isOwner=computed(()=>props.role==='owner')
const statusText={active:'账目',deleted:'回收箱',purge_pending:'清理中',purged:'已永久删除'}
const amount=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n)||0)
const valid=x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isSafeInteger(Number(x.amount))&&
 Number(x.amount)>=1&&Number(x.amount)<=10000000&&x.category?.trim()&&
 x.merchant?.length<=120&&x.note?.length<=500
const canonical=x=>({date:x.date,time:x.time||'',amount:Number(x.amount),
 type:x.type,category:x.category.trim(),merchant:x.merchant.trim(),note:x.note.trim()})
function reset(){generation++;open.value=false;available.value=false;busy.value=false;error.value='';
 notice.value='';rows.value=[];files.value={};view.value='active';editing.value='';
 draft.value=empty();editForm.value=empty();stableKey=''}
async function api(url,options={}){
 const res=await fetch(url,{credentials:'same-origin',cache:'no-store',...options})
 const data=await res.json().catch(()=>({}))
 if(!res.ok||data.ok!==true)throw Error(data.code||'共享账目操作失败')
 return data
}
const request=(method,data)=>({method,headers:{'content-type':'application/json'},
 body:JSON.stringify(data)})
async function refresh(){
 const ticket=++generation,user=props.userId,hh=props.householdId
 try{
  const r=await api('/api/family-finance/shared-entries?state='+encodeURIComponent(view.value))
  if(!alive||ticket!==generation||!open.value||user!==props.userId||hh!==props.householdId)return
  available.value=true;rows.value=Array.isArray(r.items)?r.items:[];error.value=''
 }catch(e){
  if(ticket===generation){rows.value=[];available.value=false;
   error.value=e.message==='SHARED_ENTRY_DISABLED'?'共享账目编辑尚未开放（现有账本不受影响）。':e.message}
 }
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value
 if(!open.value){generation++;rows.value=[];editing.value='';files.value={};return}
 await refresh()
}
async function switchView(state){
 if(busy.value)return
 editing.value='';view.value=state;rows.value=[]
 await refresh()
}
async function create(){
 if(busy.value||!available.value||!isOwner.value||!valid(draft.value))return
 if(!window.confirm('确认新增一条普通家庭共享账目？这将计入家庭收支统计。'))return
 const ticket=generation,user=props.userId,hh=props.householdId
 busy.value=true;error.value='';notice.value=''
 stableKey ||= 'shared:'+crypto.randomUUID()
 try{
  const result=await api('/api/family-finance/shared-entries',request('POST',{
   expected_user_id:user,idempotency_key:stableKey,entry:canonical(draft.value)}))
  if(ticket!==generation||user!==props.userId||hh!==props.householdId)return
  if(result.action?.state!=='active'||!result.action.entry_id)throw Error('账目回执不完整')
  stableKey='';draft.value=empty();notice.value='已添加至家庭统计，可修改、移入回收箱或恢复。'
  emit('changed');await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
function beginEdit(row){
 if(!isOwner.value||row.state!=='active')return
 editing.value=row.resource_id;editForm.value={...row.entry,amount:String(row.entry.amount)}
 error.value='';notice.value=''
}
async function change(row,action){
 if(busy.value||!available.value||!isOwner.value)return
 const user=props.userId,hh=props.householdId,ticket=generation
 if(action==='update'&&!valid(editForm.value))return
 const question=action==='delete'?'将这条普通账目移入回收箱？统计将同时移除该笔。':
  action==='restore'?'从回收箱恢复账目并重新计入统计？':
  action==='purge'?'永久删除？原账目无法再恢复，关联的 R2 图片也将永久清除。':
  '保存这次修改并刷新家庭统计？'
 if(!window.confirm(question))return
 busy.value=true;error.value='';notice.value=''
 try{
  const path='/api/family-finance/shared-entries/'+row.resource_id
  const opt=action==='update'?request('PUT',{expected_user_id:user,expected_version:row.version,
   entry:canonical(editForm.value)}):
   action==='delete'?request('DELETE',{expected_user_id:user,expected_version:row.version}):
   action==='restore'?request('POST',{expected_user_id:user,expected_version:row.version}):
   request('POST',{expected_user_id:user,expected_version:row.version,
    confirm_resource_id:row.resource_id})
  const url=path+(action==='restore'?'/restore':action==='purge'?'/purge':'')
  const result=await api(url,opt)
  if(ticket!==generation||user!==props.userId||hh!==props.householdId)return
  if(action==='purge'&&result.purged!==true)throw Error('R2 清理仍未完成')
  editing.value='';notice.value=action==='purge'?'已永久删除并完成附件清理':
   action==='delete'?'已移入回收箱':action==='restore'?'已恢复至家庭账本':'修改已保存'
  emit('changed');await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function compress(file){
 if(!file.type.startsWith('image/'))throw Error('请选择图片文件')
 if(file.size<=200*1024&&['image/webp','image/jpeg'].includes(file.type))return file
 const bmp=await createImageBitmap(file)
 try{
  const scale=Math.min(1,1200/Math.max(bmp.width,bmp.height))
  const canvas=document.createElement('canvas')
  canvas.width=Math.max(1,Math.floor(bmp.width*scale))
  canvas.height=Math.max(1,Math.floor(bmp.height*scale))
  canvas.getContext('2d').drawImage(bmp,0,0,canvas.width,canvas.height)
  for(const quality of [.8,.7,.55,.4,.28]){
   const blob=await new Promise(ok=>canvas.toBlob(ok,'image/webp',quality))
   if(blob?.size&&blob.size<=200*1024)return blob
  }
  throw Error('图片超过 200KB，请重新裁剪后上传')
 }finally{bmp.close()}
}
async function upload(row,event){
 const file=event.target.files?.[0];event.target.value=''
 if(!file||!isOwner.value||busy.value||row.state!=='active')return
 const ticket=generation,user=props.userId
 busy.value=true;error.value='';notice.value=''
 try{
  const blob=await compress(file),bytes=await blob.arrayBuffer()
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
   x=>x.toString(16).padStart(2,'0')).join('')
  const idempotency='shared-image:'+crypto.randomUUID()
  const init=await api('/api/family-finance/shared-entries/'+row.resource_id+'/attachments',
   request('POST',{expected_user_id:user,idempotency_key:idempotency,
    content_type:blob.type,sha256:digest,size_bytes:bytes.byteLength}))
  const remote=await api('/api/family-finance/shared-entries/'+row.resource_id+'/attachments/'+
   init.attachment.object_id,{method:'PUT',headers:{'content-type':blob.type},body:bytes})
  if(ticket!==generation||user!==props.userId)return
  if(remote.attachment?.state!=='ready')throw Error('图片上传未最终确认')
  notice.value='图片已压缩并保存到私人 R2，删除账目时图片会保留至永久清空。'
  await loadFiles(row)
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function loadFiles(row){
 const ticket=generation,user=props.userId
 try{
  const data=await api('/api/family-finance/shared-entries/'+row.resource_id+'/attachments')
  if(ticket===generation&&user===props.userId)
   files.value={...files.value,[row.resource_id]:data.items}
 }catch(e){if(ticket===generation)error.value=e.message}
}
function foreground(){
 if(document.visibilityState!=='visible')return
 generation++;rows.value=[];editing.value='';files.value={}
 if(open.value)void refresh()
}
watch(()=>[props.userId,props.householdId,props.role],reset)
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{alive=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>

<template>
<section class="shared-entries" aria-label="家庭共享账目生命周期">
 <header><strong>家庭共享账目</strong><button type="button" :disabled="busy" :aria-expanded="open" @click="toggle">{{open?'收起':'管理'}}</button></header>
 <template v-if="open">
  <p class="help">仅适用于普通收支记录。SBI 成交、信用卡债务、积分及已执行金融凭证不可直接修改或删除。家庭成员只读；管理员修改保留不可变审计。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="help">{{notice}}</p>
  <nav class="filters" aria-label="账目状态">
   <button v-for="state in ['active','deleted','purge_pending']" :key="state" type="button"
    :class="{current:view===state}" :disabled="busy" @click="switchView(state)">{{statusText[state]}}</button>
  </nav>
  <form v-if="isOwner&&view==='active'&&available" class="editor" @submit.prevent="create">
   <strong>新增普通共享收支</strong>
   <div class="pair">
    <label>日期<input v-model="draft.date" type="date" required :disabled="busy"/></label>
    <label>类型<select v-model="draft.type" :disabled="busy"><option value="expense">支出</option><option value="income">收入</option></select></label>
   </div>
   <div class="pair">
    <label>金额（円）<input v-model="draft.amount" type="number" min="1" max="10000000" inputmode="numeric" required :disabled="busy"/></label>
    <label>分类<input v-model="draft.category" maxlength="100" required :disabled="busy"/></label>
   </div>
   <label>商家或来源<input v-model="draft.merchant" maxlength="120" :disabled="busy"/></label>
   <label>备注<textarea v-model="draft.note" maxlength="500" rows="2" :disabled="busy"/></label>
   <button type="submit" :disabled="busy||!valid(draft)">保存到家庭账本</button>
  </form>
  <div v-for="row in rows" :key="row.resource_id" class="item">
   <div class="item-head"><strong>{{row.entry?.merchant||statusText[row.state]}}</strong><span>v{{row.version}} · {{statusText[row.state]}}</span></div>
   <p v-if="row.entry" class="help">{{row.entry.date}} · {{row.entry.category}} · {{amount(row.entry.amount)}}</p>
   <div v-if="isOwner" class="actions">
    <button v-if="row.state==='active'" type="button" :disabled="busy" @click="beginEdit(row)">修改</button>
    <button v-if="row.state==='active'" type="button" :disabled="busy" @click="change(row,'delete')">移入回收箱</button>
    <button v-if="row.state==='deleted'" type="button" :disabled="busy" @click="change(row,'restore')">恢复</button>
    <button v-if="row.state==='deleted'||row.state==='purge_pending'" type="button" :disabled="busy" @click="change(row,'purge')">永久删除／继续清理</button>
    <button v-if="row.state==='active'||row.state==='deleted'" type="button" :disabled="busy" @click="loadFiles(row)">查看附件</button>
   </div>
   <form v-if="isOwner&&editing===row.resource_id" class="editor" @submit.prevent="change(row,'update')">
    <div class="pair">
     <label>日期<input v-model="editForm.date" type="date" required :disabled="busy"/></label>
     <label>类型<select v-model="editForm.type" :disabled="busy"><option value="expense">支出</option><option value="income">收入</option></select></label>
    </div>
    <div class="pair">
     <label>金额<input v-model="editForm.amount" type="number" min="1" required :disabled="busy"/></label>
     <label>分类<input v-model="editForm.category" maxlength="100" required :disabled="busy"/></label>
    </div>
    <label>商家<input v-model="editForm.merchant" maxlength="120" :disabled="busy"/></label>
    <label>备注<textarea v-model="editForm.note" maxlength="500" rows="2" :disabled="busy"/></label>
    <div class="actions"><button :disabled="busy||!valid(editForm)" type="submit">保存修改</button>
     <button type="button" :disabled="busy" @click="editing=''">取消</button></div>
   </form>
   <label v-if="isOwner&&row.state==='active'" class="upload">压缩上传凭证（上限 200KB）
    <input type="file" accept="image/*" :disabled="busy" @change="upload(row,$event)"/></label>
   <div v-for="f in (files[row.resource_id]||[])" :key="f.object_id" class="help">
    R2 图片 {{f.object_id.slice(0,8)}} · {{f.state}} · {{Math.round(f.size_bytes/1024)}}KB
   </div>
  </div>
  <p v-if="available&&!rows.length" class="help">这个状态下暂无账目。</p>
  <p v-if="!isOwner" class="help">修改和永久删除必须由家庭管理员执行；成员不能借用此界面越权操作。</p>
 </template>
</section>
</template>
<style scoped>
.shared-entries{display:grid;gap:10px;min-width:0;padding:12px;border:1px solid var(--line,#d7e0df);border-radius:14px}
.shared-entries header,.item-head,.actions,.filters{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.shared-entries strong{font-size:14px}
.shared-entries button{min-height:38px;border:1px solid var(--line,#d7e0df);border-radius:10px;padding:7px 12px;background:var(--card,#fff)}
.shared-entries button:disabled{opacity:.5}.filters .current{font-weight:700;border-color:var(--accent,#428c8a)}
.editor{display:grid;gap:9px;min-width:0;padding:11px;background:var(--surface,#f7f8f8);border-radius:12px}
.editor label,.upload{display:grid;gap:4px;font-size:12px;min-width:0}
.editor input,.editor select,.editor textarea,.upload input{width:100%;max-width:100%;box-sizing:border-box;min-width:0;border:1px solid var(--line,#ddd);border-radius:9px;padding:10px;background:var(--card,#fff);color:inherit}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.item{display:grid;gap:8px;min-width:0;padding:10px;border-radius:12px;border:1px solid var(--line,#ddd)}
.item-head span,.help{font-size:12px;color:var(--muted,#6d7277);margin:0;overflow-wrap:anywhere}
.error{font-size:12px;color:#ae3838;margin:0;overflow-wrap:anywhere}
@media(max-width:360px){.pair{grid-template-columns:minmax(0,1fr)}}
</style>
