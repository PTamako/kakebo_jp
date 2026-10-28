<script setup>
import { ref, computed } from 'vue'
const props = defineProps({ record: { type: Object, required: true }, categories: { type: Array, required: true }, incomeCategories: { type: Array, required: true }, paymentSources: { type: Array, required: true }, categoryLabel: { type: Function, required: true }, receiptEnabled: { type: Boolean, default: true }, existingReceipt: { type: Boolean, default: false }, receiptName: { type: String, default: '' }, editMode: { type: Boolean, default: false } })
const emit = defineEmits(['change-type','select-receipt','clear-receipt'])
const detailsOpen = ref(false)
const record = computed(() => props.record)
const hasReceipt = computed(() => !!record.value.receiptImage || !!props.receiptName || props.existingReceipt)
</script>
<template>
<div class="transaction-form">
  <div class="type-switch" role="group" aria-label="記録の種類">
    <button v-for="t in [{id:'expense',label:'支出'},{id:'income',label:'収入'},{id:'transfer',label:'資産移動'}]" :key="t.id" type="button" :class="{selected:record.type===t.id}" @click="emit('change-type',t.id)">{{t.label}}</button>
  </div>
  <label class="form-field amount-field"><span>金額（円）</span><div class="amount-input-wrap"><span>¥</span><input v-model.number="record.amount" type="number" min="0" inputmode="numeric" required aria-label="金額（円）" /></div></label>
  <div v-if="!(Number(record.amount)>0)" class="amount-warning" role="alert">金額を確認してください。</div>
  <div class="field-grid">
    <label class="form-field"><span>日付</span><input v-model="record.date" type="date" required /></label>
    <label v-if="record.type!=='transfer'" class="form-field"><span>カテゴリ</span><select v-model="record.category"><option v-for="c in (record.type==='income'?incomeCategories:record.type==='transfer'?['投資・資産移動']:categories)" :key="c" :value="c">{{categoryLabel(c)}}</option></select></label>
    <label v-if="record.type==='expense'" class="form-field"><span>店舗</span><input v-model="record.merchant" /></label>
    <label v-if="record.type==='expense'" class="form-field"><span>支払方法・カード</span><select v-model="record.paymentSource"><option value="">未設定</option><option v-for="source in paymentSources" :key="source" :value="source">{{source}}</option><option v-if="record.paymentSource && !paymentSources.includes(record.paymentSource)" :value="record.paymentSource">{{record.paymentSource}}（既存の設定）</option></select></label>
  </div>
  <div v-if="record.type==='transfer'" class="field-grid transfer-schedule-fields"><label class="form-field"><span>振替先</span><select v-model="record.transferTarget"><option value="">選択してください</option><option value="sbi">SBI証券（投資信託）</option></select></label><label class="form-field"><span>適用日（この日に残高へ反映）</span><input v-model="record.transferDate" type="date" required /></label></div>
  <div v-if="record.type==='expense' && receiptEnabled" class="receipt-attachment-field" role="group" aria-label="レシート画像の添付"><span class="receipt-attachment-label">レシート画像（任意）</span><label class="button-secondary receipt-attachment-button">{{hasReceipt?'画像を変更する':'レシート画像を追加'}}<input type="file" accept="image/*" @change="emit('select-receipt',$event)" hidden /></label><span class="receipt-attachment-status">{{record.receiptImage?'画像を選択しました'+(record.receiptFileName?'：'+record.receiptFileName:''):receiptName?'画像を選択しました：'+receiptName:existingReceipt?'保存済みの画像があります':'画像は未選択です'}}</span><button v-if="record.receiptImage || receiptName" type="button" class="receipt-attachment-clear" @click="emit('clear-receipt')">選択を解除</button></div>
  <label v-if="!editMode && record.type!=='income' && record.type!=='transfer'" class="bind-rule transaction-bind-rule"><input v-model="record.bindRule" type="checkbox" :disabled="!record.merchant || record.merchant.trim().length<2" /><span>この店舗のカテゴリを次回から自動判定する</span></label>
  <details class="transaction-details" :open="detailsOpen" @toggle="detailsOpen=$event.target.open"><summary>詳細項目</summary><div class="field-grid"><label v-if="record.type==='expense'" class="form-field"><span>時刻</span><input v-model="record.time" type="time" /></label><label class="form-field"><span>メモ</span><input v-model="record.note" placeholder="任意" /></label></div></details>
</div>
</template>
<style scoped>
.transaction-form{display:grid;gap:12px;min-width:0}.transaction-details{border-top:1px solid var(--border,#e5e7eb);padding-top:12px}.transaction-details summary{cursor:pointer;font-weight:600;padding:8px 2px}.transaction-details[open] .field-grid{margin-top:12px}.transaction-form .amount-field input{font-size:1.6rem;font-weight:700}.transaction-bind-rule{display:flex;align-items:center;gap:10px;min-height:44px}.transaction-bind-rule input{accent-color:var(--blue)}.transaction-bind-rule:has(input:disabled){opacity:.6}

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
