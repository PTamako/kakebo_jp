import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt } from './category-rule-test-helpers.js'

const receipt = `セブン-イレブン
那覇旭町金秀ビル前店
2026年05月04日(月) 20:00
い・ろ・は・す天然水540ml *118
明治 酪農牛乳 180ml *104
小 計 (税抜 8%) ¥222
消費税等 (8%) ¥17
合 計 ¥239
(税率 8%対象 ¥239)
(内消費税等 8% ¥17)
Suica支払 ¥239
Suica残高 ¥9,126
5/5(火) 1本無料クーポン`

test('receipt total is 239, not balance, tax or item amounts', () => {
 const result = parseReceipt(receipt)
 assert.equal(result.amount, 239)
 assert.equal(result.date, '2026-05-04')
 assert.equal(result.time, '20:00')
 assert.equal(result.category, '饮食料品')
 assert.match(result.merchant, /セブン/)
})

test('receipt without explicit total needs review rather than guessing largest amount', () => {
 const result = parseReceipt('セブン-イレブン\n水 ¥118\n牛乳 ¥104\nSuica残高 ¥9,126')
 assert.equal(result.amount, 0)
 assert.match(result.note, /要確認/)
})

test('OCR damaged total label is recovered from matching tax-inclusive amount, not wrong Suica payment', () => {
 const ocr = `セフン - イルブン
那覇旭町金秀ビル前店
2026 年 05 月 04 日 (月 ) 20:00 %122
い・ろ・は・す天然水 540ml *118
小計 ( 税抜 8%) \\222
消費税等 ( 8%) \\17
= =t ¥239
(税率 8% え対象 \\239)
Suica 支払 ¥539
Suica 残高 ¥9, 126`
 const result = parseReceipt(ocr)
 assert.equal(result.amount, 239)
 assert.equal(result.date, '2026-05-04')
 assert.equal(result.time, '20:00')
})

test('OCR damaged total without independent corroboration requires review', () => {
 const result = parseReceipt('小計 ¥222\\n消費税 ¥17\\n= =t ¥239\\nSuica 支払 ¥539')
 assert.equal(result.amount, 0)
})
