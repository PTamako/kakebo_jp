<script setup>
import { ref, computed } from 'vue'
import { sortOtherLast } from './category-sort.js'
import AmountInput from './AmountInput.vue'
const props = defineProps({ record: { type: Object, required: true }, categories: { type: Array, required: true }, incomeCategories: { type: Array, required: true }, paymentSources: { type: Array, required: true }, transferDestinations: {type:Array,default:()=>[]}, categoryLabel: { type: Function, required: true }, receiptEnabled: { type: Boolean, default: true }, existingReceipt: { type: Boolean, default: false }, receiptName: { type: String, default: '' }, editMode: { type: Boolean, default: false } })
const emit = defineEmits(['change-type','select-receipt','clear-receipt','merchant-change','payment-change'])
const detailsOpen = ref(false)
const record = computed(() => props.record)
const orderedCategories = computed(() => sortOtherLast(props.categories))
const orderedIncomeCategories = computed(() => sortOtherLast(props.incomeCategories))
const orderedPayments = computed(() => sortOtherLast(props.paymentSources))
const hasReceipt = computed(() => !!record.value.receiptImage || !!props.receiptName || props.existingReceipt)
</script>
<template>
<div class="transaction-form">
  <div class="type-switch" role="group" aria-label="記録の種類">
    <button v-for="t in [{id:'expense',label:'支出'},{id:'income',label:'収入'},{id:'transfer',label:'資産移動'}]" :key="t.id" type="button" :class="{selected:record.type===t.id}" @click="emit('change-type',t.id)">{{t.label}}</button>
  </div>
  <div class="form-field amount-field"><span>金額（円）</span><AmountInput v-model="record.amount" /></div>
  <div v-if="!(Number(record.amount)>0)" class="amount-warning" role="alert">金額を確認してください。</div>
  <div class="field-grid">
    <label class="form-field"><span>日付</span><input v-model="record.date" type="date" required /><small v-if="!record.date" class="amount-warning">日付を確認してください</small></label>
    <label v-if="record.type!=='transfer'" class="form-field"><span>カテゴリ</span><select v-model="record.category"><option v-for="c in (record.type==='income'?orderedIncomeCategories:record.type==='transfer'?['投資・資産移動']:orderedCategories)" :key="c" :value="c">{{categoryLabel(c)}}</option></select></label>
    <label v-if="record.type==='expense'" class="form-field"><span>店舗</span><input v-model="record.merchant" @input="emit('merchant-change')" /></label>
    <label v-if="record.type==='expense'" class="form-field"><span>支払方法・カード</span><select :value="record.paymentSource" @change="emit('payment-change', $event.target.value)"><option value="">未設定</option><option v-for="source in orderedPayments" :key="source" :value="source">{{source}}</option><option v-if="record.paymentSource && !paymentSources.includes(record.paymentSource)" :value="record.paymentSource">{{record.paymentSource}}（既存の設定）</option></select></label>
  </div>
  <div v-if="record.type==='transfer'" class="field-grid transfer-schedule-fields"><label class="form-field"><span>振替先</span><select v-model="record.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option><option v-for="dest in transferDestinations" :key="dest.value" :value="dest.value">{{dest.name}}（チャージ）</option><option v-if="record.transferTarget && record.transferTarget!=='sbi' && !transferDestinations.some(item=>item.value===record.transferTarget)" :value="record.transferTarget">既存の振替先：{{record.transferTarget}}</option></select></label><label class="form-field"><span>反映日</span><input v-model="record.transferDate" type="date" required /></label></div>
  <label v-if="record.type==='transfer'" class="form-field">
    <span>{{record.transferTarget?.startsWith('prepaid:') ? 'チャージ元（任意）' : '振替元（任意）'}}</span>
    <select v-model="record.paymentSource"><option value="">未設定</option><option v-for="source in orderedPayments.filter(x=> record.transferTarget !== 'prepaid:'+x)" :key="source" :value="source">{{source}}</option><option v-if="record.paymentSource && !paymentSources.includes(record.paymentSource)" :value="record.paymentSource">{{record.paymentSource}}（既存の設定）</option></select>
  </label>
  <div v-if="record.type==='expense' && receiptEnabled" class="receipt-attachment-field" role="group" aria-label="レシート画像の添付"><span class="receipt-attachment-label">レシート画像（任意）</span><label class="button-secondary receipt-attachment-button">{{hasReceipt?'画像を変更する':'画像を追加'}}<input type="file" accept="image/*" @change="emit('select-receipt',$event)" hidden /></label><span class="receipt-attachment-status">{{record.receiptImage?'選択済み'+(record.receiptFileName?'：'+record.receiptFileName:''):receiptName?'選択済み：'+receiptName:existingReceipt?'保存済み':'未選択'}}</span><button v-if="record.receiptImage || receiptName" type="button" class="receipt-attachment-clear" @click="emit('clear-receipt')">選択を解除</button></div>
  <div v-if="!editMode && record.type==='expense'" class="merchant-rule-options" role="group" aria-label="店舗の自動設定">
    <label class="bind-rule transaction-bind-rule"><input v-model="record.bindRule" type="checkbox" :disabled="!record.merchant || record.merchant.trim().length<2" /><span>カテゴリを記憶</span></label>
    <label class="bind-rule transaction-bind-rule"><input v-model="record.bindPaymentRule" type="checkbox" :disabled="!record.merchant || record.merchant.trim().length<2 || !record.paymentSource" /><span>支払方法を記憶</span></label>
  </div>
  <details class="transaction-details" :open="detailsOpen" @toggle="detailsOpen=$event.target.open"><summary>詳細項目 <span v-if="record.time" class="transaction-time-summary">時刻 {{record.time}}<small v-if="record.note?.startsWith('画面表示：')">（目安）</small></span><span v-else-if="record.note?.startsWith('画面表示：')" class="transaction-time-summary">{{ record.note.slice(5).split('（')[0] }}（目安）</span></summary><div class="field-grid"><label class="form-field"><span>時刻</span><input v-model="record.time" type="time" step="1" /></label><label class="form-field"><span>メモ</span><input v-model="record.note" placeholder="任意" /></label></div></details>
</div>
</template>
<style scoped>
.transaction-time-summary{display:inline-block;margin-left:8px;padding:3px 8px;background:var(--tint,#f4f6fb);border:1px solid var(--line,#e5e7eb);border-radius:99px;color:var(--blue-dark,#586ca9);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}.transaction-form{display:grid;gap:12px;min-width:0}.transaction-details{border-top:1px solid var(--border,#e5e7eb);padding-top:12px}.transaction-details summary{cursor:pointer;font-weight:600;padding:8px 2px}.transaction-details[open] .field-grid{margin-top:12px}.transaction-form .amount-field input{font-size:1.6rem;font-weight:700}.transaction-bind-rule{display:flex;align-items:center;gap:10px;min-height:44px}.transaction-bind-rule input{accent-color:var(--blue)}.transaction-bind-rule:has(input:disabled){opacity:.6}.merchant-rule-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:0}.merchant-rule-options .transaction-bind-rule{gap:6px;min-width:0;font-size:clamp(11px,3.4vw,13px);white-space:nowrap}.merchant-rule-options .transaction-bind-rule input{flex:none;margin:0}.merchant-rule-options .transaction-bind-rule span{min-width:0}

/* All native controls must shrink inside a two-column mobile grid. */
.transaction-form,.transaction-form *{box-sizing:border-box}
.transaction-form .field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;min-width:0;width:100%}
.transaction-form .field-grid>.form-field{min-width:0;width:100%;max-width:100%}
.transaction-form .form-field input,.transaction-form .form-field select{display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box}
.transaction-form .form-field>span{overflow-wrap:anywhere}
.transaction-form .amount-input-wrap{width:100%;min-width:0;box-sizing:border-box}
.transaction-form .amount-input-wrap input{width:100%;min-width:0;flex:1}
.transaction-form .receipt-attachment-field{min-width:0;max-width:100%;overflow-wrap:anywhere}
.transaction-form .receipt-attachment-status{overflow-wrap:anywhere}
.transaction-form .transaction-details{min-width:0;width:100%}
@media(max-width:390px){.transaction-form .field-grid{gap:10px}.transaction-form .field-grid>.form-field{font-size:13px}.transaction-form .form-field input,.transaction-form .form-field select{font-size:16px;padding-inline:9px}.transaction-form .transfer-schedule-fields{grid-template-columns:minmax(0,1fr)}}

/* iOS Safari date/time controls have an intrinsic minimum width; avoid paired columns. */
.transaction-form{width:100%;max-width:100%;min-width:0;overflow:visible}
.transaction-form .field-grid,.transaction-form .transfer-schedule-fields,.transaction-form .transaction-details .field-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:12px;width:100%;min-width:0;max-width:100%}
.transaction-form .form-field{display:grid;grid-template-columns:minmax(0,1fr);min-width:0;max-width:100%;width:100%}
.transaction-form .form-field input,.transaction-form .form-field select{width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box;display:block}
.transaction-form input[type=date],.transaction-form input[type=time]{-webkit-appearance:none;appearance:none;min-height:46px;max-width:100%;text-align:left}
.transaction-form .amount-field input{min-width:0!important}
.transaction-form .receipt-attachment-field{display:flex;flex-wrap:wrap;align-items:center;gap:9px}
.transaction-form .receipt-attachment-label{flex-basis:100%}
</style>
