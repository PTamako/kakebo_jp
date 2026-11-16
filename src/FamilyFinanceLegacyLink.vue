<script setup>
import {onUnmounted,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true}})
const open=ref(false),loading=ref(false),busy=ref('')
const rows=ref([]),cursor=ref(0),nextCursor=ref(null)
const error=ref(''),message=ref(''),disabled=ref(false)
const id32=/^[a-f0-9]{32}$/i,sha256=/^[a-f0-9]{64}$/i
let revision=0,alive=true
function valid(item){
 return item&&Number.isSafeInteger(item.entry_id)&&item.entry_id>0&&
  id32.test(item.account_id||'')&&sha256.test(item.source_digest||'')&&
  ['expense','income'].includes(item.type)&&
  typeof item.account_label==='string'&&item.account_label.length<=80&&
  typeof item.original_source==='string'&&item.original_source.length>0&&
  typeof item.date==='string'&&Number.isSafeInteger(item.amount_jpy)&&
  Number.isFinite(item.amount_jpy)&&
  typeof item.category==='string'
}
async function request(path,options){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(String(data.code||'旧账关联暂不可用'))
 return data
}
async function load(after=0,preserveMessage=false){
 if(!alive||!open.value||busy.value||loading.value||
  !Number.isSafeInteger(after)||after<0)return
 const generation=++revision,user=props.userId,household=props.householdId
 loading.value=true;error.value=''
 if(!preserveMessage)message.value=''
 try{
  const data=await request('/api/family-finance/legacy/entry-links?after_id='+after)
  if(!alive||generation!==revision||user!==props.userId||
    household!==props.householdId||!open.value)return
  if(data.ok!==true||data.read_only!==true||
    data.financial_values_changed!==false||
    data.requires_explicit_confirmation!==true||
    data.household_id!==household||!Array.isArray(data.items)||
    data.items.length>5||!data.items.every(valid)||
    !(data.next_after_id===null||(Number.isSafeInteger(data.next_after_id)&&
      data.next_after_id>after&&data.items.at(-1)?.entry_id===data.next_after_id)))
   throw Error('旧账关联预览不完整，禁止操作')
  rows.value=data.items;cursor.value=after;nextCursor.value=data.next_after_id
  disabled.value=false
 }catch(e){
  if(alive&&generation===revision&&user===props.userId){
   rows.value=[];nextCursor.value=null;error.value=e.message
   disabled.value=e.message==='LEGACY_ENTRY_LINKS_DISABLED'
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
 const user=props.userId,household=props.householdId,generation=revision
 if(!alive||!open.value||loading.value||busy.value||!valid(item)||
  !rows.value.some(r=>r.entry_id===item.entry_id&&
    r.source_digest===item.source_digest&&r.account_id===item.account_id))return
 const label=item.original_source+' → '+item.account_label
 if(!window.confirm('确认把原管理员的历史流水 '+item.entry_id+
  '（'+item.amount_jpy+'円，'+item.date+'）关联到 '+label+
  '？\n只补稳定账户 ID，不修改金额、日期、分类、原支付方式或转账。'))return
 if(!alive||generation!==revision||user!==props.userId||
  household!==props.householdId||!open.value)return
 busy.value=String(item.entry_id);error.value='';message.value=''
 try{
  const result=await request('/api/family-finance/legacy/entry-links',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({entry_id:item.entry_id,account_id:item.account_id,
    source_digest:item.source_digest,expected_user_id:user,confirm:true})
  })
  if(!alive||generation!==revision||user!==props.userId||
    household!==props.householdId||!open.value)return
  if(result.ok!==true||result.linked!==true||
    result.financial_values_changed!==false||
    result.entry_id!==item.entry_id||result.account_id!==item.account_id)
   throw Error('关联回执与当前预览不一致，请重新核对')
  message.value='已关联历史流水 '+item.entry_id+
   ' 的稳定账户 ID；原金额、日期、分类及支付来源未变。'
 }catch(e){
  if(alive&&generation===revision&&user===props.userId)
   error.value=e.message==='LEGACY_ENTRY_CHANGED_REVIEW_AGAIN'
    ?'原流水在预览后发生变化，请重新核对。':e.message
 }finally{
  if(alive&&generation===revision&&user===props.userId&&
    household===props.householdId){
   busy.value=''
   await load(0,true)
  }
 }
}
onUnmounted(()=>{
 alive=false;revision++;open.value=false;rows.value=[];busy.value=''
})
</script>
<template>
 <section class="legacy-links" aria-label="逐笔旧账稳定账户关联">
  <div class="heading">
   <strong>逐笔旧账关联</strong>
   <button type="button" :aria-expanded="open" @click="toggle">
    {{open?'收起':'查看迁移预览'}}
   </button>
  </div>
  <div v-if="open" class="content">
   <p class="muted">仅原管理员可核对已领回账户的历史收支。每笔确认后只关联稳定 ID；转账和未匹配来源不会自动处理。</p>
   <p v-if="error" class="error" role="alert">{{disabled?'迁移写入功能尚未开放。':error}}</p>
   <p v-if="message" class="muted" role="status">{{message}}</p>
   <p v-if="loading" class="muted">核对中…</p>
   <ul v-else class="records">
    <li v-for="item in rows" :key="item.entry_id">
     <b>{{item.original_source}} · {{item.date}}</b>
     <span>{{item.type==='expense'?'支出':'收入'}} {{item.amount_jpy}}円 · {{item.category}}</span>
     <small>将对应：{{item.account_label}}（原管理员账户）</small>
     <button type="button" :disabled="!!busy||loading||disabled"
      @click="link(item)">核对并关联这笔</button>
    </li>
   </ul>
   <p v-if="!loading&&!error&&!rows.length" class="muted">目前没有符合安全关联条件的旧收支记录。</p>
   <div v-if="!disabled" class="paging">
    <button type="button" :disabled="loading||!!busy||cursor===0"
     @click="load(0)">从头核对</button>
    <button type="button" :disabled="loading||!!busy||nextCursor===null"
     @click="load(nextCursor)">下一批</button>
   </div>
  </div>
 </section>
</template>
<style scoped>
.legacy-links{min-width:0;padding:12px 0;border-top:1px solid var(--line,#dde3df);display:grid;gap:9px}
.heading,.paging{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.heading strong{font-size:13px}
.legacy-links button{font:inherit;font-size:12px;min-height:44px;padding:8px 12px;border:1px solid var(--line,#d2dcd6);border-radius:10px;background:transparent;color:inherit}
.legacy-links button:disabled{opacity:.5}
.content,.records{display:grid;gap:9px;min-width:0}
.records{list-style:none;margin:0;padding:0}
.records li{border:1px solid var(--line,#dde3df);border-radius:12px;padding:10px;display:grid;gap:5px;min-width:0}
.records b{font-size:12px;overflow-wrap:anywhere}
.records span{font-size:12px}
.records small,.muted{font-size:11px;line-height:1.5;color:var(--muted,#71777b)}
.muted,.error{margin:0}
.error{font-size:12px;color:#ae4444;overflow-wrap:anywhere}
</style>
