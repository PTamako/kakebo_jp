import test from 'node:test'
import assert from 'node:assert/strict'
import {bestMerchantRule} from '../src/merchant-rule-match.js'

test('specific branch is preferred over a chain-wide rule',()=>{
  const rules=[
    {keyword:'まいばすけっと',category:'食費',payment_source:'PayPay'},
    {keyword:'まいばすけっと南小岩8丁目',category:'',payment_source:'Aeon カード'}
  ]
  assert.equal(bestMerchantRule('まいばすけっと南小岩８丁目店',rules)?.payment_source,'Aeon カード')
  assert.equal(bestMerchantRule('まいばすけっと 京成立石店',rules)?.payment_source,'PayPay')
})
test('shortened OCR names can select an unambiguous saved longer branch',()=>{
  const rules=[{keyword:'まいばすけっと南小岩8丁目',category:'',payment_source:'Aeon カード'}]
  assert.equal(bestMerchantRule('まいばすけっと',rules)?.payment_source,'Aeon カード')
  assert.equal(bestMerchantRule('マイバスケット 南小岩８丁目',rules)?.payment_source,'Aeon カード')
  assert.equal(bestMerchantRule('まいばすけっと南小岩',rules)?.payment_source,'Aeon カード')
})
test('conflicting longer branch rules cannot guess payment or category',()=>{
  const rules=[
    {keyword:'まいばすけっと南小岩8丁目',category:'食費',payment_source:'Aeon カード'},
    {keyword:'まいばすけっと新小岩4丁目',category:'日用品',payment_source:'PayPay'}
  ]
  assert.equal(bestMerchantRule('まいばすけっと',rules),null)
  assert.equal(bestMerchantRule('まいばすけっと南小岩8丁目店',rules),rules[0])
})
test('do not reverse match generic names, or unrelated chains',()=>{
  const rules=[{keyword:'スーパー南小岩',category:'食費',payment_source:'Aeon カード'}]
  assert.equal(bestMerchantRule('スーパー',rules),null)
  assert.equal(bestMerchantRule('ドラッグストア',rules),null)
})
