import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGemmaText, recognizeWithGemma, GEMMA_MODEL } from '../functions/api/gemma-ocr.js'

test('Gemma response is bounded and rejects empty text', () => {
  assert.equal(normalizeGemmaText({ response: ' 店舗 1,000円 ' }), '店舗 1,000円')
  assert.equal(normalizeGemmaText({ response: 'a'.repeat(17000) }).length, 16000)
  assert.throws(() => normalizeGemmaText({ response: '' }))
})
test('AI binding required and unsupported MIME rejected before model call', async () => {
  await assert.rejects(recognizeWithGemma(null, new ArrayBuffer(0), 'image/png', 'receipt'))
  await assert.rejects(recognizeWithGemma({ run() { throw Error('unexpected') } }, new ArrayBuffer(0), 'text/plain', 'receipt'))
})
test('Gemma receives Japanese OCR instructions and an image', async () => {
  let called
  const ai = { async run(model, options) { called = { model, options }; return { response: '2026/10/28\n合計 500円' } } }
  const text = await recognizeWithGemma(ai, new Uint8Array([1,2,3]).buffer, 'image/png', 'receipt')
  assert.equal(text, '2026/10/28\n合計 500円')
  assert.equal(called.model, GEMMA_MODEL)
  assert.equal(called.options.messages[0].content[1].type, 'image_url')
})
