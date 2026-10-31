<script setup>
import { notification } from './notifications.js'
</script>
<template>
  <div class="global-toast-layer" aria-atomic="true">
    <Transition name="global-toast" mode="out-in">
      <div v-if="notification" :key="notification.id" class="global-toast-message"
        :class="{ 'global-toast-error': notification.level === 'error' }"
        :role="notification.level === 'error' ? 'alert' : 'status'">
        <svg v-if="notification.level === 'error'" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 7v6m0 4h.01"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="m7 12 3 3 7-7"/>
        </svg>
        <span>{{ notification.text }}</span>
      </div>
    </Transition>
  </div>
</template>
<style scoped>
/* The toast is outside <main>; size against the viewport, not any page tab. */
.global-toast-layer{
  position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
  min-width:0;box-sizing:border-box;
  padding:calc(18px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
    calc(18px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));
  pointer-events:none
}
.global-toast-message{
  display:flex;align-items:flex-start;gap:10px;
  width:fit-content;max-width:min(380px,100%);min-width:0;
  max-height:100%;box-sizing:border-box;
  padding:16px 18px;border:1px solid rgba(255,255,255,.2);border-radius:16px;
  background:rgba(34,42,55,.96);box-shadow:0 12px 36px rgba(22,25,35,.25);
  color:#fff;font-size:14px;font-weight:650;line-height:1.6;
  overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;pointer-events:auto
}
/* A flex child has min-width:auto by default; that prevented unbroken
   Japanese/error URLs from wrapping despite overflow-wrap on its parent. */
.global-toast-message span{
  display:block;flex:1 1 auto;min-width:0;max-width:100%;
  white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word
}
@media(max-width:400px){.global-toast-message{max-width:100%;padding:13px 14px;font-size:13px}}
.global-toast-message svg{flex:none;width:21px;height:21px;margin-top:1px;color:#9fe7cc}
.global-toast-error{background:rgba(104,44,59,.97)}
.global-toast-error svg{color:#ffd4d8}
.global-toast-enter-active,.global-toast-leave-active{transition:opacity .14s ease,transform .14s ease}
.global-toast-enter-from,.global-toast-leave-to{opacity:0;transform:translateY(6px)}
@media(prefers-reduced-motion:reduce){.global-toast-enter-active,.global-toast-leave-active{transition:none}}
</style>
