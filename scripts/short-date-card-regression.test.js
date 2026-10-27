import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntries } from '../src/parse.js'

test('parses all eight rows from card statement with OCR suffix noise', () => {
  const input = `は ま 寿 司 2.992 円 ン
26.10.18 ご 本 人 1 回 払い
マク ドナ ルド モバ イル オー ダ 420 円 て
26.10.16_ ご 本 人 1 回 払い
セブ ンー イレ ブン 744 円 ン
26.10.16_ ご 本 人 1 回 払い
SB | 証券 投信 積立 サー ビス 15,000 円 v
(翌月 買 付 分
26.10.14 ご 本 人 1 回 払い
東京 都 水 道 局 4,096 円 て
26.10.14 ご 本 人 1 回 払い
ネス レニ ツ ポ ン オン ライ ン 9,590H v
26.10.12 ご 本 人 1 回 払い
ガス ト 1990 円 ン
26.10.09 ご 本 人 1 回 払い
ジョ ナ サ ン 3,677 円 ン
26.10.04 ご 本 人 1 回 払い`
  const rows = parseEntries(input, [])
  assert.equal(rows.length, 8)
  assert.deepEqual(rows.map(row => row.date), [
    '2026-10-18', '2026-10-16', '2026-10-16', '2026-10-14',
    '2026-10-14', '2026-10-12', '2026-10-09', '2026-10-04'
  ])
  assert.deepEqual(rows.map(row => row.amount), [2992, 420, 744, 15000, 4096, 9590, 1990, 3677])
  assert.match(rows[3].merchant, /翌月/)
})
