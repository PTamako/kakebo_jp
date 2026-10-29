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
  assert.match(fn,/const structured = !append && entryInputMode\.value === 'manual' \? parseNamedExpenseBlocks\(input\.value\) : null/)
  assert.match(fn,/if \(structured\?\.error\) return flash\(structured\.error\)/)
  assert.match(fn,/classify\(row\.merchant, rules\.value\)/)
  assert.match(fn,/const effectiveMode = structured \|\| repeated \? 'statement' : mode/)
  assert.doesNotMatch(fn,/entryInputMode\.value\s*=\s*'scan'/)
  assert.doesNotMatch(fn,/api\('entries'/)
  assert.match(app,/勉強会\\n10月毎週の金曜日\\n100円/)
})
