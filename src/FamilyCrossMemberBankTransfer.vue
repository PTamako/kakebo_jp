<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'

// This is an identity-owned, separate bank workflow: never posts to /api/entries.
// Legacy asset transfers continue to use the regular Kakeibo entry form.
const props=defineProps({record:{type:Object,required:true}})
const identity=ref(null),accounts=ref([]),history=ref([])
const enabled=ref(false),loading=ref(false),busy=ref(''),error=ref(''),message=ref('')
const sourceId=ref(''),targetId=ref(''),debitReference=ref(''),posted=ref(false)
const recipientId=ref(''),creditDate=ref(''),creditReference=ref(''),credited=ref(false)
let generation=0,alive=true,stableKey=''
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const myBanks=computed(()=>accounts.value.filter(a=>a.account_kind==='bank'&&
 a.owner_user_id===identity.value?.user_id&&a.origin==='member_created'&&Number(a.is_archived)===0))
const recipientBanks=computed(()=>accounts.value.filter(a=>a.account_kind==='bank'&&
 a.owner_user_id!==identity.value?.user_id&&a.origin==='member_created'&&Number(a.is_archived)===0))
const source=computed(()=>myBanks.value.find(a=>a.account_id===sourceId.value))
const destination=computed(()=>recipientBanks.value.find(a=>a.account_id===targetId.value))
const valid=computed(()=>identity.value?.role==='member'&&source.value&&destination.value&&
 source.value.owner_user_id!==destination.value.owner_user_id&&
 Number.isSafeInteger(Number(props.record.amount))&&Number(props.record.amount)>=1&&
 Number(props.record.amount)<=10000000&&props.record.date&&props.record.date<=today()&&
 /^20\d{2}-\d{2}-\d{2}$/.test(props.record.date)&&debitReference.value.trim().length>=8&&
 debitReference.value.length<=160&&posted.value)
const currency=n=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(n||0))
async function api(path,options={}){
 const res=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const data=await res.json().catch(()=>({}))
 if(!res.ok||data?.ok!==true)throw Error(data?.code||data?.error||'家庭资产转移暂不可用')
 return data
}
const post=value=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})
async function refresh(){
 const current=++generation
 loading.value=true;error.value=''
 try{
  const auth=await api('/api/homeflow-sso/me')
  if(!alive||current!==generation)return
  const user=auth.identity
  if(!user||auth.ledger_access!==false||!['member','owner'].includes(user.role))throw Error('请先使用统一 HomeFlow 身份登录')
  if(identity.value?.user_id!==user.user_id){
   sourceId.value='';targetId.value='';debitReference.value='';posted.value=false
   recipientId.value='';creditReference.value='';credited.value=false;stableKey=''
  }
  identity.value=user
  const [a,h]=await Promise.all([
   api('/api/family-finance/accounts'),
   api('/api/family-finance/cross-member-bank-transfers')
  ])
  if(!alive||current!==generation||user.user_id!==identity.value?.user_id)return
  accounts.value=Array.isArray(a.items)?a.items.filter(x=>x.household_id===user.household_id):[]
  history.value=Array.isArray(h.items)?h.items.filter(x=>x.source_user_id===user.user_id||
   x.recipient_user_id===user.user_id):[]
  enabled.value=true
 }catch(e){
  if(alive&&current===generation){
   identity.value=null;accounts.value=[];history.value=[]
   enabled.value=false;error.value=e.message
  }
 }finally{if(alive&&current===generation)loading.value=false}
}
async function prepare(){
 if(!valid.value||busy.value)return
 const actor=identity.value.user_id,revision=generation
 const payload={expected_user_id:actor,recipient_user_id:destination.value.owner_user_id,
  idempotency_key:stableKey||(stableKey='cross-bank:'+crypto.randomUUID()),
  source_account_id:source.value.account_id,source_version:source.value.version,
  target_account_id:destination.value.account_id,target_version:destination.value.version,
  debit_date:props.record.date,amount_jpy:Number(props.record.amount),
  source_bank_reference:debitReference.value.trim(),bank_debit_posted:true}
 busy.value='prepare';error.value='';message.value=''
 try{
  const result=await api('/api/family-finance/cross-member-bank-transfers',post(payload))
  if(!alive||revision!==generation||identity.value?.user_id!==actor)return
  const intent=result.prepared
  if(!intent?.request_id||intent.source_user_id!==actor||intent.applied!==false)
   throw Error('申请结果需要核对')
  message.value='已保存原始转账申请，尚未记账。正在登记双人确认…'
  await refresh()
  // Initial consent registration is idempotent even across a lost response.
  await requestConsent(intent.request_id)
 }catch(e){
  if(alive&&identity.value?.user_id===actor){
   error.value=e.message+'。请先刷新申请记录，不要重新发起同一转账。'
   await refresh().catch(()=>{})
  }
 }finally{busy.value=''}
}
async function requestConsent(requestId){
 if(!identity.value||identity.value.role!=='member')return
 const actor=identity.value.user_id,revision=generation
 busy.value='consent';error.value=''
 try{
  const result=await api('/api/family-finance/cross-member-bank-transfers/'+
   requestId+'/request-consent',post({expected_user_id:actor}))
  if(!alive||identity.value?.user_id!==actor)return
  message.value='双人确认状态：'+({
   awaiting_recipient:'等待收款人在 HomeFlow 确认',
   recipient_accepted:'已确认收款，等待管理员授权',
   owner_authorized:'家庭成员与管理员已同意，尚未入账',
   recipient_rejected:'收款人已拒绝',revoked:'授权已撤销',
   cancelled:'申请已撤回'
  }[result.consent_status]||result.consent_status)
  if(result.consent_status==='owner_authorized'&&result.recipient_confirmed===true){
   const submitted=await api('/api/family-finance/cross-member-bank-transfers/'+
    requestId+'/submit',post({expected_user_id:actor,consent_id:result.consent_id}))
   if(submitted.applied!==false)throw Error('账本状态异常，请核对原申请')
   message.value='已提交 HomeFlow 家庭审批。等待管理员在家庭审批中批准并执行入账。'
  }
  await refresh()
  // Do not allow a stale session to render a previous actor's success.
  if(revision>generation&&identity.value?.user_id!==actor)message.value=''
 }catch(e){if(identity.value?.user_id===actor)error.value=e.message}
 finally{busy.value=''}
}
function selectRecipient(row){
 recipientId.value=row.request_id
 creditDate.value=today()
 creditReference.value='';credited.value=false
 error.value='';message.value=''
}
async function confirmCredit(){
 const actor=identity.value?.user_id
 const row=history.value.find(x=>x.request_id===recipientId.value&&x.recipient_user_id===actor)
 if(!row||identity.value?.role!=='owner'||row.recipient_confirmed||
  !creditDate.value||creditDate.value>today()||creditDate.value<row.debit_date||
  !credited.value||creditReference.value.trim().length<8||busy.value)return
 busy.value='credit';error.value='';message.value=''
 try{
  const data=await api('/api/family-finance/cross-member-bank-transfers/'+row.request_id+
   '/recipient',post({expected_user_id:actor,credit_date:creditDate.value,
    amount_jpy:row.amount_jpy,target_bank_reference:creditReference.value.trim(),
    bank_credit_posted:true}))
  if(identity.value?.user_id!==actor)return
  if(data.recipient_confirmed!==true||data.applied!==false)throw Error('到账确认结果未知')
  recipientId.value='';creditReference.value='';credited.value=false
  message.value='到账证据已独立登记。请前往 HomeFlow 的「管理 → 家庭 → 跨成员转账」完成本人确认与管理员授权。'
  await refresh()
 }catch(e){if(identity.value?.user_id===actor)error.value=e.message}
 finally{busy.value=''}
}
function foreground(){if(document.visibilityState==='visible')void refresh()}
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{alive=false;generation++;document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <section class="cross-bank-entry" aria-label="家庭成员银行账户间转账">
  <p class="family-note">直接选择转出和转入账户。当前仅支持家庭成员 → 管理员的银行已扣款／已到账记录；不会从银行发起汇款，也不会直接记账。</p>
  <p v-if="loading" class="family-note">正在核对统一账号及银行账户…</p>
  <p v-if="error" class="family-error" role="alert">{{error}}</p>
  <p v-if="message" class="family-status" role="status">{{message}}</p>
  <button type="button" class="family-outline" :disabled="!!busy||loading" @click="refresh">刷新账户与申请</button>
  <template v-if="enabled&&identity?.role==='member'">
   <label>转出账户（本人银行）
    <select v-model="sourceId" :disabled="!!busy">
     <option value="">请选择转出银行</option>
     <option v-for="a in myBanks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
    </select>
   </label>
   <label>转入账户（家庭管理员银行）
    <select v-model="targetId" :disabled="!!busy">
     <option value="">请选择转入银行</option>
     <option v-for="a in recipientBanks" :key="a.account_id" :value="a.account_id">{{a.label}}</option>
    </select>
   </label>
   <p v-if="!myBanks.length||!recipientBanks.length" class="family-note">
    请先由各成员在「管理 → 家庭账户」维护本人银行账户。这里不显示任何卡号或余额。
   </p>
   <label>真实银行扣款流水参考号
    <input v-model="debitReference" :disabled="!!busy" maxlength="160"
     placeholder="来自实际已扣款的银行流水（至少 8 位）"/>
   </label>
   <label class="family-check"><input v-model="posted" type="checkbox" :disabled="!!busy"/>
    <span>已核实银行实际扣款（不是预约或未来转账）</span>
   </label>
   <button type="button" class="family-primary" :disabled="!valid||!!busy||loading"
    @click="prepare">{{busy?'处理中…':'保存并发起双人确认'}}</button>
  </template>
  <template v-if="enabled&&history.length">
   <h3>{{identity?.role==='owner'?'待确认的家庭银行转账':'我的跨成员转账申请'}}</h3>
   <div v-for="item in history" :key="item.request_id" class="family-item">
    <strong>{{currency(item.amount_jpy)}} · {{item.debit_date}}</strong>
    <small>{{item.request_id.slice(0,8)}} · {{item.status==='submitted_status_unknown'?'已提交家庭审批，尚未确认入账':item.status==='applied'?'已经入账':item.status==='prepared'?'等待双方确认':'已撤回'}}</small>
    <small>{{item.recipient_confirmed?'收款人已登记到账凭证':'收款人尚未登记到账凭证'}}</small>
    <button v-if="identity?.role==='member'&&item.status==='prepared'" type="button"
     class="family-outline" :disabled="!!busy||loading" @click="requestConsent(item.request_id)">
      核对双人确认 · 符合条件时提交家庭审批
    </button>
    <button v-if="identity?.role==='owner'&&item.status==='prepared'&&!item.recipient_confirmed"
     type="button" class="family-outline" :disabled="!!busy||loading"
     @click="selectRecipient(item)">独立核对真实到账</button>
    <div v-if="identity?.role==='owner'&&recipientId===item.request_id" class="credit-form">
     <label>实际银行到账日<input v-model="creditDate" type="date" :disabled="!!busy"/></label>
     <label>到账银行流水参考号<input v-model="creditReference" maxlength="160"
      placeholder="来自实际已到账的银行流水（至少 8 位）" :disabled="!!busy"/></label>
     <label class="family-check"><input v-model="credited" type="checkbox" :disabled="!!busy"/>
      <span>本人确认银行实际到账且金额相同</span></label>
     <button type="button" class="family-primary" :disabled="!credited||!creditDate||
      creditDate>today()||creditDate<item.debit_date||creditReference.trim().length<8||!!busy"
      @click="confirmCredit">登记本人到账证据</button>
    </div>
   </div>
  </template>
  <p v-if="enabled&&identity?.role==='owner'&&!history.length" class="family-note">
   暂无需要您确认的跨成员银行转账申请。
  </p>
  <a class="family-link" href="https://homeflow.yupan6706.workers.dev/" target="_blank"
   rel="noopener noreferrer">前往 HomeFlow 处理家庭双人确认与审批</a>
 </section>
</template>
<style scoped>
.cross-bank-entry,.credit-form{display:grid;gap:11px;min-width:0}
.cross-bank-entry{padding:12px;border:1px solid var(--line,#e3e8e4);border-radius:13px;background:var(--card,#fff)}
.cross-bank-entry label{display:grid;gap:5px;min-width:0;font-size:13px}
.cross-bank-entry select,.cross-bank-entry input:not([type=checkbox]){
 display:block;width:100%;box-sizing:border-box;min-width:0;max-width:100%;min-height:44px;
 padding:9px 10px;border:1px solid var(--line,#d6ddd8);border-radius:10px;
 background:var(--card,#fff);font-size:16px}
.cross-bank-entry button{min-height:44px;padding:9px 12px;border-radius:10px;font-size:13px;font-weight:700}
.family-outline{border:1px solid var(--line,#b5c9bf);background:transparent;color:#3c7659}
.family-primary{border:0;background:#367b5e;color:white}
.family-primary:disabled{opacity:.55}
.family-note,.family-item small{margin:0;font-size:12px;line-height:1.55;color:var(--muted,#666)}
.family-error{margin:0;color:#b44141;font-size:12px;overflow-wrap:anywhere}
.family-status{margin:0;color:#22784f;font-size:12px;overflow-wrap:anywhere}
.family-check{display:flex!important;gap:8px!important;align-items:flex-start}
.family-check input{margin-top:3px;flex:none}
.family-link{font-size:13px;color:#34785d;overflow-wrap:anywhere}
.family-item{display:grid;gap:7px;padding:11px;border:1px solid var(--line,#d7e3db);border-radius:11px}
.family-item strong{font-size:14px}
.cross-bank-entry h3{font-size:14px;margin:6px 0 0}
</style>
