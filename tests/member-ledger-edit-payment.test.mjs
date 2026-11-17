import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {ledgerPaymentLabel} from '../src/ledger-payment-label.js'

test('husband edit form renders the same payment field, read-only with actual cash value',()=>{
 const row={id:527,type:'expense',payment_source:'現金',payment_source_display:'現金',
  shared_entry_requester_user_id:'husband'}
 assert.equal(ledgerPaymentLabel(row),'現金')
 const ledger=readFileSync(new URL('../src/family-ledger-context.js',import.meta.url),'utf8')
 assert.match(ledger,/paymentSource:ledgerPaymentLabel\(entry\)/)
 assert.match(ledger,/payment_source:null/)
 const page=readFileSync(new URL('../src/pages/LedgerPage.vue',import.meta.url),'utf8')
 assert.match(page,/:show-payment-source="true" :payment-read-only="props.member"/)
 const form=readFileSync(new URL('../src/TransactionForm.vue',import.meta.url),'utf8')
 assert.match(form,/record.type==='expense' && showPaymentSource/)
 assert.match(form,/v-if="paymentReadOnly" class="payment-source-readonly"/)
 assert.match(form,/\{\{record.paymentSource\|\|'未設定'\}\}/)
 assert.match(form,/<MobileChoiceSheet :model-value="record.paymentSource" v-else/)
})

test('shared card is visible only if member projection has authorized label; edit cannot change it',()=>{
 assert.equal(ledgerPaymentLabel({type:'expense',payment_source:'セブンカード・プラス',
  payment_source_display:'セブンカード・プラス',
  shared_entry_requester_user_id:'husband'}),'セブンカード・プラス')
 assert.equal(ledgerPaymentLabel({type:'expense',payment_source:null,
  payment_source_display:'个人支付方式',shared_entry_requester_user_id:null}),'个人支付方式')
 const form=readFileSync(new URL('../src/TransactionForm.vue',import.meta.url),'utf8')
 assert.match(form,/<MobileChoiceSheet :model-value="record.paymentSource" v-else/)
 const requests=readFileSync(new URL('../src/FamilySharedMutationRequests.vue',import.meta.url),'utf8')
 assert.match(requests,/if\(input\?\.payment_source!=null&&input\.payment_source!==''\)/)
 const ledger=readFileSync(new URL('../src/family-ledger-context.js',import.meta.url),'utf8')
 assert.match(ledger,/payment_source:null/)
})
