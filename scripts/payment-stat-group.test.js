import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAYMENT_STAT_METHODS, UNASSIGNED_TRANSFER_METHOD, isCreditPointRedemption, paymentMethodForEntry, matchesPaymentStatMethod } from '../src/payment-stat-group.js'
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
test('month and year share one selectable payment-method bar and preserve drill-down navigation',()=>{
  const page=read('src/pages/StatisticsPage.vue')
  const switcher=read('src/PaymentMethodSwitcher.vue')
  const app=read('src/App.vue')
  const api=read('functions/api/[[path]].js')
  assert.match(page,/import PaymentMethodSwitcher from '\.\.\/PaymentMethodSwitcher\.vue'/)
  assert.match(page,/<PaymentMethodSwitcher :report="stats" period="month" :yen="yen" :open-details="openPaymentMethodDetails"\s*\/>/)
  assert.match(page,/<PaymentMethodSwitcher :report="annualStats" period="year" :yen="yen" :open-details="openPaymentMethodDetails"\s*\/>/)
  assert.match(switcher,/\.\.\.PAYMENT_STAT_METHODS/)
  assert.match(switcher,/@click="toggle\(method\)"/)
  assert.match(switcher,/props\.openDetails\(selectedMethod\.value, props\.period\)/)
  assert.match(app,/matchesPaymentStatMethod\(entry, method, paymentSourceMeta\.value\)/)
  assert.match(app,/paymentMethodMatches\(entry,detailFilter\.value\.paymentMethod\)/)
  assert.match(app,/entryTypeFilter\.value = paymentMethod \? 'all'/)
  assert.equal((api.match(/WHEN p\.stat_group='points' THEN 'ポイント払い'/g)||[]).length,2)
  assert.equal((api.match(/LEFT JOIN payment_sources p ON p\.name=e\.payment_source/g)||[]).length,2)
  assert.equal((api.match(/e\.type IN \('expense','transfer'\)/g)||[]).length,2)
  assert.equal((api.match(/THEN '振替元未指定'/g)||[]).length,2)
  assert.match(switcher,/summary\(UNASSIGNED_TRANSFER_METHOD\)\.transferCount/)

})

test('point usage totals and separate breakdown remain accurate after switching from cards',()=>{
  const page=read('src/pages/StatisticsPage.vue')
  const switcher=read('src/PaymentMethodSwitcher.vue')
  assert.match(switcher,/Number\(row\.expenseAmount \|\| 0\) \+ Number\(row\.transferAmount \|\| 0\)/)
  assert.match(switcher,/method === 'ポイント払い' \? Number\(row\.creditOffsetAmount \|\| 0\) : 0/)
  assert.match(switcher,/selectedMethod === 'ポイント払い'/)
  assert.match(switcher,/selectedMethod !== UNASSIGNED_TRANSFER_METHOD/)
  assert.match(switcher,/summary\(selectedMethod\)\.creditOffsetAmount/)
  assert.match(switcher,/summary\(selectedMethod\)\.transferAmount/)
  assert.match(switcher,/summary\(selectedMethod\)\.expenseAmount/)
  assert.doesNotMatch(page,/支出と資産移動を分けて表示。資産移動は生活支出には含めません。/)
  assert.doesNotMatch(switcher,/資金流出の合計/)
  assert.match(switcher,/aria-expanded="selectedMethod === method"/)
  assert.match(switcher,/v-if="selectedMethod && methods\.includes\(selectedMethod\)"/)
  assert.match(switcher,/@click="showDetails"/)

})

test('October ¥900 credit-card point redemption belongs to point use, not general spending',()=>{
  const entry={
    type:'income',category:'ポイント還元',date:'2026-10-25',amount:900,
    payment_source:'セゾンカード',transfer_target:'credit:セゾンカード'
  }
  assert.equal(isCreditPointRedemption(entry),true)
  assert.equal(paymentMethodForEntry(entry,metadata),'ポイント払い')
  assert.equal(matchesPaymentStatMethod(entry,'ポイント払い',metadata),true)
  assert.equal(matchesPaymentStatMethod(entry,'カード・電子決済',metadata),false)
  assert.equal(matchesPaymentStatMethod(entry,'現金',metadata),false)
  assert.equal(matchesPaymentStatMethod({...entry,transfer_target:''},'ポイント払い',metadata),false)
  assert.equal(matchesPaymentStatMethod({...entry,category:'給与'},'ポイント払い',metadata),false)
  assert.equal(matchesPaymentStatMethod({...entry,type:'expense'},'ポイント払い',metadata),false)
  // Existing point-source transfers still count; no income enters spending totals.
  const entries=[
    entry,
    {type:'transfer',amount:12,payment_source:'ポイント還元',transfer_target:'prepaid:nanacoモバイル'},
    {type:'transfer',amount:4,payment_source:'ポイント還元',transfer_target:'prepaid:Suica'}
  ]
  assert.equal(entries.filter(e=>matchesPaymentStatMethod(e,'ポイント払い',metadata)).reduce((n,e)=>n+e.amount,0),916)
})

test('credit point redemptions are still aggregated in D1 and visible in the on-demand breakdown',()=>{
  const api=read('functions/api/[[path]].js')
  const switcher=read('src/PaymentMethodSwitcher.vue')
  const handler=api.slice(api.indexOf("if (a === 'stats' && m === 'GET')"))
  assert.equal((handler.match(/e\.type='income' AND e\.category='ポイント還元' AND e\.transfer_target LIKE 'credit:%' AND LENGTH\(e\.transfer_target\)>7/g)||[]).length,4)
  assert.equal((handler.match(/creditOffsetAmount/g)||[]).length,2)
  assert.equal((handler.match(/creditOffsetCount/g)||[]).length,2)
  assert.match(switcher,/>カード充当</)
  assert.match(switcher,/summary\(selectedMethod\)\.creditOffsetCount/)
  assert.match(switcher,/creditOffsetAmount \|\| 0/)
  assert.match(api,/MAX\(0,COALESCE\(SUM\(CASE WHEN type='income' THEN -amount ELSE amount END\),0\)\)/)

})

test('payment-method statistics collapse into one horizontal row and reveal details on tap',()=>{
  const page=read('src/pages/StatisticsPage.vue')
  const switcher=read('src/PaymentMethodSwitcher.vue')
  assert.equal((page.match(/<PaymentMethodSwitcher /g)||[]).length,2)
  assert.equal((page.match(/payment-method-stats-grid-three/g)||[]).length,0)
  assert.match(switcher,/class="payment-switcher-rail"/)
  assert.match(switcher,/display:flex;gap:6px;min-width:0;/)
  assert.match(switcher,/overflow-x:auto;/)
  assert.match(switcher,/flex:1 0 0;flex-direction:column;/)
  assert.match(switcher,/min-height:60px;/)
  assert.match(switcher,/:aria-expanded="selectedMethod === method"/)
  assert.match(switcher,/@click="toggle\(method\)"/)
  assert.match(switcher,/selectedMethod\.value = selectedMethod\.value === method \? '' : method/)
  assert.match(switcher,/v-if="selectedMethod && methods\.includes\(selectedMethod\)"/)
  assert.match(switcher,/\[UNASSIGNED_TRANSFER_METHOD\]/)
  assert.match(switcher,/>明細を見る <span aria-hidden="true">›<\/span>/)
  assert.doesNotMatch(page,/payment-method-unassigned/)

})
