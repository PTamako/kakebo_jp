          <div class="type-switch" role="group" aria-label="記録の種類">
            <button type="button" :class="{ selected: editingEntry.type === 'expense' }" @click="setEntryType(editingEntry, 'expense')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15m-5-5 5 5 5-5"/><path d="M4 7h16"/></svg></span><span>支出</span></button>
            <button type="button" :class="{ selected: editingEntry.type === 'income' }" @click="setEntryType(editingEntry, 'income')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V5m-5 5 5-5 5 5"/><path d="M4 17h16"/></svg></span><span>収入</span></button>
            <button type="button" :class="{ selected: editingEntry.type === 'transfer' }" @click="setEntryType(editingEntry, 'transfer')"><span class="type-action-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16l-4-4m4 4-4 4M20 17H4l4-4m-4 4 4 4"/></svg></span><span>資産移動</span></button>
          </div>
          <label class="form-field"><span>金額（円）</span><input v-model.number="editingEntry.amount" type="number" min="1" inputmode="numeric" required /></label>
          <div class="field-grid">
            <label class="form-field"><span>日付</span><input v-model="editingEntry.date" type="date" required /></label>
            <label class="form-field"><span>時刻</span><input v-model="editingEntry.time" type="time" /></label>
            <label class="form-field"><span>カテゴリ</span><select v-model="editingEntry.category"><option v-for="c in (editingEntry.type === 'income' ? INCOME_CATEGORIES : editingEntry.type === 'transfer' ? ['投資・資産移動'] : categories)" :key="c" :value="c">{{ categoryLabel(c) }}</option></select></label>
            <label class="form-field"><span>店舗</span><input v-model="editingEntry.merchant" /></label>
            <label class="form-field"><span>支払方法・カード</span><select v-model="editingEntry.paymentSource"><option value="">未設定</option><option v-for="source in paymentSources" :key="source" :value="source">{{source}}</option><option v-if="editingEntry.paymentSource && !paymentSources.includes(editingEntry.paymentSource)" :value="editingEntry.paymentSource">{{editingEntry.paymentSource}}（既存の設定）</option></select></label>
          </div>
          <div v-if="editingEntry.type === 'transfer'" class="field-grid transfer-schedule-fields">
            <label class="form-field"><span>振替先</span><select v-model="editingEntry.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option></select></label>
            <label class="form-field"><span>適用日（この日に残高へ反映）</span><input v-model="editingEntry.transferDate" type="date" required /></label>
          </div>
          <label class="form-field"><span>メモ</span><input v-model="editingEntry.note" /></label>
          <div v-if="editingEntry.type === 'expense'" class="receipt-attachment-field"><span class="receipt-attachment-label">レシート画像（任意）</span><label class="button-secondary receipt-attachment-button">{{ editReceiptImage || receiptImageIds.has(Number(editingEntry.id)) ? '画像を変更する' : 'レシート画像を追加' }}<input type="file" accept="image/*" @change="selectEditReceipt($event)" hidden /></label><span class="receipt-attachment-status">{{ editReceiptImage ? `画像を選択しました：${editReceiptFileName}` : receiptImageIds.has(Number(editingEntry.id)) ? '保存済みの画像があります' : '画像は未選択です' }}</span><button v-if="editReceiptImage" type="button" class="receipt-attachment-clear" @click="editReceiptImage = null; editReceiptFileName = ''">選択を解除</button></div>
          </fieldset>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" :disabled="editSaving" @click="cancelEdit">キャンセル</button><button type="submit" class="button-primary" :disabled="editSaving">{{ editSaving ? '保存中…' : '変更を保存' }}</button></div>
        </form>
      </div>
    </section>

    <section v-else-if="tab === 'stat' && statsPeriod === 'month'" class="page-section stats-page">
      <div class="page-heading"><div><p class="eyebrow">家計の分析</p><h1>統計</h1><p class="heading-subtitle">{{ monthLabel }}の収支を分析</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span></div>
      <div class="stats-period-tabs" role="tablist" aria-label="集計期間"><button type="button" role="tab" :aria-selected="statsPeriod === 'month'" :class="{ selected: statsPeriod === 'month' }" @click="statsPeriod = 'month'">月次</button><button type="button" role="tab" :aria-selected="statsPeriod === 'year'" :class="{ selected: statsPeriod === 'year' }" @click="statsPeriod = 'year'">年次</button></div>
      <div class="hero-total">
        <span>今月の支出合計</span>
        <strong>{{ yen(stats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ stats?.count || 0 }}件の支出記録</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(monthlyRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(monthlyRatio)" aria-label="収支バランスの表情"><img v-if="monthlyRatio !== null && monthlyRatio >= .8" :key="pigState(monthlyRatio)" class="puppy-expression" :src="puppyExpression(monthlyRatio)" :alt="monthlyRatio >= 1 ? '泣いているしろちゃん' : '汗をかくちび毛'" @error="puppyFallback" loading="lazy" /><template v-else><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="しろちゃんのスタンプ" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="ちび毛としろちゃんのスタンプ" loading="lazy" /></template></div>
        <div class="piggy-content"><div class="piggy-title">今月の収支バランス</div><div class="piggy-status">{{ pigLabel(monthlyRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (monthlyRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(monthlyRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip"><div><small>今月の収入</small><strong class="income-text">＋{{ yen(stats?.income) }}</strong></div><div><small>今月の支出</small><strong>−{{ yen(stats?.total) }}</strong></div><div><small>差引残高</small><strong :class="Number(stats?.income || 0) - Number(stats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(stats?.income || 0) - Number(stats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>今月の資産移動</small><strong>{{ yen(stats?.transferTotal) }}</strong></div><div><small>件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'month')" aria-label="今月の資産移動明細を表示">{{ stats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div></div>
      <div class="payment-method-stats"><h2>支払方法別</h2><div class="payment-method-stats-grid"><button v-for="method in ['カード・電子決済','現金']" :key="method" type="button" :disabled="!(stats?.paymentMethods || []).some(item => item.method === method && Number(item.count) > 0)" @click="openPaymentMethodDetails(method,'month')"><span>{{method}}</span><strong>{{(stats?.paymentMethods || []).find(item => item.method === method) ? yen((stats?.paymentMethods || []).find(item => item.method === method).amount) : '—'}}</strong><small>{{(stats?.paymentMethods || []).find(item => item.method === method) ? ((stats?.paymentMethods || []).find(item => item.method === method).count + '件 · 明細を見る ›') : '—'}}</small></button></div></div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><small>支出件数</small><strong>{{ stats?.count || 0 }}<em>件</em></strong></div>
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span><small>1日平均支出（支出があった日）</small><strong>{{ yen(averageDaily) }}</strong></div>
      </div>
      <div v-if="!stats?.count" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>集計データがありません</strong><p>支出を記録すると、ここに内訳が表示されます。</p><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div class="stats-card">
          <div class="section-title"><div><h2>カテゴリ支出</h2><p>何にお金を使ったか確認しましょう</p></div></div>
          <div class="pie-chart-layout donut-vertical">
            <div class="category-pie donut-chart" :style="{ background: monthlyCategoryPie }" role="group" :aria-label="'カテゴリ別支出円環グラフ。選択中 ' + (donutSelected('month') ? categoryLabel(donutSelected('month').category) : 'なし') + ' ' + donutPercent('month') + '%'" @click="selectDonutSlice($event, 'month')">
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
          <div class="section-title"><div><h2>週別支出</h2><p>月曜日から日曜日で集計（最初と最後の週は当月の日付で計算）</p></div></div>
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

    <section v-else-if="tab === 'stat' && statsPeriod === 'year'" class="page-section stats-page annual-page">
      <div class="page-heading"><div><p class="eyebrow">家計の分析</p><h1>統計</h1><p class="heading-subtitle">{{ selectedYear }}年の収支を分析</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V10M10 19V5M16 19v-8M22 19V8"/></svg></span></div>
      <div class="stats-period-tabs" role="tablist" aria-label="集計期間"><button type="button" role="tab" :aria-selected="statsPeriod === 'month'" :class="{ selected: statsPeriod === 'month' }" @click="statsPeriod = 'month'">月次</button><button type="button" role="tab" :aria-selected="statsPeriod === 'year'" :class="{ selected: statsPeriod === 'year' }" @click="statsPeriod = 'year'">年次</button></div>
      <div class="hero-total annual-hero">
        <span>{{ selectedYear }}年の支出合計</span><strong>{{ yen(annualStats?.total) }}</strong>
        <div class="hero-footer"><span class="hero-dot"></span>{{ annualStats?.count || 0 }}件の支出記録</div>
      </div>
      <div class="piggy-card" :class="'piggy-' + pigState(annualRatio)">
        <div class="puppy-pair" :class="'puppy-' + pigState(annualRatio)" aria-label="収支バランスの表情"><img v-if="annualRatio !== null && annualRatio >= .8" :key="pigState(annualRatio)" class="puppy-expression" :src="puppyExpression(annualRatio)" :alt="annualRatio >= 1 ? '泣いているしろちゃん' : '汗をかくちび毛'" @error="puppyFallback" loading="lazy" /><template v-else><img class="puppy-white" src="https://cdn2.cdnstep.com/ZW1T6zYOaVZmvnKF1aHl/0-2.thumb128.png" alt="しろちゃんのスタンプ" loading="lazy" /><img class="puppy-jimao" src="https://cdn2.cdnstep.com/8A5BxvcpUvyc8nO7YV3A/1-1.thumb128.png" alt="ちび毛としろちゃんのスタンプ" loading="lazy" /></template></div>
        <div class="piggy-content"><div class="piggy-title">年間の収支バランス</div><div class="piggy-status">{{ pigLabel(annualRatio) }}</div><div class="piggy-track"><span :style="{ width: Math.min(100, (annualRatio || 0) * 100) + '%' }"></span></div><div class="piggy-numbers"><span>支出／収入</span><strong>{{ ratioLabel(annualRatio) }}</strong></div></div>
      </div>
      <div class="income-expense-strip annual-income-strip"><div><small>年間収入</small><strong class="income-text">＋{{ yen(annualStats?.income) }}</strong></div><div><small>年間支出</small><strong>−{{ yen(annualStats?.total) }}</strong></div><div><small>年間収支</small><strong :class="Number(annualStats?.income || 0) - Number(annualStats?.total || 0) < 0 ? 'expense-text' : 'income-text'">{{ yen(Number(annualStats?.income || 0) - Number(annualStats?.total || 0)) }}</strong></div></div>
      <div class="income-expense-strip transfer-summary"><div><small>年間の資産移動</small><strong>{{ yen(annualStats?.transferTotal) }}</strong></div><div><small>件数</small><button type="button" class="transfer-count-link" @click="openCategoryDetails('投資・資産移動', 'transfer', 'year')" aria-label="年間の資産移動明細を表示">{{ annualStats?.transferCount || 0 }}件 <span aria-hidden="true">›</span></button></div></div>
      <div class="payment-method-stats"><h2>支払方法別</h2><div class="payment-method-stats-grid"><button v-for="method in ['カード・電子決済','現金']" :key="method" type="button" :disabled="!(annualStats?.paymentMethods || []).some(item => item.method === method && Number(item.count) > 0)" @click="openPaymentMethodDetails(method,'year')"><span>{{method}}</span><strong>{{(annualStats?.paymentMethods || []).find(item => item.method === method) ? yen((annualStats?.paymentMethods || []).find(item => item.method === method).amount) : '—'}}</strong><small>{{(annualStats?.paymentMethods || []).find(item => item.method === method) ? ((annualStats?.paymentMethods || []).find(item => item.method === method).count + '件 · 明細を見る ›') : '—'}}</small></button></div></div>
      <div class="metric-grid">
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><small>月平均支出（12か月で計算）</small><strong>{{ yen(annualAverage) }}</strong></div>
        <div class="metric-card"><span class="metric-icon"><svg class="ui-line-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg></span><small>支出が最も多い月</small><strong>{{ highestSpendMonth.amount ? highestSpendMonth.label : 'データなし' }}</strong><em v-if="highestSpendMonth.amount">{{ yen(highestSpendMonth.amount) }}</em></div>
      </div>
      <div v-if="!annualStats?.count && !Number(annualStats?.income || 0)" class="empty-state stats-empty"><span class="empty-icon">◷</span><strong>この年の記録はありません</strong><p>別の年を選ぶか、記録を追加してください。</p><button class="button-primary" @click="tab = 'add'">入力</button></div>
      <template v-else>
        <div v-if="annualStats?.count" class="stats-card">
          <div class="section-title"><div><h2>支出の推移</h2><p>{{ selectedYear }}年1月〜12月</p></div></div>
          <div class="trend-summary"><strong>{{ yen(highestSpendMonth.amount) }}</strong><span>月間最高支出 · {{ highestSpendMonth.amount ? highestSpendMonth.label : 'データなし' }}</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年支出の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polygon v-if="expenseTrendArea" :points="expenseTrendArea" class="expense-chart-area" />
            <polyline :points="expenseTrendLine" class="chart-line expense-chart-line" />
            <circle v-for="point in expenseTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point expense-chart-point clickable-chart-point" role="button" tabindex="0" :aria-label="point.label + '支出 ' + yen(point.amount) + '。タップして明細を表示'" @click="openMonthDetails(point, 'expense')" @keydown.enter.prevent="openMonthDetails(point, 'expense')" @keydown.space.prevent="openMonthDetails(point, 'expense')" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" @click="openMonthDetails(item, 'expense')">{{ Number(item.month.slice(5)) }}</button></div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>収入の推移</h2><p>月ごとの年間収入の推移</p></div></div>
          <div class="trend-summary"><strong>{{ yen(incomeTrendMax) }}</strong><span>月間最高収入</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年収入の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <polyline :points="incomeTrendLine" class="chart-line income-chart-line" />
            <circle v-for="point in incomeTrendPoints" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point income-chart-point clickable-chart-point" role="button" tabindex="0" :aria-label="point.label + '収入 ' + yen(point.income) + '。タップして明細を表示'" @click="openMonthDetails(point, 'income')" @keydown.enter.prevent="openMonthDetails(point, 'income')" @keydown.space.prevent="openMonthDetails(point, 'income')" />
          </svg>
<div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" @click="openMonthDetails(item, 'income')">{{ Number(item.month.slice(5)) }}</button></div>
        </div>
        <div class="stats-card trend-card">
          <div class="section-title"><div><h2>支出割合の推移</h2><p>支出 ÷ 収入。破線は80%と100%の目安</p></div></div>
          <div class="trend-summary"><strong>{{ ratioTrendMax ? Math.round(ratioTrendMax * 100) + '%' : 'データなし' }}</strong><span>月間最高の支出割合</span></div>
          <svg class="trend-chart" viewBox="0 0 320 132" role="img" :aria-label="selectedYear + '年支出割合の推移'">
            <line v-for="y in [26, 67, 108]" :key="y" x1="16" :y1="y" x2="304" :y2="y" class="chart-grid-line" />
            <line x1="16" y1="64.27" x2="304" y2="64.27" class="chart-reference-line" />
            <line x1="16" y1="53.33" x2="304" y2="53.33" class="chart-reference-line chart-reference-danger" />
            <polyline v-if="ratioTrendLine" :points="ratioTrendLine" class="chart-line ratio-chart-line" />
            <circle v-for="point in ratioTrendPoints.filter(point => point.ratio !== null)" :key="point.month" :cx="point.x" :cy="point.y" r="4" class="chart-point ratio-chart-point clickable-chart-point" :class="{ 'chart-point-selected': selectedRatioMonth === point.month }" role="button" tabindex="0" :aria-label="point.label + '支出割合 ' + Math.round(point.ratio * 100) + '%。タップして当月の収支を確認'" @click="selectRatioMonth(point)" @keydown.enter.prevent="selectRatioMonth(point)" @keydown.space.prevent="selectRatioMonth(point)" />
          </svg>
          <div class="trend-month-labels"><button v-for="item in yearMonthRows" :key="item.month" type="button" :class="{ 'trend-month-selected': selectedRatioMonth === item.month }" @click="selectRatioMonth(item)">{{ Number(item.month.slice(5)) }}</button></div>
          <div v-if="selectedRatioMonthRow" class="income-month-breakdown ratio-month-breakdown">
            <div class="income-breakdown-heading"><div><h3>{{ selectedRatioMonthRow.month.replace('-', '年') }}月の収支</h3><p>支出 ÷ 収入</p></div><strong>{{ selectedRatio === null ? '計算できません' : Math.round(selectedRatio * 100) + '%' }}</strong></div>
            <div class="ratio-detail-amounts"><div><span>当月の収入</span><strong>{{ yen(selectedRatioMonthRow.income) }}</strong></div><div><span>当月の支出</span><strong>{{ yen(selectedRatioMonthRow.amount) }}</strong></div></div>
            <p v-if="selectedRatio === null" class="trend-note">この月は収入記録がないため、支出割合を計算できません。</p>
          </div>
          <p class="trend-note">収入がない月は割合を計算しません。縦軸は0〜150%で、150%を超える点は上限に表示されます。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度カテゴリ収入</h2><p>年間合計の多い順</p></div></div>
          <div v-if="annualIncomeCategories.length" class="category-list annual-income-bars">
            <div v-for="(c, i) in annualIncomeCategories" :key="c.category" class="category-row category-row-clickable" role="button" tabindex="0" :aria-expanded="categoryDetail?.period === 'year' && categoryDetail?.type === 'income' && categoryDetail?.category === c.category" @click="openCategoryDetails(c.category, 'income', 'year')" @keydown.enter.prevent="openCategoryDetails(c.category, 'income', 'year')" @keydown.space.prevent="openCategoryDetails(c.category, 'income', 'year')">
              <div class="category-row-top"><span class="category-name"><span class="category-swatch category-emoji"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(c.category)"/></svg></span>{{ categoryLabel(c.category) }}</span><strong>{{ yen(c.amount) }}</strong></div>
              <div class="bar-track"><span class="bar-fill income-category-fill" :style="{ width: Math.max(2, Number(c.amount) / maxAnnualIncomeCategory * 100) + '%' }"></span></div>
              <small class="category-share">{{ annualStats?.income ? Math.round(Number(c.amount) / Number(annualStats.income) * 100) : 0 }}%（年間収入に占める割合） · タップして明細</small>
            </div>
          </div>
          <p v-else class="trend-note">この年の収入記録はありません。</p>
        </div>
        <div class="stats-card">
          <div class="section-title"><div><h2>年度カテゴリ支出</h2><p>年間合計の多い順</p></div></div>
          <div class="pie-chart-layout donut-vertical">
            <div class="category-pie donut-chart" :style="{ background: annualExpensePie }" role="group" :aria-label="'カテゴリ別支出円環グラフ。選択中 ' + (donutSelected('year') ? categoryLabel(donutSelected('year').category) : 'なし') + ' ' + donutPercent('year') + '%'" @click="selectDonutSlice($event, 'year')">
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


    <section v-else-if="tab === 'investments'" class="page-section">
      <article class="panel pending-transfer-panel">
        <div class="pending-transfer-heading"><h2>振替予定</h2><button class="pending-refresh" :disabled="transferLoading" @click="loadTransfers" aria-label="振替予定を更新" title="更新">↻ 更新</button></div>
        <div v-if="transferLoading" class="pending-transfer-empty">読み込み中…</div>
        <div v-else-if="!pendingTransfers.length" class="pending-transfer-empty">確認が必要な振替はありません</div>
        <div v-else class="pending-transfer-list">
          <div v-for="item in pendingTransfers" :key="item.id" class="pending-transfer-row">
            <div class="pending-transfer-main"><strong>{{ item.merchant || item.note || 'SBI証券への資産移動' }}</strong><span>予定日 {{ item.transfer_date || item.date }} · ¥{{ Number(item.amount || 0).toLocaleString('ja-JP') }}</span></div>
            <div class="pending-transfer-actions"><span class="pending-transfer-status" :class="transferStatusClass(item)">{{ transferStatus(item) }}</span><button v-if="Number(item.transfer_applied) === 1" class="pending-delete" :disabled="transferActionId !== null" aria-label="削除" title="削除" @click="deleteTransfer(item)">×</button><button v-else-if="transferDue(item)" class="pending-retry" :disabled="transferActionId !== null" @click="retryTransfer(item)">手動処理</button></div>
          </div>
        </div>
      </article>
      <div class="page-heading"><div><p class="eyebrow">資産の記録</p><h1>資産・投資</h1><p class="heading-subtitle">積立額は明細から計算し、評価額・損益は手動管理します</p></div><span class="heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 10h18M15 15h3"/></svg></span></div>
      <article v-for="item in investmentItems" :key="item.id" class="panel investment-card">
        <div class="investment-card-heading"><div><h2>{{ item.label }}</h2><p>{{ item.detail }}</p></div><span class="investment-unit">{{ item.unit }}</span></div>
        <div class="investment-principal"><small>家計簿から確認できる積立累計</small><strong>{{ yen(investments[item.id].investedTotal) }}</strong><small>振替先を設定した登録済み明細から集計</small></div>
        <label class="form-field"><span>現在の評価額（{{ item.unit }}）</span><input v-model.number="investments[item.id].currentValue" type="number" min="0" step="1" inputmode="numeric" placeholder="現在の評価額" /></label>
        <label class="form-field"><span>評価損益（{{ item.unit }}）</span><input v-model.number="investments[item.id].pnl" type="number" step="1" inputmode="numeric" placeholder="例：-1339" /></label>
        <div class="investment-summary">
          <div><small>評価損益</small><strong :class="Number(investments[item.id].pnl) > 0 ? 'investment-positive' : Number(investments[item.id].pnl) < 0 ? 'investment-negative' : ''">{{ investments[item.id].pnl === null || investments[item.id].pnl === '' ? '—' : (Number(investments[item.id].pnl) > 0 ? '+' : '') + Number(investments[item.id].pnl).toLocaleString('ja-JP') + ' ' + item.unit }}</strong></div>
          <div><small>損益率</small><strong :class="investmentReturn(item) > 0 ? 'investment-positive' : investmentReturn(item) < 0 ? 'investment-negative' : ''">{{ investmentReturn(item) === null ? '—' : (investmentReturn(item) > 0 ? '+' : '') + investmentReturn(item).toFixed(2) + '%' }}</strong></div>
        </div>
        <p class="investment-updated">最終更新：{{ investments[item.id].updatedAt ? new Date(investments[item.id].updatedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未更新' }}</p>
        <button class="button-primary investment-save" :disabled="investmentBusy" @click="saveInvestment(item)">最新データを保存</button>
      </article>
    </section>

    <FinanceTools v-if="tab === 'finance'" :api="api" :categories="categories" :payment-sources="paymentSources" @update-payment-sources="updatePaymentSources" @open-duplicate="openDuplicateDate" @ledger-updated="load(); loadYear()" />
    <nav class="bottom-nav" aria-label="メインメニュー">
      <button :class="{ active: tab === 'add' }" @click="tab = 'add'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span><span>入力</span></button>
      <button :class="{ active: tab === 'list' }" @click="tab = 'list'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><span>明細</span></button>
      <button :class="{ active: tab === 'stat' }" @click="tab = 'stat'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4.5 19.5h15"/><rect x="6" y="11" width="3.2" height="6.5" rx="1"/><rect x="10.4" y="7.5" width="3.2" height="10" rx="1"/><rect x="14.8" y="4.5" width="3.2" height="13" rx="1"/></svg></span><span>統計</span></button>
      <button :class="{ active: tab === 'investments' }" @click="tab = 'investments'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M7 4.5h10M15.5 14.5h2"/></svg></span><span>資産・投資</span></button>
      <button :class="{ active: tab === 'finance' }" @click="tab = 'finance'"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg></span><span>管理</span></button>
    </nav>
  </main>
</template>

<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","PingFang SC",system-ui,sans-serif;color:#473d46;background:#fff8f5;font-synthesis:none;text-rendering:optimizeLegibility;--ink:#473d46;--muted:#8c7e88;--line:#f3e5e8;--blue:#d96f91;--blue-dark:#bd5376;--paper:#fff8f5;--card:#fff;--teal:#68a995}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse at 12% 0%,#fff0e8 0,transparent 32%),radial-gradient(ellipse at 95% 18%,#fff0f5 0,transparent 30%),var(--paper);color:var(--ink);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit}
button{cursor:pointer;-webkit-tap-highlight-color:transparent}
button:disabled{opacity:.45;cursor:not-allowed}
main{width:min(100%,560px);min-height:100dvh;margin:0 auto;padding:calc(12px + env(safe-area-inset-top)) 18px calc(104px + env(safe-area-inset-bottom));background:var(--paper);color:var(--ink);transition:background .2s,color .2s}
/* Keep long pages, especially annual statistics, vertically scrollable on iOS/PWA. */
html,body,#app{min-height:100%;height:auto;overflow-y:auto;-webkit-overflow-scrolling:touch}
main{height:auto;overflow:visible}
.annual-page{display:block;min-height:0;overflow:visible;padding-bottom:18px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 24px}
.brand{display:flex;align-items:center;gap:10px}.brand-mark{display:grid;place-items:center;width:58px;height:42px;border-radius:15px;background:linear-gradient(135deg,#fff0e6,#ffeaf1);color:var(--blue);font-size:20px;font-weight:800;letter-spacing:-7px;padding-right:7px;box-shadow:inset 0 0 0 1px #f8dce4}.brand strong{display:block;font-size:17px;letter-spacing:.02em}.brand-heart{color:#e985a2;font-size:15px}.brand small{display:block;color:var(--muted);font-size:11px;margin-top:1px}
input,select,textarea{width:100%;min-width:0;border:1px solid #e0e6ed;border-radius:11px;background:#fff;color:var(--ink);padding:11px 12px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:#8da9e8;box-shadow:0 0 0 3px #315fbd18}
.month{width:142px;padding:9px 8px;font-size:12px;font-weight:650;background:#fff}
.page-section{animation:appear .18s ease-out}@keyframes appear{from{opacity:.6;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.page-heading{display:flex;align-items:center;justify-content:space-between;margin:0 0 18px}.today-date{font-size:12px;font-weight:750;color:var(--muted);white-space:nowrap;padding:8px 0 8px 8px}.topbar-period{display:flex;align-items:center;gap:5px}.period-reset{flex:none;padding:8px 9px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:11px;font-weight:750;white-space:nowrap}.topbar-year-wrap{display:flex;align-items:center;gap:3px;padding:0 8px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--muted);font-size:12px;font-weight:750}.topbar-year{width:58px;min-width:0;padding:9px 0;border:0;background:transparent;font-size:13px;font-weight:750;text-align:right;appearance:textfield;-moz-appearance:textfield}.topbar-year::-webkit-inner-spin-button,.topbar-year::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}.eyebrow{font-size:10px;font-weight:800;letter-spacing:.15em;color:var(--blue);margin:0 0 4px}.page-heading h1{font-size:27px;line-height:1.2;letter-spacing:-.045em;margin:0;font-weight:800}.heading-subtitle{font-size:12px;color:var(--muted);margin:7px 0 0}.heading-icon{display:grid;place-items:center;width:43px;height:43px;border-radius:15px;background:#e9efff;color:var(--blue);font-size:25px;font-weight:500}
.panel,.entry-card,.stats-card,.metric-card{background:var(--card);border:1px solid #edf0f4;border-radius:18px;box-shadow:0 5px 20px #24354b08}
.capture-panel{padding:16px}.field-label{display:block;font-size:13px;font-weight:750;margin-bottom:9px}
textarea{resize:vertical;min-height:116px;line-height:1.65;font-size:14px;background:#fbfcfe;border-color:#e8edf3}
.action-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}
.button-primary,.button-secondary{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:45px;border-radius:12px;padding:11px 14px;font-size:13px;font-weight:750;border:1px solid transparent}
.button-primary{background:var(--blue);color:#fff;box-shadow:0 4px 9px #315fbd20}.button-primary:active{background:var(--blue-dark)}
.button-secondary{background:#f1f5ff;color:var(--blue);border-color:#e2eaff}
.upload-button{display:flex;cursor:pointer}
.microcopy{font-size:11px;color:#929cab;margin:12px 0 0}.manage-category{min-height:38px;padding:8px 10px;font-size:12px;white-space:nowrap}.bind-rule{display:flex;align-items:flex-start;gap:8px;padding:10px 11px;border:1px solid #dce7ff;background:#f7f9ff;border-radius:11px;color:#315fbd;font-size:12px}.bind-rule input{width:17px;height:17px;flex:none;margin:1px 0 0;accent-color:#315fbd}.bind-rule span{flex:1}.progress-wrap{display:flex;align-items:center;gap:8px;margin-top:12px;color:var(--blue);font-size:12px}.spinner{width:14px;height:14px;border:2px solid #dce6ff;border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.toast{position:sticky;top:calc(8px + env(safe-area-inset-top));z-index:5;margin:0 0 14px;padding:11px 14px;background:#202b37;color:white;border-radius:12px;font-size:13px;box-shadow:0 5px 16px #17253820}
.draft-heading{display:flex;align-items:center;justify-content:space-between;margin:24px 2px 10px}.draft-heading h2{font-size:17px;margin:0}.draft-heading p{font-size:12px;color:var(--muted);margin:3px 0 0}.count-pill{background:#e7f5f2;color:#11796f;padding:6px 10px;border-radius:99px;font-size:12px;font-weight:800}
.entry-card{padding:15px;margin-top:11px;display:grid;gap:13px}.entry-card-heading{display:flex;align-items:center;gap:9px;min-width:0}.entry-card-heading strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:14px}.entry-number{display:grid;place-items:center;flex:none;width:30px;height:30px;background:#eef2ff;color:var(--blue);border-radius:10px;font-size:11px;font-weight:800}
.icon-button{border:0;background:transparent;color:#9ba5b2;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:23px;padding:0;flex:none}.icon-button:active{background:#f1f3f6}.form-field{display:grid;gap:6px;min-width:0}.form-field>span{font-size:11px;color:#7c8795;font-weight:650}.form-field input,.form-field select{font-size:13px;padding:10px;border-radius:10px}.amount-warning{margin:-4px 0 2px;color:#b45309;font-size:12px;font-weight:700}.amount-input-wrap{display:flex;align-items:center;gap:8px;padding:0 12px;border:1px solid #e0e6ed;border-radius:12px;background:#fbfcff}.amount-input-wrap>span{font-size:18px;color:var(--blue);font-weight:800}.amount-input-wrap input{border:0;box-shadow:none;background:transparent;padding:11px 0;font-size:26px;font-weight:800;letter-spacing:-.04em;color:var(--ink)}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.batch-actions{display:grid;grid-template-columns:.8fr 1.2fr;gap:9px;margin-top:14px}.batch-actions button{width:100%}
.summary-strip{display:flex;justify-content:space-between;align-items:center;margin:-3px 0 12px;color:var(--muted);font-size:12px}.summary-strip strong{color:#536174;font-weight:700}
.month-calendar{margin:0 0 14px;padding:14px 12px 12px;background:#fff;border:1px solid #f3e2e7;border-radius:18px;box-shadow:0 5px 20px #a75d740a}.calendar-heading{display:flex;align-items:center;justify-content:space-between;margin:0 3px 12px}.calendar-heading strong{font-size:14px;font-weight:850}.calendar-reset{border:0;background:#fff0f4;color:#b95478;border-radius:9px;padding:6px 9px;font-size:11px;font-weight:750}.calendar-weekdays,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}.calendar-weekdays{margin-bottom:5px}.calendar-weekdays span{text-align:center;font-size:10px;color:#9b8790;font-weight:750;padding:3px 0}.calendar-day{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:4px;min-width:0;min-height:54px;padding:6px 1px 4px;border:1px solid transparent;border-radius:10px;background:#fff9fa;color:#55464b}.calendar-day:disabled{background:transparent}.calendar-day-number{font-size:12px;font-weight:750;line-height:1.1}.calendar-day small{display:block;max-width:100%;font-size:8px;line-height:1.1;color:#bd6b88;font-variant-numeric:tabular-nums;white-space:nowrap;letter-spacing:-.04em}.calendar-day .calendar-no-spend{color:#d7cbd0}.calendar-day.calendar-has-spend{background:#fff0f4;border-color:#f8dce5}.calendar-day.calendar-selected{background:#d96f91;border-color:#d96f91;color:#fff;box-shadow:0 3px 8px #d96f9128}.calendar-day.calendar-selected small{color:#fff}.calendar-day:active:not(:disabled){transform:scale(.96)}.ledger{list-style:none;margin:0;padding:3px 14px;background:#fff;border:1px solid #edf0f4;border-radius:17px;box-shadow:0 5px 20px #24354b08}.ledger li{position:relative;overflow:hidden;border-bottom:1px solid #eff2f6;min-width:0}.ledger li:last-child{border-bottom:0}.ledger-row-content{position:relative;z-index:1;display:flex;align-items:center;gap:11px;padding:13px 0;background:#fff;min-width:0;transition:transform .2s ease;cursor:pointer;touch-action:pan-y}.ledger li.swiped-open .ledger-row-content{transform:translateX(-68px)}.swipe-delete{position:absolute;top:0;right:0;bottom:0;width:64px;border:0;border-radius:10px;background:#e86e86;color:#fff;font-size:12px;font-weight:800;letter-spacing:.02em}.filtered-empty{margin-bottom:10px}.category-dot{display:grid;place-items:center;flex:none;width:39px;height:39px;border-radius:13px;background:#edf2ff;color:#315fbd;font-size:14px;font-weight:800}.cat-2{background:#e8f7f2;color:#16836f}.cat-3{background:#fff2df;color:#b87518}.cat-4{background:#f3eaff;color:#8755bd}.cat-5{background:#e8f5fb;color:#267da0}.cat-6{background:#ffecef;color:#c45569}.cat-7{background:#fff0e5;color:#bd6c39}.cat-8{background:#fcebdc;color:#a65b2a}.cat-9{background:#eef1f5;color:#667384}.ledger-info{min-width:0;flex:1}.ledger-info b{display:block;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ledger-info small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.ledger-amount{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}.delete-button{font-size:20px;width:24px}
.hero-total{position:relative;overflow:hidden;background:linear-gradient(130deg,#315fbd 0%,#284d9b 100%);border-radius:21px;padding:22px 21px 18px;color:#fff;box-shadow:0 10px 24px #315fbd24}.hero-total:after{content:"";position:absolute;width:155px;height:155px;border:1px solid #ffffff1c;border-radius:50%;right:-38px;top:-74px;box-shadow:0 0 0 22px #ffffff08,0 0 0 45px #ffffff06}.hero-total>span{display:block;font-size:12px;color:#dbe5ff}.hero-total>strong{display:block;font-size:clamp(29px,8vw,39px);line-height:1.25;letter-spacing:-.045em;margin:8px 0 15px;font-variant-numeric:tabular-nums}.hero-footer{display:flex;align-items:center;gap:7px;font-size:11px;color:#dbe5ff}.hero-dot{width:6px;height:6px;border-radius:50%;background:#76e0c1}
.metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:11px 0 19px}.metric-card{padding:14px 14px 15px;min-width:0}.metric-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:#edf2ff;color:var(--blue);font-size:17px;margin-bottom:10px}.metric-card small{display:block;color:var(--muted);font-size:11px;line-height:1.4;min-height:29px}.metric-card strong{display:block;font-size:20px;letter-spacing:-.04em;margin-top:4px;overflow-wrap:anywhere}.metric-card em{font-size:11px;font-style:normal;font-weight:600;color:var(--muted);margin-left:3px}
.stats-card{padding:18px 16px;margin-top:12px}.section-title{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.section-title h2{font-size:16px;margin:0;font-weight:800}.section-title p{font-size:11px;color:var(--muted);margin:4px 0 0}.section-mark{font-size:10px;font-weight:800;color:#a3adbb;letter-spacing:.1em;padding-top:3px}
.category-list{display:grid;gap:17px}.category-row-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}.category-name{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700}.category-row-top>strong{font-size:12px;font-weight:800;font-variant-numeric:tabular-nums}.category-swatch{width:9px;height:9px;border-radius:3px;background:#5279d1}.swatch-1{background:#26a69a}.swatch-2{background:#e5a34d}.swatch-3{background:#9b78d0}.swatch-4{background:#52a5c9}.swatch-5{background:#e07886}
.bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.bar-fill{display:block;height:100%;background:#5279d1;border-radius:99px;transition:width .25s}.income-category-fill{background:linear-gradient(90deg,#278b73,#78c4aa)}.expense-category-fill{background:linear-gradient(90deg,#d96f91,#efa6b9)}.fill-1{background:#26a69a}.fill-2{background:#e5a34d}.fill-3{background:#9b78d0}.fill-4{background:#52a5c9}.fill-5{background:#e07886}.category-share{display:block;text-align:right;color:#9aa4b1;font-size:10px;margin-top:4px}
.daily-list{display:grid;gap:13px}.daily-row{display:flex;align-items:center;gap:11px}.daily-date{display:flex;align-items:baseline;justify-content:center;gap:1px;width:34px;flex:none}.daily-date strong{font-size:16px}.daily-date span{font-size:10px;color:var(--muted)}.daily-date.week-index{width:48px;gap:0;white-space:nowrap}.daily-date.week-index strong{font-size:12px}.daily-bar-wrap{flex:1;min-width:0}.daily-bar-track{height:7px;background:#f0f3f7;border-radius:99px;overflow:hidden}.daily-bar-track span{display:block;height:100%;background:linear-gradient(90deg,#4f7bd7,#6b9de9);border-radius:99px}.daily-bar-wrap small{display:block;font-size:10px;color:#9aa4b1;margin-top:3px}.daily-amount{font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.empty-state{display:flex;align-items:center;flex-direction:column;text-align:center;padding:34px 18px;background:#fff;border:1px dashed #dce3ec;border-radius:18px}.empty-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:16px;background:#edf2ff;color:var(--blue);font-size:23px;margin-bottom:12px}.empty-state strong{font-size:14px}.empty-state p{font-size:12px;color:var(--muted);margin:6px 0 17px}.empty-state button{min-width:140px}.stats-empty{margin-top:8px}
.bottom-nav{position:fixed;z-index:10;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(calc(100% - 28px),460px);display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;padding:6px;background:#ffffffed;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border:1px solid #e8edf2;border-radius:19px;box-shadow:0 8px 30px #20324b18}.bottom-nav button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:0;min-height:56px;border:1px solid transparent;background:transparent;color:var(--muted);padding:6px 2px;border-radius:14px;font-size:10px;line-height:1.2;font-weight:750;white-space:nowrap;-webkit-tap-highlight-color:transparent;transition:background .18s ease,color .18s ease,transform .18s ease,border-color .18s ease}.bottom-nav button:active{transform:scale(.96)}.bottom-nav button.active{background:color-mix(in srgb,var(--blue) 16%,white);border-color:color-mix(in srgb,var(--blue) 30%,white);color:var(--blue-dark);box-shadow:0 3px 9px color-mix(in srgb,var(--blue) 12%,transparent)}.nav-icon{display:grid;place-items:center;width:29px;height:29px;border-radius:10px;color:currentColor;transition:background .18s ease,transform .18s ease}.nav-icon svg{display:block;width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.bottom-nav button.active .nav-icon{background:color-mix(in srgb,var(--blue) 12%,white);transform:translateY(-1px)}.bottom-nav button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}

.pending-transfer-panel{padding:10px 13px;margin-bottom:12px}.pending-transfer-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.pending-transfer-heading h2{font-size:14px;margin:0}.pending-refresh{padding:4px 7px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:11px;font-weight:700}.pending-refresh:active{background:var(--paper)}.pending-transfer-list{display:grid;gap:5px}.pending-transfer-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--line)}.pending-transfer-main{display:grid;gap:4px;min-width:0}.pending-transfer-main strong{font-size:12px;overflow-wrap:anywhere}.pending-transfer-main span{font-size:11px;color:var(--muted)}.pending-transfer-actions{display:flex;align-items:center;gap:7px;flex:none}.pending-delete{width:29px;height:29px;border:1px solid var(--line);border-radius:50%;background:var(--card);color:var(--muted);font-size:20px;line-height:1;display:grid;place-items:center}.pending-retry{padding:7px 9px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:800;white-space:nowrap}.pending-transfer-status{flex:none;padding:5px 8px;border-radius:99px;font-size:10px;font-weight:800}.transfer-done{background:#e5f6ed;color:#24815b}.transfer-waiting{background:#fff3d7;color:#9b7620}.pending-transfer-empty{padding:12px 0;color:var(--muted);font-size:12px}
.investment-note{padding:12px 14px;margin:-5px 0 14px;border-radius:13px;background:var(--card);border:1px solid var(--line);font-size:12px;line-height:1.7;color:var(--muted)}
.investment-card{padding:16px;margin-bottom:13px}
.investment-card-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px}
.investment-card-heading h2{margin:0;font-size:17px}.investment-card-heading p{margin:3px 0 0;color:var(--muted);font-size:12px}
.investment-unit{padding:5px 10px;border-radius:9px;background:var(--paper);font-size:12px;font-weight:800;color:var(--blue)}
.investment-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:13px;padding:12px;background:var(--paper);border-radius:12px}
.investment-summary div{display:grid;gap:4px}.investment-summary small{font-size:11px;color:var(--muted)}.investment-summary strong{font-size:17px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.transfer-amount{color:var(--blue)}
.investment-positive{color:#25845f}.investment-negative{color:#c44f69}.investment-updated{margin:11px 0 13px;color:var(--muted);font-size:11px}
.investment-save{width:100%}.investment-footnote{font-size:11px;line-height:1.7;color:var(--muted);padding:0 4px}
.year-picker{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-4px 0 13px;padding:10px 13px;background:#fff;border:1px solid #edf0f4;border-radius:13px;font-size:12px;font-weight:700;color:var(--muted)}.year-picker select{width:125px;padding:8px 10px;font-size:13px;font-weight:750;color:var(--ink)}.annual-hero{margin-bottom:0}.year-month-list{display:grid;gap:15px}.year-month-row{display:grid;grid-template-columns:36px minmax(40px,1fr) minmax(78px,auto);align-items:center;gap:10px}.year-month-label{font-size:12px;font-weight:700;color:#647184}.year-month-track{height:8px;border-radius:99px;background:#f0f3f7;overflow:hidden}.year-month-track span{display:block;height:100%;border-radius:99px;background:var(--blue);transition:width .2s}.year-month-row strong{text-align:right;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.category-share{display:block;color:#9aa4b1;font-size:10px;margin-top:5px}
.entry-mode-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr);gap:8px;margin:-5px 0 12px}.manual-add-button{display:flex;align-items:center;justify-content:center;gap:5px;min-width:0;min-height:40px;padding:4px 4px;border:1px solid #e8e8ee;border-radius:11px;background:rgba(255,255,255,.88);color:#454b57;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 5px rgba(40,45,60,.04);transition:transform .15s,box-shadow .15s}.manual-add-button:active{transform:scale(.97);box-shadow:none}.entry-mode-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 22px;width:22px;height:22px;border-radius:7px;font-size:17px;font-weight:800;line-height:1}.expense-icon{background:#fff0ef;color:#d85d59}.income-icon{background:#eaf7ee;color:#329464}.transfer-icon{background:#edf3ff;color:#587fc4;font-size:17px}.income-add-button{background:rgba(255,255,255,.88);color:#454b57;border-color:#e8e8ee}.type-switch{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:5px;border-radius:13px;background:#f2f5f9}.type-switch button{border:0;border-radius:9px;padding:9px;background:transparent;color:#788495;font-size:13px;font-weight:800}.type-switch button.selected{background:#fff;color:#315fbd;box-shadow:0 2px 8px #20324b12}.type-switch button:last-child.selected{color:#16836f}.income-amount-wrap>span{color:#16836f}.income-category-dot{background:#e5f7ef;color:#16836f}.income-amount{color:#16836f}.income-text{color:#16836f!important}.expense-text{color:#d84d4d!important}.batch-actions-empty{margin-top:12px}.transfer-count-link{display:inline-flex;align-items:center;gap:5px;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:800;text-align:left;cursor:pointer}.transfer-count-link span{color:#587fc4;font-size:18px}.transfer-count-link:active{opacity:.65}.income-expense-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:11px 0}.income-expense-strip>div{display:flex;flex-direction:column;gap:4px;min-width:0;padding:12px 10px;background:#fff;border:1px solid #edf0f4;border-radius:13px}.income-expense-strip small{font-size:10px;color:var(--muted)}.income-expense-strip strong{font-size:clamp(12px,3.2vw,15px);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.piggy-card{display:flex;align-items:center;gap:13px;margin:12px 0;padding:15px;background:linear-gradient(135deg,#fff9ef,#fff);border:1px solid #f5e9d6;border-radius:18px;transition:background .2s,border-color .2s}.piggy-character{display:grid;place-items:center;flex:none;width:64px;height:64px;border-radius:20px;background:#fff0dc;font-size:35px;letter-spacing:-8px;padding-right:7px}.piggy-content{flex:1;min-width:0}.piggy-title{font-size:13px;font-weight:850}.piggy-status{font-size:11px;color:#8c7a64;margin:3px 0 9px}.piggy-track{height:10px;border-radius:99px;background:#f1e7dc;overflow:hidden}.piggy-track span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#74c6a7,#f0bf5e);transition:width .35s,background .2s}.piggy-numbers{display:flex;justify-content:space-between;gap:8px;margin-top:5px;font-size:10px;color:#8c7a64}.piggy-numbers strong{font-size:11px;color:#5b5044}.piggy-sweating{background:linear-gradient(135deg,#fff0ed,#fff);border-color:#ffc6bc}.piggy-sweating .piggy-character{background:#ffe1dc;animation:piggy-shake .5s ease-in-out infinite alternate}.piggy-sweating .piggy-track span{background:linear-gradient(90deg,#ffad64,#ee5b55)}.piggy-sweating .piggy-status{color:#cb5148}.piggy-broken{background:linear-gradient(135deg,#fff0f0,#fff);border-color:#f3a4a4}.piggy-broken .piggy-character{background:#ffe0e0;filter:grayscale(.2);animation:piggy-shake .18s linear 3}.piggy-broken .piggy-track span{background:#dc4242}.piggy-broken .piggy-status{color:#c92f3b;font-weight:800}.piggy-empty{background:#f8fafc;border-color:#e8edf2}.piggy-empty .piggy-character{background:#edf2ff}.piggy-empty .piggy-track span{background:#b7c2d2}@keyframes piggy-shake{from{transform:rotate(-4deg)}to{transform:rotate(4deg)}}.category-emoji{display:grid;place-items:center;width:25px;height:25px;border-radius:8px;background:#f2f5fb;font-size:15px}.annual-income-strip{margin-top:10px}

/* しろちゃんとちび毛のテーマ：クリーム色、桜色、暖かな黄色 */
.brand-mark{display:flex;align-items:center;justify-content:center;gap:0;overflow:hidden}
.brand-mark img{width:27px;height:27px;object-fit:contain;display:block}
.brand-mark img+img{margin-left:-5px}
.puppy-pair{gap:0;letter-spacing:0;padding:3px}
.puppy-pair img{display:block;width:43px;height:43px;object-fit:contain;flex:none;filter:drop-shadow(0 2px 1px #7a4c3010);transition:transform .2s,filter .2s}
.puppy-pair img+img{margin-left:-5px}
.puppy-pair .puppy-expression{width:100%;height:100%;object-fit:contain;border-radius:12px}
.puppy-sweating img{transform:rotate(4deg) translateY(-2px)}
.puppy-broken img:first-child{transform:rotate(-8deg) translateY(2px);filter:grayscale(.35)}
.puppy-broken img:last-of-type{transform:rotate(8deg) translateY(-1px);filter:grayscale(.2)}
.puppy-empty img{opacity:.78}

.brand-mark{box-shadow:inset 0 0 0 1px #f8dce4,0 4px 12px #d96f9110}
.button-primary{background:linear-gradient(135deg,#e989a7,#d96f91);box-shadow:0 4px 10px #d96f9126}
.button-primary:active{background:#bd5376}
.button-secondary{background:#fff0f4;color:#b95478;border-color:#f8dce5}
.button-secondary:active{background:#ffe5ed}
.bottom-nav button.active{background:color-mix(in srgb,var(--blue) 15%,white);color:var(--blue-dark);border-color:color-mix(in srgb,var(--blue) 30%,white)}
.bottom-nav{border-color:#f3e2e7;box-shadow:0 8px 30px #a75d7414}
.page-heading .heading-icon,.metric-icon,.empty-icon{background:#fff0f4;color:#bd5376}
.hero-total{background:linear-gradient(130deg,#e989a7 0%,#d96f91 100%);box-shadow:0 10px 24px #d96f9126}
.entry-number{background:#fff0f4;color:#bd5376}
.count-pill{background:#eaf7ef;color:#44866d}
.capture-panel,.entry-card,.stats-card,.metric-card,.ledger{border-color:#f3e7e9}
.piggy-card{background:linear-gradient(135deg,#fff8e9,#fff);border-color:#f6e6d3}
.piggy-sweating{background:linear-gradient(135deg,#fff0f4,#fff);border-color:#f5c5d4}
.piggy-broken{background:linear-gradient(135deg,#fff0f0,#fff);border-color:#f1b6c2}
.puppy-pair{display:flex;align-items:center;justify-content:center;gap:0;position:relative;flex:none;width:90px;height:76px;border-radius:23px;background:linear-gradient(135deg,#fff0e4,#ffeef4);font-size:28px;letter-spacing:-7px;padding-right:7px;transition:transform .2s,background .2s}
.puppy-pair span{display:inline-block;filter:drop-shadow(0 2px 1px #7a4c3010)}
.puppy-pair small{position:absolute;left:0;right:0;bottom:3px;text-align:center;font-size:8px;letter-spacing:.02em;color:#a77a85;font-weight:800}
.puppy-sweating{background:linear-gradient(135deg,#fff0dc,#ffe8ef);animation:puppy-bob .6s ease-in-out infinite alternate}
.puppy-broken{background:linear-gradient(135deg,#ffe6eb,#fff0f0);animation:puppy-shake .2s linear 3}
.puppy-empty{background:linear-gradient(135deg,#f2f5ff,#fff0f4)}
.puppy-happy{background:linear-gradient(135deg,#fff0e4,#fff0f6)}
@keyframes puppy-bob{from{transform:translateY(0) rotate(-2deg)}to{transform:translateY(-2px) rotate(2deg)}}
@keyframes puppy-shak        <TransactionForm :record="f" :categories="categories" :income-categories="INCOME_CATEGORIES" :payment-sources="paymentSources" :category-label="categoryLabel" :receipt-enabled="entryInputMode === 'manual' || recognitionMode === 'receipt'" @change-type="setEntryType(f, $event)" @select-receipt="selectDraftReceipt($event, f)" @clear-receipt="f.receiptImage = null; f.receiptFileName = ''" />

