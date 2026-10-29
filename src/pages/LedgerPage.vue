<script setup>
import { inject } from 'vue'
import TransactionForm from '../TransactionForm.vue'
// Shared refs and navigation actions remain owned by App.vue.
// This page only renders its own view; links to 明細 call the same parent actions.
const { categories, tab, month, resetMonth, selectedYear, input, paymentSources, editReceiptImage, editReceiptFileName, receiptSaveError, selectEditReceipt, receiptImageIds, viewedReceiptUrl, viewReceipt, closeReceipt, removeReceiptImage, editingEntry, INCOME_CATEGORIES, categoryIconPath, categoryLabel, yen, load, setEntryType, pendingEntryIds, editSaving, remove, startEdit, cancelEdit, saveEdit, selectedDay, entryTypeFilter, calendarExpanded, swipedEntryId, detailFilter, detailLoading, visibleEntryCount, listPageSize, displayEntries, setEntryTypeFilter, sortedDisplayEntries, annualDetailMode, expandedMonth, annualMonthGroups, loadMoreAnnualEntries, loadMoreEntries, expandedEntryDays, groupedPagedEntries, toggleEntryDay, clearDetailFilter, visibleCalendarDays, toggleDay, startSwipe, endSwipe, handleEntryClick, monthLabel } = inject('kakeibo-page-context')
</script>
<template>
<section  class="page-section">
      <div class="page-heading"><div><h1>収支明細</h1></div><div class="heading-period"><input type="month" v-model="month" class="month" aria-label="集計月" /><button type="button" class="period-reset" @click="resetMonth" aria-label="今月に戻す" title="今月に戻す">今月</button></div></div>
      <div class="entry-type-filter" role="group" aria-label="明細の種類"><button v-for="option in [{value: 'all', label: 'すべて'}, {value: 'income', label: '収入'}, {value: 'expense', label: '支出'}, {value: 'transfer', label: '資産移動'}]" :key="option.value" type="button" :class="{ selected: entryTypeFilter === option.value }" :aria-pressed="entryTypeFilter === option.value" @click="setEntryTypeFilter(option.value)">{{ option.label }}</button></div>
      <section v-if="!detailFilter" class="month-calendar" aria-label="月間明細カレンダー">
        <div class="calendar-heading"><strong>{{ monthLabel }}</strong><div class="calendar-actions"><button type="button" class="calendar-reset" @click="calendarExpanded = !calendarExpanded">{{ calendarExpanded ? '週のみ表示' : '月全体を表示' }}</button><button v-if="selectedDay" type="button" class="calendar-reset" @click="selectedDay = ''">日付解除</button></div></div>
        <div class="calendar-legend" aria-label="日付マークの説明"><span><i class="legend-today"></i>今日</span><span><i class="calendar-peak-expense">支</i>支出最多</span><span><i class="calendar-peak-income">収</i>収入最多</span></div>
        <div class="calendar-weekdays"><span v-for="weekday in ['日', '月', '火', '水', '木', '金', '土']" :key="weekday" :aria-label="weekday + '曜日'">{{ weekday }}</span></div>
        <div class="calendar-grid">
          <button v-for="day in visibleCalendarDays" :key="day.key" type="button" class="calendar-day" :class="{ 'calendar-blank': day.blank, 'calendar-selected': selectedDay === day.date, 'calendar-has-spend': day.amount > 0, 'calendar-today':day.isToday, 'calendar-top-expense':day.topExpense, 'calendar-top-income':day.topIncome }" :disabled="day.blank" @click="toggleDay(day.date)" :aria-current="day.isToday ? 'date' : undefined" :aria-label="day.blank ? undefined : day.date + (day.isToday?' 今日':'') + (day.topExpense?' 支出最多':'') + (day.topIncome?' 収入最多':'') + ' 記録額 ' + yen(day.amount)">
            <template v-if="!day.blank"><span class="calendar-day-number">{{ day.day }}</span><span class="calendar-day-badges"><i v-if="day.topExpense" class="calendar-peak-expense" title="支出最多" aria-hidden="true">支</i><i v-if="day.topIncome" class="calendar-peak-income" title="収入最多" aria-hidden="true">収</i></span><small v-if="day.amount > 0">{{ yen(day.amount) }}</small><small v-else class="calendar-no-spend">—</small></template>
          </button>
        </div>
      </section>
      <div class="summary-strip"><span>{{ detailFilter ? (detailFilter.period === 'year' ? selectedYear + '年' : monthLabel) + ' · ' + ({income:'収入',expense:'支出',transfer:'資産移動'}[detailFilter.type] || 'すべて') + ' · ' + (detailFilter.type === 'transfer' ? '資産移動' : categoryLabel(detailFilter.category)) : (selectedDay ? selectedDay.replace(/-/g, '/') + ' 当日の明細' : monthLabel + ' · ' + ({all: 'すべて', income: '収入', expense: '支出', transfer: '資産移動'}[entryTypeFilter])) }}</span><strong>{{ displayEntries.length }}件の記録</strong></div>
      <div v-if="detailFilter" class="detail-filter-strip"><span>{{ detailFilter.type === 'transfer' ? '資産移動で絞り込み中' : 'カテゴリで絞り込み中' }}</span><button type="button" class="button-secondary" @click="clearDetailFilter">絞り込みを解除</button></div>
      <p v-if="detailLoading" class="trend-note">明細を読み込み中…</p>
      <div v-if="!detailLoading && !displayEntries.length" class="empty-state"><span class="empty-icon">▤</span><strong>{{ detailFilter ? 'このカテゴリの明細はありません' : 'この期間の記録はありません' }}</strong><button v-if="detailFilter" class="button-secondary" @click="clearDetailFilter">絞り込みを解除</button><button v-else class="button-primary" @click="tab = 'add'">記録を追加</button></div>
      
      <div v-if="!detailLoading && displayEntries.length && annualDetailMode" class="ledger annual-month-list">
        <section v-for="group in annualMonthGroups" :key="group.month" class="entry-day-group">
          <button type="button" class="entry-day-heading" :aria-expanded="expandedMonth === group.month" @click="expandedMonth = expandedMonth === group.month ? '' : group.month">
            <span class="entry-day-chevron">{{ expandedMonth === group.month ? '▾' : '▸' }}</span>
            <strong>{{ Number(group.month.slice(5)) }}月</strong>
            <span class="entry-day-count">{{ group.count }}件</span>
            <span class="entry-day-total">{{ yen(group.total) }}</span>
          </button>
          <ul v-if="expandedMonth === group.month" class="ledger entry-day-items">
            <li v-for="e in group.items" :key="e.id" :class="{ 'swiped-open': swipedEntryId === e.id, 'receipt-available': receiptImageIds.has(Number(e.id)) }" @touchstart.passive="startSwipe($event)" @touchend="endSwipe($event, e.id)" @touchcancel="swipedEntryId = null">
              <div class="ledger-row-content" role="button" tabindex="0" @click="handleEntryClick(e)" @keydown.enter.prevent="startEdit(e)" @keydown.space.prevent="startEdit(e)">
                <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(e.category)"/></svg></span>
                <div class="ledger-info"><b>{{ e.merchant || categoryLabel(e.category) }}</b><small>{{ e.date.replace(/-/g, '/') }}<template v-if="e.time"> · {{ e.time }}</template> · {{ categoryLabel(e.category) }}</small></div>
                <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income', 'transfer-amount': e.type === 'transfer' }">{{ e.type === 'income' ? '+' : e.type === 'transfer' ? '' : '−' }}{{ yen(e.amount) }}</span>
              </div>
              <button v-if="receiptImageIds.has(Number(e.id))" type="button" class="swipe-receipt" @click.stop="viewReceipt(e.id); swipedEntryId = null" aria-label="レシート画像を見る">レシート</button>
              <button class="swipe-delete" :disabled="pendingEntryIds.has(e.id)" @click.stop="remove(e.id); swipedEntryId = null" aria-label="記録を削除">削除</button>
            </li>
          </ul>
          <div v-if="expandedMonth === group.month && group.items.length < group.count" class="load-more-wrap">
            <button type="button" class="button-secondary load-more-button" @click.stop="loadMoreAnnualEntries(group)">読み込みを続ける（{{ Math.min(listPageSize, group.count - group.items.length) }}件）</button>
          </div>
        </section>
      </div>
      <div v-else-if="!detailLoading && displayEntries.length" class="ledger day-group-list">
        <section v-for="group in groupedPagedEntries" :key="group.date" class="entry-day-group">
          <button type="button" class="entry-day-heading" :aria-expanded="expandedEntryDays.has(group.date)" @click="toggleEntryDay(group.date)">
            <span class="entry-day-chevron">{{ expandedEntryDays.has(group.date) ? '▾' : '▸' }}</span>
            <strong>{{ group.date.replace(/-/g, '/') }}</strong>
            <span class="entry-day-count">{{ group.items.length }}件</span>
            <span class="entry-day-total">{{ yen(group.items.reduce((sum, entry) => sum + (entry.type === 'income' ? -Number(entry.amount || 0) : Number(entry.amount || 0)), 0)) }}</span>
          </button>
          <ul v-if="expandedEntryDays.has(group.date)" class="ledger entry-day-items">
            <li v-for="e in group.items" :key="e.id" :class="{ 'swiped-open': swipedEntryId === e.id, 'receipt-available': receiptImageIds.has(Number(e.id)) }" @touchstart.passive="startSwipe($event)" @touchend="endSwipe($event, e.id)" @touchcancel="swipedEntryId = null">
              <div class="ledger-row-content" role="button" tabindex="0" @click="handleEntryClick(e)" @keydown.enter.prevent="startEdit(e)" @keydown.space.prevent="startEdit(e)">
                <span class="category-dot" :class="[ 'cat-' + (categories.indexOf(e.category) + 1), e.type === 'income' ? 'income-category-dot' : '' ]"><svg class="ui-line-icon category-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="categoryIconPath(e.category)"/></svg></span>
                <div class="ledger-info"><b>{{ e.merchant || categoryLabel(e.category) }}</b><small>{{ e.date.slice(5) }}<template v-if="e.time"> · {{ e.time }}</template> · {{ categoryLabel(e.category) }} · {{ e.type === 'income' ? '収入' : e.type === 'transfer' ? '資産移動' : '支出' }}<template v-if="e.type === 'transfer' && e.transfer_target"> · {{ e.transfer_target === 'sbi' ? '→ SBI証券' : '' }}</template></small></div>
                <span class="ledger-amount" :class="{ 'income-amount': e.type === 'income', 'transfer-amount': e.type === 'transfer' }">{{ e.type === 'income' ? '+' : e.type === 'transfer' ? '' : '−' }}{{ yen(e.amount) }}</span>
              </div>
              
              <button v-if="receiptImageIds.has(Number(e.id))" type="button" class="swipe-receipt" @click.stop="viewReceipt(e.id); swipedEntryId = null" aria-label="レシート画像を見る">レシート</button>
              <button class="swipe-delete" @click.stop="remove(e.id); swipedEntryId = null" aria-label="記録を削除">削除</button>
            </li>
          </ul>
        </section>
      </div>
      <div v-if="!detailLoading && !annualDetailMode && visibleEntryCount < sortedDisplayEntries.length" class="load-more-wrap">
        <button type="button" class="button-secondary load-more-button" @click="loadMoreEntries">読み込みを続ける（{{ Math.min(listPageSize, sortedDisplayEntries.length - visibleEntryCount) }}件）</button>
      </div>
      <div v-if="viewedReceiptUrl" class="edit-overlay" @click.self="closeReceipt">
        <div class="edit-dialog" role="dialog" aria-modal="true" aria-label="レシート画像">
          <div class="edit-dialog-heading"><h2>レシート画像</h2><button type="button" class="icon-button" @click="closeReceipt" aria-label="閉じる">×</button></div>
          <img :src="viewedReceiptUrl" alt="保存したレシート" style="width:100%;max-height:65vh;object-fit:contain" />
          <p class="microcopy">画像は端末内に30日保存</p>
          <button type="button" class="button-secondary" @click="removeReceiptImage">画像のみ削除</button>
        </div>
      </div>
      <div v-if="editingEntry" class="edit-overlay" @click.self="cancelEdit">
        <form class="edit-dialog" @submit.prevent="saveEdit" :aria-busy="editSaving">
          <p v-if="receiptSaveError" role="alert" class="receipt-save-error">{{ receiptSaveError }}</p>
          <div class="edit-dialog-heading"><h2>記録を編集</h2><button type="button" class="icon-button" @click="cancelEdit" aria-label="閉じる">×</button></div>
          <fieldset class="edit-fields" :disabled="editSaving">
          <TransactionForm :record="editingEntry" :categories="categories" :income-categories="INCOME_CATEGORIES" :payment-sources="paymentSources" :category-label="categoryLabel" :existing-receipt="receiptImageIds.has(Number(editingEntry.id))" :receipt-name="editReceiptFileName" :receipt-enabled="true" edit-mode @change-type="setEntryType(editingEntry, $event)" @select-receipt="selectEditReceipt" @clear-receipt="editReceiptImage = null; editReceiptFileName = ''" />
          </fieldset>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" :disabled="editSaving" @click="cancelEdit">キャンセル</button><button type="submit" class="button-primary" :disabled="editSaving">{{ editSaving ? '保存中…' : '変更を保存' }}</button></div>
        </form>
      </div>
    </section>
</template>
