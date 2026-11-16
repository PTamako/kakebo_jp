<script setup>
import AppTopbar from './AppTopbar.vue'
import EntryInputPage from './EntryInputPage.vue'
import BottomNavigation from './BottomNavigation.vue'
import LedgerPage from './pages/LedgerPage.vue'
import StatisticsPage from './pages/StatisticsPage.vue'
import AssetsPage from './pages/AssetsPage.vue'
import ManagementPage from './pages/ManagementPage.vue'
const props=defineProps({
  identity:{type:Object,default:null},
  theme:{type:String,required:true},
  themes:{type:Array,required:true},
  activeTab:{type:String,required:true},
  member:{type:Boolean,default:false},
  managementBindings:{type:Object,default:()=>({})},
  personalAssets:{type:Array,default:null},
  onCreatePersonalAccount:{type:Function,default:null},
  onOpenPersonalManagement:{type:Function,default:null},
})
const emit=defineEmits(['update:activeTab','theme-change','logout','ledger-open'])
function navigate(next){
 if(next==='list'){emit('ledger-open');return}
 emit('update:activeTab',next)
}
</script>
<template>
  <!-- Exactly one original page tree and navigation for both HomeFlow identities.
       Only injected account data and authorized event adapters differ. -->
  <AppTopbar :identity="identity" :theme="theme" :themes="themes"
   @change-theme="emit('theme-change',$event)" @logout="emit('logout')"/>
  <EntryInputPage v-if="activeTab==='add'"/>
  <LedgerPage v-else-if="activeTab==='list'" :member="member"/>
  <StatisticsPage v-else-if="activeTab==='stat'"/>
  <AssetsPage v-else-if="activeTab==='investments'"
   :personal-assets="member?personalAssets:null"
   :on-create-personal-account="member?onCreatePersonalAccount:null"
   :open-personal-management="member?onOpenPersonalManagement:null"/>
  <ManagementPage v-show="activeTab==='finance'"
   v-bind="managementBindings" :active="activeTab==='finance'">
   <template #member-cards><slot name="member-cards"/></template>
   <template #member-plans><slot name="member-plans"/></template>
   <template #member-investment><slot name="member-investment"/></template>
   <template #member-tools><slot name="member-tools"/></template>
  </ManagementPage>
  <BottomNavigation :active-tab="activeTab" @change="navigate"/>
</template>
