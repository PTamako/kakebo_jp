import test from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt, parseEntries } from '../src/parse.js'

test('AI-labeled store name is not duplicated', () => {
  const receipt = '店名: まいばすけっと 南小岩８丁目店\\n日付: 2026/10/28\\n合計: ¥311\\n支払方法: QUICPay\\n小計 ¥288\\n外税 8% ¥23'
  const result = parseReceipt(receipt)
  assert.equal(result.merchant, 'まいばすけっと 南小岩8丁目店')
  assert.equal(result.amount, 311)
  assert.equal(result.date, '2026-10-28')
})

test('legacy two-line store name keeps one brand', () => {
  const result = parseReceipt('まいばすけっと\\n南小岩8丁目店\\n2026/10/28\\n合計 ¥311')
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
  assert.deepEqual(rows.map(row => row.merchant), ['マイバスケット', 'ベルク', '東急ストア 食料品 -東京都 目黒区', 'マイバスケット', 'マイバスケット'])
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
    '10月21日, イトーヨーカドー タカサゴテン, 392円, QUICPay',
    '10月20日, マイバスケット, 417円, QUICPay',
    '10月19日, マイバスケット, 315円, QUICPay',
    '10月18日, ベルク, 4,888円, QUICPay',
    '10月17日, ケンタッキーフライドチキン, 1,580円, QUICPay',
    '10月17日, イオンフーズタイル, 254円, QUICPay'
  ].join('\n')
  const rows = parseEntries(input)
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map(row => row.merchant), ['ダイソー', 'イトーヨーカドー タカサゴテン', 'マイバスケット', 'マイバスケット', 'ベルク', 'ケンタッキーフライドチキン', 'イオンフーズタイル'])
  assert.deepEqual(rows.map(row => row.amount), [550, 392, 417, 315, 4888, 1580, 254])
  assert.deepEqual(rows.map(row => row.date.slice(5)), ['10-21', '10-21', '10-20', '10-19', '10-18', '10-17', '10-17'])
})
