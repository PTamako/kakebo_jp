<script setup>
import CardManagementControls from './CardManagementControls.vue'
import MobileCardEditorSheet from './MobileCardEditorSheet.vue'
const props=defineProps({
  selected:{type:String,default:''},
  options:{type:Array,default:()=>[]},
  defaultValue:{type:String,default:''},
  busy:{type:Boolean,default:false},
  mode:{type:String,default:''},
  name:{type:String,default:''},
  card:{type:Object,default:null},
  closingDay:{type:String,default:'末日'},
  paymentSources:{type:Array,default:()=>[]},
  shareOptions:{type:Array,default:()=>[]},
  shareReady:{type:Boolean,default:false},
  shareError:{type:String,default:''},
  archived:{type:Array,default:()=>[]},
  allowPermanentDelete:{type:Boolean,default:true},
  emptyHint:{type:String,default:''},
  onSave:{type:Function,required:true},
  onDanger:{type:Function,required:true}
})
const emit=defineEmits(['update:selected','update:mode','default','archive','remove'])
</script>
<template>
 <article class="finance-panel original-card-management">
  <h2>支払方法・カード管理</h2>
  <CardManagementControls :model-value="selected" :busy="busy"
   :options="options" :default-value="defaultValue"
   @update:model-value="emit('update:selected',$event)"
   @default="emit('default')" @edit="emit('update:mode','edit')"
   @add="emit('update:mode','add')"/>
  <p v-if="defaultValue">デフォルト：{{options.find(x=>x.value===defaultValue)?.label||defaultValue}}</p>
  <MobileCardEditorSheet :mode="mode" :card-name="name" :card="card"
   :closing-day="closingDay" :payment-sources="paymentSources"
   :share-options="shareOptions" :share-ready="shareReady" :share-error="shareError"
   :busy="busy" :on-save="onSave" :on-danger="onDanger"
   @close="emit('update:mode','')"/>
  <p v-if="emptyHint&&!options.length" class="card-type-hint">{{emptyHint}}</p>
  <details v-if="archived.length" class="card-archive-disclosure">
   <summary>アーカイブ済みのカード <strong>{{archived.length}}件</strong></summary>
   <p class="card-type-hint">新しい記帳には表示しません。過去の明細、請求、プリペイド残高はそのまま残ります。</p>
   <div v-for="item in archived" :key="item.value" class="card-archived-item">
    <span>{{item.label}} <small>（{{item.kind==='prepaid'?'プリペイド':'カード'}}）</small></span>
    <div class="card-archive-actions">
     <button type="button" :disabled="busy" @click="emit('archive',item.value)">復元</button>
     <button v-if="allowPermanentDelete" type="button" :disabled="busy" @click="emit('remove',item.value)">完全削除</button>
    </div>
   </div>
  </details>
 </article>
</template>
<style scoped>
.original-card-management{display:grid;gap:10px;padding:12px;border:1px solid var(--line);border-radius:15px;background:var(--card);min-width:0}
.original-card-management h2{font-size:16px;margin:0}
.original-card-management p{font-size:12px;margin:0;color:var(--muted)}
.card-archive-disclosure{min-width:0}
.card-archive-disclosure summary{min-height:44px;cursor:pointer;font-weight:750}
.card-archived-item{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--line)}
.card-archived-item span{font-size:12px;overflow-wrap:anywhere;min-width:0}
.card-archive-actions{display:flex;gap:6px}
.card-archive-actions button{min-height:40px;border:1px solid var(--line);border-radius:10px;background:var(--card);font-size:12px;padding:6px 9px}
</style>
