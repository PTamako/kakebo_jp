<script setup>
import FinanceTools from '../FinanceTools.vue'
defineOptions({ inheritAttrs: false })
</script>
<template>
  <!-- Keep the management instance mounted across tab switches so drafts and
       settings state survive. All existing props/events pass through unchanged. -->
  <FinanceTools v-bind="$attrs">
    <template #member-card-usage><slot name="member-card-usage" /></template>
    <template #member-investment><slot name="member-investment" /></template>
    <template #member-rules><slot name="member-rules"/></template>
    <template #member-jobs><slot name="member-jobs"/></template>
    <template #member-privacy><slot name="member-privacy"/></template>
    <template #member-backup><slot name="member-backup"/></template>
    <template #member-duplicates><slot name="member-duplicates"/></template>
    <template #member-trash><slot name="member-trash"/></template>
  </FinanceTools>
</template>
