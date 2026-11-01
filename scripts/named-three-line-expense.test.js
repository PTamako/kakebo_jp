import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseNamedExpenseBlocks } from '../src/named-expense.js'
import { parseRepeatedExpense } from '../src/natural-repeat.js'

const now=new Date(2026,9,29)
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('name / date / price three lines expand every October Friday without losing name',()=>{
  const result=parseNamedExpenseBlocks('勉強会\n10月毎週の金曜日\n100円',now)
  assert.ok(result && !result.error)
  assert.deepEqual(result.rows.map(row=>row.date),[
    '2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30'
  ])
  assert.ok(result.rows.every(row=>row.merchant==='勉強会'&&row.amount===100&&row.type==='expense'))
  assert.ok(result.rows.every(row=>!row.clientRequestId&&!row.paymentSource))
  assert.equal(result.rows.reduce((total,row)=>total+row.amount,0),500)
})

test('same three-line order also supports one-day records and multiple groups',()=>{
  const result=parseNamedExpenseBlocks(
    '勉強会\n10月毎週の金曜日\n100円\n\n昼食\n2026年10月29日\n1,200円',now)
  assert.equal(result.rows.length,6)
  assert.deepEqual(result.rows[5],{
    date:'2026-10-29',time:'',amount:1200,type:'expense',merchant:'昼食',
    category:'日用品',note:'',raw:'昼食\n2026年10月29日\n1,200円',
    suggested:'日用品',keyword:''
  })
  assert.deepEqual(parseNamedExpenseBlocks('会議\n十月29日\n¥500',now).rows.map(row=>row.date),['2026-10-29'])
  assert.deepEqual(parseNamedExpenseBlocks('書籍\n2026-10-25\n¥1,500',now).rows.map(row=>row.date),['2026-10-25'])
  assert.deepEqual(parseNamedExpenseBlocks('交通費\n10/30\n500',now).rows.map(row=>row.date),['2026-10-30'])
  assert.deepEqual(parseNamedExpenseBlocks('勉強会\n十二月毎週の土曜日\n１００円',now).rows.map(row=>row.date),
    ['2026-12-05','2026-12-12','2026-12-19','2026-12-26'])
})

test('reject malformed three-line drafts rather than silently inserting wrong dates or amounts',()=>{
  for(const input of [
    '勉強会\n10月32日\n100円',
    '勉強会\n2月30日\n100円',
    '勉強会\n十三月毎週金曜日\n100円',
    '勉強会\n10月29日\n0円',
    '勉強会\n10月29日\n999999999円',
    '勉強会\n10月29日',
    '勉強会\n10月29日\n100円\n昼食\n10月30日'
  ]){
    const result=parseNamedExpenseBlocks(input,now)
    assert.ok(result?.error,input)
    assert.equal(result.rows,undefined,input)
  }
  assert.equal(parseNamedExpenseBlocks('2026年10月25日,ベルク,8323円,クレジットカード',now),null)
  assert.equal(parseNamedExpenseBlocks('10月毎週の金曜日 100円',now),null)
  // Do not regress the original natural-language single-line feature.
  assert.equal(parseRepeatedExpense('10月毎週の金曜日 100円',now).length,5)
})

test('manual text runs structured parsing before fallback without switching to image or saving',()=>{
  const app=source('src/App.vue')
  const fn=app.match(/function recognize\([\s\S]*?\n\}(?=\nasync function onImage)/)?.[0]
  assert.ok(fn)
  assert.match(fn,/const structured = !append && entryInputMode\.value === 'manual' \? parseNamedExpenseBlocks\(input\.value, referenceTime\) : null/)
  assert.match(fn,/if \(structured\?\.error\) return flash\(structured\.error\)/)
  assert.match(fn,/classify\(row\.merchant, rules\.value\)/)
  assert.match(fn,/const effectiveMode = structured \|\| repeated \? 'statement' : mode/)
  assert.doesNotMatch(fn,/entryInputMode\.value\s*=\s*'scan'/)
  assert.doesNotMatch(fn,/api\('entries'/)
  // Check the documented input formats without pinning a user-edited sentence.
  const hint=app.match(/<textarea id="entry-text"[^>]*>/)?.[0]
  assert.ok(hint)
  assert.match(hint,/v-model="input"/)
  assert.match(hint,/recognitionMode === 'statement'/)
  assert.match(hint,/勉強会/)
  assert.match(hint,/10月毎週の金曜日/)
  assert.match(hint,/10\/10/)
  assert.match(hint,/100円/)
})


test('single-line named weekly expenses keep the item name and expand to five dates',()=>{
  for(const value of [
    '勉強会10月毎週の金曜日 100円',
    '勉強会 10月毎週の金曜日 100円',
    '勉強会十月毎週の金曜日　１００円',
    '勉強会2026年10月毎週の金曜日 ¥100'
  ]){
    const result=parseNamedExpenseBlocks(value,now)
    assert.ok(result && !result.error,value)
    assert.deepEqual(result.rows.map(row=>row.date),[
      '2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30'
    ],value)
    assert.ok(result.rows.every(row=>row.merchant==='勉強会' && row.amount===100),value)
    assert.ok(result.rows.every(row=>!row.clientRequestId&&!row.paymentSource),value)
  }
})

test('single-line names and dates support a single date and multiple independent rows',()=>{
  const result=parseNamedExpenseBlocks('昼食10月29日 850円\n勉強会10月毎週の金曜日 100円',now)
  assert.ok(result && !result.error)
  assert.equal(result.rows.length,6)
  assert.equal(result.rows[0].merchant,'昼食')
  assert.equal(result.rows[0].date,'2026-10-29')
  assert.equal(result.rows[0].amount,850)
  // The shorter date in the UI hint must work in a single-line draft too.
  const shortDate=parseNamedExpenseBlocks('勉強会 10/10 100円',now)
  assert.ok(shortDate && !shortDate.error)
  assert.deepEqual(shortDate.rows.map(row=>[row.date,row.merchant,row.amount]),[['2026-10-10','勉強会',100]])
  assert.ok(result.rows.slice(1).every(row=>row.merchant==='勉強会'))
  assert.equal(parseNamedExpenseBlocks('勉強会10月毎週の金曜日 0円',now).rows,undefined)
  assert.match(parseNamedExpenseBlocks('勉強会10月毎週の金曜日 999999999円',now).error,/金額/)
  assert.equal(parseNamedExpenseBlocks('11月毎週の金曜日 100円',now),null)
  assert.equal(parseNamedExpenseBlocks('2026年10月25日,ベルク,8323円,クレジットカード',now),null)
  assert.equal(parseNamedExpenseBlocks('勉強会\n10月毎週の金曜日\n100円',now).rows.length,5)
  assert.equal(parseRepeatedExpense('11月毎週の金曜日 100円',now).length,4)
})

test('standalone 今 before a name means recognition instant in JST down to seconds',()=>{
  const reference = new Date('2026-10-31T15:00:02.000Z') // JST: 2026-11-01 00:00:02
  for(const text of [
    '今　テスト　1000円',
    '今 テスト 1000円',
    'テスト 今 1000円',
    '今\nテスト\n1000円',
    'テスト\n今\n1000円'
  ]){
    const result=parseNamedExpenseBlocks(text,reference)
    assert.ok(result?.rows && !result.error,text)
    assert.equal(result.rows.length,1,text)
    assert.equal(result.rows[0].merchant,'テスト',text)
    assert.equal(result.rows[0].date,'2026-11-01',text)
    assert.equal(result.rows[0].time,'00:00:02',text)
    assert.equal(result.rows[0].amount,1000,text)
    assert.equal(result.rows[0].type,'expense',text)
  }
})

test('今 means now only as a standalone date token and never inside a merchant name',()=>{
  const ref=new Date('2026-11-01T03:09:08.000Z')
  assert.equal(parseNamedExpenseBlocks('今月のテスト 1000円',ref),null)
  const today=parseNamedExpenseBlocks('今日 テスト 1000円',ref)
  assert.equal(today.rows[0].merchant,'テスト')
  assert.equal(today.rows[0].time,'')
  assert.equal(parseNamedExpenseBlocks('テスト 今 0円',ref).rows,undefined)
})

test('now-second drafts are supported by form controls, API validation and backup restoration',()=>{
  const form=source('src/TransactionForm.vue')
  const api=source('functions/api/[[path]].js')
  const backup=source('src/finance-tools.js')
  assert.match(form,/v-model="record.time" type="time" step="1"/)
  assert.match(api,/\[0-5\]\\d\(\?::\[0-5\]\\d\)\?/,'the API accepts optional seconds')
  assert.match(backup,/\[0-5\]\\d\(\?::\[0-5\]\\d\)\?/,'backup accepts optional seconds')
})
