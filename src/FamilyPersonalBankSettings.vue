<script setup>
import {ref,onMounted,onUnmounted} from 'vue'
const actor=ref(null),items=ref([]),error=ref(''),busy=ref(false),loading=ref(true)
const name=ref('')
let alive=true,rev=0
async function api(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options})
 const d=await r.json().catch(()=>({}))
 if(!r.ok||d.ok!==true)throw Error(d.code||'银行账户服务暂时不可用')
 return d
}
async function reload(){
 const ticket=++rev;loading.value=true;error.value=''
 try{
  const me=await api('/api/homeflow-sso/me')
  if(!alive||ticket!==rev)return
  if(me.identity?.role!=='owner'||me.ledger_access!==false)throw Error('仅原账本管理员可管理本人银行账户')
  const banks=await api('/api/family-finance/accounts')
  if(!alive||ticket!==rev)return
  if(banks.account_scope!=='personal'||(banks.items||[]).some(x=>x.owner_user_id!==me.identity.user_id))
   throw Error('个人银行账户权限核对失败')
  actor.value=me.identity
  items.value=banks.items.filter(x=>x.account_kind==='bank')
 }catch(e){if(ticket===rev){items.value=[];actor.value=null;error.value=e.message}}
 finally{if(ticket===rev)loading.value=false}
}
async function create(){
 const label=name.value.trim(),id=actor.value?.user_id
 if(!id||!label||label.length>80||busy.value)return
 busy.value=true;error.value=''
 try{
  const r=await api('/api/family-finance/accounts',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({expected_user_id:id,account_kind:'bank',label,opening_balance:0})})
  if(r.owner_user_id!==id||r.ledger_changed!==false)throw Error('银行归属核验失败')
  name.value='';await reload()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
async function archive(a,state){
 if(!actor.value||a.owner_user_id!==actor.value.user_id||a.origin!=='member_created'||busy.value)return
 if(state&&!confirm('归档本人银行账户？已有审批记录将保留。'))return
 busy.value=true
 try{
  await api('/api/family-finance/accounts/'+encodeURIComponent(a.account_id),{
   method:'PATCH',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({expected_user_id:actor.value.user_id,version:a.version,is_archived:state})})
  await reload()
 }catch(e){error.value=e.message}
 finally{busy.value=false}
}
onMounted(()=>{void reload();document.addEventListener('visibilitychange',foreground)})
function foreground(){if(document.visibilityState==='visible')void reload()}
onUnmounted(()=>{alive=false;rev++;items.value=[];actor.value=null;
 document.removeEventListener('visibilitychange',foreground)})
</script>
<template>
 <section class="finance-panel bank-personal" aria-label="本人银行账户管理">
  <h2>本人の銀行口座</h2>
  <p class="hint">管理各自银行账户。这里只登记名称及账户归属，不显示或猜测银行实时余额；用于需要双人确认的家庭银行转账。</p>
  <p v-if="error" role="alert" class="error">{{error}}</p>
  <p v-else-if="loading" class="hint">確認中…</p>
  <div v-for="a in items" :key="a.account_id" class="row">
   <span><strong>{{a.label}}</strong><small>{{a.is_archived?'アーカイブ':'使用中'}}</small></span>
   <button type="button" :disabled="busy" @click="archive(a,!a.is_archived)">{{a.is_archived?'復元':'アーカイブ'}}</button>
  </div>
  <form v-if="actor" class="add" @submit.prevent="create">
   <label>銀行口座の名称<input v-model="name" maxlength="80" placeholder="例：本人の普通預金" required /></label>
   <button type="submit" :disabled="busy||!name.trim()">追加</button>
  </form>
 </section>
</template>
<style scoped>
.bank-personal{display:grid;gap:10px;min-width:0}
.bank-personal h2{font-size:16px;margin:0}
.bank-personal .hint,.bank-personal .error{font-size:12px;margin:0}
.bank-personal .error{color:#b23a49}
.bank-personal .row{display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line,#ddd);border-radius:10px;padding:8px;min-width:0}
.bank-personal .row span{display:grid;gap:3px;overflow-wrap:anywhere}
.bank-personal .row small{font-size:11px;color:var(--muted,#777)}
.bank-personal .add{display:grid;gap:8px}
.bank-personal label{display:grid;gap:4px;font-size:12px}
.bank-personal input{width:100%;min-width:0;padding:9px;border:1px solid var(--line,#ddd);border-radius:10px;box-sizing:border-box;background:var(--card,#fff);color:inherit}
.bank-personal button{border:1px solid var(--line,#ddd);border-radius:10px;min-height:40px;padding:8px 12px;background:var(--card,#fff);color:inherit}
.bank-personal button:disabled{opacity:.5}
</style>
