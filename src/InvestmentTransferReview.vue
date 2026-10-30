<script setup>
import { inject } from 'vue'
// The reminder actions remain owned by App, preserving due-date guards and ledger IDs.
const { pendingTransfers, transferLoading, transferDue, loadTransfers, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder } = inject('kakeibo-page-context')
const yen = value => '¥' + Number(value || 0).toLocaleString('ja-JP')
</script>
<template>
  <details v-if="pendingTransfers.length" class="panel investment-transfer-review">
    <summary class="investment-review-summary">
      <span class="investment-review-symbol" aria-hidden="true">!</span>
      <span><strong>振替の確認</strong><small>{{pendingTransfers.length}}件の確認項目</small></span>
      <span class="investment-review-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="investment-review-body">
      <div class="investment-review-tools">
        <small>記帳の反映状況</small>
        <button type="button" :disabled="transferLoading" @click="loadTransfers">↻ 更新</button>
      </div>
      <p v-if="transferLoading" class="investment-review-empty" role="status">読み込み中…</p>
      <p v-else-if="!pendingTransfers.length" class="investment-review-empty">確認が必要な振替はありません</p>
      <div v-else v-for="item in pendingTransfers" :key="item.id" class="investment-review-row">
        <div class="investment-review-entry">
          <strong>{{item.merchant || item.note || 'SBI証券への振替'}}</strong>
          <small>予定日 {{item.transfer_date || item.date}} · {{yen(item.amount)}}</small>
        </div>
        <div class="investment-review-actions">
          <span :class="transferStatusClass(item)">{{transferStatus(item)}}</span>
          <button v-if="Number(item.transfer_applied) === 1" type="button" :disabled="transferActionId !== null" :aria-label="item.merchant+'の通知を閉じる'" @click="dismissTransferReminder(item)">×</button>
          <button v-else-if="transferDue(item)" type="button" :disabled="transferActionId !== null" @click="retryTransfer(item)">記帳に反映</button>
        </div>
      </div>
      <details class="investment-review-note"><summary>振替の反映について</summary><p>期日反映は証券口座への入金・買付完了を保証しません。</p></details>
    </div>
  </details>
</template>
<style scoped>
.investment-transfer-review{min-width:0;padding:0;overflow:visible}
.investment-review-summary{display:flex;align-items:center;gap:9px;min-height:49px;padding:9px 12px;list-style:none;cursor:pointer}
.investment-review-summary::-webkit-details-marker{display:none}
.investment-review-symbol{display:grid;place-items:center;flex:none;width:27px;height:27px;border-radius:9px;background:color-mix(in srgb,var(--blue) 15%,var(--card));color:var(--blue-dark);font-weight:800}
.investment-review-summary>span:nth-child(2){display:grid;gap:2px;flex:1;min-width:0}
.investment-review-summary strong{font-size:12px}
.investment-review-summary small{font-size:10px;color:var(--muted)}
.investment-review-chevron{font-size:20px;line-height:1;color:var(--muted)}
.investment-transfer-review[open] .investment-review-chevron{transform:rotate(180deg)}
.investment-review-body{padding:2px 12px 12px;border-top:1px solid var(--line)}
.investment-review-tools{display:flex;align-items:center;justify-content:space-between;gap:8px}
.investment-review-tools small{color:var(--muted);font-size:10px}
.investment-review-tools button{border:0;background:transparent;color:var(--blue-dark);min-height:43px;font-size:11px;font-weight:750}
.investment-review-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--line)}
.investment-review-entry{display:grid;gap:3px;flex:1;min-width:0}
.investment-review-entry strong{font-size:12px;overflow-wrap:anywhere}
.investment-review-entry small{font-size:10px;color:var(--muted)}
.investment-review-actions{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:10px}
.investment-review-actions button{min-height:40px;min-width:40px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:750;padding:6px 9px}
.investment-review-empty,.investment-review-note p{font-size:11px;color:var(--muted);margin:0 0 8px;line-height:1.5}
.investment-review-note{border-top:1px solid var(--line)}
.investment-review-note summary{padding:10px 0;font-size:11px;color:var(--muted);cursor:pointer}
.investment-review-summary:focus-visible,.investment-review-actions button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.investment-review-chevron{transition:none}}
</style>