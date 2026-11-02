import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries } from '../src/parse.js'
import { paymentForDraft } from '../src/payment-rules.js'
import { recognizeWithGemma } from '../functions/api/gemma-ocr.js'

test('PayPay notification OCR reads comma-grouped amount instead of the year and strips price from merchant', () => {
  const raw = [
    'シロクオンラインショップ 3,808[',
    '2026年11月2日 19時27分',
    'クレジット VISA',
    '支払い受付'
  ].join('\n')
  const rows = parseEntries(raw, [], new Date('2026-11-02T19:36:00+09:00'))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].merchant, 'シロクオンラインショップ')
  assert.equal(rows[0].amount, 3808)
  assert.equal(rows[0].date, '2026-11-02')
  assert.equal(rows[0].time, '19:27')
})

test('year and clock never become a fabricated amount when amount is absent', () => {
  const rows = parseEntries('シロクオンラインショップ\n2026 年 11 月 2 日 19:27\nクレジット VISA', [],
    new Date('2026-11-02T19:36:00+09:00'))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount, 0)
})

test('well-formed AI transaction rows keep merchant, amount, time and payment separate', () => {
  const rows = parseEntries('2026年11月2日,19:27,シロクオンラインショップ,3808,PayPayクレジット', [],
    new Date('2026-11-02T19:36:00+09:00'))
  assert.deepEqual(rows.map(x => [x.merchant, x.amount, x.date, x.time, x.paymentSource]),
    [['シロクオンラインショップ', 3808, '2026-11-02', '19:27', 'PayPayクレジット']])
})

test('explicit PayPay credit uses only the unique registered PayPay card', () => {
  const cards = ['セゾンカード', 'PayPayカード', '楽天カード']
  const args = { merchant: 'シロクオンラインショップ', recognized: 'PayPayクレジット',
    registeredSources: cards, defaultSource: 'セゾンカード' }
  assert.equal(paymentForDraft(args), 'PayPayカード')
  assert.equal(paymentForDraft({ ...args, recognized: 'VISA' }), 'セゾンカード')
  assert.equal(paymentForDraft({ ...args, registeredSources: [...cards, 'PayPayカード VISA'] }), 'セゾンカード',
    'ambiguous PayPay cards must not be guessed')
  assert.equal(paymentForDraft({ ...args, rules: [{keyword: 'シロク', payment_source: '楽天カード'}] }), '楽天カード',
    'user merchant payment rules still take priority')
  assert.equal(paymentForDraft({ ...args, importSource: '楽天カード' }), '楽天カード',
    'explicit import card stays authoritative')
})

test('Gemma statement instruction keeps exactly five CSV columns without price commas', async () => {
  let prompt
  const ai = { async run(_model, options) {
    prompt = options.messages[0].content[0].text
    return { response: '2026年11月2日,19:27,シロクオンラインショップ,3808,PayPayクレジット' }
  } }
  await recognizeWithGemma(ai, new Uint8Array([1]).buffer, 'image/png', 'statement')
  assert.match(prompt, /半角数字のみ（例：3808）/)
  assert.match(prompt, /店舗名列には店名だけ/)
  assert.match(prompt, /PayPayクレジット/)
  assert.doesNotMatch(prompt, /¥2,264/)
})
