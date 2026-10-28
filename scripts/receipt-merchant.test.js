import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt } from '../src/parse.js'

test('AI-labeled store name is not duplicated', () => {
  const receipt = '店名: まいばすけっと 南小岩８丁目店\\n日付: 2026/10/28\\n合計: ¥311\\n支払方法: QUICPay\\n小計 ¥288\\n外税 8% ¥23'
  const result = parseReceipt(receipt)
  assert.equal(result.merchant, 'まいばすけっと 南小岩8丁目店')
  assert.equal(result.amount, 311)
  assert.equal(result.date, '2026-10-28')
})

test('legacy two-line store name keeps one brand', () => {
  const result = parseReceipt('まいばすけっと\\n南小岩8丁目店\\n2026/10/28\\n合計 ¥311')
  assert.equal(result.merchant, 'まいばすけっと 南小岩8丁目店')
})
