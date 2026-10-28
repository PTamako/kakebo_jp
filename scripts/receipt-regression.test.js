import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt } from '../src/parse.js'

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
