<script setup>
import { inject } from 'vue'
// Shared refs and navigation actions remain owned by App.vue.
// This page only renders its own view; links to 明細 call the same parent actions.
const { stats, tab, statsPeriod, month, resetMonth, selectedYear, annualStats, selectedRatioMonth, input, categoryIconPath, categoryLabel, yen, categoryRows, expensePalette, donutSelected, donutPercent, selectDonutSlice, monthlyCategoryPie, annualExpensePie, openPaymentMethodDetails, openCategoryDetails, weekRows, maxWeek, averageDaily, averageDailySummary, yearMonthRows, expenseTrendPoints, expenseTrendLine, expenseTrendArea, incomeTrendPoints, incomeTrendLine, ratioTrendPoints, ratioTrendSegments, incomeTrendMax, highestIncomeMonth, ratioTrendMax, highestRatioMonth, highestSpendMonth, annualAverageSummary, annualIncomeCategories, maxAnnualIncomeCategory, monthlyDayTypeAverages, annualDayTypeAverages, openMonthDetails, selectRatioMonth, selectedRatioMonthRow, selectedRatio, monthLabel, monthlyRatio, annualRatio, pigState, puppyExpression, puppyFallback, pigLabel, ratioLabel } = inject('kakeibo-page-context')

function comparisonRate(comparison) {
  const percent = comparison?.percent
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return '—'
  const rounded = Math.abs(Math.round(percent * 10) / 10)
  if (rounded === 0) return '±0.0%'
  return (percent < 0 ? '−' : '+') + rounded.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
}
function comparisonNote(comparison) {
  const percent = comparison?.percent
  if (!comparison) return '対象期間外'
  if (percent === null || percent === undefined) return '前期の支出なし'
  if (Math.abs(percent) < 0.05) return 'ほぼ同額'
  return percent < 0 ? '支出が減少' : '支出が増加'
}
function comparisonTone(comparison) {
  const percent = comparison?.percent
  if (!Number.isFinite(percent) || Math.abs(percent) < 0.05) return ''
  return percent < 0 ? 'income-text' : 'expense-text'
}
</script>
<template>
<section v-if="statsPeriod === 'month'" class="page-section stats-page">
      <div class="page-heading"><div><h1>統計</h1></div><div class="heading-period"><input type="month" v-model="month" class="month" aria-label="集計月" /><button type="button" class="period-reset" @click="resetMonth" aria-label="今月に戻す" title="今月に戻す">今月</button></div></div>
      <div class="stats-period-tabs" role="tablist" aria-label="集計期間"><button type="button" role="tab" :aria-selected="statsPeriod === 'month'" :class="{ selected: statsPeriod === 'month' }" @click="statsPeriod = 'month'">月次</button><button type="button" role="tab" :aria-selected="statsPeriod === 'year'" :class="{ selected: statsPeriod === 'year' }" @click="statsPeriod = 'year'">年次</button></div>
      <div class="hero-total">
        <span>{{ monthLabel }}の支出合計</span>
        <strong>{{ yen(stats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ stats?.count || 0 }}件の支出記録 · 全{{ stats?.recordCount ?? 0 }}件</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(monthlyRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(monthlyRatio)" aria-label="収支バランスの表情"><img v-if="monthlyRatio !== null && monthlyRatio >= .8" :key="pigState(monthlyRatio)" class="puppy-expression" :src="puppyExpression(monthlyRatio)" :alt="monthlyRatio >= 1 ? '泣いているしろちゃん' : '汗をかくちび毛'" @error="puppyFallback" loading="lazy" /><template v-else><img class="puppy-default-gif" src="/IMG_0986.gif" alt="収支バランスのアニメーション" loading="lazy" /></template></div>
        <div class="piggy-content"><div class="piggy-title">月間の収支バランス</div><div class="piggy-status">{{ pigLabel(monthlyRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (monthlyRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(monthlyRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip"><div><small>月間収入</small><strong class="income-text">＋{{ yen(stats?.income) }}</strong></div><div><small>月間支出</small><strong>−{{ yen(stats?.total) }}</strong></div><div><small>収支差額</small><strong :class="Number(stats?.income || 0) - Number(stats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(stats?.income || 0) - Number(stats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary monthly-transfer-summary"><div><small>月間の資産移動</small><strong>{{ yen(stats?.transferTotal) }}</strong></div><div><small>資産移動件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'month')" aria-label="選択月の資産移動明細を表示">{{ stats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div><div class="period-comparison" :title="'比較期間：' + (stats?.periodComparison?.previousStart || '—') + ' ～ ' + (stats?.periodComparison?.previousEnd || '—')">
          <small>前月同期間比</small>
          <strong :class="comparisonTone(stats?.periodComparison)">{{ comparisonRate(stats?.periodComparison) }}</strong>
          <span class="comparison-note">{{ comparisonNote(stats?.periodComparison) }}</span>
        </div></div>
      <div class="payment-method-stats"><h2>支払方法別</h2><div class="payment-method-stats-grid"><button v-for="method in ['カード・電子決済','現金']" :key="method" type="button" :disabled="!(stats?.paymentMethods || []).some(item => item.method === method && Number(item.count) > 0)" @click="openPaymentMethodDetails(method,'month')"><span>{{method}}</span><strong>{{(stats?.paymentMethods || []).find(item => item.method === method) ? yen((stats?.paymentMethods || []).find(item => item.method === method).amount) : '—'}}</strong><small>{{(stats?.paymentMethods || []).find(item => item.method === method) ? ((stats?.paymentMethods || []).find(item => item.method === method).count + '件 · 明細を見る ›') : '—'}}</small></button></div></div>
      <div class="metric-grid">
        <div class="metric-card day-average-metric" title="休日は土曜・日曜・国民の祝日・振替休日・国民の休日を含みます">
          <span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M7.5 14h3M13.5 14h3M7.5 18h3"/></svg></span>
          <small>日平均支出</small>
          <div class="metric-day-average-list">
            <div class="day-average-row"><span>平日</span><strong>{{ monthlyDayTypeAverages.weekday.average === null ? '—' : yen(monthlyDayTypeAverages.weekday.average) }}</strong></div>
            <div class="day-average-row"><span>休日</span><strong>{{ monthlyDayTypeAverages.holiday.average === null ? '—' : yen(monthlyDayTypeAverages.holiday.average) }}</strong></div>
          </div>
        </div>
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span><small>支出日の平均（{{ averageDailySummary.days }}日）</small><strong>{{ averageDaily === null ? '—' : yen(averageDaily) }}</strong></div>
      </div>
      <div v-if="!stats?.count" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>集計データがありません</strong><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div class="stats-card">
          <div class="section-title"><div><h2>カテゴリ別支出</h2></div></div>
          <div class="pie-chart-layout donut-vertical">
            <div class="category-pie donut-chart" :style="{ background: monthlyCategoryPie }" role="group" :aria-label="'カテゴリ別支出ドーナツグラフ。選択中 ' + (donutSelected('month') ? categoryLabel(donutSelected('month').category) : 'なし') + ' ' + donutPercent('month') + '%'" @click="selectDonutSlice($event, 'month')">
              <div class="donut-center"><span>{{ donutSelected('month') ? categoryLabel(donutSelected('month').category) : 'カテゴリ' }}</span><strong>{{ yen(donutSelected('month')?.amount || 0) }}</strong><small>{{ donutPercent('month') }}%</small></div>
            </div>
            <div class="category-list pie-legend" role="group" aria-label="カテゴリを選択すると明細を表示">
              <button v-for="(c, i) in categoryRows" :key="c.category" type="button" class="pie-legend-row" :class="{ 'donut-category-active': donutSelected('month')?.category === c.category }" @click="openCategoryDetails(c.category, 'expense', 'month')" :aria-label="categoryLabel(c.category) + 'の明細を見る'">
                <i class="pie-legend-dot" :style="{ background: expensePalette[i % expensePalette.length] }"></i><span>{{ categoryLabel(c.category) }}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>週別支出</h2></div></div>
          <div class="daily-list">
            <div v-for="(w, i) in weekRows" :key="w.key" class="daily-row weekly-row">
              <div class="daily-date week-index"><strong>第{{ i + 1 }}</strong><span>週</span></div>
              <div class="daily-bar-wrap"><div class="daily-bar-track"><span :style="{ width: Math.max(2, (w.amount / maxWeek) * 100) + '%' }"></span></div><small>{{ w.label }} · {{ w.days }}日間の支出</small></div>
              <strong class="daily-amount">{{ yen(w.amount) }}</strong>
            </div>
          </div>
        </div>
      </template>
    </section>

    <section v-else class="page-section stats-page annual-page">
      <div class="page-heading"><div><h1>統計</h1></div><label class="heading-year"><input v-model.number="selectedYear" class="topbar-year" type="number" min="1900" max="9999" step="1" inputmode="numeric" aria-label="集計年" /><span>年</span></label></div>
      <div class="stats-period-tabs" role="tablist" aria-label="集計期間"><button type="button" role="tab" :aria-selected="statsPeriod === 'month'" :class="{ selected: statsPeriod === 'month' }" @click="statsPeriod = 'month'">月次</button><button type="button" role="tab" :aria-selected="statsPeriod === 'year'" :class="{ selected: statsPeriod === 'year' }" @click="statsPeriod = 'year'">年次</button></div>
      <div class="hero-total annual-hero">
        <span>{{ selectedYear }}年の支出合計</span><strong>{{ yen(annualStats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ annualStats?.count || 0 }}件の支出記録 · 全{{ annualStats?.recordCount ?? 0 }}件</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(annualRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(annualRatio)" aria-label="収支バランスの表情"><img v-if="annualRatio !== null && annualRatio >= .8" :key="pigState(annualRatio)" class="puppy-expression" :src="puppyExpression(annualRatio)" :alt="annualRatio >= 1 ? '泣いているしろちゃん' : '汗をかくちび毛'" @error="puppyFallback" loading="lazy" /><template v-else><img class="puppy-default-gif" src="/IMG_0986.gif" alt="収支バランスのアニメーション" loading="lazy" /></template></div>
        <div class="piggy-content"><div class="piggy-title">年間の収支バランス</div><div class="piggy-status">{{ pigLabel(annualRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (annualRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(annualRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip annual-income-strip"><div><small>年間収入</small><strong class="income-text">＋{{ yen(annualStats?.income) }}</strong></div><div><small>年間支出</small><strong>−{{ yen(annualStats?.total) }}</strong></div><div><small>年間収支</small><strong :class="Number(annualStats?.income || 0) - Number(annualStats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(annualStats?.income || 0) - Number(annualStats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>年間の資産移動</small><strong>{{ yen(annualStats?.transferTotal) }}</strong></div><div><small>資産移動件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'year')" aria-label="年間の資産移動明細を表示">{{ annualStats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div><div class="period-comparison" :title="'比較期間：' + (annualStats?.periodComparison?.previousStart || '—') + ' ～ ' + (annualStats?.periodComparison?.previousEnd || '—')">
          <small>前年同期間比</small>
          <strong :class="comparisonTone(annualStats?.periodComparison)">{{ comparisonRate(annualStats?.periodComparison) }}</strong>
          <span class="comparison-note">{{ comparisonNote(annualStats?.periodComparison) }}</span>
        </div></div>
      <div class="payment-method-stats"><h2>支払方法別</h2><div class="payment-method-stats-grid"><button v-for="method in ['カード・電子決済','現金']" :key="method" type="button" :disabled="!(annualStats?.paymentMethods || []).some(item => item.method === method && Number(item.count) > 0)" @click="openPaymentMethodDetails(method,'year')"><span>{{method}}</span><strong>{{(annualStats?.paymentMethods || []).find(item => item.method === method) ? yen((annualStats?.paymentMethods || []).find(item => item.method === method).amount) : '—'}}</strong><small>{{(annualStats?.paymentMethods || []).find(item => item.method === method) ? ((annualStats?.paymentMethods || []).find(item => item.method === method).count + '件 · 明細を見る ›') : '—'}}</small></button></div></div>
      <div class="metric-grid">
        <div class="metric-card day-average-metric annual-day-average-metric" title="休日は土曜・日曜・国民の祝日・振替休日・国民の休日を含みます">
          <span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M7.5 14h3M13.5 14h3M7.5 18h3"/></svg></span>
          <small>日平均支出</small>
          <div class="metric-day-average-list">
            <div class="day-average-row"><span>平日</span><strong>{{ annualDayTypeAverages.weekday.average === null ? '—' : yen(annualDayTypeAverages.weekday.average) }}</strong></div>
            <div class="day-average-row"><span>休日</span><strong>{{ annualDayTypeAverages.holiday.average === null ? '—' : yen(annualDayTypeAverages.holiday.average) }}</strong></div>
          </div>
        </div>
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><small>月平均支出（{{ annualAverageSummary.monthCount }}か月）</small><strong>{{ annualAverageSummary.average === null ? '—' : yen(annualAverageSummary.average) }}</strong></div>
      </div>
      <div v-if="!annualStats?.count && !Number(annualStats?.income || 0)" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>この年の記録はありません</strong><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div v-if="annualStats?.count" class="stats-card">
          <div class="section-title"><div><h2>支出の推移</h2></div></div>
          <div class="trend-summary"><strong>{{ yen(highestSpendMonth.amount) }}</strong><span>支出が最も多い月 · {{ highestSpendMonth.amount ? highestSpendMonth.label : 'データなし' }}</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年支出の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polygon v-if="expenseTrendArea" :points="expenseTrendArea" class="expense-chart-area" />
            <polyline :points="expenseTrendLine" class="chart-line expense-chart-line" />
            <circle v-for="point in expenseTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point expense-chart-point clickable-chart-point" aria-hidden="true" pointer-events="none" />
            <circle v-for="point in expenseTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="14" class="chart-point-hit" role="button" tabindex="0" :aria-label="point.label + '支出 ' + yen(point.amount) + '。タップして明細を表示'" @click="openMonthDetails(point, 'expense')" @keydown.enter.prevent="openMonthDetails(point, 'expense')" @keydown.space.prevent="openMonthDetails(point, 'expense')" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" @click="openMonthDetails(item, 'expense')">{{ Number(item.month.slice(5)) }}</button></div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>収入の推移</h2></div></div>
          <div class="trend-summary"><strong>{{ yen(incomeTrendMax) }}</strong><span>収入が最も多い月 · {{ highestIncomeMonth.income ? highestIncomeMonth.label : 'データなし' }}</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年収入の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polyline :points="incomeTrendLine" class="chart-line income-chart-line" />
            <circle v-for="point in incomeTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point income-chart-point clickable-chart-point" aria-hidden="true" pointer-events="none" />
            <circle v-for="point in incomeTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="14" class="chart-point-hit" role="button" tabindex="0" :aria-label="point.label + '収入 ' + yen(point.income) + '。タップして明細を表示'" @click="openMonthDetails(point, 'income')" @keydown.enter.prevent="openMonthDetails(point, 'income')" @keydown.space.prevent="openMonthDetails(point, 'income')" />
          </svg>
<div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" @click="openMonthDetails(item, 'income')">{{ Number(item.month.slice(5)) }}</button></div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>支出割合の推移</h2><p>支出 ÷ 収入 · 破線：80% / 100%</p></div></div>
          <div class="trend-summary"><strong>{{ highestRatioMonth ? Math.round(ratioTrendMax * 100) + '%' : 'データなし' }}</strong><span>支出割合が最も高い月 · {{ highestRatioMonth?.label || 'データなし' }}</span></div>
          <p v-if="ratioTrendMax > 1.5" class="trend-note">150%超は上端に表示</p>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年支出割合の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <line x1="16" y1="64.27" x2="304" y2="64.27" class="chart-reference-line" />
            <line x1="16" y1="53.33" x2="304" y2="53.33" class="chart-reference-line chart-reference-danger" />
            <polyline v-for="(segment,i) in ratioTrendSegments" :key="i" :points="segment" class="chart-line ratio-chart-line" />
            <circle v-for="point in ratioTrendPoints.filter(point => point.ratio !== null)" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point ratio-chart-point clickable-chart-point" :class="{ 'chart-point-selected': selectedRatioMonth === point.month }" aria-hidden="true" pointer-events="none" />
            <circle v-for="point in ratioTrendPoints.filter(point => point.ratio !== null)" :key="point.month" :cx="point.x" :cy="point.y" r="14" class="chart-point-hit" :class="{ 'chart-point-selected': selectedRatioMonth === point.month }" role="button" tabindex="0" :aria-label="point.label + '支出割合 ' + Math.round(point.ratio * 100) + '%。タップして当月の収支を確認'" @click="selectRatioMonth(point)" @keydown.enter.prevent="selectRatioMonth(point)" @keydown.space.prevent="selectRatioMonth(point)" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" :class="{ 'trend-month-selected': selectedRatioMonth === item.month }" @click="selectRatioMonth(item)">{{ Number(item.month.slice(5)) }}</button></div>
          <div v-if="selectedRatioMonthRow" class="income-month-breakdown ratio-month-breakdown">
            <div class="income-breakdown-heading"><div><h3>{{ selectedRatioMonthRow.month.replace('-', '年') }}月の収支</h3><p>支出 ÷ 収入</p></div><strong>{{ selectedRatio === null ? '計算できません' : Math.round(selectedRatio * 100) + '%' }}</strong></div>
            <div class="ratio-detail-amounts"><div><span>当月の収入</span><strong>{{ yen(selectedRatioMonthRow.income) }}</strong></div><div><span>当月の支出</span><strong>{{ yen(selectedRatioMonthRow.amount) }}</strong></div></div>
            <p v-if="selectedRatio === null" class="trend-note">収入なし・割合算出不可</p>
          </div>
          
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年間の収入内訳</h2></div></div>
          <div v-if="annualIncomeCategories.length" class="category-list annual-income-bars">
            <div v-for="(c, i) in annualIncomeCategories" :key="c.category" class="category-row category-row-clickable" role="button" tabindex="0" :aria-expanded="categoryDetail?.period === 'year' && categoryDetail?.type === 'income' && categoryDetail?.category === c.category" @click="openCategoryDetails(c.category, 'income', 'year')" @keydown.enter.prevent="openCategoryDetails(c.category, 'income', 'year')" @keydown.space.prevent="openCategoryDetails(c.category, 'income', 'year')">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(c.category)"/></svg></span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill income-category-fill" :style="{ width: Math.max(2, Number(c.amount) / maxAnnualIncomeCategory * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.income ? Math.round(Number(c.amount) / Number(annualStats.income) * 100) : 0 }}% · タップで明細</small>
            </div>
          </div>
          <p v-else class="trend-note">この年の収入記録はありません。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年間の支出内訳</h2></div></div>
          <div class="pie-chart-layout donut-vertical">
            <div class="category-pie donut-chart" :style="{ background: annualExpensePie }" role="group" :aria-label="'カテゴリ別支出ドーナツグラフ。選択中 ' + (donutSelected('year') ? categoryLabel(donutSelected('year').category) : 'なし') + ' ' + donutPercent('year') + '%'" @click="selectDonutSlice($event, 'year')">
              <div class="donut-center"><span>{{ donutSelected('year') ? categoryLabel(donutSelected('year').category) : 'カテゴリ' }}</span><strong>{{ yen(donutSelected('year')?.amount || 0) }}</strong><small>{{ donutPercent('year') }}%</small></div>
            </div>
            <div class="category-list pie-legend" role="group" aria-label="カテゴリを選択すると明細を表示">
              <button v-for="(c, i) in (annualStats?.byCategory || [])" :key="c.category" type="button" class="pie-legend-row" :class="{ 'donut-category-active': donutSelected('year')?.category === c.category }" @click="openCategoryDetails(c.category, 'expense', 'year')" :aria-label="categoryLabel(c.category) + 'の明細を見る'">
                <i class="pie-legend-dot" :style="{ background: expensePalette[i % expensePalette.length] }"></i><span>{{ categoryLabel(c.category) }}</span>
              </button>
            </div>
          </div>
        </div>
      </template>
    </section>
</template>

<style scoped>
/* Same-card period comparisons: no new rows and no changes to the other metric grids. */
.income-expense-strip > .period-comparison {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  padding: 10px 7px;
  min-width: 0;
}
.period-comparison small {
  font-size: clamp(10px, 2.65vw, 12px);
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.income-expense-strip .period-comparison strong {
  font-size: clamp(13px, 3.5vw, 18px);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.035em;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.period-comparison .comparison-note {
  color: var(--muted);
  font-size: clamp(9px, 2.35vw, 11px);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

/* Compact the two lower metric cards in both monthly and annual statistics.
   Keep the card width, labels and amount font sizes unchanged. */
.stats-page .metric-grid .metric-card {
  padding-top: 10px;
  padding-bottom: 11px;
}
.stats-page .metric-grid .metric-icon {
  margin-bottom: 5px;
}
.stats-page .metric-grid .metric-card small {
  min-height: 0;
}
.stats-page .metric-grid .day-average-metric .metric-day-average-list {
  margin-top: 3px;
  gap: 4px;
}

/* Monthly transfer summary: 3 cards including comparison; lower metric grid remains 2 cards. */
.monthly-transfer-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.day-average-metric .metric-day-average-list {
  display: grid;
  gap: 6px;
  margin-top: 5px;
  min-width: 0;
}
.day-average-metric .day-average-row {
  align-items: center;
}
.day-average-metric .day-average-row strong {
  color: var(--ink);
  font-size: clamp(14px, 4vw, 20px);
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.04em;
  margin-top: 0;
  min-width: 0;
  text-align: right;
  overflow-wrap: anywhere;
}

/* Use the third cell of the existing transfer summary, never a new row. */
.income-expense-strip > .day-type-summary {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  padding: 10px 7px;
  min-width: 0;
}
.day-type-summary small {
  white-space: nowrap;
}
.day-average-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 3px;
  min-width: 0;
  line-height: 1.3;
}
.day-average-row span {
  color: var(--muted);
  font-size: clamp(10px, 2.6vw, 12px);
  flex: 0 0 auto;
}
.income-expense-strip .day-average-row strong {
  color: var(--ink);
  text-align: right;
  font-size: clamp(10px, 2.75vw, 14px);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
</style>
