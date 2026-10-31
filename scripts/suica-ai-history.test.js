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

test('relative Suica screenshot times become editable JST dates and times', () => {
  const reference = new Date('2026-10-31T06:20:00Z') // 2026-10-31 15:20 JST
  const rows = parseEntries([
    '不明,40分前,神奈川県横浜市,¥140,不明',
    '不明,3時間前,石川町駅,¥715,不明',
    '不明,4時間前,京成上野駅,¥272,不明'
  ].join('\n'), [], reference)
  assert.deepEqual(rows.map(r => [r.date,r.time]),[
    ['2026-10-31','14:40'],['2026-10-31','12:20'],['2026-10-31','11:20']
  ])
  assert.deepEqual(rows.map(r => r.amount),[140,715,272])
  assert.deepEqual(rows.map(r => r.category),['日用品','交通','交通'])
  assert.match(rows[0].note,/40分前/)
  assert.match(rows[1].note,/取込時刻から計算した目安/)
})

test('40分前 and 3時間前 move to yesterday across midnight', () => {
  const reference = new Date('2026-10-31T15:20:00Z') // 2026-11-01 00:20 JST
  const rows = parseEntries('不明,40分前,石川町駅,¥715,不明\n不明,3時間 前,京成上野駅,¥272,不明',[],reference)
  assert.deepEqual(rows.map(r => [r.date,r.time]),[
    ['2026-10-31','23:40'],['2026-10-31','21:20']
  ])
})

test('今日 昨日 今 and past days are resolved in Japan time', () => {
  const reference = new Date('2026-10-31T06:20:00Z')
  const rows = parseEntries([
    '今日,不明,石川町駅,¥715,不明',
    '昨日,不明,京成上野駅,¥272,不明',
    '不明,今,神奈川県横浜市,¥140,不明',
    '一昨日,13:05,喫茶店,¥420,不明',
    '不明,今日,石川町駅,¥100,不明',
    '2026-10-30,14:05,石川町駅,¥200,Suica'
  ].join('\n'),[],reference)
  assert.deepEqual(rows.map(r=>[r.date,r.time]),[
    ['2026-10-31',''],
    ['2026-10-30',''],
    ['2026-10-31','15:20'],
    ['2026-10-29','13:05'],
    ['2026-10-31',''],
    ['2026-10-30','14:05']
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
  assert.match(prompt,/画像の撮影日を推測しない/)
  assert.match(prompt,/40分前/)
  assert.match(prompt,/今日/)
  assert.match(prompt,/昨日/)
  assert.match(prompt,/「今」/)
  assert.match(prompt,/駅店/)
})

test('app routes multiple OCR rows through the same merchant and payment mapping', () => {
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  assert.match(app,/parseEntries\(input\.value, rules\.value, referenceTime\)/)
  assert.match(app,/const recognitionReference = new Date\(\)/)
  assert.match(app,/recognize\(mode, true, recognitionReference\)/)
  assert.match(app,/suggestedPayment\(f\.merchant,recognizedPayment,type,imported\)/)
  assert.match(app,/recognize\(mode, true\)/)
})
