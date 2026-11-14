<script setup>
import {onUnmounted,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true}})
const open=ref(false),loading=ref(false),error=ref('')
const items=ref([]),summary=ref(null)
let revision=0,alive=true
const names={
 adopted_to_original_owner:'已对应原管理员的稳定账户',
 legacy_account_not_adopted:'旧金融账户尚未关联',
 historical_source_missing:'历史支付来源已不在当前账户列表'
}
function valid(item){
 return item&&typeof item.legacy_name==='string'&&item.legacy_name.length>0&&
  item.legacy_name.length<=240&&Object.hasOwn(names,item.status)&&
  Number.isSafeInteger(item.entry_source_count)&&item.entry_source_count>=0&&
  Number.isSafeInteger(item.linked_entry_count)&&item.linked_entry_count>=0&&
  Number.isSafeInteger(item.transfer_target_count)&&item.transfer_target_count>=0&&
  (item.stable_account_id===null||/^[a-f0-9]{32}$/.test(item.stable_account_id))
}
async function load(){
 if(!alive||!open.value||loading.value)return
 const epoch=++revision,user=props.userId,household=props.householdId
 loading.value=true;error.value=''
 try{
  const response=await fetch('/api/family-finance/legacy/mapping-audit',{
   credentials:'same-origin',cache:'no-store'
  })
  const data=await response.json().catch(()=>({}))
  if(!alive||epoch!==revision||user!==props.userId||household!==props.householdId)return
  if(!response.ok)throw Error(String(data.code||'核对接口暂不可用'))
  if(data.ok!==true||data.read_only!==true||data.ledger_changed!==false||
   data.household_id!==household||!Array.isArray(data.items)||
   data.items.length>300||!data.items.every(valid)||
   !Number.isSafeInteger(data.unresolved_source_count)||
   !Number.isSafeInteger(data.mapped_source_count)||
   data.mapped_source_count+data.unresolved_source_count!==data.items.length||
   !Number.isSafeInteger(data.previously_linked_entries)||
   !Number.isSafeInteger(data.linked_legacy_entry_count)||
   !Number.isSafeInteger(data.remaining_legacy_entry_count)||
   data.linked_legacy_entry_count!==data.items.reduce((s,x)=>s+x.linked_entry_count,0)||
   data.remaining_legacy_entry_count!==data.items.reduce((s,x)=>s+x.entry_source_count,0))
   throw Error('原账户归属核对数据不完整，请暂勿迁移')
  items.value=data.items;summary.value=data
 }catch(e){
  if(alive&&epoch===revision&&user===props.userId){
   items.value=[];summary.value=null;error.value=e.message
  }
 }finally{
  if(alive&&epoch===revision&&user===props.userId)loading.value=false
 }
}
function toggle(){
 if(loading.value)return
 open.value=!open.value
 if(open.value)void load()
 else{revision++;items.value=[];summary.value=null;error.value=''}
}
onUnmounted(()=>{alive=false;revision++;open.value=false;items.value=[];summary.value=null})
</script>
<template>
 <section class="hf-audit" aria-label="旧金融来源归属核对">
  <div class="hf-audit-head">
   <strong>旧账本账户归属核对</strong>
   <button type="button" :aria-expanded="open" @click="toggle">{{open?'收起':'查看缺失关联'}}</button>
  </div>
  <div v-if="open" class="hf-audit-body">
   <p class="hf-subtle">仅核对原账户名称与稳定 ID，不修改任何既存流水、卡账单或资产。</p>
   <p v-if="error" class="hf-error" role="alert">{{error}}</p>
   <p v-if="loading" class="hf-subtle">核对中…</p>
   <template v-else-if="summary">
    <p class="hf-subtle">已认领账户来源 {{summary.mapped_source_count}} 项 · 待认领 {{summary.unresolved_source_count}} 项</p>
    <p class="hf-subtle">原历史收支：已关联稳定 ID {{summary.linked_legacy_entry_count}} 笔 · 待关联 {{summary.remaining_legacy_entry_count}} 笔。转账需单独核对。</p>
    <ul class="hf-audit-list">
     <li v-for="item in items" :key="item.legacy_name">
      <strong>{{item.legacy_name}}</strong>
      <span>{{names[item.status]}}</span>
      <small>旧收支已关联 {{item.linked_entry_count}} 笔 · 待关联 {{item.entry_source_count}} 笔 · 转入目标 {{item.transfer_target_count}} 笔</small>
     </li>
    </ul>
    <p v-if="!items.length" class="hf-subtle">暂无可核对的旧金融来源。</p>
    <p v-if="summary.requires_manual_review" class="hf-subtle">存在尚未关联或历史遗留名称，后续必须人工核对再迁移，不能按显示名称自动分配到另一家庭成员。</p>
    <button type="button" :disabled="loading" @click="load">重新核对</button>
   </template>
  </div>
 </section>
</template>
<style scoped>
.hf-audit{min-width:0;display:grid;gap:8px;padding:12px 0;border-top:1px solid var(--line,#dde3df)}
.hf-audit-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.hf-audit-head strong{font-size:13px}
.hf-audit button{font:inherit;font-size:12px;min-height:42px;border-radius:10px;border:1px solid var(--line,#ccd7d0);padding:8px 12px;background:transparent;color:inherit}
.hf-audit-body{min-width:0;display:grid;gap:9px}
.hf-subtle{font-size:12px;line-height:1.5;color:var(--muted,#71777b);margin:0}
.hf-error{font-size:12px;line-height:1.5;color:#b34343;overflow-wrap:anywhere;margin:0}
.hf-audit-list{list-style:none;padding:0;margin:0;display:grid;gap:7px}
.hf-audit-list li{padding:10px;display:grid;gap:4px;border:1px solid var(--line,#ddd);border-radius:10px;min-width:0}
.hf-audit-list strong{font-size:12px;overflow-wrap:anywhere}
.hf-audit-list span{font-size:12px}
.hf-audit-list small{font-size:11px;color:var(--muted,#71777b)}
</style>
