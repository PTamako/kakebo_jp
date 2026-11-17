<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'
import FamilyFinanceProposals from './FamilyFinanceProposals.vue'
import FamilyFinanceCardPurchases from './FamilyFinanceCardPurchases.vue'
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
 {value:'credit_card',label:'クレジットカード'},{value:'prepaid',label:'プリペイドカード'},
 {value:'cash',label:'現金'},
 {value:'points',label:'积分'},{value:'securities',label:'证券'},
 {value:'other',label:'其他'}
]
let epoch=0
const canManage=a=>!!person.value&&a.owner_user_id===person.value.user_id
const role=computed(()=>person.value?.role==='owner'?'管理者':'家族メンバー')
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
   typeof result.authorization_url!=='string')throw Error('認証情報が不正です')
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
  clearPending();error.value='認証の有効期限が切れました。再度ログインしてください';return
 }
 busy.value=true;error.value=''
 try{
  const data=await call('/api/homeflow-sso/complete',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({state:pending.value.state,resume_secret:pending.value.resume_secret})
  })
  if(data.ok!==true||data.ledger_access!==false)throw Error('本人確認が完了していません')
  clearPending()
  await check()
  if(!person.value)throw Error('アプリを開き直してログイン状態を確認してください')
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
 if(!label||label.length>80){error.value='口座名は1～80文字で入力してください';return}
 busy.value=true;error.value=''
 try{
  const data=await call('/api/family-finance/accounts',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({label,account_kind:newKind.value,expected_user_id:actor})
  })
  if(revision!==epoch||person.value?.user_id!==actor)return
  if(data.ledger_changed!==false)throw Error('口座の状態を確認できません')
  newLabel.value=''
  await refresh()
 }catch(e){if(revision===epoch)error.value=e.message}
 finally{busy.value=false}
}
async function mutate(a,change){
 if(busy.value||!canManage(a)||a.origin==='legacy'||!financeEnabled.value)return
 const revision=epoch,actor=person.value.user_id
 if(change.is_archived===true&&!window.confirm('この口座を保管しますか？家庭明細は削除されません。'))return
 busy.value=true;error.value=''
 try{
  const data=await call('/api/family-finance/accounts/'+encodeURIComponent(a.account_id),{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({version:a.version,...change,expected_user_id:actor})
  })
  if(revision!==epoch||person.value?.user_id!==actor)return
  if(data.ledger_changed!==false)throw Error('口座の変更結果を確認できません')
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
onUnmounted(()=>{
 // Unmount is NOT a logout: the verified HomeFlow owner is deliberately
 // switched from the identity screen to the original ledger by App.vue.
 // Emitting identity-change(null) here would lock App.vue again, remount
 // this component, reauthenticate the owner and flash in an infinite loop.
 // Invalidate pending async reads and scrub this component's local refs only.
 epoch++;person.value=null;accounts.value=[];advancedOpen.value=false
 document.removeEventListener('visibilitychange',foreground)
})
</script>

<template>
 <section v-if="enabled" class="hf-finance" aria-label="HomeFlow 家族アカウント">
  <div class="hf-head"><strong>HomeFlow 家族アカウント</strong>
   <span v-if="person" class="hf-state">已关联</span>
  </div>
  <p v-if="person" class="hf-note">{{person.display_name}} · {{role}}</p>
  <p v-else class="hf-note">HomeFlow アカウントでログイン</p>
  <p v-if="!person&&pending" class="hf-note">Safari で認証後、アプリに戻ってログインを完了してください。</p>
  <p v-if="error" class="hf-error" role="alert">{{error}}</p>
  <div class="hf-actions">
   <button v-if="person" type="button" :disabled="busy" @click="logout">退出家庭身份</button>
   <template v-else>
    <button v-if="pending" type="button" :disabled="busy" @click="complete">完成登录</button>
    <button type="button" :disabled="busy" @click="start">{{pending?'再認証':'HomeFlow でログイン'}}</button>
   </template>
  </div>
  <template v-if="person&&!props.identityOnly">
   <p v-if="!financeEnabled" class="hf-note">家庭金融機能は利用できません。</p>
   <template v-else>
    <div class="hf-subhead"><strong>家族アカウント</strong>
     <button type="button" :disabled="busy" @click="refresh">刷新</button>
    </div>
    <p v-if="!accounts.length" class="hf-note">口座は未登録です。既存の明細は保持されています。</p>
    <ul v-else class="hf-list">
     <li v-for="a in accounts" :key="a.account_id">
      <div><strong>{{a.label}}</strong>
       <small>{{kinds.find(k=>k.value===a.account_kind)?.label||'口座'}} ·
        {{a.owner_user_id===person.user_id?'本人':'家族メンバー'}} ·
        {{a.is_archived?'已归档':'使用中'}}
       </small>
      </div>
      <div v-if="canManage(a)&&!a.is_archived" class="hf-actions">
       <button v-if="a.origin==='legacy'" type="button" disabled title="旧口座の移行待ち">旧口座は閲覧のみ</button>
       <template v-else>
        <button type="button" :disabled="busy" @click="openRename(a)">改名</button>
        <button type="button" :disabled="busy" @click="mutate(a,{is_archived:true})">归档</button>
       </template>
      </div>
      <form v-if="editing===a.account_id" class="hf-inline" @submit.prevent="mutate(a,{label:rename.trim()})">
       <input v-model="rename" maxlength="80" required :disabled="busy" aria-label="口座名称"/>
       <button :disabled="busy||!rename.trim()">保存</button>
       <button type="button" @click="editing=null">取消</button>
      </form>
     </li>
    </ul>
    <form class="hf-create" @submit.prevent="createAccount">
     <strong>本人の口座を追加</strong>
     <select v-model="newKind" aria-label="口座类型" :disabled="busy">
      <option v-for="kind in kinds" :key="kind.value" :value="kind.value">{{kind.label}}</option>
     </select>
     <input v-model="newLabel" maxlength="80" placeholder="口座名称" aria-label="口座名称" required :disabled="busy"/>
     <button type="submit" :disabled="busy||!newLabel.trim()">新建</button>
    </form>
    <div class="hf-subhead hf-advanced-head">
     <strong>家庭金融ツール</strong>
     <button type="button" :aria-expanded="advancedOpen" :disabled="busy" @click="advancedOpen=!advancedOpen">
      {{advancedOpen?'收起':'展开'}}
     </button>
    </div>
    <div v-if="advancedOpen" class="hf-advanced">
     <small class="hf-note">共有明細・承認の確認</small>
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
    <FamilyRecurringFinance v-if="person.role==='member'"
      :key="'recurring:'+person.user_id" :user-id="person.user_id"
      :household-id="person.household_id" :accounts="accounts" @changed="refresh" />
    </div>
    <small class="hf-note">共有明細の変更には管理者の承認が必要です。</small>
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
