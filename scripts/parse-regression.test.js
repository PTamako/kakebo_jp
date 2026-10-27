import test from 'node:test'
import assert from 'node:assert/strict'
import { classify, parseEntries } from '../src/parse.js'

const rules = []

test('parses card statement with reference numbers and date/payment/amount on the next line', () => {
  const input = `楽天SP サンドラッグダイレックスアプリ 712345
2026/10/18 1回払い ¥1,011
Suicaチャージ（楽天ペイ） 705507
2026/10/17 1回払い ¥1,000
Suicaチャージ（楽天ペイ） 703246
2026/10/16 1回払い ¥1,000`
  const rows = parseEntries(input, rules)
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(row => [row.merchant, row.date, row.amount]), [
    ['楽天SP サンドラッグダイレックスアプリ', '2026-10-18', 1011],
    ['Suicaチャージ（楽天ペイ）', '2026-10-17', 1000],
    ['Suicaチャージ（楽天ペイ）', '2026-10-16', 1000]
  ])
})

test('parses short-year dates and merchant names with amount on same line', () => {
  const input = `はま寿司 2,992 円
26.10.18 ご本人 1回払い
マクドナルドモバイルオーダ
ー 420 円
26.10.16 ご本人 1回払い
セブンーイレブン 744 円
26.10.16 ご本人 1回払い
SBI証券投信積立サービス
（翌月買付分）15,000 円
26.10.14 ご本人 1回払い`
  const rows = parseEntries(input, rules)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map(row => [row.merchant, row.date, row.amount]), [
    ['はま寿司', '2026-10-18', 2992],
    ['マクドナルドモバイルオーダー', '2026-10-16', 420],
    ['セブンーイレブン', '2026-10-16', 744],
    ['SBI証券投信積立サービス（翌月買付分）', '2026-10-14', 15000]
  ])
})


test('classifies My Basket as a supermarket before the generic bus transport keyword', () => {
  const result = classify('まいばすけっと 葛飾高砂店', [
    { keyword: 'バス', category: '交通' }
  ])
  assert.deepEqual(result, { category: '饮食料品', keyword: 'まいばすけっと' })
})

test('supermarket classification takes priority over conflicting saved transport rules', () => {
  const result = classify('まいばすけっと', [
    { keyword: 'まいばすけっと', category: '交通' },
    { keyword: 'バス', category: '交通' }
  ])
  assert.equal(result.category, '饮食料品')
})

test('transport merchants still classify as transport', () => {
  assert.deepEqual(classify('京成電鉄', [
    { keyword: '京成電鉄', category: '交通' }
  ]), { category: '交通', keyword: '京成電鉄' })
})


test('restaurants remain in the dining category', () => {
  assert.deepEqual(classify('マクドナルド', [
    { keyword: 'マクドナルド', category: '餐饮' }
  ]), { category: '餐饮', keyword: 'マクドナルド' })
})
