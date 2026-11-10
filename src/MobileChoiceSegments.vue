<script setup>
import {computed} from 'vue'
const props=defineProps({
  modelValue:{type:[String,Number],default:''},
  options:{type:Array,default:()=>[]},
  label:{type:String,default:'選択'},
  disabled:{type:Boolean,default:false}
})
const emit=defineEmits(['update:modelValue','change'])
const items=computed(()=>props.options.map(item=>
  typeof item==='string'||typeof item==='number'
    ? {value:item,label:String(item)} : item))
function choose(item){
  if(props.disabled)return
  emit('update:modelValue',item.value)
  emit('change',item.value)
}
</script>
<template>
  <div class="mobile-choice-segments" role="group" :aria-label="label">
    <button v-for="item in items" :key="String(item.value)" type="button"
      :disabled="disabled" :aria-pressed="String(modelValue)===String(item.value)"
      :class="{active:String(modelValue)===String(item.value)}"
      @click="choose(item)">{{item.label}}</button>
  </div>
</template>
<style scoped>
.mobile-choice-segments{display:flex;flex-wrap:wrap;gap:6px;width:100%;min-width:0}
.mobile-choice-segments>button{min-width:0;flex:1 1 auto;min-height:44px;padding:7px 10px;border:1px solid var(--line,#dce1e7);background:var(--card,#fff);color:var(--ink,#252830);border-radius:11px;font:inherit;font-size:13px;font-weight:650;line-height:1.25;cursor:pointer;overflow-wrap:anywhere}
.mobile-choice-segments>button.active{border-color:var(--blue,#6498c5);background:var(--tint,#eef3fa);color:var(--blue-dark,#496a9a);font-weight:800}
.mobile-choice-segments>button:disabled{cursor:not-allowed;opacity:.55}
.mobile-choice-segments>button:focus-visible{outline:2px solid var(--blue,#6498c5);outline-offset:2px}
</style>