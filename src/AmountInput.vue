<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount, inject } from 'vue'
import { formatYenInput, normalizeYenInput, calculateYenExpression, convertToYen, calculateJapaneseConsumptionTax } from './amount-tools.js'

const props = defineProps({ modelValue: { type: [Number, String], default: 0 }, inputLabel: { type: String, default: '金額（円）' } })
const emit = defineEmits(['update:modelValue'])
const moneyInput = ref(null)
const launchButton = ref(null)
const closeButton = ref(null)
const sheetElement = ref(null)
const themeStyle = ref({})
const draft = ref(formatYenInput(props.modelValue))
watch(() => props.modelValue, value => {
  // Tool result and externally loaded/edited records must update the field.
  draft.value = formatYenInput(value)
})
function onAmountInput(event) {
  const el = event.target
  const raw = el.value
  const caret = el.selectionStart ?? raw.length
  const digitsBeforeCaret = (raw.slice(0, caret).match(/[0-9０-９]/g) || []).length
  const value = normalizeYenInput(raw)
  if (value === null) {
    el.value = draft.value
    return
  }
  const formatted = value === 0 && /[0-9０-９]/.test(raw) ? '0' : formatYenInput(value)
  draft.value = formatted
  emit('update:modelValue', value)
  el.value = formatted
  let index = 0, count = 0
  while (index < formatted.length && count < digitsBeforeCaret) {
    if (/\d/.test(formatted[index])) count++
    index++
  }
  el.setSelectionRange(index, index)
}
function onAmountBlur() {
  draft.value = formatYenInput(props.modelValue)
}

const opened = ref(false)
const activeTab = ref('calc')
const expression = ref('')
const calculatorResult = computed(() => calculateYenExpression(expression.value))
const taxRate = ref(0)
const taxRounding = ref('floor')
const taxSummary = computed(() => calculateJapaneseConsumptionTax(calculatorResult.value, taxRate.value, taxRounding.value))
const copyFeedback = ref('')
let copyTimer = null
watch([expression, taxRate, taxRounding], () => { copyFeedback.value = '' })
const currencies = ['CNY', 'USD', 'EUR', 'KRW', 'JPY']
const appContext = inject('kakeibo-page-context', null)
const currency = ref('CNY')
let currencyLoaded = false
async function loadCurrencyPreference() {
  if (currencyLoaded || !appContext?.api) return
  try {
    const state = await appContext.api('app-state?key=fx_currency')
    if (currencies.includes(state.fx_currency)) currency.value = state.fx_currency
    // Vue watchers flush asynchronously: the server-loaded value is not a user edit.
    await nextTick()
    currencyLoaded = true
  } catch (error) {
    fxError.value = '通貨設定をD1から読み込めません：' + error.message
  }
}
const foreignAmount = ref('')
const info = ref(null)
const fxLoading = ref(false)
const fxError = ref('')
const manualRate = ref(false)
const manualRateText = ref('')
let requestSequence = 0
let previousBodyOverflow = ''
function lockScroll() {
  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}
function unlockScroll() {
  document.body.style.overflow = previousBodyOverflow
}
async function openTools() {
  if (opened.value) return
  document.activeElement?.blur()
  if (!expression.value && Number(props.modelValue) > 0) expression.value = String(props.modelValue)
  const host = launchButton.value?.closest('main')
  if (host) {
    const styles = getComputedStyle(host)
    themeStyle.value = Object.fromEntries(['--ink', '--muted', '--line', '--blue', '--blue-dark', '--paper', '--card']
      .map(name => [name, styles.getPropertyValue(name).trim()]).filter(([, value]) => value))
  }
  opened.value = true
  lockScroll()
  await nextTick()
  closeButton.value?.focus({ preventScroll: true })
  void loadCurrencyPreference()
}
function trapFocus(event) {
  const controls = [...(sheetElement.value?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)') || [])]
  if (!controls.length) return
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
}
let grabStartY = 0
function grabStart(event) { grabStartY = event.changedTouches[0]?.clientY || 0 }
function grabEnd(event) { if ((event.changedTouches[0]?.clientY || 0) - grabStartY > 90) closeTools() }
function closeTools() {
  if (!opened.value) return
  opened.value = false
  requestSequence++
  unlockScroll()
  nextTick(() => launchButton.value?.focus({ preventScroll: true }))
}
onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
  requestSequence++
  if (opened.value) unlockScroll()
})
function addKey(key) {
  if (key === 'C') { expression.value = ''; return }
  if (key === '⌫') { expression.value = expression.value.slice(0, -1); return }
  if (key === '=') {
    if (calculatorResult.value != null) expression.value = String(calculatorResult.value)
    return
  }
  if (expression.value.length < 80) expression.value += key
}
async function loadRate() {
  const selected = currency.value
  const sequence = ++requestSequence
  info.value = null
  fxError.value = ''
  if (selected === 'JPY') {
    info.value = { from: 'JPY', to: 'JPY', rate: 1, date: '', source: 'identity' }
    fxLoading.value = false
    return
  }
  fxLoading.value = true
  try {
    const response = await fetch('/api/exchange-rate?from=' + encodeURIComponent(selected), { headers: { Accept: 'application/json' } })
    if (!response.ok) throw Error('rate')
    const data = await response.json()
    if (data.from !== selected || data.to !== 'JPY' || !Number.isFinite(data.rate) || data.rate <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw Error('rate')
    if (opened.value && sequence === requestSequence) info.value = data
  } catch {
    if (opened.value && sequence === requestSequence) fxError.value = 'レートを取得できません。手動入力もできます。'
  } finally {
    if (sequence === requestSequence) fxLoading.value = false
  }
}
watch(currency, selected => {
  if (currencyLoaded && appContext?.api) {
    void appContext.api('app-state',{method:'PUT',body:JSON.stringify({key:'fx_currency',value:selected})})
      .catch(error => { fxError.value = '通貨設定をD1に保存できません：' + error.message })
  }
  manualRate.value = false
  manualRateText.value = ''
  if (opened.value && activeTab.value === 'fx') void loadRate()
})
function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'fx' && !info.value && !fxLoading.value) void loadRate()
}
function switchManualRate() {
  manualRate.value = !manualRate.value
  if (manualRate.value && !manualRateText.value && info.value) manualRateText.value = String(info.value.rate)
}
const appliedRate = computed(() => manualRate.value ? Number(manualRateText.value) : info.value?.rate)
const fxResult = computed(() => convertToYen(foreignAmount.value, appliedRate.value))
const chosenResult = computed(() => activeTab.value === 'calc' ? taxSummary.value?.total ?? null : fxResult.value)
watch([chosenResult, activeTab], () => { copyFeedback.value = '' })
async function copyResult() {
  if (chosenResult.value == null) return
  const digits = String(chosenResult.value)
  let copied = false
  try {
    if (!navigator.clipboard?.writeText) throw Error('clipboard_unavailable')
    await navigator.clipboard.writeText(digits)
    copied = true
  } catch {
    // Fallback for older iOS webviews: copy the current numeric result only.
    const temporary = document.createElement('textarea')
    temporary.value = digits
    temporary.readOnly = true
    temporary.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(temporary)
    temporary.focus()
    temporary.select()
    try { copied = document.execCommand('copy') } catch { /* unsupported */ }
    temporary.remove()
  }
  copyFeedback.value = copied ? 'copied' : 'failed'
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copyFeedback.value = '' }, 2000)
}
function apply() {
  if (chosenResult.value == null) return
  const amount = chosenResult.value
  emit('update:modelValue', amount)
  draft.value = formatYenInput(amount)
  closeTools()
}
</script>

<template>
  <div class="money-entry-row">
    <div class="money-entry-input">
      <span class="money-symbol" aria-hidden="true">¥</span>
      <input ref="moneyInput" :value="draft" type="text" inputmode="numeric" autocomplete="off"
        :aria-label="inputLabel" placeholder="0" required
        @input="onAmountInput" @blur="onAmountBlur" />
    </div>
    <button ref="launchButton" class="money-tools-trigger" type="button" aria-label="計算・為替換算を開く" @click="openTools">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="5" y="2.5" width="14" height="19" rx="2.5"/>
        <path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>
      </svg>
    </button>
  </div>
  <Teleport to="body">
    <div v-if="opened" class="money-modal-backdrop" :style="themeStyle" @click.self="closeTools" @keydown.esc.stop.prevent="closeTools">
      <section ref="sheetElement" class="money-sheet" role="dialog" aria-modal="true" aria-labelledby="money-sheet-title" @keydown.enter.stop.prevent @keydown.tab="trapFocus">
        <div class="money-sheet-grabber" aria-hidden="true" @touchstart.passive="grabStart" @touchend.passive="grabEnd"></div>
        <h2 id="money-sheet-title" class="money-sr-only">金額ツール</h2>
        <div class="money-sheet-top">
          <div class="money-sheet-tabs" role="tablist" aria-label="金額ツールの種類">
            <button type="button" role="tab" :aria-selected="activeTab==='calc'" :class="{selected:activeTab==='calc'}" @click="switchTab('calc')">計算</button>
            <button type="button" role="tab" :aria-selected="activeTab==='fx'" :class="{selected:activeTab==='fx'}" @click="switchTab('fx')">為替換算</button>
          </div>
          <button ref="closeButton" type="button" class="money-sheet-close" aria-label="閉じる" @click="closeTools">×</button>
        </div>
        <div class="money-sheet-scroll">
          <div v-if="activeTab==='calc'" class="money-calculator" role="tabpanel">
            <div class="money-tax-controls">
              <div class="money-tax-row">
                <span class="money-tax-label">消費税</span>
                <div class="money-tax-choices" role="group" aria-label="消費税を加算">
                  <button v-for="option in [{ value:0, label:'なし' }, { value:10, label:'10%' }, { value:8, label:'8%' }]"
                    :key="option.value" type="button" :aria-pressed="taxRate===option.value"
                    :class="{selected:taxRate===option.value}" @click="taxRate=option.value">{{option.label}}</button>
                </div>
              </div>
              <label v-if="taxRate!==0" class="money-tax-row money-rounding-row">
                <span class="money-tax-label">端数</span>
                <span class="money-rounding-picker">
                  <select v-model="taxRounding" aria-label="消費税の端数処理">
                    <option value="floor">切り捨て</option>
                    <option value="round">四捨五入</option>
                    <option value="ceil">切り上げ</option>
                  </select>
                </span>
              </label>
            </div>
            <div class="money-result-box" aria-live="polite">
              <div class="money-expression-preview" aria-label="入力中の計算">{{ expression || '0' }}</div>
              <span>{{taxRate===0?'計算結果':'税込合計'}}</span>
              <strong>{{ taxSummary == null ? '—' : '¥' + taxSummary.total.toLocaleString('ja-JP') }}</strong>
              <div v-if="taxRate!==0 && taxSummary" class="money-tax-breakdown">
                <span>税抜 ¥{{taxSummary.subtotal.toLocaleString('ja-JP')}}</span>
                <span>消費税（{{taxRate}}%） ¥{{taxSummary.tax.toLocaleString('ja-JP')}}</span>
              </div>
            </div>
            <div class="money-keypad">
              <button v-for="key in ['C','⌫','(',')','7','8','9','÷','4','5','6','×','1','2','3','−','0','.','=','+']"
                :key="key" type="button" :class="{operator:['÷','×','−','+','='].includes(key),muted:['C','⌫','(',')'].includes(key)}"
                :aria-label="key==='⌫'?'1文字削除':key==='C'?'クリア':key" @click="addKey(key)">{{ key }}</button>
            </div>
          </div>
          <div v-else class="money-fx" role="tabpanel">
            <label class="money-sr-only" for="money-from">換算元</label>
            <div class="money-fx-source">
              <select id="money-from" v-model="currency" aria-label="換算元の通貨">
                <option value="CNY">CNY · 人民元</option>
                <option value="USD">USD · 米ドル</option>
                <option value="EUR">EUR · ユーロ</option>
                <option value="KRW">KRW · 韓国ウォン</option>
                <option value="JPY">JPY · 日本円</option>
              </select>
              <input v-model="foreignAmount" type="text" inputmode="decimal" autocomplete="off"
                aria-label="換算元の金額" placeholder="0" />
            </div>
            <div class="money-fx-arrow" aria-hidden="true">↓ <span>日本円へ換算</span></div>
            <div class="money-result-box">
              <span>換算結果</span>
              <strong>{{ fxResult == null ? '—' : '¥' + fxResult.toLocaleString('ja-JP') }}</strong>
            </div>
            <div class="money-rate-info" role="status">
              <span v-if="fxLoading && !manualRate">レート取得中…</span>
              <span v-else-if="manualRate">手動レート · 1 {{currency}} = {{manualRateText || '—'}} 円</span>
              <span v-else-if="info">参考レート · 1 {{currency}} = {{info.rate.toLocaleString('ja-JP', { maximumFractionDigits: 6 })}} 円<span v-if="info.date"> · {{info.date}} 基準</span></span>
              <span v-else-if="fxError">{{fxError}}</span>
            </div>
            <button type="button" class="money-rate-change" :aria-pressed="manualRate" @click="switchManualRate">{{manualRate ? '参考レートに戻す' : 'レートを手入力'}}</button>
            <label v-if="manualRate" class="money-manual-rate">
              <span>1 {{ currency }} あたりの円</span>
              <input v-model="manualRateText" type="text" inputmode="decimal" autocomplete="off" placeholder="例：21.5" />
            </label>
          </div>
        </div>
        <div class="money-sheet-footer">
          <div class="money-footer-actions">
            <button type="button" class="money-copy" :disabled="chosenResult == null" @click="copyResult">{{copyFeedback==='copied'?'コピーしました':copyFeedback==='failed'?'コピー失敗':'結果をコピー'}}</button>
            <button type="button" class="money-apply" :disabled="chosenResult == null" @click="apply">金額に反映</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.money-entry-row{display:flex;align-items:stretch;gap:9px;min-width:0;width:100%}
.money-entry-input{display:flex;align-items:center;gap:9px;min-width:0;flex:1;border:1px solid var(--line,#e0e6ed);border-radius:14px;background:var(--card,#fff);padding:0 12px}
.money-entry-input:focus-within{border-color:var(--blue,#7b9ce9);box-shadow:0 0 0 3px color-mix(in srgb,var(--blue,#7b9ce9) 15%,transparent)}
.money-symbol{font-size:20px;font-weight:800;color:var(--blue,#6798d8)}
.money-entry-input input{font-size:26px!important;font-weight:800;letter-spacing:-.03em;color:var(--ink,#253246);border:0!important;background:transparent!important;box-shadow:none!important;outline:0!important;min-height:50px;padding:8px 0!important;width:100%!important;min-width:0!important;font-variant-numeric:tabular-nums}
.money-tools-trigger{display:grid;place-items:center;flex:0 0 52px;min-height:52px;border:1px solid var(--line,#e0e6ed);border-radius:14px;background:var(--tint,#f4f6fe);color:var(--blue-dark,var(--blue,#486ca9));padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.money-tools-trigger svg{width:23px;height:23px}
.money-tools-trigger:active{transform:scale(.97)}
.money-tools-trigger:focus-visible,.money-sheet button:focus-visible{outline:2px solid var(--blue,#7b9ce9);outline-offset:2px}
.money-modal-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;background:rgba(19,30,48,.45);padding:0;overscroll-behavior:contain}
.money-sheet{width:100%;max-width:540px;max-height:min(90dvh,760px);margin-inline:auto;display:flex;flex-direction:column;min-height:0;border-radius:24px 24px 0 0;background:var(--card,#fff);color:var(--ink,#283346);box-shadow:0 -15px 60px #15223935;overflow:hidden}
.money-sheet-grabber{width:36px;height:5px;border-radius:99px;background:var(--line,#dadce2);margin:7px auto 1px;flex:none;touch-action:pan-y}
.money-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.money-sheet-top{display:flex;align-items:center;gap:9px;padding:5px 14px 8px;min-width:0;flex:none}

.money-sheet-close{flex:0 0 44px;width:44px;height:44px;border:0;border-radius:12px;font-size:25px;line-height:1;background:var(--paper,#f2f4f7);color:var(--ink,#283346)}
.money-sheet-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1;min-width:0;margin:0;padding:3px;gap:3px;border-radius:12px;background:var(--paper,#f3f5fa)}
.money-sheet-tabs button{border:0;min-height:44px;border-radius:9px;background:transparent;color:var(--muted,#63718a);font-size:14px;font-weight:750}
.money-sheet-tabs button.selected{color:var(--blue-dark,var(--blue,#486ca9));background:var(--card,#fff);box-shadow:0 2px 8px #192d3c16}
.money-sheet-scroll{overflow-y:auto;overscroll-behavior:contain;min-height:0;padding:2px 14px 9px;flex:1}
.money-caption{display:block;font-size:12px;font-weight:700;color:var(--muted,#6e7a90);margin:0}
.money-expression-preview{width:100%;max-width:100%;min-height:20px;overflow-x:auto;overflow-y:hidden;white-space:nowrap;text-align:right;direction:ltr;font-size:15px;line-height:1.3;font-weight:650;color:var(--muted,#6e7a90);font-variant-numeric:tabular-nums;scrollbar-width:none}
.money-expression-preview::-webkit-scrollbar{display:none}
.money-result-box{margin:6px 0 9px;display:flex;flex-direction:column;gap:1px;align-items:flex-end;justify-content:center;border-radius:13px;padding:8px 12px;background:var(--tint,#f3f6fc);min-height:62px}
.money-result-box span{font-size:12px;color:var(--muted,#6e7a90)}
.money-result-box strong{font-size:clamp(23px,7vw,30px);font-weight:850;line-height:1.2;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.money-keypad{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.money-keypad button{min-width:0;min-height:46px;border:1px solid var(--line,#dfe3eb);border-radius:11px;background:var(--paper,#f9fafc);color:var(--ink,#283346);font-size:19px;font-weight:750;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.money-keypad button:active{transform:scale(.96)}
.money-keypad button.operator{background:var(--tint,#edf2ff);color:var(--blue-dark,var(--blue,#486ca9))}
.money-keypad button.muted{color:var(--muted,#6e7a90)}
.money-fx-source{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:9px}
.money-fx-source select,.money-fx-source input,.money-manual-rate input{box-sizing:border-box;min-width:0;width:100%;min-height:50px;padding:10px!important;border:1px solid var(--line,#dfe3eb)!important;border-radius:12px!important;background:var(--paper,#fafbff)!important;color:var(--ink,#283346);font-size:16px!important}
.money-fx-arrow{text-align:center;margin:6px auto 1px;color:var(--muted,#6e7a90);font-size:14px}
.money-fx-arrow span{font-size:13px;font-weight:750}
.money-rate-info{min-height:28px;padding:2px 0;font-size:12px;line-height:1.45;color:var(--muted,#6e7a90)}
.money-rate-change{min-height:44px;border:0;background:transparent;color:var(--blue-dark,var(--blue,#486ca9));font-size:13px;font-weight:750;padding:4px 0}
.money-manual-rate{display:grid;gap:6px;font-size:12px;color:var(--muted,#6e7a90);padding:4px 0 8px}
.money-tax-controls{display:flex;align-items:center;gap:6px;min-width:0;white-space:nowrap;margin:1px 0 6px}
.money-tax-row{display:flex;flex:0 0 auto;align-items:center;gap:6px;min-width:0;min-height:44px}
.money-tax-label{flex:0 0 38px;font-size:12px;font-weight:700;color:var(--muted,#6e7a90);white-space:nowrap}
.money-tax-choices{display:inline-flex;flex:0 0 auto;align-items:center;gap:3px;min-width:0;padding:0;background:none}
.money-tax-choices button{flex:0 0 auto;min-width:46px;min-height:44px;padding:0 8px;border:1px solid var(--line,#e5e8ee);border-radius:11px;background:var(--paper,#f7f8fb);color:var(--muted,#6e7a90);font-size:13px;font-weight:750;touch-action:manipulation;white-space:nowrap}
.money-tax-choices button.selected{border-color:var(--blue,#668bdd);background:var(--tint,#f2f4fb);color:var(--blue-dark,var(--blue,#486ca9));box-shadow:inset 0 0 0 1px var(--blue,#668bdd)}
.money-rounding-row{gap:4px}
.money-rounding-row .money-tax-label{flex:0 0 auto;font-size:12px}
.money-rounding-picker{position:relative;display:inline-flex;align-items:center;min-width:0}
.money-rounding-picker:after{content:'⌄';position:absolute;right:6px;top:50%;transform:translateY(-55%);font-size:14px;color:var(--blue-dark,var(--blue,#486ca9));pointer-events:none}
.money-rounding-picker select{box-sizing:border-box;appearance:none;-webkit-appearance:none;display:block;min-width:0;width:100px;height:44px;min-height:44px;padding:6px 20px 6px 7px!important;border:1px solid var(--line,#e5e8ee)!important;border-radius:11px!important;background:var(--paper,#f7f8fb)!important;color:var(--ink,#283346);font-size:12px!important;font-weight:750;line-height:1.25;touch-action:manipulation}
.money-rounding-picker select:focus-visible{outline:2px solid var(--blue,#668bdd);outline-offset:2px}
@media(max-width:390px){.money-tax-controls{gap:4px}.money-tax-row{gap:4px}.money-tax-label{flex-basis:36px;font-size:11px}.money-tax-choices button{min-width:44px;padding-inline:7px}.money-rounding-row .money-tax-label{font-size:11px}.money-rounding-picker select{width:92px;padding-left:6px!important;font-size:11px!important}}
@media(max-width:350px){.money-tax-label{flex-basis:34px}.money-tax-choices{gap:2px}.money-tax-choices button{padding-inline:6px}.money-rounding-picker select{width:84px;padding-right:17px!important}.money-rounding-picker:after{right:4px}}
.money-tax-breakdown{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;column-gap:12px;row-gap:3px;width:100%;font-size:11px;color:var(--muted,#6e7a90)}
.money-tax-breakdown span{font-size:11px}
.money-footer-actions{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:9px}
.money-copy{width:100%;min-height:48px;border:1px solid var(--line,#dfe3eb);border-radius:12px;background:var(--paper,#f6f7fa);color:var(--blue-dark,var(--blue,#486ca9));font-size:13px;font-weight:750;touch-action:manipulation;white-space:nowrap}
.money-sheet-footer{flex:none;background:var(--card,#fff);border-top:1px solid var(--line,#e5e8ee);padding:8px 14px calc(8px + env(safe-area-inset-bottom,0px))}
.money-apply{display:block;width:100%;min-height:48px;border:0;border-radius:12px;background:var(--blue,#668bdd);color:white;font-size:15px;font-weight:800;touch-action:manipulation}
.money-apply:disabled{opacity:.4;cursor:not-allowed}
@media(max-height:650px){.money-sheet{max-height:96dvh}.money-keypad button{min-height:44px}.money-result-box{min-height:54px;margin:5px 0 7px}.money-sheet-top{padding-block:3px 5px}}
@media(min-width:600px){.money-modal-backdrop{align-items:center;padding:20px}.money-sheet{border-radius:24px;max-height:min(90dvh,760px)}}
</style>
