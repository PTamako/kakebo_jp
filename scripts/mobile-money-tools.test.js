import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatYenInput, normalizeYenInput, calculateYenExpression, convertToYen, calculateJapaneseConsumptionTax } from '../src/amount-tools.js'
import { onRequestGet } from '../functions/api/exchange-rate.js'

const source = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')

test('yen entry groups every three digits while preserving integer ledger values', () => {
  assert.equal(formatYenInput(12345), '12,345')
  assert.equal(formatYenInput(1234567), '1,234,567')
  assert.equal(normalizeYenInput('¥12,345円'), 12345)
  assert.equal(normalizeYenInput('１２，３４５円'), 12345)
  assert.equal(normalizeYenInput('0'), 0)
  assert.equal(normalizeYenInput(''), 0)
  assert.equal(normalizeYenInput('1.2'), null, 'never turn decimals into a different amount')
  assert.equal(normalizeYenInput('-1200'), null, 'never silently strip a negative sign')
  assert.equal(normalizeYenInput('1e5'), null)
  assert.equal(normalizeYenInput('9007199254740992'), null, 'reject unsafe integers')
})

test('calculator uses an arithmetic parser, not eval, and only accepts positive, safe JPY totals', () => {
  assert.equal(calculateYenExpression('1,200 + 380'), 1580)
  assert.equal(calculateYenExpression('1,200 + 380 ÷ 2'), 1390)
  assert.equal(calculateYenExpression('(100 + 20) × 3'), 360)
  assert.equal(calculateYenExpression('10÷4'), 3)
  assert.equal(calculateYenExpression('0'), null, 'zero cannot be posted to ledger')
  assert.equal(calculateYenExpression('3/0'), null)
  assert.equal(calculateYenExpression('3+-5'), null)
  assert.equal(calculateYenExpression('1,2+3'), null, 'bad thousand separator is not accepted')
  assert.equal(calculateYenExpression('1+alert(1)'), null)
  assert.equal(calculateYenExpression('9999999999999999+1'), null)
  assert.equal(convertToYen('100', '21.25'), 2125)
  assert.equal(convertToYen('0', '21'), null)
  assert.equal(convertToYen('100', '0'), null)
  assert.equal(convertToYen('200', 'not a rate'), null)
  assert.equal(convertToYen('1e30', 150), null)
})


test('Japan consumption tax opt-in defaults off and supports 10%/8% with selectable rounding', () => {
  assert.deepEqual(calculateJapaneseConsumptionTax(1580), {subtotal:1580,tax:0,total:1580})
  assert.deepEqual(calculateJapaneseConsumptionTax(1580,10), {subtotal:1580,tax:158,total:1738})
  assert.deepEqual(calculateJapaneseConsumptionTax(1580,8), {subtotal:1580,tax:126,total:1706})
  assert.deepEqual(calculateJapaneseConsumptionTax(101,8,'floor'), {subtotal:101,tax:8,total:109})
  assert.deepEqual(calculateJapaneseConsumptionTax(107,8,'round'), {subtotal:107,tax:9,total:116})
  assert.deepEqual(calculateJapaneseConsumptionTax(101,8,'ceil'), {subtotal:101,tax:9,total:110})
  assert.equal(calculateJapaneseConsumptionTax(0,10),null)
  assert.equal(calculateJapaneseConsumptionTax(-1,8),null)
  assert.equal(calculateJapaneseConsumptionTax(Number.MAX_SAFE_INTEGER,10),null)
  assert.equal(calculateJapaneseConsumptionTax(1000,7),null)
  assert.equal(calculateJapaneseConsumptionTax(1000,10,'bankers'),null)
  const field=source('src/AmountInput.vue')
  assert.match(field, /const taxRate = ref\(0\)/, 'no tax is the default')
  assert.match(field, /const taxRounding = ref\('floor'\)/)
  assert.match(field, /activeTab\.value === 'calc' \? taxSummary\.value\?\.total/, 'copy and apply use final tax-inclusive result')
  assert.match(field, /watch\(\[chosenResult, activeTab\]/, 'stale copy confirmation resets when result or tab changes')
})

test('all transaction forms including edit mode use the shared currency field', () => {
  const transaction = source('src/TransactionForm.vue')
  const app = source('src/App.vue')
  const finance = source('src/FinanceTools.vue')
  const field = source('src/AmountInput.vue')
  assert.match(transaction, /<AmountInput v-model="record.amount"/)
  assert.match(app, /<TransactionForm :record="f"/)
  assert.match(app, /<TransactionForm :record="editingEntry"/)
  assert.match(finance, /<AmountInput v-model="plan.amount"/)
  assert.match(field, /aria-label="計算・為替換算を開く"/)
  assert.match(field, /role="dialog" aria-modal="true"/)
  assert.match(field, /金額に反映/)
  assert.match(field, /class="money-expression-preview"/, 'calculation appears within the unified result display')
  assert.match(field, /aria-label="入力中の計算"/, 'screen reader can identify the expression')
  assert.doesNotMatch(field, /id="money-expression"|@input="setExpression"|<label[^>]*>計算式<\/label>/, 'remove redundant editable expression field')
  assert.match(field, /結果をコピー/)
  assert.doesNotMatch(field, /計算式をコピー|GenUI.copy/)
  assert.match(field, /navigator\.clipboard\.writeText\(digits\)/)
  assert.match(field, /const digits = String\(chosenResult\.value\)/)
  assert.match(field, /copyFeedback==='copied'/)
  assert.match(field, /:disabled="chosenResult == null" @click="copyResult"/)
  assert.match(field, /grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)/)
  assert.match(field, /消費税を加算/)
  assert.match(field, /taxRate===option\.value/)
  assert.match(field, /taxSummary\.value\?\.total/)
  assert.match(field, /税込合計/)
  assert.match(field, /切り捨て/)
  assert.match(field, /四捨五入/)
  assert.match(field, /切り上げ/)
  assert.match(field, /type="button" class="money-apply" :disabled="chosenResult == null"/)
  assert.match(field, /@click.self="closeTools"/)
  assert.match(field, /inputmode="numeric"/)
  assert.match(field, /inputmode="decimal"/)
  assert.match(field, /env\(safe-area-inset-bottom/)
  assert.match(field, /document\.activeElement\?\.blur\(\)/)
  assert.match(field, /localStorage\.setItem\('kakeibo-fx-currency'/)
})

test('FX proxy validates allowed currencies, returns a sourced reference rate and does not touch D1', async () => {
  const invalid = await onRequestGet({request:new Request('https://example.com/api/exchange-rate?from=XSS')})
  assert.equal(invalid.status, 400)
  const original = globalThis.fetch
  const requests = []
  try {
    globalThis.fetch = async url => {
      requests.push(url)
      return Response.json({date:'2026-10-29',base:'CNY',quote:'JPY',rate:21.73})
    }
    const ok = await onRequestGet({request:new Request('https://example.com/api/exchange-rate?from=CNY')})
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(),{from:'CNY',to:'JPY',rate:21.73,date:'2026-10-29',source:'Frankfurter'})
    assert.equal(requests[0], 'https://api.frankfurter.dev/v2/rate/CNY/JPY')
    assert.match(ok.headers.get('Cache-Control'), /max-age=21600/)
    const jpy = await onRequestGet({request:new Request('https://example.com/api/exchange-rate?from=JPY')})
    assert.equal((await jpy.json()).rate, 1)
    assert.equal(requests.length, 1)
    globalThis.fetch = async () => Response.json({date:'2026-10-29',base:'CNY',quote:'USD',rate:1.5})
    const mismatch = await onRequestGet({request:new Request('https://example.com/api/exchange-rate?from=CNY')})
    assert.equal(mismatch.status, 502, 'never apply another currency or unsupported data')
    globalThis.fetch = async () => { throw Error('offline') }
    const failed = await onRequestGet({request:new Request('https://example.com/api/exchange-rate?from=CNY')})
    assert.equal(failed.status, 502, 'no guessed or stale rates')
    assert.equal(failed.headers.get('Cache-Control'), 'no-store')
  } finally { globalThis.fetch = original }
})
