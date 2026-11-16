<script setup>
const props=defineProps({activeTab:{type:String,default:'add'}})
const emit=defineEmits(['change'])
</script>
<template>
    <nav class="bottom-nav" aria-label="メインメニュー">
      <button type="button" :class="{ active: activeTab === 'list' }" :aria-current="activeTab === 'list' ? 'page' : undefined" @click="emit('change','list')"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><span>明細</span></button>
      <button type="button" :class="{ active: activeTab === 'stat' }" :aria-current="activeTab === 'stat' ? 'page' : undefined" @click="emit('change','stat')"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4.5 19.5h15"/><rect x="6" y="11" width="3.2" height="6.5" rx="1"/><rect x="10.4" y="7.5" width="3.2" height="10" rx="1"/><rect x="14.8" y="4.5" width="3.2" height="13" rx="1"/></svg></span><span>統計</span></button>
      <button type="button" class="nav-add" :class="{ active: activeTab === 'add' }" :aria-current="activeTab === 'add' ? 'page' : undefined" aria-label="記録を追加" title="記録を追加" @click="emit('change','add')"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <button type="button" :class="{ active: activeTab === 'investments' }" :aria-current="activeTab === 'investments' ? 'page' : undefined" aria-label="残高" @click="emit('change','investments')"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M7 4.5h10M15.5 14.5h2"/></svg></span><span>残高</span></button>
      <button type="button" :class="{ active: activeTab === 'finance' }" :aria-current="activeTab === 'finance' ? 'page' : undefined" @click="emit('change','finance')"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg></span><span>管理</span></button>
    </nav>
</template>
