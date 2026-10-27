import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries } from '../src/parse.js'

test('parses every QP card transaction instead of falling back to one entry', () => {
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
QP/ ダ イ ソ ー 220 m 、
10 月 5 日 1 回 払い`
  const rows = parseEntries(input, [])
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map(row => row.date), [
    '2026-10-07', '2026-10-07', '2026-10-06', '2026-10-06',
    '2026-10-06', '2026-10-05', '2026-10-05'
  ])
  assert.deepEqual(rows.map(row => row.amount).filter(Boolean).length, 7)
  assert.match(rows[0].merchant, /イトーヨーカドータカサゴテン/)
  assert.match(rows[1].merchant, /ダイソー/)
  assert.match(rows[4].merchant, /マイバスケット/)
})
