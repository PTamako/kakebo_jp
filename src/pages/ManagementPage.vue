<script setup>
import FinanceTools from '../FinanceTools.vue'
defineOptions({ inheritAttrs: false })
</script>
<template>
  <!-- Keep the management instance mounted across tab switches so drafts and
       settings state survive. All existing props/events pass through unchanged. -->
  <FinanceTools v-bind="$attrs" />
</template>
