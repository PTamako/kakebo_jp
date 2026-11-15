<script setup>
import {onBeforeUnmount,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},householdId:{type:String,required:true}})
const rows=ref([]),busy=ref(false),error=ref(''),notice=ref(''),next=ref(null)
const reviewed=ref({}),copied=ref({})
let disposed=false,controller=null,revision=0
onBeforeUnmount(()=>{disposed=true;revision++;controller?.abort();rows.value=[];reviewed.value={};copied.value={};notice.value='';error.value=''})
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
  reviewed.value={};copied.value={}
  next.value=result.next_after_id??null
 }catch(e){
  if(!disposed&&stamp===revision&&e.name!=='AbortError')error.value=e.message
 }finally{if(!disposed&&stamp===revision)busy.value=false}
}
// The exact R2 blocker is separately reviewable; ANY other blocker stops.
const needsReceipt=row=>row?.blockers?.length===1&&
 row.blockers[0]==='requires_original_r2_object_and_tombstone_review';
const canAdopt=row=>row.adoption_state==='manual_review_required'&&
 row.original_owner_user_id===props.userId&&(!row.blockers.length||
  needsReceipt(row)&&copied.value[row.entry_id]===row.source_snapshot_sha256);
async function reviewReceipt(row){
 if(busy.value||!safe()||!needsReceipt(row)||row.original_owner_user_id!==props.userId)return
 const stamp=++revision,who=props.userId,house=props.householdId
 busy.value=true;error.value='';notice.value=''
 controller?.abort();controller=new AbortController()
 try{
  const data=await jsonCall('/api/family-finance/legacy/shared-receipt-review?entry_id='+
    encodeURIComponent(row.entry_id),{signal:controller.signal})
  if(disposed||stamp!==revision||who!==props.userId||house!==props.householdId)return
  if(data.read_only!==true||data.copied!==false||data.entry_id!==row.entry_id||
    data.account_id!==row.account_id||!/^[a-f0-9]{64}$/.test(data.original_sha256))
   throw Error('原票据核验未取得可追踪证据')
  reviewed.value={...reviewed.value,[row.entry_id]:data}
  notice.value='原票据 #'+row.entry_id+' 已逐字节核验；尚未复制或公开'
 }catch(e){
  if(!disposed&&stamp===revision&&e.name!=='AbortError')error.value=e.message
 }finally{if(!disposed&&stamp===revision)busy.value=false}
}
async function copyReceipt(row){
 if(busy.value||!safe()||!needsReceipt(row)||row.original_owner_user_id!==props.userId)return
 const review=reviewed.value[row.entry_id]
 if(!review||review.account_id!==row.account_id||review.entry_id!==row.entry_id)return
 if(!window.confirm('确认只为历史账目 #'+row.entry_id+
  ' 复制已核验的原始票据？SHA：'+review.original_sha256.slice(0,16)+
  '…；不重新压缩、不删除原件、不会自动采用账目。'))return
 const stamp=++revision,who=props.userId,house=props.householdId
 busy.value=true;error.value='';notice.value=''
 controller?.abort();controller=new AbortController()
 try{
  const data=await jsonCall('/api/family-finance/legacy/shared-receipt-copy',{
   method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
   body:JSON.stringify({expected_user_id:who,entry_id:row.entry_id,account_id:row.account_id,
    source_snapshot_sha256:row.source_snapshot_sha256,confirm:true})
  })
  if(disposed||stamp!==revision||who!==props.userId||house!==props.householdId)return
  if(data.state!=='verified_copy_not_adopted'||data.entry_id!==row.entry_id||
    data.original_sha256!==review.original_sha256||
    data.copied_to_shared_registry!==false||data.legacy_object_deleted!==false)
    throw Error('R2 副本回执需独立核对')
  copied.value={...copied.value,[row.entry_id]:row.source_snapshot_sha256}
  notice.value='第 '+row.entry_id+' 笔原件副本已核验，尚未采用；仍须单独确认共享'
 }catch(e){
  if(!disposed&&stamp===revision&&e.name!=='AbortError')error.value=e.message
 }finally{if(!disposed&&stamp===revision)busy.value=false}
}
async function adopt(row){
 if(busy.value||!safe()||!canAdopt(row))return
 const entryId=row.entry_id,digest=row.source_snapshot_sha256
 if(!/^[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(entryId))return
 if(!window.confirm('确认将历史账目 #'+entryId+' 纳入家庭共享修改/删除/恢复？原账 ID、金额、分类和日期保持原样。'+
  (needsReceipt(row)?'已核验的原票据副本将在同一笔 D1 事务中关联，旧原件保留。':'无需迁移旧附件。')+
  '此操作不可撤销。'))return
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
  <small>仅原管理员逐笔确认。普通账不重新计数；未删除的旧票据需人工核验、原字节复制和再次确认。已删除票据禁止恢复，不自动批量迁移。</small>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <p v-if="notice" role="status">{{notice}}</p>
  <ul v-if="rows.length">
   <li v-for="r in rows" :key="r.entry_id">
    <div><b>#{{r.entry_id}} · {{r.entry_type}}</b>
     <small>原字段摘要 {{r.source_snapshot_sha256.slice(0,12)}}…</small>
     <small v-if="r.blockers.length">{{needsReceipt(r)?'旧票据必须先核验及复制：':'禁止采用：'}}{{r.blockers.join(' / ')}}</small>
     <small v-else>需原所有者明确确认，无自动批量执行</small>
     <small v-if="reviewed[r.entry_id]">票据 SHA：{{reviewed[r.entry_id].original_sha256.slice(0,16)}}…</small>
     <small v-if="copied[r.entry_id]">原字节副本已核验，待单独确认采用</small>
    </div>
    <button v-if="needsReceipt(r)" type="button" :disabled="busy" @click="reviewReceipt(r)">核验旧票据</button>
    <button v-if="needsReceipt(r)&&reviewed[r.entry_id]&&!copied[r.entry_id]" type="button"
     :disabled="busy" @click="copyReceipt(r)">确认原件复制</button>
    <button type="button" :disabled="busy||!canAdopt(r)" @click="adopt(r)">逐笔确认采用</button>
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
