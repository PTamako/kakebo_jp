<script setup>
defineProps({
 active:{type:Boolean,default:false},
 busy:{type:Boolean,default:false},
 trashCount:{type:Number,default:0},
 trashStatus:{type:String,default:''},
 onOpenJobs:{type:Function,default:null},
 onOpenReceipts:{type:Function,default:null},
 onOpenDuplicates:{type:Function,default:null},
 onOpenTrash:{type:Function,default:null}
})
</script>
<template>
  <!-- One original management "Other" layout for both identities. Slot actions
       are authorized by each user's own APIs, not by copying the owner API. -->
  <div v-show="active" class="original-other-management">
    <slot name="rules"/>
    <details class="finance-panel finance-disclosure" @toggle="$event.target.open&&onOpenJobs?.()">
      <summary>定期処理の実行状況</summary>
      <slot name="jobs"><p>実行履歴はありません。</p></slot>
    </details>
    <details class="finance-panel finance-disclosure device-privacy-panel">
      <summary>端末のプライバシー設定</summary>
      <slot name="privacy"/>
    </details>
    <details class="finance-panel finance-disclosure" @toggle="$event.target.open&&onOpenReceipts?.()">
      <summary>バックアップ・復元</summary>
      <slot name="backup"/>
    </details>
    <details class="finance-panel finance-disclosure" @toggle="$event.target.open&&onOpenDuplicates?.()">
      <summary>重複の可能性</summary>
      <slot name="duplicates"><p>本人が確認できる記録のみ表示します。</p></slot>
    </details>
    <details class="finance-panel finance-disclosure review-trash-panel" @toggle="$event.target.open&&onOpenTrash?.()">
      <summary>ゴミ箱 <span class="review-trash-count" aria-live="polite">{{trashStatus || (trashCount+'件')}}</span></summary>
      <slot name="trash"><p>ゴミ箱は空です。</p></slot>
    </details>
  </div>
</template>
<style scoped>
.original-other-management{display:grid;gap:10px;min-width:0}
.finance-panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px;display:grid;gap:8px;min-width:0}
.finance-disclosure summary{cursor:pointer;min-height:44px;font-size:14px;font-weight:750;display:flex;align-items:center;justify-content:space-between;gap:8px}
.finance-disclosure :deep(button){min-height:40px}
.finance-disclosure :deep(p){font-size:12px;line-height:1.6;color:var(--muted);overflow-wrap:anywhere}
.finance-disclosure :deep(details){min-width:0}
</style>
