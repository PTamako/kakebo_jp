<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'
import FamilyFinanceProposals from './FamilyFinanceProposals.vue'
import FamilyFinanceCardPurchases from './FamilyFinanceCardPurchases.vue'
import FamilyFinanceCardSettlements from './FamilyFinanceCardSettlements.vue'
import FamilyFinancePrepaidActions from './FamilyFinancePrepaidActions.vue'
import FamilyFinanceBankTransfers from './FamilyFinanceBankTransfers.vue'
import FamilySharedEntries from './FamilySharedEntries.vue'
import FamilySharedMutationRequests from './FamilySharedMutationRequests.vue'
import FamilyRecurringFinance from './FamilyRecurringFinance.vue'
import {validateKakeiboHomeflowAuthorizationUrl} from './homeflow-authorization-url.js'
import FamilyFinanceMappingAudit from './FamilyFinanceMappingAudit.vue'
import FamilyFinanceLegacyLink from './FamilyFinanceLegacyLink.vue'
import FamilyFinanceLegacySharedAdoption from './FamilyFinanceLegacySharedAdoption.vue'
import FamilyFinanceLegacyTransferLink from './FamilyFinanceLegacyTransferLink.vue'
import FamilyFinanceAssetOwnership from './FamilyFinanceAssetOwnership.vue'
import FamilyFinancePlanOwnership from './FamilyFinancePlanOwnership.vue'
import FamilyFinanceOwnerAdoption from './FamilyFinanceOwnerAdoption.vue'

const props=defineProps({identityOnly:{type:Boolean,default:false}})
const emit=defineEmits(['identity-change'])
const STORAGE='kakeibo:homeflow-resume-v1'
const hex=/^[a-f0-9]{64}$/i
const enabled=ref(false),financeEnabled=ref(false),busy=ref(false),error=ref('')
const person=ref(null),pending=ref(null),accounts=ref([]),advancedOpen=ref(false)
const newLabel=ref(''),newKind=ref('credit_card'),editing=ref(null),rename=ref('')
const kinds=[
 {value:'credit_card',label:'信用卡'},{value:'prepaid',label:'储值卡'},
 {value:'cash',label:'现金'},{value:'bank',label:'银行'},
 {value:'points',label:'积分'},{value:'securities',label:'证券'},
 {value:'other',label:'其他'}
]
let epoch=0
const canManage=a=>!!person.value&&a.owner_user_id===person.value.user_id
const role=computed(()=>person.value?.role==='owner'?'管理员':'家庭成员')
function clearPending(){
 try{localStorage.removeItem(STORAGE)}catch{}
 pending.value=null
}
function restorePending(){
 try{
  const data=JSON.parse(localStorage.getItem(STORAGE)||'null')
  if(data&&hex.test(data.state)&&hex.test(data.resume_secret)&&
   Number.isFinite(data.expires_at)&&data.expires_at>Date.now())pending.value=data
  else clearPending()
 }catch{clearPending()}
}
function resetIdentity(){
 epoch++;person.value=null;accounts.value=[];advancedOpen.value=false
 emit('identity-change',null)
 editing.value=null;rename.value='';newLabel.value='';newKind.value='credit_card'
}
async function call(path,options={}){
 const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(String(data.code||'操作失败'))
 return data
}
async function refresh(){
 const revision=epoch
 if(!person.value||!financeEnabled.value)return
 try{
  const list=await call('/api/family-finance/accounts')
  if(revision!==epoch)return
  accounts.value=Array.isArray(list.items)?list.items:[]
 }catch(e){
  if(revision===epoch){error.value=e.message;accounts.value=[]}
 }
}
async function check(){
 const revision=++epoch
 error.value='';restorePending()
 try{
  const status=await call('/api/homeflow-sso/status')
  if(revision!==epoch)return
  enabled.value=status.enabled===true
  if(!enabled.value){resetIdentity();clearPending();return}
  const feature=await call('/api/family-finance/status')
  if(revision!==epoch)return
  financeEnabled.value=feature.enabled===true
  const response=await fetch('/api/homeflow-sso/me',{cache:'no-store',credentials:'same-origin'})
  if(revision!==epoch)return
  if(response.ok){
   const user=await response.json()
   if(revision!==epoch)return
   if(user.ok===true&&user.ledger_access===false&&user.identity?.user_id){
    person.value=user.identity;clearPending()
    emit('identity-change',user.identity)
    if(financeEnabled.value&&!props.identityOnly)await refresh()
   }else resetIdentity()
  }else resetIdentity()
 }catch{
  if(revision===epoch){enabled.value=false;financeEnabled.value=false;resetIdentity()}
 }
}
async function start(){
 if(busy.value||!enabled.value)return
 busy.value=true;error.value=''
 try{
  const result=await call('/api/homeflow-sso/start',{method:'POST'})
  if(!hex.test(result.state)||!hex.test(result.resume_secret)||
   typeof result.authorization_url!=='string')throw Error('授权数据无效')
  const destination=validateKakeiboHomeflowAuthorizationUrl(result.authorization_url,result.state,window.location.origin)
  const proof={state:result.state,resume_secret:result.resume_secret,
   expires_at:Date.now()+Math.min(300,Math.max(1,Number(result.expires_in)||300))*1000}
  localStorage.setItem(STORAGE,JSON.stringify(proof))
  pending.value=proof
  window.location.assign(destination.toString())
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function complete(){
 if(busy.value||!pending.value)return
 if(pending.value.expires_at<=Date.now()){
  clearPending();error.value='授权已过期，请重新登录';return
 }
 busy.value=true;error.value=''
 try{
  const data=await call('/api/homeflow-sso/complete',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({state:pending.value.state,resume_secret:pending.value.resume_secret})
  })
  if(data.ok!==true||data.ledger_access!==false)throw Error('身份授权未完成')
  clearPending()
  await check()
  if(!person.value)throw Error('请重新打开应用检查登录状态')
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function logout(){
 if(busy.value)return
 // Hide the former account immediately and invalidate any pending finance
 // responses. A failed logout still reports failure; it is not success.
 resetIdentity()
 busy.value=true;error.value=''
 try{
  await call('/api/homeflow-sso/logout',{method:'POST'})
  clearPending()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function createAccount(){
 if(busy.value||!person.value||!financeEnabled.value)return
 const revision=epoch,actor=person.value.user_id
 const label=newLabel.value.trim()
 if(!label||label.length>80){error.value='账户名称需为 1～80 个字符';return}
 busy.value=true;error.value=''
 try{
  const data=await call('/api/family-finance/accounts',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({label,account_kind:newKind.value,expected_user_id:actor})
  })
  if(revision!==epoch||person.value?.user_id!==actor)return
  if(data.ledger_changed!==false)throw Error('账户状态需要复核')
  newLabel.value=''
  await refresh()
 }catch(e){if(revision===epoch)error.value=e.message}
 finally{busy.value=false}
}
async function mutate(a,change){
 if(busy.value||!canManage(a)||a.origin==='legacy'||!financeEnabled.value)return
 const revision=epoch,actor=person.value.user_id
 if(change.is_archived===true&&!window.confirm('确认归档此账户？不会删除家庭账务记录。'))return
 busy.value=true;error.value=''
 try{
  const data=await call('/api/family-finance/accounts/'+encodeURIComponent(a.account_id),{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({version:a.version,...change,expected_user_id:actor})
  })
  if(revision!==epoch||person.value?.user_id!==actor)return
  if(data.ledger_changed!==false)throw Error('账户修改结果需要复核')
  editing.value=null;rename.value=''
  await refresh()
 }catch(e){if(revision===epoch)error.value=e.message}
 finally{busy.value=false}
}
function openRename(a){
 if(!canManage(a)||a.origin==='legacy')return
 editing.value=a.account_id;rename.value=a.label
}
function foreground(){
 if(document.visibilityState!=='visible')return
 // Account switching may happen while a prior fetch/mutation is still busy.
 // Always hide the prior person's private assets before introspection.
 resetIdentity()
 void check()
}
onMounted(()=>{void check();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{resetIdentity();document.removeEventListener('visibilitychange',foreground)})
</script>

<template>
 <section v-if="enabled" class="hf-finance" aria-label="HomeFlow 家庭账户">
  <div class="hf-head"><strong>HomeFlow 家庭账户</strong>
   <span v-if="person" class="hf-state">已关联</span>
  </div>
  <p v-if="person" class="hf-note">{{person.display_name}} · {{role}}</p>
  <p v-else class="hf-note">使用已有 HomeFlow 账号授权，不需要共享家計簿访问码。</p>
  <p v-if="!person&&pending" class="hf-note">在 Safari 完成授权后，回到本 App 点击「完成登录」。</p>
  <p v-if="error" class="hf-error" role="alert">{{error}}</p>
  <div class="hf-actions">
   <button v-if="person" type="button" :disabled="busy" @click="logout">退出家庭身份</button>
   <template v-else>
    <button v-if="pending" type="button" :disabled="busy" @click="complete">完成登录</button>
    <button type="button" :disabled="busy" @click="start">{{pending?'重新授权':'使用 HomeFlow 登录'}}</button>
   </template>
  </div>
  <template v-if="person&&!props.identityOnly">
   <p v-if="!financeEnabled" class="hf-note">家庭金融账户功能尚未开放，旧账本不会因身份关联而自动开放。</p>
   <template v-else>
    <div class="hf-subhead"><strong>家庭账户</strong>
     <button type="button" :disabled="busy" @click="refresh">刷新</button>
    </div>
    <p v-if="!accounts.length" class="hf-note">尚无统一金融账户。原有支付方式和历史账目仍保留在记账本中，未被删除。</p>
    <ul v-else class="hf-list">
     <li v-for="a in accounts" :key="a.account_id">
      <div><strong>{{a.label}}</strong>
       <small>{{kinds.find(k=>k.value===a.account_kind)?.label||'账户'}} ·
        {{a.owner_user_id===person.user_id?'本人':'家庭成员'}} ·
        {{a.is_archived?'已归档':'使用中'}}
       </small>
      </div>
      <div v-if="canManage(a)&&!a.is_archived" class="hf-actions">
       <button v-if="a.origin==='legacy'" type="button" disabled title="旧账户待无损迁移">旧账户只读</button>
       <template v-else>
        <button type="button" :disabled="busy" @click="openRename(a)">改名</button>
        <button type="button" :disabled="busy" @click="mutate(a,{is_archived:true})">归档</button>
       </template>
      </div>
      <form v-if="editing===a.account_id" class="hf-inline" @submit.prevent="mutate(a,{label:rename.trim()})">
       <input v-model="rename" maxlength="80" required :disabled="busy" aria-label="账户名称"/>
       <button :disabled="busy||!rename.trim()">保存</button>
       <button type="button" @click="editing=null">取消</button>
      </form>
     </li>
    </ul>
    <form class="hf-create" @submit.prevent="createAccount">
     <strong>新建本人账户</strong>
     <select v-model="newKind" aria-label="账户类型" :disabled="busy">
      <option v-for="kind in kinds" :key="kind.value" :value="kind.value">{{kind.label}}</option>
     </select>
     <input v-model="newLabel" maxlength="80" placeholder="账户名称" aria-label="账户名称" required :disabled="busy"/>
     <button type="submit" :disabled="busy||!newLabel.trim()">新建</button>
    </form>
    <div class="hf-subhead hf-advanced-head">
     <strong>更多家庭财务工具</strong>
     <button type="button" :aria-expanded="advancedOpen" :disabled="busy" @click="advancedOpen=!advancedOpen">
      {{advancedOpen?'收起':'展开'}}
     </button>
    </div>
    <div v-if="advancedOpen" class="hf-advanced">
     <small class="hf-note">按需查看共享账务、历史归属核验及审批工具；不会影响原有账本。</small>
    <FamilySharedMutationRequests v-if="person.role==='member'"
      :key="'shared-mutation:'+person.user_id" :user-id="person.user_id"
      :household-id="person.household_id" />
    <FamilySharedEntries :key="'shared-entry:'+person.user_id"
      :user-id="person.user_id" :household-id="person.household_id"
      :role="person.role" @changed="refresh" />
    <FamilyFinanceOwnerAdoption v-if="person.role==='owner'"
     :key="'resource-adoption:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" />
    <FamilyFinanceMappingAudit v-if="person.role==='owner'"
     :key="'mapping-audit:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" />
    <FamilyFinanceLegacySharedAdoption v-if="person.role==='owner'"
     :key="'legacy-shared-adopt:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" />
    <FamilyFinanceLegacyLink v-if="person.role==='owner'"
     :key="'legacy-entry-links:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" />
    <FamilyFinanceLegacyTransferLink v-if="person.role==='owner'"
     :key="'legacy-transfer-links:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" />
    <FamilyFinanceAssetOwnership :key="'asset-provenance:'+person.user_id"
     :user-id="person.user_id" :household-id="person.household_id" />
    <FamilyFinancePlanOwnership :key="'plan-ownership:'+person.user_id"
     :user-id="person.user_id" :household-id="person.household_id" />
    <FamilyFinanceProposals v-if="person.role==='member'"
     :key="'proposals:'+person.user_id" :user-id="person.user_id" :accounts="accounts" />
    <FamilyFinanceCardPurchases v-if="person.role==='member'"
     :key="'card-purchases:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" :accounts="accounts" />
    <FamilyFinanceCardSettlements v-if="person.role==='member'"
     :key="'card-settlement:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" :accounts="accounts" />
    <FamilyFinancePrepaidActions v-if="person.role==='member'"
     :key="'prepaid-actions:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" :accounts="accounts" />
    <FamilyRecurringFinance v-if="person.role==='member'"
      :key="'recurring:'+person.user_id" :user-id="person.user_id"
      :household-id="person.household_id" :accounts="accounts" @changed="refresh" />
    <FamilyFinanceBankTransfers v-if="person.role==='member'"
     :key="'bank-transfers:'+person.user_id" :user-id="person.user_id"
     :household-id="person.household_id" :accounts="accounts" />
    </div>
    <small class="hf-note">此界面不会直接记账；成员修改家庭正式账务仍须管理员审批。</small>
   </template>
  </template>
 </section>
</template>

<style scoped>
.hf-finance{box-sizing:border-box;min-width:0;max-width:680px;width:100%;display:grid;gap:9px;
 margin:12px auto;padding:14px;border:1px solid var(--line,#d7e0df);
 border-radius:16px;background:var(--card,#fff);color:var(--ink,#333)}
.hf-head,.hf-subhead{display:flex;align-items:center;justify-content:space-between;gap:8px}
.hf-state{font-size:11px;color:#226d55;border-radius:20px;background:#e8f4ec;padding:4px 7px}
.hf-note,.hf-list small,.hf-summary small{margin:0;color:var(--muted,#71777b);font-size:12px;line-height:1.5}
.hf-error{font-size:12px;color:#b44646;margin:0;overflow-wrap:anywhere}
.hf-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px;min-width:0}
.hf-finance button{min-height:40px;border-radius:10px;padding:6px 11px;font-size:12px}
.hf-finance button:disabled{opacity:.55}
.hf-list{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.hf-list li{padding:9px;border-radius:10px;border:1px solid var(--line,#ddd);
 display:grid;gap:8px;overflow-wrap:anywhere}
.hf-list li>div:first-child{display:grid;gap:3px}
.hf-advanced-head{padding-top:10px;border-top:1px solid var(--line,#ddd)}
.hf-advanced{display:grid;gap:12px;min-width:0}
.hf-create{display:grid;gap:7px;border-top:1px solid var(--line,#ddd);padding-top:12px}
.hf-create input,.hf-create select,.hf-inline input{min-width:0;width:100%;box-sizing:border-box;
 min-height:42px;border:1px solid var(--line,#ddd);border-radius:10px;padding:7px}
.hf-inline{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
.hf-inline input{flex:1 1 120px}
</style>
