<script setup>
import { computed, ref } from 'vue'
import { PAYMENT_STAT_METHODS, UNASSIGNED_TRANSFER_METHOD } from './payment-stat-group.js'

const props = defineProps({
  report: { type: Object, default: null },
  period: { type: String, required: true },
  yen: { type: Function, required: true },
  openDetails: { type: Function, required: true }
})

const selectedMethod = ref('')
const empty = Object.freeze({
  expenseAmount: 0, transferAmount: 0, creditOffsetAmount: 0,
  expenseCount: 0, transferCount: 0, creditOffsetCount: 0
})
const summary = method => (props.report?.paymentMethods || []).find(row => row.method === method) || empty
const count = method => {
  const row = summary(method)
  return Number(row.expenseCount || 0) + Number(row.transferCount || 0) + Number(row.creditOffsetCount || 0)
}
const total = method => {
  const row = summary(method)
  return Number(row.expenseAmount || 0) + Number(row.transferAmount || 0)
    + (method === 'ポイント払い' ? Number(row.creditOffsetAmount || 0) : 0)
}
const methods = computed(() => [
  ...PAYMENT_STAT_METHODS,
  ...(Number(summary(UNASSIGNED_TRANSFER_METHOD).transferCount || 0) > 0 ? [UNASSIGNED_TRANSFER_METHOD] : [])
])
const labels = {
  'カード・電子決済': 'カード',
  '現金': '現金',
  'ポイント払い': 'ポイント',
  [UNASSIGNED_TRANSFER_METHOD]: '未指定'
}
const panelId = computed(() => 'payment-switch-breakdown-' + props.period)
const toggle = method => { selectedMethod.value = selectedMethod.value === method ? '' : method }
const showDetails = () => {
  if (selectedMethod.value && count(selectedMethod.value)) props.openDetails(selectedMethod.value, props.period)
}
</script>

<template>
  <section class="payment-switcher" aria-label="支払方法別">
    <h2>支払方法別</h2>
    <div class="payment-switcher-rail" role="group" aria-label="支払方法を選んで内訳を表示">
      <button v-for="method in methods" :key="method" type="button"
        class="payment-switcher-tab" :class="{ 'is-selected': selectedMethod === method }"
        :aria-expanded="selectedMethod === method" :aria-controls="panelId"
        :aria-label="method + ' ' + yen(total(method)) + '、内訳を' + (selectedMethod === method ? '閉じる' : '表示')"
        @click="toggle(method)">
        <span class="payment-switcher-label">{{ labels[method] }}</span>
        <strong class="payment-switcher-amount">{{ yen(total(method)) }}</strong>
      </button>
    </div>

    <div v-if="selectedMethod && methods.includes(selectedMethod)" :id="panelId"
      class="payment-switcher-panel" role="region" :aria-label="selectedMethod + 'の内訳'">
      <div class="payment-switcher-panel-head">
        <strong>{{ selectedMethod }}</strong>
        <button type="button" class="payment-switcher-detail-link" :disabled="!count(selectedMethod)"
          @click="showDetails">明細を見る <span aria-hidden="true">›</span></button>
      </div>
      <div class="payment-switcher-breakdown">
        <template v-if="selectedMethod !== UNASSIGNED_TRANSFER_METHOD">
          <span class="payment-switcher-breakdown-item">
            <span>支出</span><b>{{ yen(summary(selectedMethod).expenseAmount) }}</b>
            <small>{{ summary(selectedMethod).expenseCount || 0 }}件</small>
          </span>
        </template>
        <span class="payment-switcher-breakdown-item">
          <span>資産移動</span><b>{{ yen(summary(selectedMethod).transferAmount) }}</b>
          <small>{{ summary(selectedMethod).transferCount || 0 }}件</small>
        </span>
        <span v-if="selectedMethod === 'ポイント払い'" class="payment-switcher-breakdown-item"
          title="クレジットカード利用額に充当したポイント">
          <span>カード充当</span><b>{{ yen(summary(selectedMethod).creditOffsetAmount) }}</b>
          <small>{{ summary(selectedMethod).creditOffsetCount || 0 }}件</small>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.payment-switcher{display:grid;gap:7px;margin:8px 0 10px;min-width:0}
.payment-switcher h2{font-size:15px;line-height:1.3;margin:0;color:var(--ink)}
.payment-switcher-rail{display:flex;gap:6px;min-width:0;padding:2px 1px 4px;margin:-2px -1px -4px;overflow-x:auto;scrollbar-width:none;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}
.payment-switcher-rail::-webkit-scrollbar{display:none}
.payment-switcher-tab{appearance:none;display:flex;flex:1 0 0;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;min-width:82px;min-height:60px;padding:9px 9px;border:1px solid var(--line);border-radius:13px;background:var(--card);color:var(--ink);text-align:left;scroll-snap-align:start;transition:background .15s,border-color .15s,box-shadow .15s}
.payment-switcher-tab.is-selected{background:var(--tint);border-color:var(--blue);box-shadow:inset 0 0 0 1px var(--blue)}
.payment-switcher-tab:focus-visible,.payment-switcher-detail-link:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.payment-switcher-label{font-size:clamp(10px,2.8vw,12px);line-height:1.15;font-weight:650;color:var(--muted);white-space:nowrap}
.payment-switcher-tab.is-selected .payment-switcher-label{color:var(--blue-dark)}
.payment-switcher-amount{font-size:clamp(13px,3.6vw,17px);font-weight:800;line-height:1.15;letter-spacing:-.04em;font-variant-numeric:tabular-nums;white-space:nowrap}
.payment-switcher-panel{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:13px;background:var(--card)}
.payment-switcher-panel-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.payment-switcher-panel-head>strong{font-size:13px;line-height:1.3;font-weight:750}
.payment-switcher-detail-link{appearance:none;border:0;background:transparent;color:var(--blue-dark);font-size:12px;font-weight:700;white-space:nowrap;padding:4px 0 4px 8px}
.payment-switcher-detail-link:disabled{color:var(--muted);opacity:.65}
.payment-switcher-breakdown{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.payment-switcher-breakdown-item{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap;line-height:1.3}
.payment-switcher-breakdown-item>span{font-size:11px;color:var(--muted)}
.payment-switcher-breakdown-item>b{font-size:12px;font-weight:750;color:var(--ink);font-variant-numeric:tabular-nums}
.payment-switcher-breakdown-item>small{font-size:10px;color:var(--muted)}
@media(max-width:360px){.payment-switcher-tab{padding:9px 7px;min-width:80px}.payment-switcher-amount{font-size:13px}.payment-switcher-breakdown{gap:5px 10px}}
</style>
