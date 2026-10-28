import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries } from './category-rule-test-helpers.js'

test('QP statement yields seven independent transactions with correct amounts', () => {
  const input = `QP/ イ トー ヨー カド ー タカ サ ゴ テン 537 m
10 月 7 日 1 回 払い ’
QP/ ダ イソ ー 880m 、
10 月 7 日 1 回 払い
QP/ ダ イソ ー 220 m 、
10 月 6 日 1 回 払い
QP/ イ トー ヨー カド ー タカ サ ゴ テン o22 ロ 、
10 月 6 日 1 回 払い
QP/ マ イ バ ス ケツ ト 309 m 、
10 月 6 日 1 回 払い
QP/ イ トー ヨー カド ー タカ サ ゴ テン 1] 096 ロ 、
10 月 5 日 1 回 払い
QP/ ダ イソ ー 220 m 、
10 月 5 日 1 回 払い`
  const rows = parseEntries(input, [])
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map(row => row.amount), [537, 880, 220, 0, 309, 1096, 220])
  assert.deepEqual(rows.map(row => row.date), [
    '2026-10-07', '2026-10-07', '2026-10-06', '2026-10-06',
    '2026-10-06', '2026-10-05', '2026-10-05'
  ])
  assert.match(rows[0].merchant, /イトーヨーカドータカサゴテン/)
  assert.match(rows[1].merchant, /ダイソー/)
  assert.match(rows[4].merchant, /マイバスケット/)
})


test('QUICPay OCR keeps every transaction when one amount is missing', () => {
  const input = `QUICPay 利用 (QP/ ダイソー) 550m 、
1 回 払い
10 月 21 日
QUICPay 利用 (QOP/ イトーヨーカドー タカサゴテン
カサゴテン) >
1 回 払い
10 月 21 日
QUICPay 利用 (QP/ マイバスケット) 417 = 、
1 回 払い
10 月 20 日
QUICPay 利用 (QP/ マイバスケット) 315m 、
1 回 払い
10 月 19 日
QUICPay 利用 (QP/ ベルク) 4.888gm 、
1 回 払い
10 月 18 日
QUICPay 利用 (QP/ ケンタッキーフライドチキン) 1,580円 、
1 回 払い
10 月 17 日
QUICPay 利用 (QP/ イオンフードスタイル) 254 = 、
1 回 払い
10 月 17 日`
  const withRightColumn = input + '\n__QP_AMOUNT_COLUMN__\n550\n392\n417\n315\n4888\n1580\n254'
  const rows = parseEntries(withRightColumn, [])
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map(row => row.amount), [550, 392, 417, 315, 4888, 1580, 254])
  assert.match(rows[1].merchant, /イトーヨーカドー/)
  assert.match(rows[1].note, /^$/)
  assert.match(rows[5].merchant, /ケンタッキー/)
})
