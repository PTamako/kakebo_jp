<script setup>
defineProps({modelValue:{type:String,default:'all'}})
const emit=defineEmits(['change'])
const options=[{value:'all',label:'すべて'},{value:'income',label:'収入'},
 {value:'expense',label:'支出'},{value:'transfer',label:'資産移動'}]
</script>
<template>
 <div class="entry-type-filter" role="group" aria-label="明細の種類">
  <button v-for="option in options" :key="option.value" type="button"
   :class="{selected:modelValue===option.value}" :aria-pressed="modelValue===option.value"
   @click="emit('change',option.value)">{{option.label}}</button>
 </div>
</template>
