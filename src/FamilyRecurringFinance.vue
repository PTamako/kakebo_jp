<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
const props=defineProps({userId:{type:String,required:true},
 householdId:{type:String,required:true},accounts:{type:Array,required:true},view:{type:String,default:'plans'}})
const emit=defineEmits(['changed'])
const open=ref(props.view!=='investment'),editorOpen=ref(false),busy=ref(false),available=ref(false),executionAvailable=ref(false),error=ref(''),notice=ref('')
const plans=ref([]),occurrences=ref([]),policies=ref({})
const day=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const month=()=>day().slice(0,7)
const activeType=computed(()=>props.view==='investment'?'sbi_tsumitate':'fixed_cost')
const visiblePlans=computed(()=>plans.value.filter(p=>p.plan_type===activeType.value))
const planPage=ref(0)
const planPages=computed(()=>Math.max(1,Math.ceil(visiblePlans.value.length/5)))
const visiblePlanPage=computed(()=>visiblePlans.value.slice(planPage.value*5,planPage.value*5+5))
const visibleOccurrences=computed(()=>occurrences.value.filter(p=>p.plan_type===activeType.value))
const form=ref({plan_type:props.view==='investment'?'sbi_tsumitate':'fixed_cost',source_bank_account_id:'',
 securities_account_id:'',amount_jpy:'',due_day:Math.min(28,Number(day().slice(8))),
 start_month:month(),end_month:month(),category:'固定費',merchant:'',
 fund_code:'',fund_name:''})
const selected=ref(''),debit=ref(day()),period=ref(month()),bankRef=ref(''),
 units=ref(''),brokerRef=ref(''),trade=ref(day()),effective=ref(day()),
 bankPosted=ref(false),brokerExecuted=ref(false)
let generation=0,alive=true,planRetry=''
const banks=computed(()=>props.accounts.filter(a=>
 a.owner_user_id===props.userId&&a.origin==='member_created'&&
 a.account_kind==='bank'&&Number(a.is_archived)===0))
const securities=computed(()=>props.accounts.filter(a=>
 a.owner_user_id===props.userId&&a.origin==='member_created'&&
 a.account_kind==='securities'&&Number(a.is_archived)===0))
const chosen=computed(()=>plans.value.find(p=>p.plan_resource_id===selected.value))
const currency=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0))
const currentPolicy=p=>policies.value[p.plan_resource_id]
const canPlan=computed(()=>banks.value.some(a=>a.account_id===form.value.source_bank_account_id)&&
  (form.value.plan_type==='fixed_cost'||securities.value.some(a=>a.account_id===form.value.securities_account_id))&&
  form.value.amount_jpy&&Number.isSafeInteger(Number(form.value.amount_jpy))&&
  Number(form.value.amount_jpy)>=1&&Number(form.value.amount_jpy)<=10000000&&
  form.value.due_day>=1&&form.value.due_day<=28&&form.value.merchant.trim()&&
  form.value.category.trim()&&form.value.start_month<=form.value.end_month&&
  (form.value.plan_type==='fixed_cost'||(/^[A-Z0-9]{8}$/.test(form.value.fund_code)&&form.value.fund_name.trim())))
const online=()=>typeof navigator!=='undefined'&&navigator.onLine!==false
const post=data=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})
async function api(path,options={}){
 if(!online())throw Error('オフライン中は金融操作を送信できません。通信回復後にお試しください')
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok||data.ok!==true)throw Error(data.code||'元の申請番号で操作結果を確認してください')
 return data
}
function reset(){
 generation++;open.value=props.view!=='investment';editorOpen.value=false;busy.value=false;available.value=false;executionAvailable.value=false;
 error.value='';notice.value='';plans.value=[];occurrences.value=[];policies.value={};
 selected.value='';bankRef.value='';brokerRef.value='';units.value='';planRetry='';
 bankPosted.value=false;brokerExecuted.value=false
 form.value={plan_type:props.view==='investment'?'sbi_tsumitate':'fixed_cost',source_bank_account_id:'',securities_account_id:'',
  amount_jpy:'',due_day:Math.min(28,Number(day().slice(8))),start_month:month(),
  end_month:month(),category:'固定費',merchant:'',fund_code:'',fund_name:''}
}
async function refresh(){
 const ticket=++generation,who=props.userId,hh=props.householdId
 if(!open.value)return
 try{
  const result=await api('/api/family-finance/member-recurring-plans')
  if(!alive||ticket!==generation||who!==props.userId||hh!==props.householdId)return
  plans.value=Array.isArray(result.items)?result.items:[]
  available.value=true;error.value=''
  planPage.value=Math.min(planPage.value,Math.max(0,Math.ceil(visiblePlans.value.length/5)-1))
 }catch(e){
  if(!alive||ticket!==generation||who!==props.userId||hh!==props.householdId)return
  plans.value=[];available.value=false;error.value=String(e.message||'積立計画を取得できません')
 }
}
async function toggle(){
 if(busy.value)return
 open.value=!open.value
 if(open.value)await refresh()
 else{generation++;plans.value=[];occurrences.value=[];policies.value={};selected.value=''}
}
function accountVersion(id){
 return props.accounts.find(a=>a.account_id===id&&a.owner_user_id===props.userId)?.version
}
async function createPlan(){
 if(!canPlan.value||busy.value||!available.value)return
 if(!window.confirm('本人の積立計画を登録しますか？登録だけでは購入・口座振替・家庭明細の追加は行われません。'))return
 const ticket=generation,actor=props.userId,hh=props.householdId
 const x=form.value
 const payload={expected_user_id:actor,
  idempotency_key:planRetry||'member-recurring:'+crypto.randomUUID(),
  plan_type:x.plan_type,source_bank_account_id:x.source_bank_account_id,
  source_account_version:accountVersion(x.source_bank_account_id),
  securities_account_id:x.plan_type==='fixed_cost'?null:x.securities_account_id,
  securities_version:x.plan_type==='fixed_cost'?null:accountVersion(x.securities_account_id),
  amount_jpy:Number(x.amount_jpy),due_day:Number(x.due_day),
  start_month:x.start_month,end_month:x.end_month,category:x.category.trim(),
  merchant:x.merchant.trim(),fund_code:x.plan_type==='fixed_cost'?null:x.fund_code.trim(),
  fund_name:x.plan_type==='fixed_cost'?null:x.fund_name.trim(),
  account_type:x.plan_type==='fixed_cost'?null:'tsumitate'}
 planRetry=payload.idempotency_key;busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/member-recurring-plans',post(payload))
  if(ticket!==generation||actor!==props.userId||hh!==props.householdId)return
  if(result.plan?.ledger_applied!==false||result.plan?.policy_approved!==false)
   throw Error('計画の登録結果を確認できません')
  planRetry='';editorOpen.value=false;notice.value='本人の積立計画を保存しました。計画には管理者承認は不要です。実際の取引は残高・明細から別途記録してください。'
  selected.value=result.plan.plan_resource_id
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function submitPolicy(p){
 if(busy.value||!available.value||p.state!=='active')return
 const ticket=generation,actor=props.userId
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/member-recurring-plans/'+
   p.plan_resource_id+'/submit-policy',post({
    expected_user_id:actor,confirm_plan_resource_id:p.plan_resource_id}))
  if(ticket!==generation||actor!==props.userId)return
  if(result.ledger_applied!==false||result.policy?.plan_resource_id!==p.plan_resource_id)
   throw Error('HomeFlow の確認結果を取得できません')
  policies.value={...policies.value,[p.plan_resource_id]:result.policy}
  notice.value=result.owner_approved?
   '以前の承認記録です。銀行の実際の取引とは別です。':
   '過去の申請です。家計簿の明細にはまだ反映されていません。'
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function prepareOccurrence(){
 const p=chosen.value,policy=p&&currentPolicy(p)
 if(!executionAvailable.value||busy.value||!available.value||!p||policy?.status!=='approved'||
  !bankPosted.value||!bankRef.value.trim()||bankRef.value.trim().length<8||
  p.plan_type==='sbi_tsumitate'&&(!brokerExecuted.value||brokerRef.value.trim().length<8||
   !Number.isSafeInteger(Number(units.value))||Number(units.value)<=0))return
 if(!window.confirm('銀行の引落しと実際の約定を確認しましたか？証拠のみ記録し、取引は実行しません。'))return
 const ticket=generation,actor=props.userId
 const isSbi=p.plan_type==='sbi_tsumitate'
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/recurring-occurrences',post({
   expected_user_id:actor,policy_id:policy.policy_id,
   plan_resource_id:p.plan_resource_id,period_key:period.value,debit_date:debit.value,
   bank_reference:bankRef.value.trim(),bank_debit_posted:true,
   confirmed_units:isSbi?Number(units.value):null,
   broker_trade_reference:isSbi?brokerRef.value.trim():null,
   trade_date:isSbi?trade.value:null,effective_date:isSbi?effective.value:null,
   broker_order_executed:isSbi}))
  if(ticket!==generation||actor!==props.userId)return
  if(result.prepared?.ledger_applied!==false)throw Error('周期证据准备回执异常')
  bankRef.value='';brokerRef.value='';units.value=''
  bankPosted.value=false;brokerExecuted.value=false
  notice.value='今月の証拠を保存しました。家庭明細は変更されていません。'
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
async function perform(o,action='execute'){
 if(!executionAvailable.value||busy.value||!available.value||!window.confirm(
  action==='execute'?'実際の取引に基づき内部明細へ記録しますか？銀行・証券会社には送信しません。':
  '元の記録で HomeFlow と家計簿の結果を確認します。'))return
 const ticket=generation,actor=props.userId,hh=props.householdId
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/recurring-occurrences/'+o.occurrence_id+'/'+action,
   post(action==='execute'?{expected_user_id:actor,confirm_occurrence_id:o.occurrence_id}:
    {expected_user_id:actor}))
  if(ticket!==generation||actor!==props.userId||hh!==props.householdId)return
  if(result.ledger_applied!==true||result.applied!==true)
   throw Error('账目仍未取得真实不可变入账回执')
  if(result.homeflow_receipt_confirmed!==true){
   notice.value='家計簿への記録は完了しましたが、HomeFlow 側の確認が必要です。二重登録しないでください。'
  }else{
   notice.value='家計簿と HomeFlow の記録を照合しました。金融機関による直接照合ではありません。'
   emit('changed')
  }
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
function openPlanEditor(source=null){
 if(busy.value)return
 open.value=true;editorOpen.value=true;error.value='';notice.value=''
 const bank=banks.value.find(a=>a.account_id===source?.source_account_id)||banks.value[0]
 const account=securities.value.find(a=>a.account_id===source?.securities_account_id)||securities.value[0]
 form.value={plan_type:'sbi_tsumitate',
  source_bank_account_id:bank?.account_id||'',
  securities_account_id:account?.account_id||'',
  amount_jpy:source?.monthly_amount||'',due_day:source?.order_day||9,
  start_month:month(),end_month:month(),category:'積立',
  merchant:source?.fund_name||'',fund_code:source?.fund_code||'',
  fund_name:source?.fund_name||''}
 if(source){
  notice.value='以前の計画を直接上書きせず、本人が新しい条件で保存します。管理者の承認は不要です。'
 }
 if(!available.value)void refresh()
 if(typeof document!=='undefined')queueMicrotask(()=>
   document.querySelector('.recurring-panel[aria-label="毎月の積立"]')?.scrollIntoView({behavior:'smooth',block:'start'}))
}
async function revokePlan(p){
 if(busy.value||p.state!=='active'||!window.confirm('この積立計画を停止しますか？過去の記録は削除されません。'))return
 const ticket=generation,actor=props.userId
 busy.value=true;error.value='';notice.value=''
 try{
  const result=await api('/api/family-finance/member-recurring-plans/'+
   encodeURIComponent(p.plan_resource_id)+'/revoke',post({
    expected_user_id:actor,confirm_resource_id:p.plan_resource_id
   }))
  if(ticket!==generation||actor!==props.userId)return
  if(result.revoked!==true)throw Error('停止結果が確認できません')
  notice.value='積立計画を停止しました。既存の明細や保有残高は変わりません。'
  await refresh()
 }catch(e){if(ticket===generation)error.value=e.message}
 finally{if(ticket===generation)busy.value=false}
}
defineExpose({openPlanEditor})
function foreground(){
 if(document.visibilityState!=='visible')return
 generation++;policies.value={};bankRef.value='';brokerRef.value='';
 units.value='';bankPosted.value=false;brokerExecuted.value=false
 if(open.value)void refresh()
}
watch(()=>[props.userId,props.householdId,props.view],()=>{reset();void refresh()})
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;reset();document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
<section class="recurring-panel finance-panel" :aria-label="view==='investment'?'本人の積立計画':'本人の定期計画'">
 <header>
  <strong>{{view==='investment'?'積立計画の管理':'定期計画の管理'}}</strong>
  <button type="button" :aria-expanded="open" :disabled="busy" @click="toggle">{{open?'閉じる':'開く'}}</button>
 </header>
 <template v-if="open">
  <p class="help">本人の積立計画の登録・停止に管理者の承認は不要です。家庭の明細を変更する場合にだけ、HomeFlowで明細の承認を受けます。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-if="notice" role="status" class="help">{{notice}}</p>
  <button v-if="available&&!editorOpen" type="button" @click="openPlanEditor()">＋ 積立計画を追加</button>
  <form v-if="available&&editorOpen" class="editor" @submit.prevent="createPlan">
   <strong>本人の積立計画を登録</strong>
   <label>本人の引落銀行口座
    <select v-model="form.source_bank_account_id" :disabled="busy" required>
     <option value="">口座を選択</option>
     <option v-for="a in banks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
    </select>
   </label>
   <label>本人の証券口座
    <select v-model="form.securities_account_id" :disabled="busy" required>
     <option value="">口座を選択</option>
     <option v-for="a in securities" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
    </select>
   </label>
   <div class="pair">
    <label>毎月の金額（円）<input v-model="form.amount_jpy" type="number" min="1" max="10000000" required :disabled="busy"/></label>
    <label>引落日（1～28日）<input v-model.number="form.due_day" type="number" min="1" max="28" required :disabled="busy"/></label>
   </div>
   <div class="pair">
    <label>開始月<input v-model="form.start_month" type="month" required :disabled="busy"/></label>
    <label>終了月<input v-model="form.end_month" type="month" required :disabled="busy"/></label>
   </div>
   <label>銘柄コード（8文字）<input v-model="form.fund_code" maxlength="8" required :disabled="busy"/></label>
   <label>銘柄名<input v-model="form.fund_name" maxlength="120" required :disabled="busy"/></label>
   <button type="submit" :disabled="busy||!canPlan">積立計画を保存</button>
   <button type="button" :disabled="busy" @click="editorOpen=false">キャンセル</button>
  </form>
  <div v-if="available" class="items">
   <strong>登録済みの積立計画 · {{visiblePlans.length}}件</strong>
   <p v-if="!visiblePlans.length" class="help">積立計画はまだありません。</p>
   <div v-for="p in visiblePlanPage" :key="p.plan_resource_id" class="item">
    <div class="head"><strong>{{p.fund_name||p.merchant}} · {{currency(p.amount_jpy)}}</strong><span>{{p.state==='active'?'有効':'停止済み'}}</span></div>
    <p class="help">{{p.start_month}}～{{p.end_month}} · 毎月{{p.due_day}}日</p>
    <p class="help">計画の保存のみ。銀行の引落し・証券注文は実行していません。</p>
    <button v-if="p.state==='active'" type="button" :disabled="busy" @click="revokePlan(p)">計画を停止</button>
   </div>
   <div v-if="planPages>1" class="head">
    <button type="button" :disabled="planPage===0" @click="planPage--">前へ</button>
    <span>{{planPage+1}} / {{planPages}}</span>
    <button type="button" :disabled="planPage+1>=planPages" @click="planPage++">次へ</button>
   </div>
  </div>
 </template>
</section>
</template>
<style scoped>
.recurring-panel{display:grid;gap:10px;max-width:100%;min-width:0;border:1px solid var(--line,#ddd);border-radius:12px;padding:12px}
.recurring-panel header,.head{display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap}
.recurring-panel strong{font-size:14px}
.recurring-panel button{min-height:40px;padding:7px 12px;border-radius:10px;border:1px solid var(--line,#ddd);background:var(--card,#fff)}
.recurring-panel button:disabled{opacity:.55}.help{font-size:12px;color:var(--muted,#6c7774);margin:0;overflow-wrap:anywhere}
.error{color:#a83737;font-size:12px;margin:0;overflow-wrap:anywhere}
.editor,.items{display:grid;gap:9px;min-width:0}
.editor{border:1px solid var(--line,#eee);padding:10px;border-radius:12px}
.editor label{display:grid;gap:4px;font-size:12px;min-width:0}
.editor input,.editor select,.editor textarea{min-width:0;max-width:100%;width:100%;box-sizing:border-box;padding:9px;border:1px solid var(--line,#ddd);border-radius:9px;background:var(--card,#fff);color:inherit}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.checkbox{display:flex!important;align-items:center;gap:7px}.checkbox input{width:auto}
.item{display:grid;gap:8px;border:1px solid var(--line,#ddd);border-radius:11px;padding:10px;min-width:0}
.item span{font-size:12px}
@media(max-width:380px){.pair{grid-template-columns:minmax(0,1fr)}}
</style>
