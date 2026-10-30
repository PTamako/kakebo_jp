import test from 'node:test'
import assert from 'node:assert/strict'
import { isStationMerchant } from '../src/station-merchant.js'
import { classify, parseEntries, parseReceipt } from '../src/parse.js'
import { paymentForDraft } from '../src/payment-rules.js'

test('a station named in text or OCR is transport, but 駅店 and 駅前店 are stores',()=>{
  for (const merchant of ['京成高砂駅','新宿駅','JR新宿駅','高砂駅 220円','品川駅　¥180','渋谷駅（改札）']) {
    assert.equal(isStationMerchant(merchant),true,merchant)
    assert.equal(classify(merchant,[]).category,'交通',merchant)
  }
  for (const merchant of ['新宿駅店','京成高砂駅店','東京駅前店','駅店','新宿駅店 980円','新宿駅前のカフェ','新宿駅ビル店','新宿駅構内のお店']) {
    assert.equal(isStationMerchant(merchant),false,merchant)
    assert.equal(classify(merchant,[]).category,'日用品',merchant)
  }
  assert.equal(parseEntries('新宿駅 220円',[])[0].category,'交通')
  assert.equal(parseEntries('新宿駅店 880円',[])[0].category,'日用品')
  assert.equal(classify('京成高砂駅',[{keyword:'京成高砂駅',category:'食費',is_custom:true}]).category,'食費')
  assert.equal(classify('京成高砂駅',[{keyword:'駅',category:'日用品',is_custom:false}]).category,'交通')
})
test('station defaults to registered Suica, without creating an unregistered card',()=>{
  const base={merchant:'京成高砂駅',defaultSource:'楽天カード',registeredSources:['楽天カード','Suica'],type:'expense'}
  assert.equal(paymentForDraft(base),'Suica')
  assert.equal(paymentForDraft({...base,merchant:'京成高砂駅店'}),'楽天カード')
  assert.equal(paymentForDraft({...base,merchant:'東京駅前店'}),'楽天カード')
  assert.equal(paymentForDraft({...base,registeredSources:['楽天カード']}),'楽天カード')
  assert.equal(paymentForDraft({...base,importSource:'セゾンカード'}),'セゾンカード')
  assert.equal(paymentForDraft({...base,recognized:'現金'}),'現金')
  assert.equal(paymentForDraft({...base,rules:[{keyword:'京成高砂駅',payment_source:'PayPay'}]}),'PayPay')
  assert.equal(paymentForDraft({...base,type:'income'}),'')
  assert.equal(paymentForDraft({...base,type:'transfer'}),'')
})
test('ordinary store-recognition retains its own explicit rule',()=>{
  const named='新宿駅店'
  assert.equal(classify(named,[{keyword:named,category:'餐饮',is_custom:true}]).category,'餐饮')
  assert.equal(paymentForDraft({merchant:named,registeredSources:['Suica'],rules:[{keyword:named,payment_source:'セゾンカード'}],defaultSource:'Suica'}),'セゾンカード')
})
