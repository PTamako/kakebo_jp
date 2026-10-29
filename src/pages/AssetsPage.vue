<script setup>
import { inject } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
// Shared refs and navigation actions remain owned by App.vue.
// This page only renders its own view; links to 明細 call the same parent actions.
const { month, input, yen, pendingTransfers, transferLoading, transferDue, loadTransfers, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder, investmentItems, investments, investmentBusy, investmentReturn, saveInvestment, api } = inject('kakeibo-page-context')
</script>
<template>
<section  class="page-section">
      <article class="panel pending-transfer-panel">
        <div class="pending-transfer-heading"><h2>振替予定</h2><button class="pending-refresh" :disabled="transferLoading" @click="loadTransfers" aria-label="振替予定を更新" title="更新">↻ 更新</button></div>
        <p class="microcopy">期日で家計簿に反映。SBIへの着金確認・買付は別です</p>
        <div v-if="transferLoading" class="pending-transfer-empty">読み込み中…</div>
        <div v-else-if="!pendingTransfers.length" class="pending-transfer-empty">確認が必要な振替はありません</div>
        <div v-else class="pending-transfer-list">
          <div v-for="item in pendingTransfers" :key="item.id" class="pending-transfer-row">
            <div class="pending-transfer-main"><strong>{{ item.merchant || item.note || 'SBI証券への資産移動' }}</strong><span>予定日 {{ item.transfer_date || item.date }} · ¥{{ Number(item.amount || 0).toLocaleString('ja-JP') }}</span></div>
            <div class="pending-transfer-actions"><span class="pending-transfer-status" :class="transferStatusClass(item)">{{ transferStatus(item) }}</span><button v-if="Number(item.transfer_applied) === 1" class="pending-delete" :disabled="transferActionId !== null" aria-label="通知を閉じる" title="通知を閉じる" @click="dismissTransferReminder(item)">×</button><button v-else-if="transferDue(item)" class="pending-retry" :disabled="transferActionId !== null" @click="retryTransfer(item)">記帳に反映</button></div>
          </div>
        </div>
      </article>
      <div class="page-heading"><div><h1>資産・投資</h1><p class="heading-subtitle">資産移動と積立予定を照合</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M15 15h3"/></svg></span></div>
      <SbiPortfolio :api="api" />
      <details class="legacy-investment-details"><summary>旧評価額（過去の手入力データ）</summary>
      <article v-for="item in investmentItems" :key="item.id" class="panel investment-card">
        <div class="investment-card-heading"><div><h2>{{ item.label }}</h2><p>{{ item.detail }}</p></div><span class="investment-unit">{{ item.unit }}</span></div>
        <div class="investment-principal"><small>積立累計</small><strong>{{ yen(investments[item.id].investedTotal) }}</strong></div>
        <label class="form-field"><span>現在の評価額（{{ item.unit }}）</span><input v-model.number="investments[item.id].currentValue" type="number" min="0" step="1" inputmode="numeric" placeholder="現在の評価額" /></label>
        <label class="form-field"><span>評価損益（{{ item.unit }}）</span><input v-model.number="investments[item.id].pnl" type="number" step="1" inputmode="numeric" placeholder="例：-1339" /></label>
        <div class="investment-summary">
          <div><small>評価損益</small><strong :class="Number(investments[item.id].pnl) > 0 ? 'investment-positive' : Number(investments[item.id].pnl) < 0 ? 'investment-negative' : ''">{{ investments[item.id].pnl === null || investments[item.id].pnl === '' ? '—' : (Number(investments[item.id].pnl) > 0 ? '+' : '') + Number(investments[item.id].pnl).toLocaleString('ja-JP') + ' ' + item.unit }}</strong></div>
          <div><small>損益率</small><strong :class="investmentReturn(item) > 0 ? 'investment-positive' : investmentReturn(item) < 0 ? 'investment-negative' : ''">{{ investmentReturn(item) === null ? '—' : (investmentReturn(item) > 0 ? '+' : '') + investmentReturn(item).toFixed(2) + '%' }}</strong></div>
        </div>
        <p class="investment-updated">最終更新：{{ investments[item.id].updatedAt ? new Date(investments[item.id].updatedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未更新' }}</p>
        <button class="button-primary investment-save" :disabled="investmentBusy" @click="saveInvestment(item)">最新データを保存</button>
      </article>
      </details>
    </section>
</template>
<style scoped>
.legacy-investment-details{margin-top:14px;border-top:1px solid var(--line);padding-top:12px;color:var(--muted)}
.legacy-investment-details summary{font-size:12px;cursor:pointer;padding:10px 0}
.legacy-investment-details[open] summary{margin-bottom:10px}
</style>
