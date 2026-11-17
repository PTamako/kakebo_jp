import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
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


test('real approved owner cash and shared card sources are displayed by the original ledger component',()=>{
 const cash={id:527,date:'2026-11-17',amount:960,type:'expense',
  category:'餐饮',merchant:'長門',payment_source:'現金',recorded_by:'家庭成员'};
 const card={id:528,date:'2026-11-17',amount:650,type:'expense',
  category:'食費',merchant:'バーガーキング',payment_source:'セブンカード・プラス',recorded_by:'家庭成员'};
 assert.equal(ledgerPaymentLabel(cash),'現金');
 assert.equal(ledgerPaymentLabel(card),'セブンカード・プラス');
 const component=readFileSync(new URL('../src/LedgerEntryContent.vue',import.meta.url),'utf8');
 const metadata=component.slice(component.indexOf('<small>'),component.indexOf('</small>'));
 assert(metadata.includes('ledgerPaymentLabel(entry)'));
 assert(metadata.indexOf('class="ledger-payment-method"')<metadata.indexOf('class="ledger-recorder"'),
  'payment method appears before potentially long nickname');
 const css=readFileSync(new URL('../src/mobile-ui.css',import.meta.url),'utf8');
 assert.match(css,/main \.ledger-info small \{[^}]*white-space:\s*normal;/);
 assert.match(css,/main \.ledger-payment-method \{[^}]*white-space:\s*nowrap;/);
});
