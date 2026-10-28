import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries } from './category-rule-test-helpers.js'

test('parses multiple QUICPay statement rows even when OCR adds a prefix before QP/', () => {
  const input = `QUICPay 利用 (QP/ マイバスケット ) 628gm |
10 月 17 日 1 回 払い
QUICPay 利用 (QP/ マイバスケット ) 373gm 、
10 月 16 日 1 回 払い
QUICPay 利用 (QP/ マイバスケット ) 320m 、
10 月 15 日 1 回 払い
QUICPay 利用 (QP/ マイバスケット ) 460 m
10 月 14 日 1 回 払い
QUICPay 利用 (QP/ マイバスケット ) 311m
10 月 13 日 1 回 払い
QUICPay 利用 (QP/ ベルク ) 4.140g
10 月 11 日 1 回 払い`

  const rows = parseEntries(input, [])
  assert.equal(rows.length, 6)
  assert.deepEqual(rows.map(row => row.amount), [628, 373, 320, 460, 311, 4140])
  assert.deepEqual(rows.map(row => row.date), [
    '2026-10-17',
    '2026-10-16',
    '2026-10-15',
    '2026-10-14',
    '2026-10-13',
    '2026-10-11'
  ])
  assert.equal(rows[0].merchant, 'マイバスケット')
  assert.equal(rows[5].merchant, 'ベルク')
})

test('does not invent an amount for an ambiguous OCR merchant row', () => {
  const input = `UICPay# Pー ヨ ー カ ドー タタ
2 の a
10 月 14 日 1 回 払い`

  const rows = parseEntries(input, [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount, 0)
})
