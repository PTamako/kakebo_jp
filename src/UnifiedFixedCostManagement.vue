<script setup>
import {computed} from 'vue'
import FixedCostEditorFields from './FixedCostEditorFields.vue'
import OriginalFixedCostList from './OriginalFixedCostList.vue'

// Presentation is independent of household role. A scoped controller supplies
// current-user data and authorized callbacks, never another member's ledger.
const props=defineProps({config:{type:Object,default:null}})
const state=computed(()=>props.config||null)
function invoke(name,...args){return state.value?.[name]?.(...args)}
</script>
<template>
 <div v-if="state" class="unified-fixed-cost-management">
  <article class="finance-panel recurring-manager-panel">
   <h2>固定費の設定</h2>
   <FixedCostEditorFields :model="state.model"
    :cycle-choice="state.cycleChoice"
    @update:cycle-choice="invoke('onCycleChange',$event)"
    :cycle-options="state.cycleOptions"
    :categories="state.categories"
    :category-label="state.categoryLabel"
    :payment-choices="state.paymentChoices"
    :member="state.memberMode===true"/>
   <div class="finance-actions recurring-save-actions">
    <button type="button" :disabled="!state.canSave"
     @click="invoke('onSave')">{{state.busy?'保存中…':state.editingId?'変更を保存':'固定費を登録'}}</button>
    <button v-if="state.editingId" type="button" :disabled="state.busy"
     @click="invoke('onCancel')">編集をやめる</button>
   </div>
   <p v-if="state.error" class="fixed-cost-error" role="alert">{{state.error}}</p>
   <p v-if="state.notice" class="fixed-cost-notice" role="status">{{state.notice}}</p>
  </article>
  <slot name="after-editor"/>
  <OriginalFixedCostList
    :items="state.items" :busy="state.busy" :yen="state.yen"
    :category-label="state.categoryLabel"
    :payment-label="state.paymentLabel"
    :next-label="state.nextLabel"
    :current-count="state.currentCount"
    :monthly-total="state.monthlyTotal"
    :allow-delete="true" :allow-post="state.allowPost===true"
    @edit="invoke('onEdit',$event)"
    @toggle="invoke('onToggle',$event)"
    @remove="invoke('onRemove',$event)"
    @post="invoke('onPost',$event)"/>
 </div>
</template>
<style scoped>
.unified-fixed-cost-management{display:grid;gap:12px;min-width:0}
.finance-panel{display:grid;gap:9px;min-width:0;padding:12px;border:1px solid var(--line);background:var(--card);border-radius:15px}
.finance-panel h2{margin:0;font-size:16px}
.finance-actions{display:flex;gap:8px;flex-wrap:wrap}
.finance-actions button{flex:1;min-height:44px;padding:9px;border:1px solid var(--line);border-radius:11px;background:var(--tint);color:var(--blue-dark);font-weight:750}
.finance-actions button:disabled{opacity:.55}
.fixed-cost-error{color:#b43c4a;font-size:12px;margin:0}
.fixed-cost-notice{color:var(--muted);font-size:12px;margin:0}
</style>
