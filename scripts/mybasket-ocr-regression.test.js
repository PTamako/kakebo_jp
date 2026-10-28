import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt } from './category-rule-test-helpers.js'

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

test('corrects 20-year OCR error only when receipt date is today and current year appears separately', () => {
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  const wrongYear = today.getFullYear() - 20
  const raw = `まいばすけっと
${wrongYear}/${month}/${day} 12:37
外税 8% 対象額 ¥288
外税 8% ¥23
お取扱日 ${today.getFullYear()} 年 1 月 5 日`
  const row = parseReceipt(raw)
  assert.equal(row.date, `${today.getFullYear()}-${month}-${day}`)
  assert.match(row.note, /日付の年/)
})
