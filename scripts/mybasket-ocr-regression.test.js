import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt } from '../src/parse.js'

const actualOcr = `まい ば きけ っ と
南小 岩 8 丁 目 店
TELO3-5612-1338 FAX03-5612- 1339
登録 番号 「104DU01054552
Ly0107  2006/10/28(5K)  12:37
梅 し そし ば 漬 押 考 人 り 99※
お いし い 水 6 記 上 ペ ル  BI%
/v ET ¥288
外 税 8% 対 象 額 \\288
外 税 8% ¥23
合 &f rrelilly
QUICPay 支払 Y911
HE9Y ¥0
_ お 買上 商品 数 :3`

test('recovers ¥311 from spaced OCR taxable base and tax, not Y911', () => {
  const row = parseReceipt(actualOcr)
  assert.equal(row.amount, 311)
  assert.equal(row.merchant, 'まいばすけっと 南小岩8丁目店')
  assert.equal(row.category, '饮食料品')
  assert.match(row.note, /要確認/)
})

test('does not treat unverified QUICPay Y911 as receipt total', () => {
  const row = parseReceipt('まいばすけっと\\n合 &f rrelilly\\nQUICPay 支払 Y911')
  assert.equal(row.amount, 0)
})
