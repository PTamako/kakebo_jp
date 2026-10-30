<script setup>
import { inject } from 'vue'
// The reminder actions remain owned by App, preserving due-date guards and ledger IDs.
const { pendingTransfers, transferLoading, transferDue, transferStatus, transferStatusClass, transferActionId, retryTransfer, dismissTransferReminder } = inject('kakeibo-page-context')
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
      <p v-if="transferLoading" class="investment-review-empty" role="status">読み込み中…</p>
      <p v-else-if="!pendingTransfers.length" class="investment-review-empty">確認が必要な振替はありません</p>
      <div v-else v-for="item in pendingTransfers" :key="item.id" class="investment-review-row">
        <div class="investment-review-entry">
          <strong>{{item.merchant || item.note || 'SBI証券への振替'}}</strong>
          <small>予定日 {{item.transfer_date || item.date}} · {{yen(item.amount)}}</small>
        </div>
        <div class="investment-review-actions">
          <span :class="transferStatusClass(item)">{{transferStatus(item)}}</span>
          <button v-if="Number(item.transfer_applied) === 1" type="button" :disabled="transferActionId !== null" :aria-label="(item.merchant || item.note || 'SBI証券への振替')+'の通知を閉じる'" @click="dismissTransferReminder(item)">×</button>
          <button v-else-if="transferDue(item)" type="button" :disabled="transferActionId !== null" @click="retryTransfer(item)">記帳に反映</button>
        </div>
      </div>
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
.investment-review-body{box-sizing:border-box;min-width:0;padding:2px 12px 11px;border-top:1px solid var(--line)}
.investment-review-row{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;width:100%;min-width:0;margin:0;padding:10px 0;border-top:1px solid var(--line)}
.investment-review-row:first-of-type{border-top:0}
.investment-review-entry{display:grid;gap:3px;min-width:0;margin:0}
.investment-review-entry strong{display:block;min-width:0;font-size:12px;line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
.investment-review-entry small{min-width:0;font-size:10px;color:var(--muted);line-height:1.4;overflow-wrap:anywhere}
.investment-review-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:6px;min-width:0;color:var(--muted);font-size:10px}
.investment-review-actions button{min-height:40px;min-width:40px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--blue-dark);font-size:11px;font-weight:750;padding:6px 9px}
.investment-review-empty{font-size:11px;color:var(--muted);margin:0 0 8px;line-height:1.5}
.investment-review-summary:focus-visible,.investment-review-actions button:focus-visible{outline:2px solid var(--blue-dark);outline-offset:2px}
@media(prefers-reduced-motion:reduce){.investment-review-chevron{transition:none}}
@media(max-width:370px){.investment-review-row{grid-template-columns:minmax(0,1fr)}.investment-review-actions{justify-content:flex-start}}
</style>