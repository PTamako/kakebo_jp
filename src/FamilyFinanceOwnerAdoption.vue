<script setup>
import {onMounted,onUnmounted,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true}})
const kinds={
 recurring_plan:'旧固定费用',
 investment_plan:'旧 SBI 定投',
 investment_plan_history:'SBI 定投历史',
 investment_holding:'SBI 当前持仓',
 card_bill:'旧信用卡账单'
}
const opened=ref(false),busy=ref(false),loading=ref(false),error=ref('')
const summary=ref([]),kind=ref('recurring_plan'),cursor=ref(null)
const pending=ref(null),counts=ref({}),finished=ref({})
let generation=0,alive=true
function reset(){
 generation++;summary.value=[];error.value=''
}
function select(value){
 if(!Object.hasOwn(kinds,value)||kind.value===value||busy.value||loading.value)return
 kind.value=value;cursor.value=null;pending.value=null;reset()
}
async function load(){
 if(!alive||!opened.value||busy.value||loading.value)return
 const run=++generation,actor=props.userId,household=props.householdId
 loading.value=true;error.value=''
 try{
  const response=await fetch('/api/family-finance/legacy/resource-owners',{
   credentials:'same-origin',cache:'no-store'
  })
  const data=await response.json().catch(()=>({}))
  if(!alive||run!==generation||actor!==props.userId||
   household!==props.householdId||!opened.value)return
  if(!response.ok||data.ok!==true||data.household_id!==household||
   data.ledger_changed!==false||!Array.isArray(data.items)||
   data.items.some(x=>!Object.hasOwn(kinds,x.resource_kind)||
    x.owner_user_id!==actor||!Number.isSafeInteger(x.mapped_count)||
    x.mapped_count<0))
   throw Error(data.code||'资源归属汇总核验失败')
  summary.value=data.items
 }catch(e){
  if(alive&&run===generation)error.value=String(e.message||e)
 }finally{if(alive&&run===generation)loading.value=false}
}
function toggle(){
 if(busy.value||loading.value)return
 opened.value=!opened.value;reset()
 if(opened.value){
  if(!pending.value){finished.value={};cursor.value=null}
  void load()
 }
}
async function adopt(){
 if(!alive||!opened.value||busy.value||loading.value)return
 if(!pending.value){
  if(finished.value[kind.value])return
  if(!window.confirm('确认把此类原有金融资源归属证明登记到原管理员本人？不会变动旧账本、余额和计划。'))return
  pending.value={expected_user_id:props.userId,confirm:true,
   resource_kind:kind.value,...(cursor.value?{cursor:cursor.value}:{})}
 }
 const frozen=pending.value,run=generation,actor=props.userId,household=props.householdId
 busy.value=true;error.value=''
 let success=false
 try{
  const response=await fetch('/api/family-finance/legacy/resource-owners',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(frozen)
  })
  const data=await response.json().catch(()=>({}))
  if(!alive||run!==generation||actor!==props.userId||
   household!==props.householdId||!opened.value)return
  if(!response.ok||data.ok!==true||data.resource_kind!==frozen.resource_kind||
   data.owner_user_id!==actor||data.ledger_changed!==false||
   !Number.isSafeInteger(data.mapped)||data.mapped<0||data.mapped>50||
   !Number.isSafeInteger(data.already_mapped)||data.already_mapped<0||
   typeof data.has_more!=='boolean'||
   (data.has_more&&(typeof data.next_cursor!=='string'||!data.next_cursor))||
   (!data.has_more&&data.next_cursor!==null))
   throw Error(data.code||'归属登记结果尚未确认，请原样重试')
  counts.value={...counts.value,[kind.value]:(counts.value[kind.value]||0)+data.mapped}
  cursor.value=data.has_more?data.next_cursor:null
  finished.value={...finished.value,[kind.value]:!data.has_more}
  pending.value=null;success=true
 }catch(e){if(alive&&run===generation)error.value=String(e.message||e)}
 finally{if(alive&&run===generation)busy.value=false}
 if(success)void load()
}
function foreground(){
 if(document.visibilityState!=='visible')return
 reset()
 // Preserve the frozen unresolved POST (and cursor) for safe original retry.
 busy.value=false;loading.value=false
 if(opened.value)void load()
}
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{
 alive=false;reset();pending.value=null;opened.value=false
 document.removeEventListener('visibilitychange',foreground)
})
</script>
<template>
 <section class="legacy-adopt" aria-label="原金融资源归属登记">
  <div class="head">
   <strong>原金融资源归属登记</strong>
   <button type="button" :aria-expanded="opened" :disabled="busy||loading"
    @click="toggle">{{opened?'收起':'核对及登记'}}</button>
  </div>
  <template v-if="opened">
   <p class="note">原管理员人工确认五类历史资源，一次最多50条；仅登记不可更改的归属证据，不移动金额或修改账户。</p>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <label>资源类别
    <select :value="kind" :disabled="busy||loading||!!pending" @change="select($event.target.value)">
     <option v-for="(label,key) in kinds" :key="key" :value="key">{{label}}</option>
    </select>
   </label>
   <p v-if="loading" class="note">核对中…</p>
   <p class="note">此类现有已登记数量：{{summary.find(x=>x.resource_kind===kind)?.mapped_count||0}}</p>
   <p v-if="counts[kind]" class="note">本次新增 {{counts[kind]}} 条归属映射</p>
   <button type="button" :disabled="busy||loading||finished[kind]" @click="adopt">
    {{pending?'结果未确认 · 原样重试':finished[kind]?'此类分页核对结束':cursor?'继续登记下一批':'确认原归属并登记'}}
   </button>
   <button type="button" :disabled="busy||loading" @click="load">重新读取归属统计</button>
  </template>
 </section>
</template>
<style scoped>
.legacy-adopt{display:grid;gap:9px;padding:12px 0;min-width:0;border-top:1px solid var(--line,#ddd)}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.head strong{font-size:13px}
.legacy-adopt button,.legacy-adopt select{font:inherit;font-size:12px;min-height:42px;
 border:1px solid var(--line,#ddd);border-radius:10px;padding:8px 12px;background:transparent;color:inherit}
.legacy-adopt button:disabled{opacity:.5}
.legacy-adopt label{display:grid;gap:5px;font-size:12px}
.legacy-adopt select{width:100%;min-width:0}
.note{font-size:11px;line-height:1.5;color:var(--muted,#777);margin:0}
.error{font-size:12px;line-height:1.5;color:#b44242}
</style>