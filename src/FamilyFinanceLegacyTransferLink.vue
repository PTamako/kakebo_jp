<script setup>
import {onUnmounted,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true}})
const open=ref(false),loading=ref(false),busy=ref('')
const rows=ref([]),cursor=ref(0),nextCursor=ref(null)
const error=ref(''),message=ref(''),disabled=ref(false)
const hex32=/^[a-f0-9]{32}$/,sha256=/^[a-f0-9]{64}$/
let revision=0,alive=true
function valid(x){
 return x&&Number.isSafeInteger(x.entry_id)&&x.entry_id>0&&
  hex32.test(x.source_account_id||'')&&hex32.test(x.target_account_id||'')&&
  x.source_account_id!==x.target_account_id&&sha256.test(x.source_digest||'')&&
  typeof x.original_source==='string'&&x.original_source.length>0&&
  typeof x.original_target==='string'&&x.original_target.length>0&&
  x.original_source!==x.original_target&&
  typeof x.source_label==='string'&&typeof x.target_label==='string'&&
  typeof x.date==='string'&&Number.isSafeInteger(x.amount_jpy)&&x.amount_jpy>=0&&
  Number.isSafeInteger(x.transfer_applied)
}
async function request(path,options){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(String(data.code||'转账归属核对暂不可用'))
 return data
}
async function load(after=0,keepMessage=false){
 if(!alive||!open.value||loading.value||busy.value||
  !Number.isSafeInteger(after)||after<0)return
 const generation=++revision,user=props.userId,household=props.householdId
 loading.value=true;error.value=''
 if(!keepMessage)message.value=''
 try{
  const data=await request('/api/family-finance/legacy/transfer-links?after_id='+after)
  if(!alive||generation!==revision||user!==props.userId||
   household!==props.householdId||!open.value)return
  if(data.ok!==true||data.read_only!==true||
   data.financial_values_changed!==false||data.requires_explicit_confirmation!==true||
   data.household_id!==household||!Array.isArray(data.items)||data.items.length>5||
   !data.items.every(valid)||
   !(data.next_after_id===null||(Number.isSafeInteger(data.next_after_id)&&
     data.next_after_id>after&&data.next_after_id===data.items.at(-1)?.entry_id)))
   throw Error('转账双向归属预览不完整，禁止操作')
  rows.value=data.items;cursor.value=after;nextCursor.value=data.next_after_id
  disabled.value=false
 }catch(e){
  if(alive&&generation===revision&&user===props.userId){
   rows.value=[];nextCursor.value=null;error.value=e.message
   disabled.value=e.message==='LEGACY_TRANSFER_LINKS_DISABLED'
  }
 }finally{
  if(alive&&generation===revision&&user===props.userId)loading.value=false
 }
}
function toggle(){
 if(busy.value||loading.value)return
 open.value=!open.value
 if(open.value)void load(0)
 else{revision++;rows.value=[];nextCursor.value=null;error.value='';message.value=''}
}
async function link(item){
 const generation=revision,user=props.userId,household=props.householdId
 if(!alive||!open.value||loading.value||busy.value||!valid(item)||
  !rows.value.some(x=>x.entry_id===item.entry_id&&
   x.source_digest===item.source_digest&&x.source_account_id===item.source_account_id&&
   x.target_account_id===item.target_account_id))return
 if(!window.confirm('确认关联这笔原管理员历史转账 '+item.entry_id+
  '（'+item.amount_jpy+'円，'+item.date+'）？\n转出：'+item.original_source+
  ' → '+item.source_label+'\n转入：'+item.original_target+' → '+item.target_label+
  '\n只写入两个稳定账户 ID，不执行新的转账、不更改任何金额或原始来源。'))return
 if(!alive||generation!==revision||user!==props.userId||
  household!==props.householdId||!open.value)return
 busy.value=String(item.entry_id);error.value='';message.value=''
 try{
  const result=await request('/api/family-finance/legacy/transfer-links',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({entry_id:item.entry_id,
    source_account_id:item.source_account_id,target_account_id:item.target_account_id,
    source_digest:item.source_digest,expected_user_id:user,confirm:true})
  })
  if(!alive||generation!==revision||user!==props.userId||
   household!==props.householdId||!open.value)return
  if(result.ok!==true||result.linked!==true||
   result.financial_values_changed!==false||
   result.entry_id!==item.entry_id||
   result.source_account_id!==item.source_account_id||
   result.target_account_id!==item.target_account_id)
   throw Error('转账关联回执不一致，请重新核对')
  message.value='已把这笔原转账的转出、转入各关联到正确稳定账户；未执行资金操作。'
 }catch(e){
  if(alive&&generation===revision&&user===props.userId)
   error.value=e.message==='LEGACY_TRANSFER_CHANGED_REVIEW_AGAIN'
    ?'原转账在预览后发生变化，请重新核对。':e.message
 }finally{
  if(alive&&generation===revision&&user===props.userId&&
   household===props.householdId){
   busy.value=''
   await load(0,true)
  }
 }
}
onUnmounted(()=>{alive=false;revision++;open.value=false;rows.value=[];busy.value=''})
</script>
<template>
 <section class="hf-transfer-links" aria-label="旧转账双向账户归属核对">
  <div class="head">
   <strong>旧转账双向账户核对</strong>
   <button type="button" :aria-expanded="open" @click="toggle">
    {{open?'收起':'查看旧转账'}}
   </button>
  </div>
  <div v-if="open" class="content">
   <p class="muted">转出和转入必须分别属于原管理员已认领的两个不同账户。只关联账户 ID，不重新转账、不调整余额。</p>
   <p v-if="error" role="alert" class="error">{{disabled?'双向转账关联功能尚未开放。':error}}</p>
   <p v-if="message" role="status" class="muted">{{message}}</p>
   <p v-if="loading" class="muted">正在核对双向账户…</p>
   <ul v-else class="entries">
    <li v-for="x in rows" :key="x.entry_id">
     <strong>转账 #{{x.entry_id}} · {{x.date}}</strong>
     <span>{{x.amount_jpy}}円</span>
     <small>转出：{{x.original_source}} → {{x.source_label}}</small>
     <small>转入：{{x.original_target}} → {{x.target_label}}</small>
     <button type="button" :disabled="loading||!!busy||disabled"
      @click="link(x)">确认双向关联</button>
    </li>
   </ul>
   <p v-if="!loading&&!error&&!rows.length" class="muted">没有符合严格双向归属条件的旧转账；其他记录需要人工核对。</p>
   <div v-if="!disabled" class="pager">
    <button type="button" :disabled="loading||!!busy||cursor===0" @click="load(0)">从头核对</button>
    <button type="button" :disabled="loading||!!busy||nextCursor===null"
     @click="load(nextCursor)">下一批</button>
   </div>
  </div>
 </section>
</template>
<style scoped>
.hf-transfer-links{min-width:0;display:grid;gap:9px;padding:12px 0;border-top:1px solid var(--line,#dde3df)}
.head,.pager{display:flex;justify-content:space-between;align-items:center;gap:8px}
.head strong{font-size:13px}
.hf-transfer-links button{font:inherit;font-size:12px;min-height:44px;border:1px solid var(--line,#d2dcd6);border-radius:10px;padding:8px 12px;background:transparent;color:inherit}
.hf-transfer-links button:disabled{opacity:.5}
.content,.entries{display:grid;gap:9px;min-width:0}
.entries{list-style:none;margin:0;padding:0}
.entries li{border:1px solid var(--line,#dde3df);border-radius:12px;padding:10px;display:grid;gap:6px;min-width:0}
.entries strong{font-size:12px}
.entries span{font-size:12px}
.entries small,.muted{font-size:11px;line-height:1.5;color:var(--muted,#71777b)}
.muted,.error{margin:0}
.error{font-size:12px;color:#ae4444;overflow-wrap:anywhere}
</style>