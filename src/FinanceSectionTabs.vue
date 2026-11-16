<script setup>
defineProps({modelValue:{type:String,default:'cards'}})
const emit=defineEmits(['update:modelValue'])
const choices=[['cards','カード'],['plans','固定費'],['investment','積立'],['tools','その他']]
</script>
<template>
 <div class="finance-section-tabs" role="group" aria-label="管理項目">
  <button v-for="[value,label] in choices" :key="value" type="button"
    :class="{selected:modelValue===value}" :aria-pressed="modelValue===value"
    @click="emit('update:modelValue',value)">{{label}}</button>
 </div>
</template>
<style scoped>
.finance-section-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;width:100%;min-width:0;padding:4px;border-radius:13px;border:1px solid var(--line,#ddd);background:var(--paper,#fffaf8);box-sizing:border-box}
.finance-section-tabs>button{display:grid;place-items:center;width:100%;min-width:0;min-height:44px;padding:8px 2px;white-space:nowrap;font-size:12px;font-weight:750;color:var(--muted,#888);border:1px solid transparent;border-radius:10px;background:transparent;cursor:pointer;box-sizing:border-box}
.finance-section-tabs>button.selected{color:var(--blue-dark,#bd5376);background:var(--card,#fff);border-color:color-mix(in srgb,var(--blue,#d96f91) 16%,var(--line,#ddd));box-shadow:0 1px 5px #0000000b}
.finance-section-tabs>button:focus-visible{outline:2px solid var(--blue-dark,#bd5376);outline-offset:2px}
@media(max-width:360px){.finance-section-tabs{gap:2px}.finance-section-tabs>button{font-size:11px;padding-inline:1px}}
</style>
