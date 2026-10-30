<script setup>
import { computed, inject, ref } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
import PrepaidAssets from '../PrepaidAssets.vue'
const { tab, openPrepaidHistoryDetails, ledgerRevision, pendingTransfers, transferLoading, transferDue, loadTransfers, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder, api } = inject('kakeibo-page-context')
const activeView = ref('funds')
const selectView = value => { activeView.value = value }
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

    <nav class="balance-view-switch" aria-label="残高の表示切替" role="tablist">
      <button type="button" role="tab" :aria-selected="activeView==='funds'" :class="{selected:activeView==='funds'}" @click="selectView('funds')">投資信託</button>
      <button type="button" role="tab" :aria-selected="activeView==='wallets'" :class="{selected:activeView==='wallets'}" @click="selectView('wallets')">電子マネー</button>
      <button type="button" role="tab" :aria-selected="activeView==='plans'" :class="{selected:activeView==='plans'}" @click="selectView('plans')">積立管理<span v-if="pendingTransfers.length" class="balance-view-count">{{pendingTransfers.length}}</span></button>
    </nav>

    <details v-if="pendingTransfers.length && activeView==='plans'" class="panel pending-transfer-panel">
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

    <SbiPortfolio :api="api" :transfer-loading="transferLoading" :active-view="activeView" @summary="onPortfolioSummary">
      <template #before-holdings>
        <PrepaidAssets :api="api" :active="true" :revision="ledgerRevision" @summary="onPrepaidSummary" @open-card-settings="openCardSettings" @open-history="openPrepaidHistoryDetails" />
      </template>
    </SbiPortfolio>
  </section>
</template>
<style scoped>
.assets-page{display:grid;gap:9px;min-width:0}
.assets-page .page-heading{margin-bottom:0;min-height:0}
.assets-page .page-heading h1{letter-spacing:-.035em}
.asset-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}
.asset-investment,.asset-wallet{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:106px;padding:12px;border:1px solid var(--line);border-radius:15px;background:var(--card)}
.asset-investment{background:linear-gradient(135deg,color-mix(in srgb,var(--blue) 12%,var(--card)),var(--card) 85%);border-color:color-mix(in srgb,var(--blue) 18%,var(--line))}
.asset-wallet{background:linear-gradient(135deg,color-mix(in srgb,var(--teal) 9%,var(--card)),var(--card) 85%);border-color:color-mix(in srgb,var(--teal) 17%,var(--line))}
.asset-overview-label{display:flex;gap:6px;align-items:center;min-width:0}
.asset-overview-label>span:last-child{display:grid;gap:1px;color:var(--ink);font-size:11px;font-weight:800;min-width:0;line-height:1.3}
.asset-overview-label small{color:var(--muted);font-size:9px;font-weight:500}
.asset-label-icon{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:9px}
.asset-label-icon svg{width:15px;height:15px}
.asset-label-investment{background:color-mix(in srgb,var(--blue) 17%,var(--card));color:var(--blue-dark)}
.asset-label-wallet{background:color-mix(in srgb,var(--teal) 15%,var(--card));color:var(--teal)}
.asset-investment-value,.asset-wallet-value{display:block;margin-top:auto;padding-top:8px;font-size:clamp(18px,5.4vw,25px);font-weight:850;letter-spacing:-.045em;font-variant-numeric:tabular-nums;line-height:1.15;overflow-wrap:anywhere}
.asset-investment-foot{display:flex;align-items:center;gap:5px;justify-content:space-between;margin-top:7px;padding-top:5px;border-top:1px solid color-mix(in srgb,var(--blue) 15%,var(--line));font-size:10px;color:var(--muted)}
.asset-investment-foot strong{font-size:10px;color:#18876c;font-variant-numeric:tabular-nums;white-space:nowrap}
.asset-investment-foot .asset-pnl-negative{color:#bf516d}
.balance-view-switch{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;min-width:0;padding:4px;border-radius:13px;border:1px solid var(--line);background:var(--paper)}
.balance-view-switch button{display:flex;justify-content:center;align-items:center;gap:4px;min-width:0;min-height:43px;padding:8px 3px;border:1px solid transparent;background:transparent;border-radius:10px;color:var(--muted);font-size:12px;font-weight:750;white-space:nowrap;cursor:pointer}
.balance-view-switch button.selected{color:var(--blue-dark);background:var(--card);border-color:color-mix(in srgb,var(--blue) 17%,var(--line));box-shadow:0 1px 5px #0000000a}
.balance-view-switch button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.balance-view-count{display:inline-grid;place-items:center;min-width:15px;height:15px;padding:0 3px;border-radius:9px;background:color-mix(in srgb,var(--blue) 16%,var(--card));font-size:9px;line-height:1.1}
.pending-transfer-panel{min-width:0;margin:0;padding:0;overflow:visible}
.pending-summary{display:flex;align-items:center;gap:9px;min-height:45px;padding:7px 12px;list-style:none;cursor:pointer}
.pending-summary::-webkit-details-marker{display:none}
.pending-summary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.pending-alert-icon{display:grid;place-items:center;width:25px;height:25px;flex:none;border-radius:9px;background:color-mix(in srgb,var(--blue) 13%,var(--card));color:var(--blue-dark);font-size:13px;font-weight:850}
.pending-title{display:grid;gap:1px;flex:1;min-width:0}
.pending-title strong{font-size:12px}.pending-title small{font-size:10px;color:var(--muted)}
.pending-chevron{font-size:18px;line-height:1;color:var(--muted);transition:transform .18s}
.pending-transfer-panel[open] .pending-chevron{transform:rotate(180deg)}
.pending-body{padding:2px 12px 11px;border-top:1px solid var(--line)}
.pending-tools{display:flex;align-items:center;justify-content:space-between;gap:6px}
.pending-tools small{font-size:10px;color:var(--muted)}
.pending-refresh{border:0;background:transparent;color:var(--blue-dark);font-size:11px;font-weight:750;min-height:42px;padding:7px 5px}
.pending-transfer-list{display:grid}
.pending-transfer-row{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;padding:10px 0;border-top:1px solid var(--line)}
.pending-transfer-main{display:grid;gap:3px;min-width:0;flex:1}
.pending-transfer-main strong{font-size:12px;overflow-wrap:anywhere}.pending-transfer-main span{font-size:10px;color:var(--muted)}
.pending-transfer-actions{display:flex;align-items:center;gap:6px}
.pending-transfer-status{font-size:10px;color:var(--muted)}
.pending-delete,.pending-retry{min-height:40px;padding:6px 9px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:700}
.pending-delete{min-width:40px;font-size:18px}
.pending-explanation{border-top:1px solid var(--line)}.pending-explanation summary{padding:10px 0;font-size:11px;color:var(--muted);cursor:pointer}
.pending-explanation p,.pending-transfer-empty{margin:0 0 7px;color:var(--muted);font-size:11px;line-height:1.5}
@media(max-width:370px){.asset-investment,.asset-wallet{padding:10px}.asset-overview-label{gap:4px}.asset-overview-label>span:last-child{font-size:10px}.asset-label-icon{width:24px;height:24px}.asset-investment-value,.asset-wallet-value{font-size:18px}.balance-view-switch button{font-size:11px}}
@media(prefers-reduced-motion:reduce){.pending-chevron{transition:none}}
</style>