import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseNamedExpenseBlocks} from '../src/named-expense.js'
import {parseRepeatedExpense} from '../src/natural-repeat.js'

const now=new Date(2026,9,29)
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const octoberFridays=['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30']

test('all six 3-line orders preserve name, recurring dates, and yen amount',()=>{
  const fields=['勉強会','10月毎週の金曜日','100円']
  const variations=[
    [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
  ]
  for(const order of variations){
    const input=order.map(i=>fields[i]).join('\n')
    const result=parseNamedExpenseBlocks(input,now)
    assert.ok(result&&!result.error,input)
    assert.deepEqual(result.rows.map(r=>r.date),octoberFridays,input)
    assert.ok(result.rows.every(r=>r.amount===100&&r.merchant==='勉強会'&&r.type==='expense'),input)
    assert.ok(result.rows.every(r=>!r.clientRequestId&&!r.paymentSource),input)
  }
})

test('inline fields can be moved before or after each other without losing the named draft',()=>{
  for(const text of [
    '勉強会10月毎週の金曜日 100円',
    '10月毎週の金曜日 勉強会 100円',
    '100円 勉強会10月毎週の金曜日',
    '勉強会100円10月毎週の金曜日',
    '100円10月毎週の金曜日勉強会',
    '10月毎週の金曜日100円勉強会',
    '2026年10月毎週の金曜日100円 勉強会'
  ]){
    const result=parseNamedExpenseBlocks(text,now)
    assert.ok(result&&!result.error,text)
    assert.deepEqual(result.rows.map(r=>r.date),octoberFridays,text)
    assert.ok(result.rows.every(r=>r.amount===100&&r.merchant==='勉強会'),text)
  }
  assert.equal(parseNamedExpenseBlocks('10月毎週の金曜日 100円',now),null)
  assert.equal(parseRepeatedExpense('10月毎週の金曜日 100円',now).length,5)
})

test('flexible single dates, mixed formats, and malformed money are handled safely',()=>{
  const group=parseNamedExpenseBlocks(
    '100円\n勉強会\n10月毎週の金曜日\n昼食10月29日 850円',now)
  assert.equal(group.rows.length,6)
  assert.equal(group.rows[5].merchant,'昼食')
  assert.equal(group.rows[5].date,'2026-10-29')
  assert.equal(group.rows[5].amount,850)
  for(const text of ['850円 昼食10月29日','10月29日 昼食 850円','昼食\n850円\n10月29日']){
    const result=parseNamedExpenseBlocks(text,now)
    assert.equal(result.rows.length,1,text)
    assert.equal(result.rows[0].merchant,'昼食',text)
    assert.equal(result.rows[0].amount,850,text)
  }
  for(const text of [
    '勉強会\n10月32日\n100円',
    '100円\n10月32日\n勉強会',
    '10月29日\n勉強会\n999999999円',
    '勉強会\n100円\n十月毎週の金曜日\n昼食\n850円'
  ])assert.ok(parseNamedExpenseBlocks(text,now)?.error,text)
  // Real credit-card statement lines keep the existing OCR/text parsing flow.
  assert.equal(parseNamedExpenseBlocks('2026年10月25日,ベルク,8323円,クレジットカード',now),null)
})

test('image upload recognizes in append mode then stays in 画像から読み取る tab',()=>{
  const app=src('src/App.vue')
  const image=app.match(/async function onImage\([\s\S]*?\n\}(?=\nfunction addBlank)/)?.[0]
  const manual=app.match(/function recognize\([\s\S]*?\n\}(?=\nasync function onImage)/)?.[0]
  assert.ok(image)
  assert.ok(manual)
  assert.match(image,/recognize\(mode, true\)\s*entryInputMode\.value = 'scan'/)
  assert.doesNotMatch(image,/entryInputMode\.value\s*=\s*'manual'/)
  assert.doesNotMatch(manual,/entryInputMode\.value\s*=\s*'manual'/)
  assert.doesNotMatch(manual,/entryInputMode\.value\s*=\s*'scan'/)
  assert.match(app,/v-if="entryInputMode === 'scan'" class="panel capture-panel"/)
  assert.match(app,/@change="onImage\(\$event, recognitionMode\)"/)
})

test('calendar is compact but retains today, selected, income and expense badges',()=>{
  const css=src('src/mobile-ui.css')
  const app=src('src/App.vue')
  assert.match(css,/main \.month-calendar \.calendar-day\{\s*height:46px;min-height:46px/)
  assert.match(css,/main \.month-calendar \.calendar-legend\{margin:-2px 2px 5px/)
  assert.match(css,/main \.month-calendar \.calendar-day-badges\{min-height:10px/)
  assert.match(app,/calendar-today/)
  assert.match(app,/calendar-top-expense/)
  assert.match(app,/calendar-top-income/)
  assert.match(app,/calendar-selected/)
  assert.match(app,/calendarExpanded \? '週のみ表示' : '月全体を表示'/)
})
