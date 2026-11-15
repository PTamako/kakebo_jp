<script setup>
import {onBeforeUnmount,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true}})
const rows=ref([]),busy=ref(false),error=ref(''),notice=ref(''),next=ref(null)
let disposed=false,controller=null,revision=0
onBeforeUnmount(()=>{disposed=true;revision++;controller?.abort();rows.value=[];notice.value='';error.value=''})
function safe(){return !disposed&&!!props.userId&&!!props.householdId}
async function jsonCall(path,opts={}){
 const r=await fetch(path,{cache:'no-store',credentials:'same-origin',...opts})
 const data=await r.json().catch(()=>({}))
 if(!r.ok)throw Error(data.code||'迁移资格验证失败')
 return data
}
async function load(after=0){
 if(busy.value||!safe())return
 const stamp=++revision,who=props.userId,house=props.householdId
 busy.value=true;error.value='';notice.value=''
 controller?.abort();controller=new AbortController()
 try{
  const result=await jsonCall('/api/family-finance/legacy/shared-adoption-preflight?after_id='+after,
   {signal:controller.signal})
  if(disposed||stamp!==revision||who!==props.userId||house!==props.householdId)return
  if(result.read_only!==true||result.adopted!==false||!Array.isArray(result.items))
   throw Error('只读核验结果不可信')
  rows.value=result.items
  next.value=result.next_after_id??null
 }catch(e){
  if(!disposed&&stamp===revision&&e.name!=='AbortError')error.value=e.message
 }finally{if(!disposed&&stamp===revision)busy.value=false}
}
async function adopt(row){
 if(busy.value||!safe()||row.blockers?.length||
    row.adoption_state!=='manual_review_required'||row.original_owner_user_id!==props.userId)return
 const entryId=row.entry_id,digest=row.source_snapshot_sha256
 if(!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(entryId))return
 if(!window.confirm('确认将历史账目 #'+entryId+' 纳入家庭共享修改/删除/恢复？原账 ID、金额、分类和日期不变。此操作不可撤销；旧 R2 图片尚不支持迁移。'))return
 const stamp=++revision,who=props.userId,house=props.householdId
 busy.value=true;error.value='';notice.value=''
 controller?.abort();controller=new AbortController()
 try{
  const result=await jsonCall('/api/family-finance/legacy/shared-adopt',{
   method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
   body:JSON.stringify({expected_user_id:who,entry_id:entryId,
    account_id:row.account_id,source_snapshot_sha256:digest,confirm:true})
  })
  if(disposed||stamp!==revision||who!==props.userId||house!==props.householdId)return
  if(result.adopted!==true||result.ledger_changed!==false||result.adoption?.entry_id!==entryId)
   throw Error('采用回执需复核')
  notice.value='第 '+entryId+' 笔已记录采用回执（未新增收支）'
  rows.value=rows.value.map(r=>r.entry_id===entryId?
   {...r,adoption_state:'adopted',blockers:['already_under_shared_lifecycle']}:r)
 }catch(e){
  if(!disposed&&stamp===revision&&e.name!=='AbortError')error.value=e.message
 }finally{if(!disposed&&stamp===revision)busy.value=false}
}
</script>

<template>
 <section class="legacy-adoption" aria-label="历史共享账逐笔采用">
  <div class="head"><strong>历史共享账目 · 逐笔确认</strong>
   <button type="button" :disabled="busy" @click="load(0)">检查资格</button></div>
  <small>仅原管理员本人可确认普通收入/支出。原始票据存在或已删除时必须先核对附件，不允许自动迁移。</small>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <p v-if="notice" role="status">{{notice}}</p>
  <ul v-if="rows.length">
   <li v-for="r in rows" :key="r.entry_id">
    <div><b>#{{r.entry_id}} · {{r.entry_type}}</b>
     <small>原字段摘要 {{r.source_snapshot_sha256.slice(0,12)}}…</small>
     <small v-if="r.blockers.length">禁止采用：{{r.blockers.join(' / ')}}</small>
     <small v-else>需原所有者明确确认，无自动批量执行</small>
    </div>
    <button type="button" :disabled="busy||r.blockers.length>0||r.adoption_state!=='manual_review_required'"
     @click="adopt(r)">逐笔确认采用</button>
   </li>
  </ul>
  <button v-if="next!==null" type="button" :disabled="busy" @click="load(next)">下一页</button>
 </section>
</template>
<style scoped>
.legacy-adoption{display:grid;gap:9px;padding:12px;border:1px solid var(--line,#ddd);border-radius:14px;min-width:0}
.head{display:flex;justify-content:space-between;gap:8px;align-items:center}
small{font-size:11px;color:var(--muted,#777);overflow-wrap:anywhere}
ul{list-style:none;padding:0;margin:0;display:grid;gap:7px}
li{border:1px solid var(--line,#ddd);border-radius:11px;padding:9px;display:flex;
 gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;min-width:0}
li>div{display:grid;gap:4px;min-width:0;flex:1}
button{min-height:40px;border-radius:9px;padding:6px 12px;border:1px solid var(--line,#ddd)}
button:disabled{opacity:.45}.error{color:#b44646;overflow-wrap:anywhere}
</style>
