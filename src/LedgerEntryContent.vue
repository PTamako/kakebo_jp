<script setup>
import {isExternalLedgerEntry} from './ledger-origin.js'
const props=defineProps({
 entry:{type:Object,required:true},categories:{type:Array,default:()=>[]},
 categoryIconPath:{type:Function,default:()=>''},
 categoryLabel:{type:Function,default:x=>x},
 yen:{type:Function,required:true},annual:{type:Boolean,default:false},
 cardBill:{type:Boolean,default:false},prepaidUsage:{type:Boolean,default:false},
 clickable:{type:Boolean,default:true}
})
const emit=defineEmits(['open','edit'])
const name=x=>props.categoryLabel(x)||x||'その他'
const attribution=e=>e?.recorder_basis==='creator'?'記帳：':e?.recorder_basis==='legacy_assigned'?'旧記録：':null
</script>
<template>
 <div class="ledger-row-content" :role="clickable?'button':undefined" :tabindex="clickable?0:undefined"
   @click="clickable&&emit('open')" @keydown.enter.prevent="clickable&&emit('edit')"
   @keydown.space.prevent="clickable&&emit('edit')">
  <span class="category-dot" :class="['cat-'+(categories.indexOf(entry.category)+1),
     entry.type==='income'?'income-category-dot':'']">
   <svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path :d="categoryIconPath(entry.category)"/>
   </svg>
  </span>
  <div class="ledger-info">
   <b>{{entry.merchant||name(entry.category)}}<span v-if="isExternalLedgerEntry(entry)" class="ledger-external-label"> • 外部</span></b>
   <small>{{annual?String(entry.date||'').replace(/-/g,'/'):String(entry.date||'').slice(5)}}
    <template v-if="entry.time"> · {{entry.time}}</template> · {{name(entry.category)}}
    <template v-if="!annual"> · {{entry.type==='income'?'収入':entry.type==='transfer'?'資産移動':'支出'}}</template>
    <span v-if="attribution(entry)&&entry.recorded_by" class="ledger-recorder"
     :title="entry.recorder_basis==='legacy_assigned'?'原账本归属人；旧记录未单独保存实际记账操作人':'由已验证的 HomeFlow 身份创建'">
     · {{attribution(entry)}}{{entry.recorded_by}}
    </span>
    <template v-if="prepaidUsage&&entry.payment_source"> · {{entry.payment_source}}</template>
    <template v-if="entry.type==='income'&&entry.category==='ポイント還元'&&entry.transfer_target">
     · → {{entry.transfer_target.startsWith('prepaid:')?entry.transfer_target.slice(8):
       entry.transfer_target.startsWith('credit:')?entry.transfer_target.slice(7):entry.transfer_target}}
    </template>
    <template v-if="entry.type==='transfer'&&entry.transfer_target">
     · {{entry.transfer_target==='sbi'?'→ SBI証券':
       entry.transfer_target.startsWith('prepaid:')?'→ '+entry.transfer_target.slice(8):'→ '+entry.transfer_target}}
    </template>
   </small>
  </div>
  <span class="ledger-amount" :class="{'income-amount':entry.type==='income','transfer-amount':entry.type==='transfer'}">
   {{cardBill?(entry.type==='income'?'−':''):entry.type==='income'?'+':entry.type==='transfer'?'':'−'}}{{yen(entry.amount)}}
  </span>
 </div>
</template>
<style scoped>
.ledger-recorder{display:inline;white-space:normal;overflow-wrap:normal;
 font-size:clamp(10px,2.7vw,12px);color:var(--muted,#897b85);font-weight:600}
</style>
