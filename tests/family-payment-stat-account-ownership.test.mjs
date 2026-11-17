import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {paymentMethodForEntry,matchesPaymentStatMethod} from '../src/payment-stat-group.js'

test('personal card and prepaid expenses with empty legacy source remain card payments',()=>{
 for(const kind of ['credit_card','prepaid']){
  const row={type:'expense',payment_source:'',family_account_id:'a123',payment_account_kind:kind}
  assert.equal(paymentMethodForEntry(row),'カード・電子決済')
  assert.equal(matchesPaymentStatMethod(row,'現金'),false)
  assert.equal(matchesPaymentStatMethod(row,'カード・電子決済'),true)
 }
 assert.equal(paymentMethodForEntry({type:'expense',payment_source:''}),'現金')
 assert.equal(paymentMethodForEntry({type:'expense',payment_source:'',payment_account_kind:'cash'}),'現金')
 assert.equal(paymentMethodForEntry({type:'transfer',payment_source:''}),'振替元未指定')
 assert.equal(paymentMethodForEntry({type:'income',category:'ポイント還元',transfer_target:'credit:X'}),'ポイント払い')
})

test('both statistical endpoints use the account ownership classification with legacy fallback',()=>{
 for(const path of ['../functions/api/[[path]].js','../functions/api/family-finance/household-stats.js']){
  const s=readFileSync(new URL(path,import.meta.url),'utf8')
  assert.equal((s.match(/await accountStatsJoin\(db\)/g)||[]).length,2)
  assert.match(s,/fa\.account_kind IN \('credit_card','prepaid'\)/)
  assert.match(s,/fa\.account_kind='points'/)
  assert.match(s,/sqlite_master/)
 }
 const entryApi=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 assert.match(entryApi,/payment_method_group=paymentMethodForEntry\(r\)/)
 const ledger=readFileSync(new URL('../src/family-ledger-context.js',import.meta.url),'utf8')
 assert.match(ledger,/matchesPaymentStatMethod\(e,detailFilter\.value\.paymentMethod\)/)
 const stats=readFileSync(new URL('../src/family-stats-context.js',import.meta.url),'utf8')
 assert.match(stats,/onPaymentMethodDetails\(method,period\)/)
})
