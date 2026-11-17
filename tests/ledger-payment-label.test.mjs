import test from 'node:test'
import assert from 'node:assert/strict'
import {ledgerPaymentLabel} from '../src/ledger-payment-label.js'

test('member-owned approved cash ledger entry explicitly shows cash',()=>{
 assert.equal(ledgerPaymentLabel({
  type:'expense',payment_source:'',payment_source_display:'',
  shared_entry_requester_user_id:'current-member'
 }),'現金')
})
test('shared card source is shown with its registered name, not charged as cash',()=>{
 assert.equal(ledgerPaymentLabel({
  type:'expense',payment_source:'セブンカード・プラス',
  payment_source_display:'セブンカード・プラス',
  shared_entry_requester_user_id:'current-member'
 }),'セブンカード・プラス')
})
test('unapproved cash draft is labeled but has no bill or balance effect',()=>{
 assert.equal(ledgerPaymentLabel({
  type:'expense',pending_approval:true,pending_operation:'create'
 }),'現金')
})
test('private card name is never reconstructed from a redacted member projection',()=>{
 assert.equal(ledgerPaymentLabel({
  type:'expense',payment_source:null,payment_source_display:'个人支付方式',
  shared_entry_requester_user_id:null
 }),'个人支付方式')
})
test('other legacy unspecified entries are not guessed to be cash',()=>{
 assert.equal(ledgerPaymentLabel({type:'expense',payment_source:''}),'')
})
test('asset transfer and income do not inherit card or cash labels',()=>{
 assert.equal(ledgerPaymentLabel({type:'transfer',payment_source:'セブンカード・プラス'}),'')
 assert.equal(ledgerPaymentLabel({type:'income',payment_source:'セブンカード・プラス'}),'')
})
