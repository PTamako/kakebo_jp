<script setup>
import MobileChoiceSheet from './MobileChoiceSheet.vue'
import MobileChoiceSegments from './MobileChoiceSegments.vue'
defineProps({
 aiEnabled:{type:Boolean,default:false},quota:{type:Object,default:null},
 paymentOptions:{type:Array,default:()=>[]},paymentSource:{type:String,default:''},
 mode:{type:String,default:'statement'},busy:{type:Boolean,default:false},
 status:{type:String,default:''},warning:{type:String,default:''}
})
const emit=defineEmits(['update:aiEnabled','update:paymentSource','update:mode'])
</script>
<template>
  <div class="panel capture-panel">
    <div class="ocr-engine-picker" role="group" aria-label="画像の読み取り方法">
      <span class="ocr-engine-title">読み取り方法</span>
      <div class="ocr-engine-options">
        <button type="button" :class="{selected:!aiEnabled}" :aria-pressed="!aiEnabled" :disabled="busy" @click="emit('update:aiEnabled',false)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18h4"/></svg><span>端末内</span>
        </button>
        <button type="button" :class="{selected:aiEnabled}" :aria-pressed="aiEnabled" :disabled="busy" @click="emit('update:aiEnabled',true)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg><span>AI</span>
        </button>
      </div>
    </div>
    <p v-if="quota" class="ocr-engine-note" role="note">本日のAI残り回数：{{quota.remaining}}/{{quota.limit}}回</p>
    <label class="form-field"><span>読み取り対象のカード</span>
      <MobileChoiceSheet :model-value="paymentSource" :options="paymentOptions" label="読み取り対象のカード" :disabled="busy" @update:model-value="emit('update:paymentSource',$event)" />
    </label>
    <label class="form-field receipt-mode-select"><span>読み取り対象</span>
      <MobileChoiceSegments :model-value="mode" label="読み取り対象"
        :options="[{value:'statement',label:'利用明細'},{value:'receipt',label:'レシート'}]"
        @update:model-value="emit('update:mode',$event)" />
    </label>
    <p class="microcopy">{{mode==='statement'?'明細を複数件読み取り':'レシートを1件読み取り'}}</p>
    <div v-if="busy" class="progress-wrap"><span class="spinner"></span><span>読み取り中…</span></div>
    <p v-if="status" class="microcopy" role="status">読み取りエンジン：{{status}}</p>
    <p v-if="warning" class="microcopy" role="alert">{{warning}}</p>
  </div>
</template>
