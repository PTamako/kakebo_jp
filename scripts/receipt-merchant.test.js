import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt, parseEntries } from './category-rule-test-helpers.js'

test('AI-labeled store name is not duplicated', () => {
  const receipt = '店名: まいばすけっと 南小岩８丁目店\n日付: 2026/10/28\n合計: ¥311\n支払方法: QUICPay\n小計 ¥288\n外税 8% ¥23'
  const result = parseReceipt(receipt)
  assert.equal(result.merchant, 'まいばすけっと南小岩8丁目店')
  assert.equal(result.amount, 311)
  assert.equal(result.date, '2026-10-28')
})

test('legacy two-line store name keeps one brand', () => {
  const result = parseReceipt('まいばすけっと\n南小岩8丁目店\n2026/10/28\n合計 ¥311')
  assert.equal(result.merchant, 'まいばすけっと 南小岩8丁目店')
})

test('AI statement CSV row uses merchant-only draft title', () => {
  const [entry] = parseEntries('26.07.13, SBI証券投信積立サービス, 10,000円, 1回払い')
  assert.equal(entry.merchant, 'SBI証券投信積立サービス')
  assert.equal(entry.amount, 10000)
  assert.equal(entry.date, '2026-07-13')
})

test('AI multiple statements parse into five merchant-only drafts', () => {
  const input = [
    '10月5日, QP/マイバスケット, 203円, 1回払い',
    '10月4日, QP/ベルク, 4,788円, 1回払い',
    '10月3日, 東急ストア 食料品 －東京都 目黒区, 3,162円, 1回払い',
    '10月2日, QP/マイバスケット, 309円, 1回払い',
    '10月1日, QP/マイバスケット, 420円, 1回払い'
  ].join('\n')
  const rows = parseEntries(input)
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map(row => row.merchant), ['マイバスケット', 'ベルク', '東急ストア食料品 -東京都目黒区', 'マイバスケット', 'マイバスケット'])
  assert.deepEqual(rows.map(row => row.amount), [203, 4788, 3162, 309, 420])
})
test('AI Japanese date rows preserve comma-separated yen amounts', () => {
  const rows = parseEntries('2026年10月25日,ベルク葛飾高砂店,8,323円,クレジットカードVISA\n2026年10月25日,KFCネットオーダー青砥駅店,2,380円,クレジットカードVISA')
  assert.deepEqual(rows.map(row => row.merchant), ['ベルク葛飾高砂店', 'KFCネットオーダー青砥駅店'])
  assert.deepEqual(rows.map(row => row.amount), [8323, 2380])
})

test('seven QUICPay AI rows yield seven clean titles and exact amounts', () => {
  const input = [
    '10月21日, ダイソー, 550円, QUICPay',
    '10月21日, イトーヨーカドータカサゴテン, 392円, QUICPay',
    '10月20日, マイバスケット, 417円, QUICPay',
    '10月19日, マイバスケット, 315円, QUICPay',
    '10月18日, ベルク, 4,888円, QUICPay',
    '10月17日, ケンタッキーフライドチキン, 1,580円, QUICPay',
    '10月17日, イオンフーズタイル, 254円, QUICPay'
  ].join('\n')
  const rows = parseEntries(input)
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map(row => row.merchant), ['ダイソー', 'イトーヨーカドータカサゴテン', 'マイバスケット', 'マイバスケット', 'ベルク', 'ケンタッキーフライドチキン', 'イオンフーズタイル'])
  assert.deepEqual(rows.map(row => row.amount), [550, 392, 417, 315, 4888, 1580, 254])
  assert.deepEqual(rows.map(row => row.date.slice(5)), ['10-21', '10-21', '10-20', '10-19', '10-18', '10-17', '10-17'])
})

test('eight space-delimited AI card rows keep merchant titles and amounts', () => {
  const input = [
    '26.10.18 はま寿司 2,992円 1回払い',
    '26.10.16 マクドナルドモバイルオーダー 420円 1回払い',
    '26.10.16 セブンーイレブン 744円 1回払い',
    '26.10.14 SBI証券投信積立サービス(翌月買付分) 15,000円 1回払い',
    '26.10.14 東京都水道局 4,096円 1回払い',
    '26.10.12 ネスレツィポンオンライン 9,590円 1回払い',
    '26.10.09 ガスト 1,990円 1回払い',
    '26.10.04 ジョナサン 3,677円 1回払い'
  ].join('\n')
  const rows = parseEntries(input)
  assert.equal(rows.length, 8)
  assert.deepEqual(rows.map(row => row.merchant), ['はま寿司', 'マクドナルドモバイルオーダー', 'セブンーイレブン', 'SBI証券投信積立サービス(翌月買付分)', '東京都水道局', 'ネスレツィポンオンライン', 'ガスト', 'ジョナサン'])
  assert.deepEqual(rows.map(row => row.amount), [2992, 420, 744, 15000, 4096, 9590, 1990, 3677])
  assert.deepEqual(rows.map(row => row.date), ['2026-10-18', '2026-10-16', '2026-10-16', '2026-10-14', '2026-10-14', '2026-10-12', '2026-10-09', '2026-10-04'])
})

test('eight yen-prefixed AI statement rows parse cleanly', () => {
  const input = [
    '2026/10/18, サンドラッグダイレックスアプリ, ¥1,011, 1回払い',
    '2026/10/17, Suicaチャージ（楽天ペイ）, ¥1,000, 1回払い',
    '2026/10/16, Suicaチャージ（楽天ペイ）, ¥1,000, 1回払い',
    '2026/10/13, Suicaチャージ（楽天ペイ）, ¥1,000, 1回払い',
    '2026/10/08, Suicaチャージ（楽天ペイ）, ¥1,000, 1回払い',
    '2026/10/04, Suicaチャージ（楽天ペイ）, ¥1,000, 1回払い',
    '2026/10/03, サンドラッグダイレックスアプリ, ¥1,265, 1回払い',
    '2026/10/02, Suicaチャージ（楽天ペイ）, ¥1,000, 1回払い'
  ].join('\n')
  const rows = parseEntries(input)
  assert.equal(rows.length, 8)
  assert.deepEqual(rows.map(row => row.amount), [1011, 1000, 1000, 1000, 1000, 1000, 1265, 1000])
  assert.equal(rows[0].merchant, 'サンドラッグダイレックスアプリ')
  assert.equal(rows[1].merchant, 'Suicaチャージ(楽天ペイ)')
  assert.equal(rows[7].date, '2026-10-02')
})

test('eight Seven-Eleven and Ario AI statement rows retain branches and separate same-day entries', () => {
  const input = [
    '2026/10/1, セブンイレブン葛飾柴又４丁目店, 270円, 1回払い',
    '2026/10/4, セブンイレブン葛飾高砂７丁目店, 452円, 1回払い',
    '2026/10/5, セブンイレブン葛飾高砂２丁目店, 388円, 1回払い',
    '2026/10/6, セブンイレブン江戸川東葛西９丁目店, 532円, 1回払い',
    '2026/10/8, セブンイレブン葛飾高砂７丁目店, 775円, 1回払い',
    '2026/10/9, マクドナルド葛西店, 930円, 1回払い',
    '2026/10/10, イトーヨーカドーアリオ亀有店, 3,512円, 1回払い',
    '2026/10/10, アリオ亀有, 5,931円, 1回払い'
  ].join('\n')
  const rows = parseEntries(input)
  assert.equal(rows.length, 8)
  assert.deepEqual(rows.map(row => row.amount), [270, 452, 388, 532, 775, 930, 3512, 5931])
  assert.deepEqual(rows.map(row => row.merchant), [
    'セブンイレブン葛飾柴又4丁目店',
    'セブンイレブン葛飾高砂7丁目店',
    'セブンイレブン葛飾高砂2丁目店',
    'セブンイレブン江戸川東葛西9丁目店',
    'セブンイレブン葛飾高砂7丁目店',
    'マクドナルド葛西店',
    'イトーヨーカドーアリオ亀有店',
    'アリオ亀有'
  ])
  assert.deepEqual(rows.map(row => row.date), ['2026-10-01','2026-10-04','2026-10-05','2026-10-06','2026-10-08','2026-10-09','2026-10-10','2026-10-10'])
})
