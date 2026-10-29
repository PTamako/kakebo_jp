import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localHHMM, findTransactionTime, readClockTime } from '../src/entry-time.js'
import { parseReceipt, parseEntries } from '../src/parse.js'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('new manual expense gets local HH:mm once when the draft is created', () => {
  assert.equal(localHHMM(new Date(2026, 9, 29, 7, 5)), '07:05')
  assert.equal(localHHMM(new Date(2026, 9, 29, 23, 59)), '23:59')
  const app = source('src/App.vue')
  const add = app.match(/function addBlank\(type = 'expense'\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(add, 'manual add handler exists')
  assert.match(add, /const now = new Date\(\)/)
  assert.match(add, /time: localHHMM\(now\)/, 'all manual entries default to the current time')
  assert.match(add, /date: today, transferDate: today/)
  assert.match(app, /function startEdit\(entry\)[\s\S]*?time: entry\.time \|\| ''/, 'existing entry time is preserved')
  assert.doesNotMatch(app, /function startEdit\(entry\)[\s\S]{0,180}localHHMM/, 'do not overwrite edit time')
})

test('receipt OCR accepts printed time on the date line, next line or an explicit time label', () => {
  const same = parseReceipt('セブン-イレブン\n2026年10月29日 18:35\n合計 ¥850')
  assert.equal(same.date, '2026-10-29')
  assert.equal(same.time, '18:35')
  assert.equal(same.amount, 850)
  const split = parseReceipt('セブン-イレブン\n2026年10月29日\n時刻：１８：３５\n合計 ¥850')
  assert.equal(split.time, '18:35')
  const bare = parseReceipt('ローソン\n2026/10/29\n9時5分\n合計 900円')
  assert.equal(bare.time, '09:05')
  const pm = parseReceipt('ローソン\n2026年10月29日 午後8:05\n合計 900円')
  assert.equal(pm.time, '20:05')
  assert.equal(readClockTime('午前12:05'), '00:05')
  assert.equal(readClockTime('午後12:05'), '12:05')
})

test('OCR never guesses import time from scan time, opening hours, phone numbers or unrelated text', () => {
  assert.equal(parseReceipt('ローソン\n2026/10/29\n営業時間 9:00-22:00\n合計 900円').time, '')
  assert.equal(parseReceipt('ローソン\n2026/10/29\n電話番号 03-1234-5678\n合計 900円').time, '')
  assert.equal(parseReceipt('ローソン\n2026/10/29\n合計 900円').time, '')
  assert.equal(findTransactionTime('2026/10/29\n12:35 レジ 1'), '')
})

test('statement OCR retains transaction-specific times across CSV and payment schedule layouts', () => {
  const csv = parseEntries('2026.10.29 18:35, セブンイレブン, 850\n2026.10.30 14:12, ユニクロ, 4500')
  assert.deepEqual(csv.map(x => x.time), ['18:35', '14:12'])
  assert.deepEqual(csv.map(x => x.merchant), ['セブンイレブン', 'ユニクロ'])
  const spaced = parseEntries('2026.10.29 18:35 マクドナルド 1,234円 1回払い\n2026.10.30 14:12 ローソン 780円 1回払い')
  assert.deepEqual(spaced.map(x => x.time), ['18:35', '14:12'])
  assert.deepEqual(spaced.map(x => x.merchant), ['マクドナルド', 'ローソン'])
  const untimed = parseEntries('2026.10.29, セブンイレブン, 850\n2026.10.30, ユニクロ, 4500')
  assert.deepEqual(untimed.map(x => x.time), ['', ''])
  const single = parseEntries('セブン-イレブン 950円\n2026/10/29 17:12')
  assert.equal(single[0].time, '17:12')
})

test('OCR readout and create/edit share the existing time field without a data migration', () => {
  const app = source('src/App.vue')
  const form = source('src/TransactionForm.vue')
  const parser = source('src/parse.js')
  assert.match(parser, /time: findTransactionTime\(text, dateLine\)/)
  assert.match(parser, /export function parseEntries\(raw, rules\)/)
  assert.match(parser, /findTransactionTime\(row\.raw \|\| ''\)/)
  assert.match(app, /return \{ \.\.\.f, type, category:/, 'OCR fields, including time, are spread into drafts')
  assert.match(app, /\.\.\.f, amount: Number\(f\.amount\)/, 'save keeps the original time field')
  assert.match(form, /v-model="record\.time" type="time"/)
  assert.match(form, /class="transaction-time-summary">時刻 \{\{record\.time\}\}/, 'the automatically filled time can be seen in compact details')
  assert.doesNotMatch(form, /v-if="record.type==='expense'" class="form-field"><span>時刻/, 'income and transfer time remains editable')
})
