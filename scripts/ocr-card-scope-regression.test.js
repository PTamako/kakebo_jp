import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectedImportCard } from '../src/import-payment-scope.js'
import { paymentForDraft } from '../src/payment-rules.js'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('manual and image card choices remain independent when switching modes', () => {
  assert.equal(selectedImportCard(false, '楽天カード', 'PayPayカード'), '楽天カード')
  assert.equal(selectedImportCard(true, '楽天カード', 'PayPayカード'), 'PayPayカード')
  assert.equal(selectedImportCard(false, '', 'PayPayカード'), '')
  assert.equal(selectedImportCard(true, '楽天カード', ''), '')
})

test('explicit card overrides OCR payment guesses for both statements and receipts', () => {
  for (const recognized of ['楽天カード', '現金', 'Suica']) {
    assert.equal(paymentForDraft({
      merchant: 'ベルク', recognized, importSource: 'PayPayカード',
      registeredSources: ['楽天カード', 'PayPayカード', 'Suica']
    }), 'PayPayカード')
  }
  assert.match(app, /const imported = selectedImport/)
  assert.doesNotMatch(app, /const imported = effectiveMode === 'statement'/)
  assert.match(app, /selectedImportCard\(fromImage, importPaymentSource\.value, scanImportPaymentSource\.value\)/)
})

test('owner and member share one capture component with card before target type', () => {
 const capture = read('src/OcrCapturePanel.vue')
 const member = read('src/FamilyMemberWorkspace.vue')
 const card=capture.indexOf(':model-value="paymentSource"')
 const target=capture.indexOf(':model-value="mode"')
 assert.ok(card>=0 && target>card, 'card selection must precede document type')
 assert.match(capture, /label="読み取り対象のカード"/)
 assert.match(capture, /:disabled="busy"/)
 assert.match(app, /<OcrCapturePanel v-if="entryInputMode === 'scan'"/)
 assert.match(member, /<OcrCapturePanel v-else/)
})
test('manual and image OCR preserve distinct card selection', () => {
 const capture=read('src/OcrCapturePanel.vue')
 assert.match(app,/v-model="importPaymentSource"/)
 assert.match(app,/:payment-source="scanImportPaymentSource"/)
 assert.match(capture,/:model-value="paymentSource"/)
 assert.doesNotMatch(capture,/v-model="importPaymentSource"/)
})

