import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recognizeWithGemma } from '../functions/api/gemma-ocr.js'
import { parseEntries } from '../src/parse.js'

const currentYear = new Date().getFullYear()
const statement = [
  '9月6日,不明,QP/ベルク,¥2,264,不明',
  '9月5日,不明,QP/ベルク,¥4,744,不明',
  '9月4日,不明,QP/マイバスケット,¥437,不明',
  '9月4日,不明,モバイルPASMOチャージ,¥200,不明',
  '9月3日,不明,QP/マイバスケット,¥428,不明',
  '9月2日,不明,QP/マイバスケット,¥480,不明',
  '9月1日,不明,QP/マイバスケット,¥203,不明'
].join('\n')

// This is an integration fixture for the model's *text response*, not a vision-model
// accuracy test. Real screenshot accuracy still requires a Cloudflare AI smoke test.
test('seven dated September card rows keep each printed date and amount', async () => {
  const ai = { async run() { return { response: statement } } }
  const raw = await recognizeWithGemma(ai, new Uint8Array([1]).buffer, 'image/png', 'statement')
  const rows = parseEntries(raw, [], new Date('2026-10-31T09:00:00Z'))
  assert.equal(rows.length, 7)
  assert.deepEqual(rows.map(row => row.date), [
    `${currentYear}-09-06`, `${currentYear}-09-05`, `${currentYear}-09-04`, `${currentYear}-09-04`,
    `${currentYear}-09-03`, `${currentYear}-09-02`, `${currentYear}-09-01`
  ])
  assert.deepEqual(rows.map(row => row.amount), [2264, 4744, 437, 200, 428, 480, 203])
  assert.deepEqual(rows.map(row => row.merchant), [
    'ベルク', 'ベルク', 'マイバスケット', 'モバイルPASMOチャージ',
    'マイバスケット', 'マイバスケット', 'マイバスケット'
  ])
  assert.ok(rows.every(row => row.time === ''), 'No hours and minutes are printed')
})

test('statement date parsing accepts different printed date formats per transaction', () => {
  const rows = parseEntries([
    '9/6,不明,喫茶店,¥500,不明',
    '2026/09/05,不明,薬局,¥1,200,不明',
    '9月4日,不明,コンビニ,¥320,不明'
  ].join('\n'), [], new Date('2026-10-31T09:00:00Z'))
  assert.deepEqual(rows.map(row => row.date), [`${currentYear}-09-06`, '2026-09-05', `${currentYear}-09-04`])
  assert.deepEqual(rows.map(row => row.amount), [500, 1200, 320])
})

test('unknown date does not borrow date from adjacent transaction', () => {
  const rows = parseEntries([
    '9月6日,不明,ベルク,¥2,264,不明',
    '不明,不明,スーパー,¥630,不明',
    '9月4日,不明,マイバスケット,¥437,不明'
  ].join('\n'), [], new Date('2026-10-31T09:00:00Z'))
  assert.deepEqual(rows.map(row => row.date), [`${currentYear}-09-06`, '', `${currentYear}-09-04`])
})

test('Gemma does not assume dates occupy any fixed part of the screen', async () => {
  let prompt = ''
  await recognizeWithGemma({ async run(_model, options) {
    prompt = options.messages[0].content[0].text
    return { response: statement }
  } }, new Uint8Array([1]).buffer, 'image/png', 'statement')
  assert.match(prompt, /取引ごとのまとまり/)
  assert.match(prompt, /固定位置を前提にしない/)
  assert.match(prompt, /薄い灰色/)
  assert.match(prompt, /隣の取引の日付を流用しない/)
  assert.match(prompt, /年を推測しない/)
  assert.match(prompt, /1回払い/)
  assert.match(prompt, /時刻だけ「不明」/)
})

test('AI upload retains fine print while locally saved photos stay compact', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  assert.match(app, /const image = await compressReceiptImage\(f, 2000, 1024 \* 1024\)/)
  assert.match(app, /pendingReceiptImage\.value = await compressReceiptImage\(f\)/)
})

test('Gemma five-column Japanese 時分 clock remains a time, never part of the merchant', () => {
  // Synthetic amounts: same layout as Japanese payment-history screenshots.
  const rows = parseEntries([
    '2026年9月2日,19時48分,リブレ京成,¥300,クレジット VISA',
    '2026年9月15日,13時16分,メルカリ,¥2,000,PayPay カード VISA',
    '2026年9月10日,19時50分,リブレ京成,¥400,クレジット VISA',
    '2026年9月9日,19時11分,リブレ京成,¥500,クレジット VISA',
    '2026年9月8日,19時10分,リブレ京成,¥900,クレジット VISA',
    '2026年9月3日,19時10分,リブレ京成,¥600,クレジット VISA'
  ].join('\n'), [], new Date('2026-10-31T09:00:00Z'))
  assert.equal(rows.length, 6)
  assert.deepEqual(rows.map(row => row.merchant), [
    'リブレ京成', 'メルカリ', 'リブレ京成', 'リブレ京成', 'リブレ京成', 'リブレ京成'
  ])
  assert.deepEqual(rows.map(row => row.date), [
    '2026-09-02', '2026-09-15', '2026-09-10', '2026-09-09', '2026-09-08', '2026-09-03'
  ])
  assert.deepEqual(rows.map(row => row.time), ['19:48', '13:16', '19:50', '19:11', '19:10', '19:10'])
  assert.deepEqual(rows.map(row => row.amount), [300, 2000, 400, 500, 900, 600])
  assert.deepEqual(rows.map(row => row.paymentSource), [
    'クレジット VISA', 'PayPay カード VISA', 'クレジット VISA',
    'クレジット VISA', 'クレジット VISA', 'クレジット VISA'
  ])
})

test('Gemma accepts Japanese single-digit, full-width-colon and AM/PM time without accepting arbitrary text', () => {
  const rows = parseEntries([
    '2026年9月2日,9時9分,架空書店,¥170,不明',
    '2026年9月3日,１９：４８,架空文具店,¥2,500,不明',
    '2026年9月4日,午後8時05分,架空喫茶店,¥420,不明',
    '2026年9月5日,不明,架空スーパー,¥800,不明'
  ].join('\n'), [], new Date('2026-10-31T09:00:00Z'))
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.map(row => row.time), ['09:09', '19:48', '20:05', ''])
  assert.deepEqual(rows.map(row => row.merchant), ['架空書店','架空文具店','架空喫茶店','架空スーパー'])
})
