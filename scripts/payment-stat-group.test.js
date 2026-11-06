import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAYMENT_STAT_METHODS, UNASSIGNED_TRANSFER_METHOD, paymentMethodForEntry, matchesPaymentStatMethod } from '../src/payment-stat-group.js'
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
  assert.equal(matchesPaymentStatMethod({type:'transfer',payment_source:'ポイント還元'},'ポイント払い',metadata),true)
  assert.equal(matchesPaymentStatMethod({type:'transfer',payment_source:'nanacoモバイル'},'カード・電子決済',metadata),true)
  assert.equal(matchesPaymentStatMethod({type:'transfer',payment_source:'現金'},'現金',metadata),true)
  for(const source of ['', 'その他', '其他']) {
    const entry={type:'transfer',payment_source:source}
    assert.equal(paymentMethodForEntry(entry,metadata),UNASSIGNED_TRANSFER_METHOD)
    assert.equal(matchesPaymentStatMethod(entry,UNASSIGNED_TRANSFER_METHOD,metadata),true)
    assert.equal(matchesPaymentStatMethod(entry,'現金',metadata),false)
  }
  assert.equal(matchesPaymentStatMethod({type:'expense',payment_source:'ポイント還元'},'不明',metadata),false)
})
test('month and year use exactly the same three-way stats and clickable detail filter',()=>{
  const page=read('src/pages/StatisticsPage.vue')
  const app=read('src/App.vue')
  const api=read('functions/api/[[path]].js')
  assert.equal((page.match(/v-for="method in PAYMENT_STAT_METHODS"/g)||[]).length,2)
  assert.equal((page.match(/openPaymentMethodDetails\(method,'(?:month|year)'\)/g)||[]).length,2)
  assert.match(app,/matchesPaymentStatMethod\(entry, method, paymentSourceMeta\.value\)/)
  assert.match(app,/paymentMethodMatches\(entry,detailFilter\.value\.paymentMethod\)/)
  assert.match(app,/entryTypeFilter\.value = paymentMethod \? 'all'/)
  assert.equal((api.match(/WHEN p\.stat_group='points' THEN 'ポイント払い'/g)||[]).length,2)
  assert.equal((api.match(/LEFT JOIN payment_sources p ON p\.name=e\.payment_source/g)||[]).length,2)
  assert.equal((api.match(/e\.type IN \('expense','transfer'\)/g)||[]).length,2)
  assert.equal((api.match(/THEN '振替元未指定'/g)||[]).length,2)
  assert.equal((page.match(/methodSummary\([^)]*,'振替元未指定'\)/g)||[]).length>=2,true)
})

test('the payment method card headline is total outflow while expense stays separate',()=>{
  const page=read('src/pages/StatisticsPage.vue')
  assert.match(page,/const methodOutflow =/)
  assert.match(page,/Number\(methodSummary\(report, method\)\.expenseAmount \|\| 0\) \+ Number\(methodSummary\(report, method\)\.transferAmount \|\| 0\)/)
  assert.equal((page.match(/資金流出の合計/g)||[]).length,0)
  assert.equal((page.match(/class="payment-method-breakdown-row"/g)||[]).length,4)
  assert.equal((page.match(/class="payment-method-breakdown-label">支出/g)||[]).length,2)
  assert.equal((page.match(/class="payment-method-breakdown-label">資産移動/g)||[]).length,2)
  const app=read('src/App.vue')
  assert.match(app,/\.payment-method-stats-grid-three\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(app,/\.payment-method-stats-grid-three button:last-child\{grid-column:auto\}/)
  assert.match(app,/\.payment-method-stats-grid\.payment-method-stats-grid-three button\{min-width:0;padding:8px 5px;/)
  assert.match(app,/\.payment-method-stats-grid-three \.payment-method-breakdown-row\{display:grid;grid-template-columns:max-content minmax\(0,1fr\) max-content;/)
  assert.match(app,/\.payment-method-stats-grid-three \.payment-method-breakdown-row small\{display:block;justify-self:end;white-space:nowrap;/)
})
