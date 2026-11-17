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
  personalAccounts:{type:Array,default:()=>[]},
  onUpdatePersonalAccount:{type:Function,default:null},
  personalPrepaidApi:{type:Function,default:null},
  personalPortfolioApi:{type:Function,default:null},
  onPersonalOpening:{type:Function,default:null},
  onPersonalHistory:{type:Function,default:null},
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
  <EntryInputPage v-if="activeTab==='add'">
   <template #custom-transfer-fields="{record}"><slot name="custom-transfer-fields" :record="record"/></template>
  </EntryInputPage>
  <LedgerPage v-else-if="activeTab==='list'" :member="member"/>
  <StatisticsPage v-else-if="activeTab==='stat'"/>
  <AssetsPage v-else-if="activeTab==='investments'"
   :personal-assets="member?personalAssets:null"
   :personal-accounts="member?personalAccounts:[]"
   :on-update-personal-account="member?onUpdatePersonalAccount:null"
   :personal-user-id="member?identity?.user_id||'':''"
   :personal-prepaid-api="member?personalPrepaidApi:null"
   :personal-portfolio-api="member?personalPortfolioApi:null"
   :on-personal-opening="member?onPersonalOpening:null"
   :on-personal-history="member?onPersonalHistory:null"
   :on-create-personal-account="member?onCreatePersonalAccount:null"
   :open-personal-management="member?onOpenPersonalManagement:null"/>
  <ManagementPage v-show="activeTab==='finance'"
   v-bind="managementBindings" :active="activeTab==='finance'">
   <template #member-card-usage><slot name="member-card-usage"/></template>
   <template #member-plans><slot name="member-plans"/></template>
   <template #member-investment><slot name="member-investment"/></template>
   <template #member-rules><slot name="member-rules"/></template>
   <template #member-jobs><slot name="member-jobs"/></template>
   <template #member-privacy><slot name="member-privacy"/></template>
   <template #member-backup><slot name="member-backup"/></template>
   <template #member-duplicates><slot name="member-duplicates"/></template>
   <template #member-trash><slot name="member-trash"/></template>
  </ManagementPage>
  <BottomNavigation :active-tab="activeTab" @change="navigate"/>
</template>
