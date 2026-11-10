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

test('image card selector precedes document type and serves both receipt and statement', () => {
  const scan = app.slice(app.indexOf('<div v-if="entryInputMode === \'scan\'"'))
  const card = scan.indexOf('v-model="scanImportPaymentSource"')
  const target = scan.indexOf('v-model="recognitionMode"')
  assert.ok(card >= 0 && target > card, 'card selection must appear before document type')
  const scanCardTag = scan.slice(scan.lastIndexOf('<label', card), scan.indexOf('</label>', card))
  assert.doesNotMatch(scanCardTag, /v-if=/, 'receipt must also display the card selector')
  assert.match(scanCardTag, /:disabled="!!busy"/)
})

test('manual text and image OCR each bind to their own card selection', () => {
  const manual = app.slice(app.indexOf('<div v-if="entryInputMode === \'manual\'"'), app.indexOf('<div v-if="entryInputMode === \'scan\'"'))
  const scan = app.slice(app.indexOf('<div v-if="entryInputMode === \'scan\'"'), app.indexOf('<div v-if="forms.length || input.trim()"'))
  assert.match(manual, /v-model="importPaymentSource"/)
  assert.doesNotMatch(manual, /v-model="scanImportPaymentSource"/)
  assert.match(scan, /v-model="scanImportPaymentSource"/)
  assert.doesNotMatch(scan, /v-model="importPaymentSource"/)
})
