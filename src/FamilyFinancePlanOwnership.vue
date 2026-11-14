<script setup>
import {onMounted,onUnmounted,ref} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true}})
const labels={recurring_plan:'固定费用',investment_plan:'SBI 定投',
 investment_plan_history:'定投历史版本'}
const opened=ref(false),kind=ref('recurring_plan'),busy=ref(false),error=ref('')
const items=ref([]),next=ref(null)
let generation=0,alive=true
const owner=item=>item.identity_status!=='verified_legacy'?'归属待核验':
 item.owner_user_id===props.userId?'本人原有计划':'家庭成员原有计划'
function clear(){generation++;items.value=[];next.value=null;error.value=''}
function toggle(){
 if(busy.value)return
 opened.value=!opened.value
 clear()
 if(opened.value)void load()
}
function choose(value){
 if(!Object.hasOwn(labels,value)||kind.value===value||busy.value)return
 kind.value=value;clear()
 if(opened.value)void load()
}
async function load(more=false){
 if(!alive||!opened.value||busy.value||(more&&!next.value))return
 const revision=++generation,actor=props.userId,household=props.householdId
 const selected=kind.value,cursor=more?next.value:null
 busy.value=true;error.value=''
 try{
  const q=new URLSearchParams({kind:selected,limit:'20'})
  if(cursor)q.set('after',cursor)
  const res=await fetch('/api/family-finance/shared/plan-ownership?'+q,{
   credentials:'same-origin',cache:'no-store'})
  const data=await res.json().catch(()=>({}))
  if(!alive||revision!==generation||!opened.value||actor!==props.userId||
   household!==props.householdId||selected!==kind.value)return
  if(!res.ok||data.ok!==true||data.scope!=='household'||
   data.household_id!==household||data.kind!==selected||
   data.read_only!==true||data.ledger_changed!==false||
   data.ownership_proof!=='immutable_legacy_resource_owner'||
   !Array.isArray(data.items)||data.items.some(x=>
    typeof x.legacy_key!=='string'||typeof x.label!=='string'||
    !['verified_legacy','unverified'].includes(x.identity_status)||
    (x.identity_status==='unverified'&&x.owner_user_id!==null)||
    (x.identity_status==='verified_legacy'&&!x.owner_user_id)))
   throw Error(data.code||'计划归属核验失败')
  items.value=more?[...items.value,...data.items]:data.items
  next.value=typeof data.next_cursor==='string'?data.next_cursor:null
 }catch(e){if(alive&&revision===generation)error.value=String(e.message||e)}
 finally{if(alive&&revision===generation)busy.value=false}
}
function foreground(){
 if(document.visibilityState!=='visible'||!opened.value)return
 clear()
 if(!busy.value)void load()
}
onMounted(()=>document.addEventListener('visibilitychange',foreground))
onUnmounted(()=>{
 alive=false;clear()
 document.removeEventListener('visibilitychange',foreground)
})
</script>
<template>
 <section class="plan-proof" aria-label="家庭固定费与投资计划归属">
  <div class="head"><strong>固定费与 SBI 计划归属</strong>
   <button type="button" :aria-expanded="opened" :disabled="busy"
    @click="toggle">{{opened?'收起':'查看计划归属'}}</button>
  </div>
  <template v-if="opened">
   <p class="note">已验证的历史计划会标明原归属人；两个人都可以查看。这里只读，不代表已开放个人编辑或自动扣款。</p>
   <div class="filters">
    <button v-for="(label,key) in labels" :key="key" type="button"
     :aria-pressed="kind===key" :disabled="busy" @click="choose(key)">{{label}}</button>
   </div>
   <p v-if="error" class="error" role="alert">{{error}}</p>
   <p v-if="busy" class="note">核对计划中…</p>
   <ul class="items">
    <li v-for="item in items" :key="item.legacy_key">
     <span>{{item.label}}</span><small>{{owner(item)}}</small>
    </li>
   </ul>
   <p v-if="!items.length&&!busy" class="note">暂无此类计划</p>
   <button v-if="next" type="button" :disabled="busy" @click="load(true)">加载更多</button>
   <button type="button" :disabled="busy" @click="clear();load()">重新读取</button>
  </template>
 </section>
</template>
<style scoped>
.plan-proof{display:grid;gap:9px;min-width:0;border-top:1px solid var(--line,#ddd);padding-top:12px}
.head,.filters{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.head strong{font-size:13px}
.plan-proof button{font:inherit;min-height:42px;border:1px solid var(--line,#ddd);
 border-radius:10px;background:transparent;color:inherit;padding:7px 12px;font-size:12px}
.plan-proof button[aria-pressed="true"]{font-weight:700;border-color:currentColor}
.plan-proof button:disabled{opacity:.5}
.note,.items small{font-size:11px;line-height:1.5;color:var(--muted,#777);margin:0}
.items{display:grid;gap:5px;list-style:none;padding:0;margin:0}
.items li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;
 padding:8px;border:1px solid var(--line,#ddd);border-radius:10px}
.items span{font-size:12px;overflow-wrap:anywhere}
.error{font-size:12px;color:#b44444}
</style>
