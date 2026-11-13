<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'

const STORAGE='kakeibo:homeflow-resume-v1'
const hex=/^[a-f0-9]{64}$/i
const enabled=ref(false),financeEnabled=ref(false),busy=ref(false),error=ref('')
const person=ref(null),pending=ref(null),accounts=ref([]),totals=ref(null),annual=ref(null)
const newLabel=ref(''),newKind=ref('credit_card'),editing=ref(null),rename=ref('')
const kinds=[
 {value:'credit_card',label:'信用卡'},{value:'prepaid',label:'储值卡'},
 {value:'cash',label:'现金'},{value:'bank',label:'银行'},
 {value:'points',label:'积分'},{value:'securities',label:'证券'},
 {value:'other',label:'其他'}
]
let epoch=0
const month=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'}).slice(0,7)
const selectedYear=ref(month.slice(0,4))
const yearOptions=Array.from({length:6},(_,i)=>String(Number(month.slice(0,4))+1-i))
const canManage=a=>!!person.value&&(person.value.role==='owner'||a.owner_user_id===person.value.user_id)
const amount=value=>new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',
 maximumFractionDigits:0}).format(Number(value||0))
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
 epoch++;person.value=null;accounts.value=[];totals.value=null;annual.value=null
 editing.value=null;rename.value=''
}
async function call(path,options={}){
 const response=await fetch(path,{cache:'no-store',credentials:'same-origin',...options})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(String(data.code||'操作失败'))
 return data
}
async function refresh(){
 const revision=epoch,year=selectedYear.value
 if(!person.value||!financeEnabled.value)return
 try{
  const [list,summary,yearly]=await Promise.all([
   call('/api/family-finance/accounts'),
   call('/api/family-finance/shared/ledger-totals?month='+encodeURIComponent(month)),
   call('/api/family-finance/shared/year-summary?year='+encodeURIComponent(year))
  ])
  if(revision!==epoch||year!==selectedYear.value)return
  accounts.value=Array.isArray(list.items)?list.items:[]
  totals.value=summary.ledger_scope==='household'?summary:null
  annual.value=yearly.ledger_scope==='household'&&yearly.complete===true?yearly:null
 }catch(e){
  if(revision===epoch&&year===selectedYear.value){error.value=e.message;accounts.value=[];totals.value=null;annual.value=null}
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
    if(financeEnabled.value)await refresh()
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
  const destination=new URL(result.authorization_url)
  if(destination.protocol!=='https:'||destination.pathname!=='/authorize')
   throw Error('授权地址无效')
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
 busy.value=true;error.value=''
 try{
  await call('/api/homeflow-sso/logout',{method:'POST'})
  resetIdentity();clearPending()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function createAccount(){
 if(busy.value||!person.value||!financeEnabled.value)return
 const label=newLabel.value.trim()
 if(!label||label.length>80){error.value='账户名称需为 1～80 个字符';return}
 busy.value=true;error.value=''
 try{
  const data=await call('/api/family-finance/accounts',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({label,account_kind:newKind.value})
  })
  if(data.ledger_changed!==false)throw Error('账户状态需要复核')
  newLabel.value=''
  await refresh()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function mutate(a,change){
 if(busy.value||!canManage(a)||a.origin==='legacy'||!financeEnabled.value)return
 if(change.is_archived===true&&!window.confirm('确认归档此账户？不会删除家庭账务记录。'))return
 busy.value=true;error.value=''
 try{
  const data=await call('/api/family-finance/accounts/'+encodeURIComponent(a.account_id),{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({version:a.version,...change})
  })
  if(data.ledger_changed!==false)throw Error('账户修改结果需要复核')
  editing.value=null;rename.value=''
  await refresh()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
function openRename(a){
 if(!canManage(a)||a.origin==='legacy')return
 editing.value=a.account_id;rename.value=a.label
}
function foreground(){
 if(document.visibilityState==='visible'&&person.value&&!busy.value)void check()
}
onMounted(()=>{void check();document.addEventListener('visibilitychange',foreground)})
onUnmounted(()=>{epoch++;document.removeEventListener('visibilitychange',foreground)})
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
  <template v-if="person">
   <p v-if="!financeEnabled" class="hf-note">家庭金融账户功能尚未开放，旧账本不会因身份关联而自动开放。</p>
   <template v-else>
    <div v-if="totals" class="hf-summary">
     <small>{{month}} 家庭账务（双方相同统计）</small>
     <div><span>收入 {{amount(totals.totals.income)}}</span><span>支出 {{amount(totals.totals.expense)}}</span></div>
    </div>
    <div class="hf-year-head"><strong>家庭年度统计</strong>
     <label>年度
      <select v-model="selectedYear" aria-label="统计年度" @change="refresh">
       <option v-for="y in yearOptions" :key="y" :value="y">{{y}} 年</option>
      </select>
     </label>
    </div>
    <div v-if="annual" class="hf-annual">
     <div class="hf-annual-totals">
      <span>收入 <b>{{amount(annual.totals.income)}}</b></span>
      <span>支出 <b>{{amount(annual.totals.expense)}}</b></span>
      <span>结余 <b>{{amount(annual.net_income_expense)}}</b></span>
     </div>
     <small class="hf-note">资产转移 {{amount(annual.totals.transfer)}} 单独列示，不计入收支结余</small>
     <div class="hf-year-list" aria-label="家庭每月收支">
      <div v-for="m in annual.months" :key="m.month" class="hf-year-row">
       <span>{{m.month.slice(5)}}月</span>
       <span>收入 {{amount(m.totals.income)}}</span>
       <span>支出 {{amount(m.totals.expense)}}</span>
      </div>
     </div>
     <div v-if="annual.categories.some(c=>c.type==='expense')" class="hf-category">
      <strong>年度支出分类</strong>
      <div v-for="c in annual.categories.filter(c=>c.type==='expense')" :key="c.category">
       <span>{{c.category}}</span><b>{{amount(c.amount)}}</b>
      </div>
     </div>
    </div>
    <p v-else class="hf-note">年度统计尚未读取成功</p>
    <div class="hf-subhead"><strong>家庭账户</strong>
     <button type="button" :disabled="busy" @click="refresh">刷新</button>
    </div>
    <p v-if="!accounts.length" class="hf-note">暂无已关联的金融账户</p>
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
.hf-summary{padding:9px;border-radius:10px;background:var(--bg,#f7f7f7);display:grid;gap:6px}
.hf-summary div{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;font-size:13px}
.hf-year-head{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid var(--line,#ddd);padding-top:12px}
.hf-year-head label{display:flex;align-items:center;gap:5px;font-size:12px}
.hf-year-head select{min-height:40px;border:1px solid var(--line,#ddd);border-radius:9px;padding:5px;background:var(--card,#fff)}
.hf-annual{display:grid;gap:10px;min-width:0}
.hf-annual-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.hf-annual-totals span{display:grid;gap:5px;padding:9px;background:var(--bg,#f7f7f7);border-radius:9px;font-size:11px}
.hf-annual-totals b{font-size:clamp(12px,3vw,15px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.hf-year-list,.hf-category{display:grid;gap:0;border:1px solid var(--line,#ddd);border-radius:10px;overflow:hidden}
.hf-year-row{display:grid;grid-template-columns:42px minmax(0,1fr) minmax(0,1fr);gap:6px;align-items:center;padding:7px 9px;font-size:11px}
.hf-year-row:nth-child(even){background:var(--bg,#f7f7f7)}
.hf-year-row span:not(:first-child){text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.hf-category{padding:7px 10px;gap:6px;font-size:12px}
.hf-category>div{display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--line,#ddd);padding-top:6px}
.hf-create{display:grid;gap:7px;border-top:1px solid var(--line,#ddd);padding-top:12px}
.hf-create input,.hf-create select,.hf-inline input{min-width:0;width:100%;box-sizing:border-box;
 min-height:42px;border:1px solid var(--line,#ddd);border-radius:10px;padding:7px}
.hf-inline{display:flex;align-items:center;flex-wrap:wrap;gap:6px;min-width:0}
.hf-inline input{flex:1 1 120px}
</style>
