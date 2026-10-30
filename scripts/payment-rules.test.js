import test from 'node:test'
import assert from 'node:assert/strict'
import { paymentForDraft } from '../src/payment-rules.js'
const rules = [{keyword:'まいばすけっと',payment_source:'PayPay'},{keyword:'まいばすけっと南小岩',payment_source:'三井住友カード'}]
const base = {merchant:'まいばすけっと南小岩8丁目店', rules, defaultSource:'楽天カード', type:'expense'}
test('explicit import card overrides merchant and OCR', () => {
  assert.equal(paymentForDraft({...base, recognized:'現金',importSource:'セゾンカード'}), 'セゾンカード')
})
test('user merchant payment rule overrides identified OCR card', () => {
  assert.equal(paymentForDraft({...base, recognized:'現金'}), '三井住友カード')
})
test('longest matching merchant wins and normalizes whitespace', () => {
  assert.equal(paymentForDraft({...base,merchant:'まいばすけっと 南小岩８丁目店'}), '三井住友カード')
})
test('unknown merchant falls back to global default', () => {
  assert.equal(paymentForDraft({...base,merchant:'初めての店'}), '楽天カード')
})
test('no payment forced onto income or transfers', () => {
  assert.equal(paymentForDraft({...base,type:'transfer',importSource:'セゾンカード'}), '')
  assert.equal(paymentForDraft({...base,type:'income'}), '')
})
test('no default configured means unassigned payment', () => {
  assert.equal(paymentForDraft({...base,merchant:'不明店舗',defaultSource:''}), '')
})

test('registered OCR card is used when merchant has no saved payment rule',()=>{
  assert.equal(paymentForDraft({...base,merchant:'初めての店',recognized:'Suica'}),'Suica')
})
test('no recognized or merchant card uses configured default',()=>{
  assert.equal(paymentForDraft({...base,merchant:'初めての店',recognized:''}),'楽天カード')
})
test('QUICPay OCR label does not override a user store-specific card',()=>{
  assert.equal(paymentForDraft({...base,merchant:'まいばすけっと南小岩8丁目店',recognized:''}),'三井住友カード')
})
