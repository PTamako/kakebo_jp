<script setup>
defineProps({
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['restore', 'remove'])
</script>
<template>
  <div class="trash-row-actions" role="group" :aria-label="label">
    <button type="button" class="trash-row-restore" :disabled="disabled"
      :aria-label="'元に戻す：' + label" :title="'元に戻す：' + label" @click="emit('restore')">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 11v-6m0 6h6"/><path d="M3.6 11a9 9 0 1 1 2 7"/>
      </svg>
    </button>
    <button type="button" class="trash-row-delete" :disabled="disabled"
      :aria-label="'削除：' + label" :title="'削除：' + label" @click="emit('remove')">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18m-2 0-1 14H6L5 6m3 0V4h8v2m-7 4v7m6-7v7"/>
      </svg>
    </button>
  </div>
</template>
<style scoped>
.trash-row-actions{display:flex;gap:2px;align-items:center;flex:none}
.trash-row-actions button{display:flex;align-items:center;justify-content:center;flex:none;width:42px;min-width:42px;height:44px;min-height:44px;padding:0!important;border:0!important;border-radius:9px;background:transparent!important;color:var(--blue-dark);touch-action:manipulation}
.trash-row-actions .trash-row-delete{color:var(--muted)}
.trash-row-actions svg{width:18px;height:18px;flex:none}
.trash-row-actions button:disabled{opacity:.35}
.trash-row-actions button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:-2px}
@media(max-width:360px){.trash-row-actions button{width:38px;min-width:38px}}
</style>
