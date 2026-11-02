import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries, parseEntry } from '../src/parse.js'
import { paymentForDraft } from '../src/payment-rules.js'

const reference = new Date('2026-11-02T19:36:00+09:00')

// Exact text obtained from the user's iPhone on-device Tesseract output.
// This is NOT a cleaned-up or simulated ideal OCR result.
const iphoneOcr = [
  'シロ クオ ン ラ イン ショ ッ プ 3.808[',
  '2026 年 11 月 2 日 19 時 27 分',
  '世 」 クレ ジッ ト visa'
].join('\n')

test('real iPhone local OCR: 3.808[ means 3808 yen, not 808 or 2026', () => {
  const rows = parseEntries(iphoneOcr, [], reference)
  assert.equal(rows.length, 1)
  assert.deepEqual(
    [rows[0].merchant, rows[0].amount, rows[0].date, rows[0].time],
    ['シロクオンラインショップ', 3808, '2026-11-02', '19:27']
  )
})

test('local OCR supports comma/dot, full-width separators and malformed currency brackets', () => {
  for (const amountText of ['3,808[', '3.808[', '3．808［', '¥3.808', '3.808円', '3808[']) {
    const rows = parseEntries('シロクオンラインショップ ' + amountText +
      '\n2026 年 11 月 2 日 19 時 27 分\nクレジット VISA', [], reference)
    assert.equal(rows.length, 1, amountText)
    assert.equal(rows[0].amount, 3808, amountText)
    assert.equal(rows[0].merchant, 'シロクオンラインショップ', amountText)
  }
})

test('dot-grouped notification amount does not take digits from printed date', () => {
  const row = parseEntry('シロクオンラインショップ 3.808[\n2026 年 11 月 2 日 19 時 27 分', [])
  assert.equal(row.amount, 3808)
  assert.equal(row.time, '19:27')
})

test('a timestamp without a price still produces a zero amount', () => {
  const rows = parseEntries('シロクオンラインショップ\n2026 年 11 月 2 日 19 時 27 分', [], reference)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount, 0)
})

test('merchant names containing ordinary digits must remain intact', () => {
  const rows = parseEntries('セブン-イレブン 3.808[\n2026 年 11 月 2 日 19 時 27 分', [], reference)
  assert.equal(rows[0].merchant, 'セブン-イレブン')
  assert.equal(rows[0].amount, 3808)
})

test('VISA on an OCR notification is not evidence of a particular credit card', () => {
  const row = parseEntries(iphoneOcr, [], reference)[0]
  assert.equal(row.paymentSource || '', '')
  assert.equal(paymentForDraft({
    merchant: row.merchant, recognized: row.paymentSource,
    registeredSources: ['PayPayカード', 'セゾンカード'],
    defaultSource: 'セゾンカード'
  }), 'セゾンカード')
})
