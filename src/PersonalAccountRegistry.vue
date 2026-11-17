<script setup>
import {computed,ref} from 'vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
const props=defineProps({accounts:{type:Array,default:()=>[]},onCreate:{type:Function,default:null},onUpdate:{type:Function,default:null}})
const kinds=[{value:'securities',label:'証券口座'}]
const personal=computed(()=>props.accounts.filter(x=>x.account_kind==='securities'&&x.origin==='member_created'))
const kind=ref('securities'),name=ref(''),editing=ref(''),editName=ref(''),busy=ref(false),error=ref(''),message=ref('')
const label=x=>kinds.find(k=>k.value===x.account_kind)?.label||'口座'
async function add(){
 if(busy.value||!name.value.trim()||name.value.length>80||!props.onCreate)return
 busy.value=true;error.value='';message.value=''
 try{await props.onCreate(kind.value,name.value.trim());name.value='';message.value='本人の口座を追加しました'}
 catch(e){error.value=e.message||'追加できませんでした'}finally{busy.value=false}
}
async function update(item,changes){
 if(busy.value||!props.onUpdate)return
 busy.value=true;error.value='';message.value=''
 try{await props.onUpdate(item,changes);editing.value='';message.value='本人の口座を更新しました'}
 catch(e){error.value=e.message||'変更できませんでした'}finally{busy.value=false}
}
</script>
<template>
 <details class="personal-account-registry">
  <summary>証券口座 <span>{{personal.filter(a=>!a.is_archived).length}}件</span></summary>
  <div class="personal-account-body">
   
   <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="message" role="status">{{message}}</p>
   <div v-for="a in personal.filter(x=>!x.is_archived)" :key="a.account_id" class="account-row">
    <span><strong>{{a.label}}</strong><small>{{label(a)}}</small></span>
    <button type="button" :disabled="busy" @click="editing=a.account_id;editName=a.label">編集</button>
    <div v-if="editing===a.account_id" class="account-edit">
     <input v-model.trim="editName" maxlength="80" aria-label="口座名" :disabled="busy"/>
     <button type="button" :disabled="busy||!editName" @click="update(a,{label:editName})">保存</button>
     <button type="button" :disabled="busy" @click="editing=''">取消</button>
     <button type="button" :disabled="busy" @click="update(a,{is_archived:true})">保管</button>
    </div>
   </div>
   <p v-if="!personal.some(a=>!a.is_archived)">証券口座はまだありません。</p>
   <form class="account-create" @submit.prevent="add">
    <MobileChoiceSheet v-model="kind" label="口座の種類" :options="kinds"/>
    <input v-model.trim="name" maxlength="80" required aria-label="本人の口座名" placeholder="口座名" :disabled="busy"/>
    <button type="submit" :disabled="busy||!name">＋ 口座を追加</button>
   </form>
   <details v-if="personal.some(a=>a.is_archived)" class="account-archived"><summary>保管中</summary>
    <div v-for="a in personal.filter(x=>x.is_archived)" :key="a.account_id">
     {{a.label}} · {{label(a)}} <button type="button" :disabled="busy" @click="update(a,{is_archived:false})">復元</button>
    </div>
   </details>
  </div>
 </details>
</template>
<style scoped>
.personal-account-registry{border:1px solid var(--line);background:var(--card);border-radius:15px;padding:10px 12px;min-width:0}
.personal-account-registry>summary{display:flex;justify-content:space-between;align-items:center;cursor:pointer;min-height:36px;font-size:13px;font-weight:750}
.personal-account-body{display:grid;gap:10px;margin-top:8px}
.personal-account-body p{margin:0;font-size:11px;color:var(--muted)}.personal-account-body p.error{color:#b42f48}
.account-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;border-top:1px solid var(--line);padding:7px 0}
.account-row>span{display:grid;gap:2px;min-width:0;font-size:12px}.account-row strong{overflow-wrap:anywhere}.account-row small{color:var(--muted)}
.account-edit{grid-column:1/-1;display:flex;gap:5px;flex-wrap:wrap}.account-edit input{flex:1 1 110px}
.account-create{display:grid;gap:8px}.account-create input,.account-edit input{min-width:0;height:42px;padding:8px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink)}
.personal-account-registry button{min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:12px;font-weight:700}
.account-archived>div{display:flex;align-items:center;justify-content:space-between;font-size:12px}
</style>