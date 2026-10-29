<script setup>
import { inject, ref } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
// Shared refs and navigation actions remain owned by App.vue.
// This page only renders its own view; links to 明細 call the same parent actions.
const migrationPending = ref(false)
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
      <SbiPortfolio :api="api" :transfer-loading="transferLoading" @migration-status="migrationPending = $event" />
      <details class="legacy-investment-details" :open="migrationPending"><summary>{{ migrationPending ? '旧評価額（移行前も利用できます）' : '旧評価額（過去の手入力データ）' }}</summary>
      <article v-for="item in investmentItems" :key="item.id" class="panel investment-card">
        <div class="investment-card-heading"><div><h2>{{item.label}}</h2><p>移行前の手入力履歴（参照のみ）</p></div><span class="investment-unit">{{item.unit}}</span></div>
        <div class="investment-summary">
          <div><small>旧評価額</small><strong>{{investments[item.id].currentValue===null?'—':yen(investments[item.id].currentValue)}}</strong></div>
          <div><small>旧評価損益</small><strong>{{investments[item.id].pnl===null?'—':yen(investments[item.id].pnl)}}</strong></div>
        </div>
        <div v-if="migrationPending" class="legacy-edit-controls">
          <label>評価額（円）<input v-model.number="investments[item.id].currentValue" inputmode="numeric" type="number" min="0" step="1" /></label>
          <label>評価損益（円）<input v-model.number="investments[item.id].pnl" inputmode="numeric" type="number" step="1" /></label>
          <button class="button-primary" type="button" :disabled="investmentBusy" @click="saveInvestment(item)">旧評価額を保存</button>
        </div>
        <p class="investment-updated">最終更新：{{investments[item.id].updatedAt?new Date(investments[item.id].updatedAt).toLocaleDateString('ja-JP'):'未更新'}}</p>
      </article>
      </details>
    </section>
</template>
<style scoped>
.legacy-investment-details{margin-top:14px;border-top:1px solid var(--line);padding-top:12px;color:var(--muted)}
.legacy-investment-details summary{font-size:12px;cursor:pointer;padding:10px 0}
.legacy-investment-details[open] summary{margin-bottom:10px}
.legacy-edit-controls{display:grid;gap:10px;padding:12px}
.legacy-edit-controls label{display:grid;gap:5px;font-size:12px}
.legacy-edit-controls input{font-size:16px;width:100%;max-width:280px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}
.legacy-edit-controls button{min-height:44px}
</style>
