import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEntries, parseEntry } from '../src/parse.js'
import { paymentForDraft } from '../src/payment-rules.js'
import { recognizeWithGemma } from '../functions/api/gemma-ocr.js'

const example = [
  '不明,不明,神奈川県横浜市,¥140,不明',
  '不明,不明,石川町駅,¥715,不明',
  '不明,不明,京成上野駅,¥272,不明'
].join('\n')

test('actual five-column Gemma screenshot produces exactly three separate editable drafts', () => {
  const rows = parseEntries(example, [])
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map(r => r.merchant), ['神奈川県横浜市', '石川町駅', '京成上野駅'])
  assert.deepEqual(rows.map(r => r.amount), [140, 715, 272])
  assert.deepEqual(rows.map(r => r.category), ['日用品', '交通', '交通'])
  assert.ok(rows.every(r => r.date === '' && r.time === ''), 'Unknown timestamps must not silently become current date/time')
  assert.ok(rows.every(r => r.paymentSource === ''))
  const cards = ['楽天カード', 'Suica']
  const pay = row => paymentForDraft({merchant:row.merchant,recognized:row.paymentSource,registeredSources:cards,defaultSource:'楽天カード'})
  assert.deepEqual(rows.map(pay), ['楽天カード','Suica','Suica'])
  // When the user explicitly selects Suica as the statement import card,
  // even a non-station municipal transaction is assigned to that source.
  assert.deepEqual(rows.map(row => paymentForDraft({merchant:row.merchant,
    importSource:'Suica',registeredSources:cards,defaultSource:'楽天カード'})), ['Suica','Suica','Suica'])
})

test('station merchants still respect personal card rules and avoid unregistered Suica', () => {
  const station = parseEntries(example, [])[1]
  assert.equal(paymentForDraft({merchant:station.merchant,registeredSources:['楽天カード'],defaultSource:'楽天カード'}),'楽天カード')
  assert.equal(paymentForDraft({merchant:station.merchant,registeredSources:['Suica'],rules:[{keyword:'石川町駅',payment_source:'現金'}]}),'現金')
  const store = parseEntry('不明,不明,石川町駅店,¥880,不明', [])
  assert.equal(store.category,'日用品')
  assert.equal(paymentForDraft({merchant:store.merchant,registeredSources:['Suica'],defaultSource:'楽天カード'}),'楽天カード')
})

test('relative time is kept as original text, never falsified as a precise HH:mm timestamp', () => {
  const rows = parseEntries([
    '不明,2時間前,神奈川県横浜市,¥140,不明',
    '不明,3時間前,石川町駅,¥715,不明',
    '不明,4時間前,京成上野駅,¥272,不明'
  ].join('\n'), [])
  assert.equal(rows.length, 3)
  assert.ok(rows.every(row => row.date === '' && row.time === ''))
  assert.deepEqual(rows.map(row => row.note), [
    '画面表示：2時間前（正確な取引時刻は不明）',
    '画面表示：3時間前（正確な取引時刻は不明）',
    '画面表示：4時間前（正確な取引時刻は不明）'
  ])
})

test('explicit printed dates and times are kept, including thousands separators', () => {
  const row=parseEntry('2026-10-31,13:05,石川町駅,¥1,275,Suica',[])
  assert.deepEqual([row.date,row.time,row.amount,row.merchant,row.category,row.paymentSource],
    ['2026-10-31','13:05',1275,'石川町駅','交通','Suica'])
  const old=parseEntries('2026-10-31,喫茶店,¥420,現金',[])
  assert.equal(old.length,1)
  assert.deepEqual([old[0].date,old[0].merchant,old[0].amount],['2026-10-31','喫茶店',420])
})

test('Gemma statement prompt preserves original relative-time display and uses five CSV columns', async () => {
  let prompt=''
  await recognizeWithGemma({async run(_model, options){
    prompt=options.messages[0].content[0].text
    return {response:example}
  }},new Uint8Array([1]).buffer,'image/png','statement')
  assert.match(prompt,/日付,時刻,店舗名または駅名,金額,支払方法/)
  assert.match(prompt,/2時間前/)
  assert.match(prompt,/撮影日を取引日として推測しない/)
  assert.match(prompt,/駅店/)
})

test('app routes multiple OCR rows through the same merchant and payment mapping', () => {
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  assert.match(app,/parseEntries\(input\.value, rules\.value\)/)
  assert.match(app,/suggestedPayment\(f\.merchant,recognizedPayment,type,imported\)/)
  assert.match(app,/recognize\(mode, true\)/)
})
