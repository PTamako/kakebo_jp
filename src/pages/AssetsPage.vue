<script setup>
import { computed, inject, ref } from 'vue'
import SbiPortfolio from '../SbiPortfolio.vue'
import PrepaidAssets from '../PrepaidAssets.vue'
const { tab, openPrepaidHistoryDetails, ledgerRevision, transferLoading, api } = inject('kakeibo-page-context')
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
const latestUsage = computed(() => prepaidSummary.value?.latestUsage || null)
const latestCharge = computed(() => prepaidSummary.value?.latestCharge || null)
const shortDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? String(value).slice(5).replace('-', '/') : ''
// This is a view of *tracked* wallets and funds, not a total net-worth figure.
const pnl = computed(() => portfolioSummary.value?.pnl ?? null)
const acquisition = computed(() => portfolioSummary.value?.acquisition ?? null)
const pnlRatio = computed(() => portfolioSummary.value?.ratio ?? null)
const fundCount = computed(() => portfolioSummary.value?.fundCount ?? 0)
const allocation = computed(() => portfolioSummary.value?.allocation ?? [])
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
          <span>評価額・損益の内訳<small>SBI証券 · {{fundCount}}銘柄</small></span>
        </div>
        <strong class="asset-investment-value">{{yen(investment)}}</strong>
        <div class="asset-investment-foot">
          <span>評価損益</span>
          <strong :class="{'asset-pnl-negative':pnl !== null && pnl < 0}">{{gainYen(pnl)}}<small v-if="pnlRatio!==null"> ({{pnlRatio>=0?'+':''}}{{pnlRatio.toFixed(2)}}%)</small></strong>
        </div>
        <div class="asset-cost-line"><span>取得金額</span><strong>{{yen(acquisition)}}</strong></div>
        <div v-if="allocation.length" class="asset-allocation" aria-label="銘柄別の評価額比率">
          <span v-for="a in allocation" :key="a.key" :style="{width:a.ratio+'%',background:a.color}" :title="a.ratio.toFixed(1)+'%'"></span>
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
        <div class="asset-wallet-activity" aria-label="電子マネーの最近の記録">
          <div class="asset-wallet-event">
            <div class="asset-wallet-event-top">
              <span class="asset-wallet-event-kind">↘ 最近の利用</span>
              <strong v-if="latestUsage" class="asset-wallet-event-amount">{{'−'+yen(latestUsage.amount)}}</strong>
            </div>
            <div v-if="latestUsage" class="asset-wallet-event-detail">
              <strong class="asset-wallet-card" :title="latestUsage.card">{{latestUsage.card}}</strong>
              <small>{{shortDate(latestUsage.date)}}<span v-if="latestUsage.merchant" :title="latestUsage.merchant"> · {{latestUsage.merchant}}</span></small>
            </div>
            <small v-else class="asset-wallet-event-empty">{{prepaidSummary ? '記録なし' : '—'}}</small>
          </div>
          <div class="asset-wallet-event">
            <div class="asset-wallet-event-top">
              <span class="asset-wallet-event-kind">↗ 最近のチャージ</span>
              <strong v-if="latestCharge" class="asset-wallet-event-amount asset-wallet-plus">{{'+'+yen(latestCharge.amount)}}</strong>
            </div>
            <div v-if="latestCharge" class="asset-wallet-event-detail">
              <strong class="asset-wallet-card" :title="latestCharge.card">{{latestCharge.card}}</strong>
              <small :title="latestCharge.funding_source || ''">{{shortDate(latestCharge.date)}}<span v-if="latestCharge.funding_source"> · {{latestCharge.funding_source}}から</span></small>
            </div>
            <small v-else class="asset-wallet-event-empty">{{prepaidSummary ? '記録なし' : '—'}}</small>
          </div>
        </div>
      </div>
    </section>

    <nav class="balance-view-switch" aria-label="残高の表示切替" role="tablist">
      <button type="button" role="tab" :aria-selected="activeView==='funds'" :class="{selected:activeView==='funds'}" @click="selectView('funds')">投資信託</button>
      <button type="button" role="tab" :aria-selected="activeView==='wallets'" :class="{selected:activeView==='wallets'}" @click="selectView('wallets')">電子マネー</button>
    </nav>

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
.asset-investment,.asset-wallet{box-sizing:border-box;display:flex;flex-direction:column;min-width:0;min-height:123px;padding:12px;border:1px solid var(--line);border-radius:15px;background:var(--card)}
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
.asset-wallet-activity{display:grid;gap:5px;margin-top:8px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--teal) 20%,var(--line))}
.asset-wallet-event{display:grid;gap:2px;min-width:0}
.asset-wallet-event+.asset-wallet-event{padding-top:5px;border-top:1px solid color-mix(in srgb,var(--teal) 10%,var(--line))}
.asset-wallet-event-top{display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0}
.asset-wallet-event-kind{font-size:10px;color:var(--muted);font-weight:750;white-space:nowrap}
.asset-wallet-event-amount{font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:-.015em}
.asset-wallet-event-amount.asset-wallet-plus{color:var(--teal)}
.asset-wallet-event-detail{display:flex;align-items:center;justify-content:space-between;gap:4px;min-width:0}
.asset-wallet-card{min-width:0;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}
.asset-wallet-event-detail small{display:block;min-width:0;max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;font-size:9px;color:var(--muted)}
.asset-wallet-event-empty{font-size:10px;color:var(--muted)}
.asset-investment-foot{display:flex;align-items:center;gap:5px;justify-content:space-between;margin-top:7px;padding-top:5px;border-top:1px solid color-mix(in srgb,var(--blue) 15%,var(--line));font-size:10px;color:var(--muted)}
.asset-investment-foot strong{font-size:10px;color:#18876c;font-variant-numeric:tabular-nums;white-space:nowrap}
.asset-investment-foot .asset-pnl-negative{color:#bf516d}
.asset-investment-foot strong small{font-size:9px;font-weight:650}
.asset-cost-line{display:flex;align-items:center;justify-content:space-between;gap:4px;color:var(--muted);font-size:10px}
.asset-cost-line strong{color:var(--ink);font-size:10px;font-variant-numeric:tabular-nums}
.asset-allocation{display:flex;width:100%;height:5px;border-radius:99px;overflow:hidden;gap:2px;background:var(--line);margin-top:3px}
.asset-allocation>span{height:100%;min-width:0}
.balance-view-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;min-width:0;padding:4px;border-radius:13px;border:1px solid var(--line);background:var(--paper)}
.balance-view-switch button{display:flex;justify-content:center;align-items:center;gap:4px;min-width:0;min-height:43px;padding:8px 3px;border:1px solid transparent;background:transparent;border-radius:10px;color:var(--muted);font-size:12px;font-weight:750;white-space:nowrap;cursor:pointer}
.balance-view-switch button.selected{color:var(--blue-dark);background:var(--card);border-color:color-mix(in srgb,var(--blue) 17%,var(--line));box-shadow:0 1px 5px #0000000a}
.balance-view-switch button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
.balance-view-count{display:inline-grid;place-items:center;min-width:15px;height:15px;padding:0 3px;border-radius:9px;background:color-mix(in srgb,var(--blue) 16%,var(--card));font-size:9px;line-height:1.1}
@media(max-width:370px){.asset-investment,.asset-wallet{padding:10px}.asset-overview-label{gap:4px}.asset-overview-label>span:last-child{font-size:10px}.asset-label-icon{width:24px;height:24px}.asset-investment-value,.asset-wallet-value{font-size:18px}.balance-view-switch button{font-size:11px}}
@media(prefers-reduced-motion:reduce){.pending-chevron{transition:none}}
</style>