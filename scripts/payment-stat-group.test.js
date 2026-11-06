import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAYMENT_STAT_METHODS, paymentMethodForEntry, matchesPaymentStatMethod } from '../src/payment-stat-group.js'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const metadata={
  'ポイント還元':{stat_group:'points',source_type:'prepaid'},
  '未来のポイント口座':{stat_group:'points',source_type:'standard'},
  'nanacoモバイル':{stat_group:'card',source_type:'prepaid'},
  'PayPay マネーライト':{stat_group:'card',source_type:'prepaid'}
}
test('point payment classification is D1-driven and separates card, cash and points',()=>{
  assert.deepEqual(PAYMENT_STAT_METHODS,['カード・電子決済','現金','ポイント払い'])
  for(const [name,method] of [['ポイント還元','ポイント払い'],['未来のポイント口座','ポイント払い'],['nanacoモバイル','カード・電子決済'],['PayPay マネーライト','カード・電子決済'],['未知のカード','カード・電子決済'],['','現金'],['現金','現金']]) {
    const entry={type:'expense',payment_source:name}
    assert.equal(paymentMethodForEntry(entry,metadata),method,name)
    assert.deepEqual(PAYMENT_STAT_METHODS.filter(m=>matchesPaymentStatMethod(entry,m,metadata)),[method])
  }
  assert.equal(matchesPaymentStatMethod({type:'income',payment_source:'ポイント還元'},'ポイント払い',metadata),false)
  assert.equal(matchesPaymentStatMethod({type:'transfer',payment_source:'ポイント還元'},'ポイント払い',metadata),false)
  assert.equal(matchesPaymentStatMethod({type:'expense',payment_source:'ポイント還元'},'不明',metadata),false)
})
test('month and year use exactly the same three-way stats and clickable detail filter',()=>{
  const page=read('src/pages/StatisticsPage.vue')
  const app=read('src/App.vue')
  const api=read('functions/api/[[path]].js')
  assert.equal((page.match(/v-for="method in PAYMENT_STAT_METHODS"/g)||[]).length,2)
  assert.equal((page.match(/openPaymentMethodDetails\(method,'(?:month|year)'\)/g)||[]).length,2)
  assert.match(app,/matchesPaymentStatMethod\(entry, method, paymentSourceMeta\.value\)/)
  assert.match(app,/entry\.type === 'expense' && paymentMethodMatches\(entry,detailFilter\.value\.paymentMethod\)/)
  assert.equal((api.match(/WHEN p\.stat_group='points' THEN 'ポイント払い'/g)||[]).length,2)
  assert.equal((api.match(/LEFT JOIN payment_sources p ON p\.name=e\.payment_source/g)||[]).length,2)
})
