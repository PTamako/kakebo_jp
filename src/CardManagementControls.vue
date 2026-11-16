<script setup>
import MobileChoiceSheet from './MobileChoiceSheet.vue'
defineProps({
 modelValue:{type:String,default:''},
 options:{type:Array,default:()=>[]},
 busy:{type:Boolean,default:false},
 defaultValue:{type:String,default:''},
 allowDefault:{type:Boolean,default:true}
})
const emit=defineEmits(['update:modelValue','default','edit','add'])
</script>
<template>
 <div class="finance-inputs card-controls card-main-controls">
  <MobileChoiceSheet :model-value="modelValue" :disabled="busy"
   label="管理するカード" :options="[{value:'',label:'支払方法・カードを選択'},...options]"
   @update:model-value="emit('update:modelValue',$event)" />
  <button type="button" class="card-icon-action"
   :disabled="busy||!modelValue||!allowDefault||modelValue===defaultValue"
   @click="emit('default')" aria-label="デフォルトに設定" title="デフォルトに設定">
   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z"/>
   </svg>
  </button>
  <button type="button" class="card-icon-action" :disabled="busy||!modelValue"
   @click="emit('edit')" aria-label="カードを編集" title="カードを編集">
   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1 1-4L16.5 4.5Z"/></svg>
  </button>
  <button type="button" class="card-icon-action" :disabled="busy"
   @click="emit('add')" aria-label="カードを追加" title="カードを追加">
   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
  </button>
 </div>
</template>
