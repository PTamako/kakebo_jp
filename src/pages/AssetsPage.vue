<script setup>
import { computed, inject, ref } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
import PrepaidAssets from '../PrepaidAssets.vue'
const { tab, openPrepaidHistoryDetails, ledgerRevision, pendingTransfers, transferLoading, transferDue, loadTransfers, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder, api } = inject('kakeibo-page-context')
const portfolioSummary = ref(null)
const prepaidSummary = ref(null)
const onPortfolioSummary = value => { portfolioSummary.value = value }
const onPrepaidSummary = value => { prepaidSummary.value = value }
const openCardSettings = () => { tab.value = 'finance' }
const yen = value => value === null || !Number.isFinite(Number(value)) ? '—' : '¥'+Number(value).toLocaleString('ja-JP')
const investment = computed(() => portfolioSummary.value?.valuation ?? null)
const prepaid = computed(() => prepaidSummary.value?.balance ?? null)
// This is a view of *tracked* wallets and funds, not a total net-worth figure.
const pnl = computed(() => portfolioSummary.value?.pnl ?? null)
const gainYen = value => value === null || !Number.isFinite(Number(value)) ? '—' : (Number(value) >= 0 ? '+' : '−') + '¥' + Math.abs(Number(value)).toLocaleString('ja-JP')
</script>
<template>
  <section class="page-section assets-page">
    <div class="page-heading">
      <div><h1>残高</h1><p class="heading-subtitle">電子マネー・投資信託</p></div>
    </div>

    <section class="asset-overview" aria-label="残高の概要">
      <div class="asset-investment" :class="{'asset-investment-loss':pnl !== null && pnl < 0}">
        <div class="asset-overview-label">
          <span class="asset-label-icon asset-label-investment" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18V9m6 9V5m6 13v-6m4 6V8"/><path d="M3 21h18"/></svg>
          </span>
          <span>投資信託評価額<small>SBI証券</small></span>
        </div>
        <strong class="asset-investment-value">{{yen(investment)}}</strong>
        <div class="asset-investment-foot">
          <span>評価損益</span>
          <strong :class="{'asset-pnl-negative':pnl !== null && pnl < 0}">{{gainYen(pnl)}}</strong>
        </div>
      </div>
      <div class="asset-wallet">
        <div class="asset-overview-label">
          <span class="asset-label-icon asset-label-wallet" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M15 15h3"/></svg>
          </span>
          <span>電子マネー残高<small>Suica・PASMO など</small></span>
        </div>
        <strong class="asset-wallet-value">{{yen(prepaid)}}</strong>
      </div>
    </section>

    <details v-if="pendingTransfers.length" class="panel pending-transfer-panel">
      <summary class="pending-summary">
        <span class="pending-alert-icon" aria-hidden="true">!</span>
        <span class="pending-title"><strong>振替の確認</strong><small>{{pendingTransfers.length}}件の確認項目</small></span>
        <span class="pending-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="pending-body">
        <div class="pending-tools"><small>記帳上の反映を確認</small><button type="button" class="pending-refresh" :disabled="transferLoading" @click="loadTransfers" aria-label="振替予定を更新">↻ 更新</button></div>
        <p v-if="transferLoading" class="pending-transfer-empty" role="status">読み込み中…</p>
        <p v-else-if="!pendingTransfers.length" class="pending-transfer-empty">確認が必要な振替はありません</p>
        <div v-else class="pending-transfer-list">
          <div v-for="item in pendingTransfers" :key="item.id" class="pending-transfer-row">
            <div class="pending-transfer-main"><strong>{{item.merchant || item.note || 'SBI証券への振替'}}</strong><span>予定日 {{item.transfer_date || item.date}} · {{yen(item.amount)}}</span></div>
            <div class="pending-transfer-actions">
              <span class="pending-transfer-status" :class="transferStatusClass(item)">{{transferStatus(item)}}</span>
              <button v-if="Number(item.transfer_applied) === 1" class="pending-delete" :disabled="transferActionId !== null" aria-label="通知を閉じる" title="通知を閉じる" @click="dismissTransferReminder(item)">×</button>
              <button v-else-if="transferDue(item)" class="pending-retry" :disabled="transferActionId !== null" @click="retryTransfer(item)">記帳に反映</button>
            </div>
          </div>
        </div>
        <details class="pending-explanation"><summary>振替の反映について</summary><p>記帳上の反映は、SBI証券での買付成立を保証するものではありません。</p></details>
      </div>
    </details>

    <SbiPortfolio :api="api" :transfer-loading="transferLoading" @summary="onPortfolioSummary">
      <template #before-holdings>
        <PrepaidAssets :api="api" :active="true" :revision="ledgerRevision" @summary="onPrepaidSummary" @open-card-settings="openCardSettings" @open-history="openPrepaidHistoryDetails" />
      </template>
    </SbiPortfolio>
  </section>
</template>
<style scoped>
.assets-page{display:grid;gap:12px;min-width:0}
.assets-page .page-heading{margin-bottom:0}
.assets-page .page-heading h1{letter-spacing:-.035em}
.asset-overview{display:grid;gap:9px;min-width:0}
.asset-investment,.asset-wallet{min-width:0;border:1px solid var(--line);background:var(--card);border-radius:19px}
.asset-investment{display:grid;gap:12px;padding:17px 17px 14px;background:linear-gradient(135deg,color-mix(in srgb,var(--blue) 12%,var(--card)),var(--card) 74%);border-color:color-mix(in srgb,var(--blue) 19%,var(--line))}
.asset-overview-label{display:flex;align-items:center;gap:10px;min-width:0}
.asset-overview-label>span:last-child{display:grid;gap:2px;color:var(--ink);font-size:12px;font-weight:800}
.asset-overview-label small{font-size:10px;font-weight:500;color:var(--muted)}
.asset-label-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:12px}
.asset-label-icon svg{width:20px;height:20px}
.asset-label-investment{background:color-mix(in srgb,var(--blue) 18%,var(--card));color:var(--blue-dark)}
.asset-label-wallet{background:color-mix(in srgb,var(--teal) 16%,var(--card));color:var(--teal)}
.asset-investment-value{font-size:clamp(29px,8vw,38px);font-weight:850;letter-spacing:-.045em;line-height:1.1;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.asset-investment-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid color-mix(in srgb,var(--blue) 16%,var(--line));padding-top:11px;color:var(--muted);font-size:11px}
.asset-investment-foot strong{font-size:14px;color:#18876c;font-variant-numeric:tabular-nums}
.asset-investment-foot .asset-pnl-negative{color:#bf516d}
.asset-wallet{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;background:linear-gradient(110deg,color-mix(in srgb,var(--teal) 7%,var(--card)),var(--card) 86%)}
.asset-wallet-value{flex:none;font-size:clamp(17px,5.5vw,24px);letter-spacing:-.035em;font-weight:850;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.pending-transfer-panel{min-width:0;margin:0;padding:0;overflow:visible;border-color:color-mix(in srgb,var(--blue) 18%,var(--line))}
.pending-summary{display:flex;align-items:center;gap:10px;min-height:52px;padding:9px 13px;list-style:none;cursor:pointer}
.pending-summary::-webkit-details-marker{display:none}
.pending-summary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.pending-alert-icon{display:grid;place-items:center;width:27px;height:27px;flex:none;border-radius:9px;background:color-mix(in srgb,var(--blue) 13%,var(--card));color:var(--blue-dark);font-size:14px;font-weight:850}
.pending-title{display:grid;gap:1px;flex:1;min-width:0}
.pending-title strong{font-size:12px}
.pending-title small{font-size:10px;color:var(--muted)}
.pending-chevron{font-size:20px;line-height:1;color:var(--muted);transition:transform .18s}
.pending-transfer-panel[open] .pending-chevron{transform:rotate(180deg)}
.pending-body{padding:2px 13px 12px;border-top:1px solid var(--line)}
.pending-tools{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pending-tools small{font-size:10px;color:var(--muted)}
.pending-refresh{border:0;background:transparent;color:var(--blue-dark);font-size:11px;font-weight:750;min-height:42px;padding:7px 5px}
.pending-transfer-list{display:grid}
.pending-transfer-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;padding:10px 0;border-top:1px solid var(--line)}
.pending-transfer-main{display:grid;gap:3px;min-width:0;flex:1}
.pending-transfer-main strong{font-size:12px;overflow-wrap:anywhere}
.pending-transfer-main span{font-size:10px;color:var(--muted)}
.pending-transfer-actions{display:flex;gap:7px;align-items:center}
.pending-transfer-status{font-size:10px;color:var(--muted)}
.pending-delete,.pending-retry{min-height:40px;padding:6px 10px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:700}
.pending-delete{min-width:40px;font-size:18px}
.pending-explanation{border-top:1px solid var(--line)}
.pending-explanation summary{padding:11px 0;font-size:11px;color:var(--muted);cursor:pointer}
.pending-explanation p,.pending-transfer-empty{margin:0 0 7px;color:var(--muted);font-size:11px;line-height:1.5}
@media(max-width:370px){.asset-investment{padding:15px 14px 12px}.asset-wallet{padding:11px}.asset-overview-label{gap:7px}.asset-wallet-value{font-size:18px}}
@media(prefers-reduced-motion:reduce){.pending-chevron{transition:none}}
</style>
