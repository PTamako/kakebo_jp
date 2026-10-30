<script setup>
import { computed, inject, ref } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
import PrepaidAssets from '../PrepaidAssets.vue'
const { tab, ledgerRevision, pendingTransfers, transferLoading, transferDue, loadTransfers, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder, api } = inject('kakeibo-page-context')
const portfolioSummary = ref(null)
const prepaidSummary = ref(null)
const onPortfolioSummary = value => { portfolioSummary.value = value }
const onPrepaidSummary = value => { prepaidSummary.value = value }
const openCardSettings = () => { tab.value = 'finance' }
const yen = value => value === null || !Number.isFinite(Number(value)) ? '—' : '¥'+Number(value).toLocaleString('ja-JP')
const investment = computed(() => portfolioSummary.value?.valuation ?? null)
const prepaid = computed(() => prepaidSummary.value?.balance ?? null)
// Only totals backed by current asset APIs are shown. Cash is not tracked here.
const assetsTotal = computed(() => investment.value === null || prepaid.value === null ? null : investment.value + prepaid.value)
const recon = computed(() => portfolioSummary.value?.reconciliation || null)
const plan = computed(() => recon.value?.monthly_amount ?? null)
const posted = computed(() => recon.value?.funded ?? null)
const pending = computed(() => recon.value?.pending ?? null)
const progress = computed(() => !plan.value || posted.value === null ? 0 : Math.max(0,Math.min(100,100*posted.value/plan.value)))
const monthLabel = computed(() => portfolioSummary.value?.month ? portfolioSummary.value.month.replace('-', '年')+'月' : '今月')
</script>
<template>
  <section class="page-section assets-page">
    <div class="page-heading">
      <div><h1>資産</h1><p class="heading-subtitle">残高と積立をまとめて確認</p></div>
      <span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M15 15h3"/></svg></span>
    </div>

    <section class="asset-overview" aria-label="資産概覧">
      <div class="asset-stat asset-stat-main">
        <span>資産合計</span>
        <strong>{{yen(assetsTotal)}}</strong>
        <small>投信＋プリペイド</small>
      </div>
      <div class="asset-stat">
        <span>プリペイド残高</span>
        <strong>{{yen(prepaid)}}</strong>
        <small>Suica・PASMOなど</small>
      </div>
      <div class="asset-stat">
        <span>投資信託評価額</span>
        <strong>{{yen(investment)}}</strong>
        <small>SBI証券</small>
      </div>
      <div class="asset-stat">
        <span>{{monthLabel}}の振替状況</span>
        <strong>{{yen(posted)}}</strong>
        <small>予定 {{yen(plan)}} · 記帳反映済</small>
      </div>
    </section>
    <p class="assets-coverage-note">※ 資産合計に現金残高・未登録の資産は含みません。</p>

    <details class="panel pending-transfer-panel">
      <summary class="pending-summary">
        <span class="pending-title"><strong>振替予定</strong><small>{{pendingTransfers.length}}件の確認項目</small><span class="pending-chevron" aria-hidden="true">⌄</span></span>
        <span class="pending-numbers">
          <span><small>今月予定</small><b>{{yen(plan)}}</b></span>
          <span><small>反映済</small><b>{{yen(posted)}}</b></span>
          <span><small>未反映</small><b>{{yen(pending)}}</b></span>
        </span>
        <span class="pending-progress" role="progressbar" aria-label="予定額に対する記帳済金額" :aria-valuemin="0" :aria-valuemax="Math.max(1,plan ?? 0)" :aria-valuenow="Math.min(Math.max(0,posted ?? 0),Math.max(1,plan ?? 0))"><span :style="{width:progress+'%'}"></span></span>
      </summary>
      <div class="pending-body">
        <div class="pending-tools"><small>期日反映は記帳上の処理です</small><button type="button" class="pending-refresh" :disabled="transferLoading" @click="loadTransfers" aria-label="振替予定を更新">↻ 更新</button></div>
        <p v-if="transferLoading" class="pending-transfer-empty" role="status">読み込み中…</p>
        <p v-else-if="!pendingTransfers.length" class="pending-transfer-empty">確認が必要な振替はありません</p>
        <div v-else class="pending-transfer-list">
          <div v-for="item in pendingTransfers" :key="item.id" class="pending-transfer-row">
            <div class="pending-transfer-main"><strong>{{item.merchant || item.note || 'SBI証券への資産移動'}}</strong><span>予定日 {{item.transfer_date || item.date}} · {{yen(item.amount)}}</span></div>
            <div class="pending-transfer-actions">
              <span class="pending-transfer-status" :class="transferStatusClass(item)">{{transferStatus(item)}}</span>
              <button v-if="Number(item.transfer_applied) === 1" class="pending-delete" :disabled="transferActionId !== null" aria-label="通知を閉じる" title="通知を閉じる" @click="dismissTransferReminder(item)">×</button>
              <button v-else-if="transferDue(item)" class="pending-retry" :disabled="transferActionId !== null" @click="retryTransfer(item)">記帳に反映</button>
            </div>
          </div>
        </div>
        <details class="pending-explanation"><summary>振替の反映について</summary><p>期日反映は証券口座への入金・買付完了を保証しません。買付月は別途確認してください。</p></details>
      </div>
    </details>

    <SbiPortfolio :api="api" :transfer-loading="transferLoading" @summary="onPortfolioSummary">
      <template #before-holdings>
        <PrepaidAssets :api="api" :active="true" :revision="ledgerRevision" @summary="onPrepaidSummary" @open-card-settings="openCardSettings" />
      </template>
    </SbiPortfolio>
  </section>
</template>
<style scoped>
.assets-page{display:grid;gap:10px;min-width:0}.assets-page .page-heading{margin-bottom:1px}
.asset-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.asset-stat{display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:3px;min-width:0;min-height:99px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--card)}
.asset-stat>span{font-size:11px;font-weight:750;color:var(--muted);line-height:1.35}
.asset-stat strong{display:block;font-size:clamp(17px,4.7vw,23px);font-weight:850;letter-spacing:-.045em;font-variant-numeric:tabular-nums;line-height:1.25;overflow-wrap:anywhere;max-width:100%}
.asset-stat small{font-size:10px;color:var(--muted);line-height:1.35}
.asset-stat-main{background:linear-gradient(140deg,color-mix(in srgb,var(--blue) 14%,var(--card)),var(--card) 88%);border-color:color-mix(in srgb,var(--blue) 18%,var(--line))}
.assets-coverage-note{margin:-2px 2px 1px;font-size:10px;color:var(--muted);line-height:1.35}
.pending-transfer-panel{min-width:0;margin:0;padding:0;overflow:visible}
.pending-summary{display:grid;gap:8px;min-height:94px;padding:12px 14px;list-style:none;cursor:pointer}
.pending-summary::-webkit-details-marker{display:none}
.pending-summary:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.pending-title{display:flex;align-items:center;gap:8px}.pending-title strong{font-size:14px}.pending-title small{font-size:10px;color:var(--muted);flex:1}.pending-chevron{font-size:19px;line-height:1;color:var(--muted);transition:transform .18s}
.pending-transfer-panel[open] .pending-chevron{transform:rotate(180deg)}
.pending-numbers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
.pending-numbers>span{display:grid;gap:2px;min-width:0}.pending-numbers small{color:var(--muted);font-size:10px}.pending-numbers b{font-size:clamp(12px,3.7vw,15px);font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.pending-progress{height:4px;overflow:hidden;border-radius:100px;background:var(--line)}.pending-progress>span{display:block;height:100%;border-radius:inherit;background:var(--blue)}
.pending-body{padding:2px 14px 13px;border-top:1px solid var(--line)}
.pending-tools{display:flex;align-items:center;justify-content:space-between;gap:8px}.pending-tools small{font-size:10px;color:var(--muted)}
.pending-refresh{border:0;background:transparent;color:var(--blue-dark);font-size:11px;font-weight:750;min-height:39px;padding:7px 5px}
.pending-transfer-list{display:grid;gap:0}.pending-transfer-row{padding:10px 0;border-top:1px solid var(--line)}
.pending-explanation{border-top:1px solid var(--line)}.pending-explanation summary{padding:12px 0;font-size:11px;color:var(--muted);cursor:pointer}
.pending-explanation p,.pending-transfer-empty{margin:0 0 8px;color:var(--muted);font-size:11px;line-height:1.5}
@media(max-width:365px){.asset-stat{min-height:92px;padding:10px}.pending-summary{padding:11px}.pending-numbers{gap:4px}.pending-numbers b{font-size:12px}}
@media(prefers-reduced-motion:reduce){.pending-chevron{transition:none}}
</style>
