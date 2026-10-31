import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGemmaText, recognizeWithGemma, GEMMA_MODEL } from '../functions/api/gemma-ocr.js'
import { parseReceipt } from '../src/parse.js'
import { detectRegisteredReceiptPayment, isQuicPayReceipt } from '../src/receipt-payment.js'
import { paymentForDraft } from '../src/payment-rules.js'

test('Gemma response is bounded and rejects empty text', () => {
  assert.equal(normalizeGemmaText({ response: ' 店舗 1,000円 ' }), '店舗 1,000円')
  assert.equal(normalizeGemmaText({ response: 'a'.repeat(17000) }).length, 16000)
  assert.throws(() => normalizeGemmaText({ response: '' }))
})
test('AI binding required and unsupported MIME rejected before model call', async () => {
  await assert.rejects(recognizeWithGemma(null, new ArrayBuffer(0), 'image/png', 'receipt'))
  await assert.rejects(recognizeWithGemma({ run() { throw Error('unexpected') } }, new ArrayBuffer(0), 'text/plain', 'receipt'))
})
test('Gemma receives Japanese OCR instructions and an image', async () => {
  let called
  const ai = { async run(model, options) { called = { model, options }; return { response: '2026/10/28\n合計 500円' } } }
  const text = await recognizeWithGemma(ai, new Uint8Array([1,2,3]).buffer, 'image/png', 'receipt')
  assert.equal(text, '2026/10/28\n合計 500円')
  assert.equal(called.model, GEMMA_MODEL)
  assert.equal(called.options.messages[0].content[1].type, 'image_url')
})

test('Gemma multimodal description response is accepted', () => {
  assert.equal(normalizeGemmaText({ description: '店名: まいばすけっと' }), '店名: まいばすけっと')
})


test('Gemma 4 receipt prompt requires printed transaction HH:mm and excludes voucher dates',async()=>{
  let called
  const ai={async run(model,options){called={model,options};return{response:['店名: 架空の店舗','日付: 不明','時刻: 不明','合計: 不明','支払方法: 不明'].join('\n')}}}
  await recognizeWithGemma(ai,new Uint8Array([1,2,3]).buffer,'image/png','receipt')
  const prompt=called.options.messages[0].content[0].text
  assert.equal(called.model,GEMMA_MODEL)
  assert.match(prompt,/時刻: <購入時刻 HH:mm/)
  assert.match(prompt,/クーポン開始日/)
  assert.match(prompt,/現在時刻を補わず/)
  assert.match(prompt,/合計: <税込み購入合計額/)
  assert.match(prompt,/支払方法:/)
  assert.match(prompt,/店名:[^\n]*\n日付:/,'format instructions use real newlines')
})

test('Gemma 4 mock Seven-Eleven yields one purchase at 20:00, 239 yen and registered Suica',async()=>{
  const response=[
    '店名: セブン-イレブン 那覇旭町架空店',
    '日付: 2026-05-04','時刻: 20:00','合計: ¥239','支払方法: Suica',
    '商品明細','天然水 118円','牛乳 104円','小計 ¥222','消費税 ¥17',
    'Suica支払 ¥239','Suica残高 ¥9,126',
    'クーポン利用開始 2026年05月05日','クーポン対象商品 1本無料'
  ].join('\n')
  const ai={async run(){return {response}}}
  const raw=await recognizeWithGemma(ai,new Uint8Array([1]).buffer,'image/png','receipt')
  const record=parseReceipt(raw,[{keyword:'セブン',category:'饮食料品',is_custom:false}])
  assert.equal(record.merchant,'セブン-イレブン那覇旭町架空店')
  assert.equal(record.date,'2026-05-04')
  assert.equal(record.time,'20:00')
  assert.equal(record.amount,239)
  assert.equal(record.category,'饮食料品')
  assert.equal(detectRegisteredReceiptPayment(raw,['Suica','nanaco']),'Suica')
  assert.equal(paymentForDraft({merchant:record.merchant,recognized:detectRegisteredReceiptPayment(raw,['Suica']),registeredSources:['Suica']}),'Suica')
  assert.equal(detectRegisteredReceiptPayment(raw,['nanaco']), '', 'unregistered cards must not be inserted or inferred')
})

test('Gemma 4 mock MyBasket uses till purchase time, not duplicate payment-slip date',()=>{
  const raw=[
    '店名: まいばすけっと南小岩8丁目店',
    '日付: 2026-10-30','時刻: 12:36','合計: ¥311',
    '支払方法: QUICPay','小計 ¥288','外税 8% ¥23',
    'QUICPay支払 ¥311','お取扱日 2026年10月30日','金額 ¥311'
  ].join('\n')
  const record=parseReceipt(raw,[{keyword:'まいばすけっと',category:'饮食料品',is_custom:false}])
  assert.deepEqual([record.date,record.time,record.amount,record.category],['2026-10-30','12:36',311,'饮食料品'])
  assert.equal(isQuicPayReceipt(raw),true)
  const sources=['セゾンローズゴールドAMEX','Suica','QUICPay']
  const meta={'セゾンローズゴールドAMEX':{source_type:'standard'},'Suica':{source_type:'prepaid'}}
  assert.equal(detectRegisteredReceiptPayment(raw,sources,meta),'','QUICPay is a network, not a credit card')
  assert.equal(detectRegisteredReceiptPayment(raw,['QUICPay']), '', 'QUICPay is not a standalone card')
  assert.equal(detectRegisteredReceiptPayment(raw,['Suica']), '', 'receipt is not a Suica expense')
  assert.equal(paymentForDraft({merchant:record.merchant,recognized:'',rules:[{keyword:'まいばすけっと',payment_source:'セゾンローズゴールドAMEX'}],registeredSources:['セゾンローズゴールドAMEX','楽天カード'],defaultSource:'楽天カード'}),'セゾンローズゴールドAMEX','user merchant rule selects actual card')
  assert.equal(paymentForDraft({merchant:record.merchant,recognized:'',rules:[],registeredSources:['楽天カード'],defaultSource:'楽天カード'}),'楽天カード','without saved rule use configured default')
})

test('Gemma unreadable purchase date or time must not fall through to coupon period',()=>{
  const text=[
    '店名: セブン-イレブン 架空店','日付: 不明','時刻: 不明',
    '合計: ¥239','支払方法: Suica','クーポン期間: 2026-05-05～2026-05-18'
  ].join('\n')
  const result=parseReceipt(text)
  assert.equal(result.date,'')
  assert.equal(result.time,'')
  assert.equal(result.amount,239)
})

test('receipt payment extraction supports arbitrary registered names',()=>{
  const registered=['わたし専用IC','Suica','QUICPay']
  assert.equal(detectRegisteredReceiptPayment('支払方法: わたし専用IC',registered),'わたし専用IC')
  assert.equal(detectRegisteredReceiptPayment('わたし専用IC支払 ¥120',registered),'わたし専用IC')
  assert.equal(detectRegisteredReceiptPayment('Suica残高 ¥9,126',registered),'')
  assert.equal(detectRegisteredReceiptPayment('支払方法: その他のカード',registered),'')
})


test('QUICPay payment uses configured merchant rule then default; never guesses Saison',()=>{
  const source=['店名: まいばすけっと 架空店','日付: 2026-10-30','時刻: 12:36','合計: ¥311','支払方法: QUICPay'].join('\n')
  const cards=['現金','セゾンカード','Suica']
  const meta={'セゾンカード':{source_type:'standard'},'Suica':{source_type:'prepaid'}}
  assert.equal(detectRegisteredReceiptPayment(source,cards,meta),'')
  assert.equal(isQuicPayReceipt(source),true)
  assert.equal(paymentForDraft({merchant:'まいばすけっと 架空店',recognized:'',rules:[{keyword:'まいばすけっと',payment_source:'セゾンカード'}],registeredSources:['セゾンカード','現金'],defaultSource:'現金'}),'セゾンカード')
  assert.equal(paymentForDraft({merchant:'まいばすけっと 架空店',recognized:'',rules:[],defaultSource:'現金'}),'現金')
  assert.equal(detectRegisteredReceiptPayment(source,['現金','QUICPay'],{}),'')
  assert.equal(isQuicPayReceipt('支払方法: Suica'),false)
})
