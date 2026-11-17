<script setup>
import {inject} from 'vue'
import TransactionForm from './TransactionForm.vue'
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import MobileChoiceSegments from './MobileChoiceSegments.vue'
import OcrCapturePanel from './OcrCapturePanel.vue'
// Both household identities render this exact original page. Only the
// authenticated data/actions adapter is identity-specific.
const ctx=inject('kakeibo-entry-input')
if(!ctx)throw Error('記帳ページのデータ接続がありません')
const {liveClockIso,todayLabel,addCategory,busy,categoryDialog,categorySaving,saveCategory,categoryEntryType,categoryName,categoryIcon,availableIcons,input,entryInputMode,recognitionMode,importPaymentSource,importPaymentOptions,recognize,aiOcrEnabled,aiQuota,scanImportPaymentSource,ocrEngine,ocrWarning,setAiOcrEnabled,forms,draftRecoveryInfo,clearLocalDraft,removeDraft,rewardDestinations,transferDestinations,categories,INCOME_CATEGORIES,paymentSources,categoryLabel,selectDraftReceipt,pendingReceiptImage,pendingReceiptFileName,receiptSaveError,setEntryType,applyMerchantPayment,manualPayment,onImage,addBlank,saveAll,receiptEnabled,allowedTypes,paymentChoices,allowSbiTransfer,personalAssetActionsEnabled}=ctx
</script>
<template>
<section class="page-section">
      <div class="page-heading"><div><h1>入力</h1><time class="entry-live-clock" :datetime="liveClockIso" aria-label="現在の日時">{{ todayLabel }}</time></div><button class="button-secondary manage-category" @click="addCategory">＋ カテゴリ追加</button></div>
      <fieldset class="draft-controls" :disabled="busy === 'saving'" :aria-busy="busy === 'saving'">
      <div v-if="categoryDialog" class="edit-overlay" @click.self="!categorySaving && (categoryDialog = false)">
        <form class="edit-dialog category-dialog" @submit.prevent="saveCategory" aria-label="カテゴリを追加">
          <div class="edit-dialog-heading"><h2>カテゴリを追加</h2><button type="button" class="icon-button" :disabled="categorySaving" @click="categoryDialog = false" aria-label="閉じる">×</button></div>
          <label class="form-field"><span>種類</span><MobileChoiceSegments v-model="categoryEntryType" label="種類" :disabled="categorySaving" :options="[{value:'expense',label:'支出'},{value:'income',label:'収入'}]" /></label>
          <label class="form-field"><span>カテゴリ名</span><input v-model.trim="categoryName" maxlength="20" required :disabled="categorySaving" placeholder="例：美容" /></label>
          <p class="field-label">アイコンを選択</p>
          <div class="icon-picker" role="group" aria-label="アイコンを選択">
            <button v-for="icon in availableIcons" :key="icon.id" type="button" :disabled="categorySaving" :class="{ selected: categoryIcon === icon.id }" :aria-pressed="categoryIcon === icon.id" @click="categoryIcon = icon.id"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="icon.path"/></svg><span>{{ icon.label }}</span></button>
          </div>
          <div class="edit-dialog-actions"><button type="button" class="button-secondary" :disabled="categorySaving" @click="categoryDialog = false">キャンセル</button><button type="submit" class="button-primary" :disabled="categorySaving">{{ categorySaving ? '保存中…' : '追加する' }}</button></div>
        </form>
      </div>
      <div class="input-mode-switch" role="tablist" aria-label="入力方法"><button type="button" role="tab" :aria-selected="entryInputMode === 'manual'" :class="{ selected: entryInputMode === 'manual' }" @click="entryInputMode = 'manual'">手入力</button><button type="button" role="tab" :aria-selected="entryInputMode === 'scan'" :class="{ selected: entryInputMode === 'scan' }" @click="entryInputMode = 'scan'">画像から読み取る</button></div>
      <div v-if="entryInputMode === 'manual'" class="panel text-paste-panel">
        <details class="text-entry-details">
          <summary>テキストを貼り付けて読み取る</summary>
          <label class="field-label" for="entry-text">テキスト入力</label>
          <label class="form-field"><span>読み取り対象のカード</span><MobileChoiceSheet v-model="importPaymentSource" :options="importPaymentOptions" label="読み取り対象のカード" /></label>
          <textarea id="entry-text" v-model="input" rows="4" :placeholder="recognitionMode === 'statement' ? '例：勉強会　10月毎週の金曜日（もしくは　10/10） 100円' : 'レシートの読み取り文字を貼り付けられます。'"></textarea>
          <div class="action-row">
            <button class="button-secondary" @click="recognize(recognitionMode)" :disabled="!!busy || !input.trim()">テキストを読み取る</button>
          </div>
        </details>
      </div>
      <OcrCapturePanel v-if="entryInputMode === 'scan'"
        :ai-enabled="aiOcrEnabled" :quota="aiQuota" :payment-options="importPaymentOptions"
        :payment-source="scanImportPaymentSource" :mode="recognitionMode" :busy="!!busy"
        :status="ocrEngine" :warning="ocrWarning"
        @update:ai-enabled="setAiOcrEnabled"
        @update:payment-source="scanImportPaymentSource=$event"
        @update:mode="recognitionMode=$event" />

      <div v-if="forms.length || input.trim()" class="draft-utility-row">
        <span v-if="draftRecoveryInfo" class="draft-recovery-hint" role="status">{{draftRecoveryInfo}}</span>
        <button type="button" class="draft-discard-inline" :disabled="!!busy" @click="clearLocalDraft" aria-label="未保存の下書きを削除" title="未保存の下書きを削除">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 4h4M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg>
          下書きを削除
        </button>
      </div>
      <div v-if="forms.length" class="draft-heading">
        <div><h2>{{ entryInputMode === 'scan' ? '読み取り結果の確認' : '入力内容の確認' }}</h2><p>保存前に金額・日付を確認</p></div>
        <span class="count-pill">{{ forms.length }}件</span>
      </div>
      <div v-for="(f, i) in forms" :key="i" class="entry-card">
        <div class="entry-card-heading"><span class="entry-number">{{ String(i + 1).padStart(2, '0') }}</span><strong>{{ f.merchant || '新しい記録' }}</strong><button class="icon-button remove-button" @click="removeDraft(i)" aria-label="この記録を削除">×</button></div>
        <TransactionForm :reward-destinations="rewardDestinations" :transfer-destinations="transferDestinations" :record="f" :categories="categories" :income-categories="INCOME_CATEGORIES" :payment-sources="paymentSources" :category-label="categoryLabel" :receipt-enabled="receiptEnabled && (entryInputMode === 'manual' || f.showReceiptAttachment === true)" :allowed-types="allowedTypes" :payment-choices="paymentChoices" :allow-sbi-transfer="allowSbiTransfer" :custom-transfer-form="personalAssetActionsEnabled" @change-type="setEntryType(f, $event)" @merchant-change="applyMerchantPayment(f)" @payment-change="manualPayment(f, $event)" @select-receipt="selectDraftReceipt($event, f)" @clear-receipt="f.receiptImage = null; f.receiptFileName = ''"><template #custom-transfer-fields><slot name="custom-transfer-fields" :record="f"/></template></TransactionForm>
      </div>
      <p v-if="receiptSaveError" role="alert" class="receipt-save-error">{{ receiptSaveError }}</p>
      <div class="batch-actions" :class="{ 'batch-actions-empty': !forms.length }">
        <button v-if="entryInputMode === 'manual'" type="button" class="button-secondary" :disabled="!!busy" @click="addBlank('expense')">＋ 記録を追加</button>
        <label v-else class="button-secondary upload-button" :class="{ 'upload-disabled': !!busy }" :aria-disabled="!!busy">{{ forms.length ? '別の画像を読み取る' : recognitionMode === 'statement' ? '明細を読み取る' : 'レシートを読み取る' }}<input type="file" accept="image/*" @change="onImage($event, recognitionMode)" :disabled="!!busy" hidden /></label>
        <button class="button-primary" @click="saveAll" :disabled="!!busy || !forms.length || forms.some(f => f.type === 'transfer' && f.transferTarget === 'family:cross-bank')">{{ busy === 'saving' ? '保存中…' : forms.some(f => f.type === 'transfer' && f.transferTarget === 'family:cross-bank') ? '配偶間の資産移動は別途確認' : `保存 ${forms.length}件` }}</button>
      </div>
      </fieldset>
    </section>
</template>


<style scoped>
.personal-asset-entry-switch{margin:4px 0 12px}.personal-asset-entry-panel{display:grid;gap:10px;min-width:0;padding:0 0 90px}.personal-asset-entry-note{margin:0;color:var(--muted);font-size:12px;line-height:1.6}
</style>
