import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseRepeatedExpense} from '../src/natural-repeat.js'
import {classify} from '../src/parse.js'
import {DEFAULT_RULE_ROWS} from './fixtures/default-rule-rows.js'
import {restoreAtomic} from '../functions/api/restore-atomic.js'

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('Chinese October Fridays become exactly five reviewable drafts and never save automatically',()=>{
  const rows=parseRepeatedExpense('10月每周五 花费100元',new Date(2026,9,29))
  assert.deepEqual(rows.map(x=>x.date),['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30'])
  assert.ok(rows.every(x=>x.amount===100&&x.type==='expense'&&!x.paymentSource&&!x.clientRequestId))
  assert.equal(parseRepeatedExpense('这个月随便花费100元'),null)
  assert.equal(parseRepeatedExpense('10月每周五 花费0元'),null)
  assert.equal(parseRepeatedExpense('10月每周五 花费999999999元'),null)
  assert.deepEqual(parseRepeatedExpense('2026年2月毎週金曜日に100円使った',new Date(2026,9,29)).map(x=>x.date),['2026-02-06','2026-02-13','2026-02-20','2026-02-27'])
})

test('isolated test fixture covers migrated merchant matching examples',()=>{
  const rows=DEFAULT_RULE_ROWS.map(([keyword,category])=>({keyword,category,is_custom:false}))
  for(const value of ['Amazon','アマゾン','楽天','楽天市場','ユニクロ','UNIQLO','コジマ'])
    assert.equal(classify(value,rows).category,'购物',value)
  assert.equal(classify('ペットのコジマ',rows).category,'宠物')
})

test('today and highest expense/income marks survive month and week calendar views',()=>{
  const app=source('src/App.vue')+'\n'+source('src/pages/LedgerPage.vue')
  assert.match(app,/calendar-today/)
  assert.match(app,/calendar-top-expense/)
  assert.match(app,/calendar-top-income/)
  assert.match(app,/maxExpense=Math\.max/)
  assert.match(app,/maxIncome=Math\.max/)
  assert.match(app,/liveNow\.value\.toLocaleDateString/)
  assert.match(app,/:aria-current="day\.isToday \? 'date'/)
  assert.match(app,/:datetime="liveClockIso"/)
  assert.match(app,/clockTimer = setInterval\(/)
  assert.match(app,/if \(clockTimer\) clearInterval\(clockTimer\)/)
  assert.match(app,/parseRepeatedExpense\(input\.value\)/)
})

test('card bill recalculation is server-authoritative, never saves cached amount',()=>{
  const api=source('functions/api/[[path]].js'),ui=source('src/FinanceTools.vue')
  assert.match(api,/INSERT INTO card_bills\(payment_source,bill_month,period_start,period_end,total_amount,transaction_count\)\s*SELECT \?1,\?2,\?3,\?4,COALESCE\(SUM\(amount\),0\),COUNT\(\*\)/)
  assert.match(ui,/props\.api\('card-bills\/recalculate'/)
  assert.doesNotMatch(ui,/total:cardTotal\.value,count:cardTransactions\.value\.length/)
})

test('single D1 batch snapshot protects cross-table export',()=>{
  const api=source('functions/api/[[path]].js')
  const ui=source('src/FinanceTools.vue')
  assert.match(api,/if \(a === 'backup-snapshot' && m === 'GET'\)/)
  assert.match(api,/const results=await db\.batch\(statements\)/)
  assert.match(ui,/props\.api\('backup-snapshot'\)/)
  assert.match(ui,/await sealBackup\(validated\)/)
})

test('preview requires matching identity from bound D1, not only configured flags',()=>{
  const api=source('functions/api/[[path]].js')
  assert.match(api,/SELECT value FROM environment_identity WHERE name='database_id'/)
  assert.match(api,/actualIdentity\?\.value\?\.toLowerCase\(\)!==env\.PREVIEW_D1_ID\.toLowerCase\(\)/)
})

test('future dated SBI transfers are not restored as applied even when backup says applied',async()=>{
  const bindCalls=[]
  const db={prepare(sql){return{bind(...params){return {sql,params}}}},async batch(statements){bindCalls.push(...statements);return statements.map(()=>({meta:{changes:1}}))}}
  const backup={format:'kakeibo-ledger-backup',version:3,
    entries:[{id:12,date:'2099-12-30',type:'transfer',amount:15000,transfer_target:'sbi',transfer_date:'2099-12-30',transfer_applied:1,clientRequestId:'restore_'+'a'.repeat(32)}]}
  await restoreAtomic(db,backup)
  const transfer=bindCalls.find(x=>x.sql.startsWith('INSERT INTO entries'))
  assert.equal(transfer.params[9],0)
  assert.equal(transfer.params[10],'2099-12-30')
  assert.doesNotMatch(source('functions/api/restore-atomic.js'),/type,target,transfer\?Number\(e\.transfer_applied/)
})
test('resumable D1 restoration is broken into bounded transactional batches',()=>{
  const ui=source('src/FinanceTools.vue')
  assert.match(ui,/const BATCH_SIZE=150/)
  assert.match(ui,/for\(let offset=0;offset<sourceRows\.length;offset\+=BATCH_SIZE\)/)
  assert.match(ui,/restoreOwnKeys\.value=new Map/)
})


test('Japanese kanji October and numeric October Fridays expand to identical five drafts',()=>{
  const phrases=[
    '十月毎週の金曜日に　100円',
    '十月の毎週金曜日に100円使った',
    '10月毎週の金曜日に100円',
    '2026年十月の毎週金曜日に100円使った',
    '１０月毎週の金曜日に１００円'
  ]
  const expected=['2026-10-02','2026-10-09','2026-10-16','2026-10-23','2026-10-30']
  for(const phrase of phrases){
    const drafts=parseRepeatedExpense(phrase,new Date(2026,9,29))
    assert.ok(drafts,phrase)
    assert.deepEqual(drafts.map(item=>item.date),expected,phrase)
    assert.ok(drafts.every(item=>item.amount===100&&item.type==='expense'&&item.note==='毎週金曜日の支出（内容を確認）'),phrase)
    assert.ok(drafts.every(item=>!item.clientRequestId&&!item.paymentSource),phrase)
  }
  assert.deepEqual(
    parseRepeatedExpense('2026年十二月の毎週土曜日に1,000円',new Date(2026,9,29)).map(item=>item.date),
    ['2026-12-05','2026-12-12','2026-12-19','2026-12-26']
  )
  assert.equal(parseRepeatedExpense('十三月毎週金曜日に100円'),null)
  assert.equal(parseRepeatedExpense('十月毎週金曜日に0円'),null)
})

test('手入力 text reading keeps the manual tab and review/save controls; only image reading opens image tab',()=>{
  const app=source('src/App.vue')
  const manual=app.match(/function recognize\([\s\S]*?\n\}(?=\nasync function onImage)/)?.[0]
  const image=app.match(/async function onImage\([\s\S]*?\n\}(?=\nfunction addBlank)/)?.[0]
  assert.ok(manual,'text recognizer is present')
  assert.ok(image,'image upload handler is present')
  assert.match(app,/@click="recognize\(recognitionMode\)"/)
  assert.match(app,/v-if="entryInputMode === 'manual'"/)
  assert.match(app,/entryInputMode === 'scan' \? '読み取り結果の確認' : '入力内容の確認'/)
  assert.match(app,/@click="saveAll"/)
  assert.match(manual,/const repeated = parseRepeatedExpense\(input\.value\)/)
  assert.match(manual,/const effectiveMode = structured \|\| repeated \? 'statement' : mode/)
  assert.match(manual,/forms\.value = append \? \[\.\.\.forms\.value, \.\.\.parsedForms\] : parsedForms/)
  assert.doesNotMatch(manual,/entryInputMode\.value\s*=\s*'scan'/)
  assert.doesNotMatch(manual,/api\('entries'/)
  assert.match(image,/recognize\(mode, true\)[\s\S]*entryInputMode\.value = 'scan'/)
})
