<script setup>
import FinanceSectionTabs from './FinanceSectionTabs.vue'
defineProps({
 modelValue:{type:String,default:'cards'},
 busy:{type:Boolean,default:false},
 status:{type:String,default:''},
 error:{type:String,default:''}
})
const emit=defineEmits(['update:modelValue','refresh'])
</script>
<template>
 <div class="finance-page-heading">
  <h1 class="finance-heading">管理</h1>
  <button type="button" class="finance-global-load" :disabled="busy" @click="emit('refresh')">
   <span class="finance-refresh-icon" aria-hidden="true">↻</span>{{busy?'更新中…':'すべて更新'}}
  </button>
 </div>
 <p class="finance-last-loaded" role="status">{{status}}</p>
 <p v-if="error" class="finance-load-error" role="alert">{{error}}</p>
 <FinanceSectionTabs :model-value="modelValue" @update:model-value="emit('update:modelValue',$event)" />
</template>
<style scoped>
.finance-page-heading{display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0}
.finance-heading{font-size:24px;margin:0;letter-spacing:-.02em}
.finance-global-load{display:flex;align-items:center;gap:6px;justify-content:center;min-height:40px;padding:7px 12px;border:1px solid var(--line,#ddd);border-radius:11px;color:var(--ink,#333);background:var(--card,#fff);font-weight:650}
.finance-global-load:disabled{opacity:.55}
.finance-refresh-icon{font-size:21px;line-height:1}
.finance-last-loaded{font-size:11px;color:var(--muted,#777);min-height:14px;margin:0}
.finance-load-error{font-size:12px;color:#b23a49;margin:0}
</style>
