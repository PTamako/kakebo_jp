<script setup>
import {computed,reactive,ref,watch} from 'vue'
import TransactionForm from './TransactionForm.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'

const props=defineProps({
 userId:{type:String,required:true},
 cards:{type:Array,default:()=>[]}
})
const emit=defineEmits(['posted','refresh'])
const categories=['食費','日用品','交通','住居','医療','交際費','その他']
const today=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const draft=reactive({
 type:'expense',date:today(),time:'',amount:'',merchant:'',
 category:'食費',note:'',paymentSource:'',transferTarget:'',
 bindRule:false,bindPaymentRule:false
})
const open=ref(true),busy=ref(false),error=ref(''),notice=ref('')
const selected=ref('')
const available=computed(()=>props.cards.filter(c=>
 typeof c.card_name==='string'&&c.card_name.length>0))
const selectedCard=computed(()=>available.value.find(c=>c.card_name===selected.value)||null)
const ownerLabel=computed(()=>selectedCard.value?.owner_display_name||'家庭管理员')
let pending=null
const id32=/^[a-f0-9]{32}$/i
function payload(){
 return {expected_user_id:props.userId,card_name:selected.value,
  date:draft.date,time:draft.time||'',amount_jpy:Number(draft.amount),
  merchant:String(draft.merchant||'').trim(),
  category:String(draft.category||'').trim(),
  note:String(draft.note||'').trim()}
}
function valid(x){
 return !!selectedCard.value&&x.expected_user_id===props.userId&&
 Number.isSafeInteger(x.amount_jpy)&&x.amount_jpy>=1&&x.amount_jpy<=10000000&&
 /^\d{4}-\d\d-\d\d$/.test(x.date)&&x.merchant.length>0&&x.merchant.length<=120&&
 x.category.length>0&&x.category.length<=100&&x.note.length<=500
}
async function save(){
 if(busy.value)return
 const record=payload()
 if(!valid(record)){error.value='请确认共享卡、金额、日期、店铺和分类';return}
 if(pending&&JSON.stringify(pending.record)!==JSON.stringify(record)){
  error.value='上次请求的结果还未确认。请先恢复原内容重试，避免重复记账。'
  return
 }
 if(!pending)pending={record,idempotency_key:'delegated:'+crypto.randomUUID()}
 busy.value=true;error.value='';notice.value=''
 try{
  const res=await fetch('/api/family-finance/legacy-card-spends',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({...pending.record,idempotency_key:pending.idempotency_key})
  })
  const data=await res.json().catch(()=>({}))
  if(!res.ok||data.ok!==true||data.applied!==true||
   !Number.isSafeInteger(data.entry_id)||data.entry_id<1)
   throw Error(data.code||'保存回执未确认')
  pending=null;draft.amount='';draft.merchant='';draft.note='';draft.time=''
  notice.value='已记入家庭支出，支付卡片仍归'+ownerLabel.value+'所有'
  emit('posted')
 }catch(e){error.value='提交未完成确认：'+e.message+'。保持表单内容重试可避免重复记账。'}
 finally{busy.value=false}
}
watch(()=>props.userId,()=>{pending=null;selected.value='';error.value='';notice.value=''})
watch(available,cards=>{
 if(!cards.some(c=>c.card_name===selected.value)){
  selected.value=cards[0]?.card_name||''
 }
},{immediate:true})
</script>

<template>
 <section class="shared-card-expense" aria-label="家庭共有カードで記帳">
  <div class="shared-card-heading">
   <strong>共有カードで記帳</strong>
   <button type="button" :disabled="busy" :aria-expanded="open"
    @click="open=!open">{{open?'收起':'展开'}}</button>
  </div>
  <div v-if="open" class="shared-card-fields">
   <p class="shared-card-note">你可以使用对方授权的卡记录支出，不需要重复添加卡片或逐笔审批。</p>
   <label class="shared-card-label">支払方法・カード
    <MobileChoiceSheet v-model="selected" :disabled="busy"
     label="共有カード" :options="available.map(c=>({
       value:c.card_name,label:c.card_name+'（'+(c.owner_display_name||'家庭管理员')+'）'
      }))"/>
   </label>
   <p v-if="selectedCard" class="shared-card-note">卡片归属：{{ownerLabel}} · 仅开放消费记账</p>
   <form @submit.prevent="save">
    <TransactionForm :record="draft" :categories="categories"
     :income-categories="[]" :payment-sources="[]"
     :category-label="name=>name" :allowed-types="['expense']"
     :show-payment-source="false" :receipt-enabled="false" />
    <button type="submit" class="shared-card-save" :disabled="busy||!selectedCard">
     {{busy?'保存中…':'保存支出'}}
    </button>
   </form>
   <p v-if="error" role="alert" class="shared-card-error">{{error}}</p>
   <p v-if="notice" role="status" class="shared-card-note">{{notice}}</p>
   <button type="button" class="shared-card-refresh" :disabled="busy"
    @click="emit('refresh')">刷新共享卡列表</button>
  </div>
 </section>
</template>

<style scoped>
.shared-card-expense{display:grid;gap:10px;border:1px solid var(--line,#ddd);
 border-radius:15px;padding:12px;background:var(--card,#fff)}
.shared-card-heading{display:flex;justify-content:space-between;align-items:center;gap:10px}
.shared-card-expense strong{font-size:15px}
.shared-card-label{display:grid;gap:6px;font-size:13px;font-weight:700}
.shared-card-fields,.shared-card-fields form{display:grid;gap:12px;min-width:0}
.shared-card-expense button{min-height:44px;padding:9px 12px;border:1px solid var(--line,#ddd);
 border-radius:11px;background:var(--card,#fff);color:inherit;font:inherit}
.shared-card-expense .shared-card-save{background:var(--blue,#d05a81);color:white;border:0;font-weight:750}
.shared-card-expense button:disabled{opacity:.5}
.shared-card-note{color:var(--muted,#777);font-size:12px;margin:0;overflow-wrap:anywhere}
.shared-card-error{color:#a63842;font-size:12px;margin:0;overflow-wrap:anywhere}
.shared-card-expense .shared-card-refresh{background:transparent;font-size:12px}
</style>