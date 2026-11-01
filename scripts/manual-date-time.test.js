import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNamedExpenseBlocks } from '../src/named-expense.js'
import { recognizeAssetTransfer } from '../src/transfer-recognition.js'

const reference = new Date('2026-11-01T08:54:00.000Z') // 17:54 JST

test('three-line manual input reads explicit dates and minute-precision clocks', () => {
  for (const when of [
    '2026/11/01 17:49',
    '2026-11-01 17:49',
    '2026.11.01 17:49',
    '２０２６／１１／０１　１７：４９',
    '2026年11月1日 17時49分',
    '2026年11月1日午後5時49分'
  ]) {
    const parsed = parseNamedExpenseBlocks(['テスト', when, '1000円'].join('\n'), reference)
    assert.ok(parsed?.rows, when + ': ' + JSON.stringify(parsed))
    assert.equal(parsed.rows.length, 1, when)
    assert.equal(parsed.rows[0].merchant, 'テスト', when)
    assert.equal(parsed.rows[0].date, '2026-11-01', when)
    assert.equal(parsed.rows[0].time, '17:49', when)
    assert.equal(parsed.rows[0].amount, 1000, when)
  }
})

test('single-line text supports name/date/time/amount in either order', () => {
  for (const line of [
    'テスト 2026/11/01 17:49 1000円',
    '2026/11/01 17:49 テスト 1000円',
    'テスト 2026年11月1日 17時49分 ¥1,000'
  ]) {
    const parsed = parseNamedExpenseBlocks(line, reference)
    assert.ok(parsed?.rows, line + ': ' + JSON.stringify(parsed))
    assert.equal(parsed.rows.length, 1, line)
    assert.equal(parsed.rows[0].merchant, 'テスト', line)
    assert.equal(parsed.rows[0].date, '2026-11-01', line)
    assert.equal(parsed.rows[0].time, '17:49', line)
    assert.equal(parsed.rows[0].amount, 1000, line)
  }
})

test('Suica recharge recognizes field order in a single line or three lines', () => {
  const samples = [
    'Suicaチャージ　1000円　2026/11/01 17:49',
    ['Suicaチャージ', '1000円', '2026/11/01 17:49'].join('\n'),
    ['Suicaチャージ', '2026/11/01 17:49', '1000円'].join('\n')
  ]
  for (const input of samples) {
    const parsed = parseNamedExpenseBlocks(input, reference)
    assert.ok(parsed?.rows, input + ': ' + JSON.stringify(parsed))
    assert.equal(parsed.rows.length, 1, input)
    const row = parsed.rows[0]
    assert.equal(row.merchant, 'Suicaチャージ', input)
    assert.equal(row.amount, 1000, input)
    assert.equal(row.date, '2026-11-01', input)
    assert.equal(row.time, '17:49', input)
    assert.deepEqual(
      recognizeAssetTransfer({merchant:row.merchant,note:row.note,raw:row.raw,prepaidNames:['Suica','PASMO']}),
      {isTransfer:true,transferTarget:'prepaid:Suica',kind:'recharge'}
    )
  }
})

test('relative dates with printed clocks use the correct day and clock', () => {
  const yesterday = parseNamedExpenseBlocks(['テスト', '昨日 17:49', '1000円'].join('\n'), reference)
  assert.equal(yesterday.rows[0].date, '2026-10-31')
  assert.equal(yesterday.rows[0].time, '17:49')
  const now = parseNamedExpenseBlocks(['テスト', '今', '1000円'].join('\n'), reference)
  assert.equal(now.rows[0].date, '2026-11-01')
  assert.equal(now.rows[0].time, '17:54')
  const dateOnly = parseNamedExpenseBlocks(['テスト', '2026/11/01', '1000円'].join('\n'), reference)
  assert.equal(dateOnly.rows[0].date, '2026-11-01')
  assert.equal(dateOnly.rows[0].time, '')
})

test('invalid printed dates or clocks are rejected instead of falling back to now', () => {
  for (const when of ['2026/11/01 25:49', '2026/11/01 17:60', '2026/02/30 17:49']) {
    const parsed = parseNamedExpenseBlocks(['テスト', when, '1000円'].join('\n'), reference)
    assert.ok(parsed?.error, when)
  }
})
