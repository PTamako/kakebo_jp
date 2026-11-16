<script setup>
defineProps({identity:{type:Object,required:true}})
const emit=defineEmits(['logout'])
</script>

<template>
 <details class="family-account-menu">
  <summary aria-label="HomeFlow 家庭账户" title="家庭账户">
   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">
    <circle cx="12" cy="8" r="3.3"/>
    <path d="M5.5 19v-1.2a6.5 6.5 0 0 1 13 0V19"/>
   </svg>
   <span class="family-account-dot" aria-hidden="true"></span>
  </summary>
  <div class="family-account-popover" role="group" aria-label="HomeFlow 家庭账户详情">
   <div class="family-account-heading">
    <strong>HomeFlow 家庭账户</strong>
    <span class="family-account-linked">已关联</span>
   </div>
   <p class="family-account-user">{{identity.display_name||'家庭成员'}} · {{identity.role==='owner'?'管理员':'家庭成员'}}</p>
   <button type="button" class="family-account-signout" @click="emit('logout')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="M10 17l5-5-5-5M15 12H3M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/>
    </svg>
    退出家庭身份
   </button>
  </div>
 </details>
</template>

<style scoped>
.family-account-menu{position:relative;flex:none;z-index:35}
.family-account-menu>summary{
 position:relative;display:grid;place-items:center;width:44px;height:44px;
 padding:0;border:1px solid var(--line,#f3e5e8);border-radius:14px;
 background:var(--card,#fff);color:var(--ink,#473d46);cursor:pointer;
 list-style:none;-webkit-tap-highlight-color:transparent
}
.family-account-menu>summary::-webkit-details-marker{display:none}
.family-account-menu>summary svg{width:22px;height:22px}
.family-account-dot{position:absolute;right:8px;top:7px;width:8px;height:8px;border-radius:50%;background:#58ad88;border:1px solid var(--card,#fff)}
.family-account-menu[open]>summary{border-color:var(--blue,#d96f91);color:var(--blue-dark,#bd5376)}
.family-account-menu>summary:focus-visible{outline:2px solid var(--blue-dark,#bd5376);outline-offset:2px}
.family-account-popover{
 position:absolute;top:calc(100% + 10px);right:0;width:min(290px,calc(100vw - 32px));
 display:grid;gap:12px;padding:15px;box-sizing:border-box;
 border:1px solid var(--line,#f3e5e8);border-radius:16px;
 background:var(--card,#fff);color:var(--ink,#473d46);
 box-shadow:0 14px 36px #473d4626
}
.family-account-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.family-account-heading strong{font-size:14px;white-space:nowrap}
.family-account-linked{padding:4px 7px;border-radius:100px;color:#237453;background:#e9f6ee;font-size:11px;white-space:nowrap}
.family-account-user{font-size:13px;color:var(--muted,#8c7e88);margin:0;overflow-wrap:anywhere}
.family-account-signout{
 display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
 min-height:44px;border:1px solid var(--line,#f3e5e8);border-radius:11px;
 background:var(--paper,#fff8f5);color:var(--blue-dark,#bd5376);
 font:inherit;font-size:13px;font-weight:750;cursor:pointer
}
.family-account-signout svg{width:18px;height:18px;flex:none}
@media(max-width:360px){
 .family-account-popover{right:-1px;width:min(270px,calc(100vw - 28px))}
}
</style>
