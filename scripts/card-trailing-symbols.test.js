import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries } from '../src/parse.js'

test('parses eight card rows when amount lines end in OCR symbols', () => {
  const input = `はま寿司
2,992円～
26.10.18
ご本人
1回払い
マクドナルドモバイルオーダ
420円く
26.10.16
ご本人
1回払い
セブンーイレブン
744円～
26.10.16
ご本人
1回払い
SBI証券投信積立サービス
（翌月買付分）
15,000円～
26.10.14
ご本人
1回払い
東京都水道局
4,096円～
26.10.14
ご本人
1回払い
ネスレニツポン オンライン
9,590円～
26.10.12
ご本人
1回払い
ガスト
1,990円～
26.10.09
ご本人
1回払い
ジョナサン
3,677円～
26.10.04
ご本人
1回払い`
  const rows = parseEntries(input, [])
  assert.equal(rows.length, 8)
  assert.deepEqual(rows.map(row => row.amount), [2992, 420, 744, 15000, 4096, 9590, 1990, 3677])
  assert.deepEqual(rows.map(row => row.date), [
    '2026-10-18', '2026-10-16', '2026-10-16', '2026-10-14',
    '2026-10-14', '2026-10-12', '2026-10-09', '2026-10-04'
  ])
  assert.match(rows[3].merchant, /翌月買付分/)
})
