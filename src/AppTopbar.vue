<script setup>
import FamilyAccountMenu from './FamilyAccountMenu.vue'
defineProps({
 identity:{type:Object,default:null},
 theme:{type:String,required:true},
 themes:{type:Array,required:true}
})
const emit=defineEmits(['logout','change-theme'])
</script>
<template>
 <header class="topbar">
  <div class="brand">
   <img class="brand-wordmark" src="/branding/kakeibo-wordmark.png?v=4"
    alt="家計簿" width="400" height="133" decoding="async" />
  </div>
  <div class="header-actions">
   <details class="theme-picker">
    <summary aria-label="テーマカラーを選ぶ" title="配色を変更">
     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H13a1.5 1.5 0 0 1 0-3h3.5A4.5 4.5 0 0 0 21 9.5 9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="11" cy="6.5" r="1"/><circle cx="16" cy="8.5" r="1"/></svg>
     <span class="theme-indicator" :style="{ background: themes.find(item => item.id === theme)?.color }"></span>
    </summary>
    <div class="theme-switcher" role="group" aria-label="テーマカラー">
     <button v-for="item in themes" :key="item.id" type="button" class="theme-swatch"
      :class="{ selected: theme === item.id }" :aria-label="item.label + 'テーマ'"
      :aria-pressed="theme === item.id"
      @click="emit('change-theme',item.id); $event.currentTarget.closest('details').open = false">
      <span class="theme-dot" :style="{ backgroundColor: item.color }" aria-hidden="true"></span>
      <svg v-if="theme === item.id" class="theme-check" viewBox="0 0 24 24" aria-hidden="true">
       <path d="m5 12 5 5 9-10" />
      </svg>
     </button>
    </div>
   </details>
   <FamilyAccountMenu v-if="identity" :identity="identity" @logout="emit('logout')" />
   <button type="button" v-else class="header-logout" @click="emit('logout')" aria-label="ログアウト">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg>
    <span>ログアウト</span>
   </button>
  </div>
 </header>
</template>
