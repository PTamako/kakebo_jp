import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isCardBilledEntry } from '../src/card-billing.js'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')
const finance = source('src/FinanceTools.vue')
const ledger = source('src/pages/LedgerPage.vue')
const fetcher = app.match(/async function fetchCardBillDetailRows\(filter\) \{[\s\S]*?\n\}\nasync function fetchPeriodDetailRows/)?.[0]
  ?.replace(/\nasync function fetchPeriodDetailRows$/, '') || ''
const opener = app.match(/async function openCardBillDetails\(details\) \{[\s\S]*?\n\}\nasync function openCategoryDetails/)?.[0]
  ?.replace(/\nasync function openCategoryDetails$/, '') || ''

const record = (date, card, type = 'expense', target = '', amount = 1000) =>
  ({ date, payment_source: card, type, transfer_target: target, amount, id: date + card + type })

test('save and view buttons stay side by side and share the selected closing period', () => {
  assert.match(finance, /class="card-billing-actions"/)
  assert.match(finance, /grid-template-columns:minmax\(0,3fr\) minmax\(0,2fr\)/)
  assert.match(finance, /@click="saveCardBill">この月の利用額を保存/)
  assert.match(finance, /@click="viewCardBillDetails">明細を見る/)
  assert.match(finance, /emit\('open-card-bill-details', \{/)
  assert.match(finance, /name: bill\.value\.name, month: bill\.value\.month, start: period\.start, end: period\.end/)
  assert.match(app, /@open-card-bill-details="openCardBillDetails"/)
})

test('cross-month card statement retrieves both months and excludes wrong cards and dates', async () => {
  assert.ok(fetcher, 'billing-period retrieval exists')
  const calls = []
  const items = {
    '2026-09': [
      record('2026-09-10', '楽天カード'),
      record('2026-09-11', '楽天カード', 'expense', '', 200),
      record('2026-09-16', '楽天カード', 'transfer', 'sbi', 300),
      record('2026-09-18', '楽天カード', 'transfer', 'prepaid:Suica', 400),
      record('2026-09-20', 'PayPayカード'),
      record('2026-09-20', '楽天カード', 'income'),
      record('2026-09-22', '楽天カード', 'transfer', '')
    ],
    '2026-10': [
      record('2026-10-10', '楽天カード', 'expense', '', 500),
      record('2026-10-11', '楽天カード'),
      record('2026-10-01', 'PayPayカード')
    ]
  }
  const fetchMonthEntries = async month => { calls.push(month); return items[month] || [] }
  const run = new Function('fetchMonthEntries', 'isCardBilledEntry',
    fetcher + '\nreturn fetchCardBillDetailRows')(fetchMonthEntries, isCardBilledEntry)
  const filtered = await run({period:'card-bill',cardName:'楽天カード',start:'2026-09-11',end:'2026-10-10'})
  assert.deepEqual(calls,['2026-09','2026-10'])
  assert.deepEqual(filtered.map(row=>row.amount), [200,300,400,500])
  assert.equal(filtered.reduce((n,row)=>n+row.amount,0),1400)
})

test('end-of-month billing never downloads duplicate pages', async () => {
  const calls=[]
  const run = new Function('fetchMonthEntries', 'isCardBilledEntry',
    fetcher + '\nreturn fetchCardBillDetailRows')(async month=>{calls.push(month);return [record('2026-10-20','楽天カード')]},isCardBilledEntry)
  const result=await run({period:'card-bill',cardName:'楽天カード',start:'2026-10-01',end:'2026-10-31'})
  assert.equal(result.length,1)
  assert.deepEqual(calls,['2026-10'])
})

test('billing-period navigation opens all matching transactions including transfers',async()=>{
  assert.ok(opener,'drilldown navigation handler exists')
  const state = {
    paymentSources:{value:['楽天カード','PayPayカード']},
    paymentSourceMeta:{value:{
      '楽天カード':{source_type:'standard'},
      'PayPayカード':{source_type:'standard'},
      '過去カード':{source_type:'standard',is_archived:1}
    }},
    month:{value:'2026-11'},
    editListReturn:{value:null},
    prepaidHistoryFilter:{value:{card:'Suica'}},
    entryTypeFilter:{value:'expense'},
    selectedDay:{value:'2026-11-01'},
    calendarExpanded:{value:true},
    detailSourceEntries:{value:[]},
    visibleEntryCount:{value:100},
    preserveOperatedDay:{value:'2026-11-01'},
    detailFilter:{value:null},
    tab:{value:'finance'},
    detailLoading:{value:false}
  }
  const effects=[]
  const params = {
    ...state,
    nextTick:async()=>effects.push('tick'),
    flash:message=>effects.push(message),
    fetchCardBillDetailRows:async filter=>[record('2026-10-09',filter.cardName,'transfer','sbi',1500)]
  }
  const open = new Function(...Object.keys(params),
    'let detailRequestId=0;\n'+opener+'\nreturn openCardBillDetails')(...Object.values(params))
  await open({name:'楽天カード',month:'2026-10',start:'2026-09-11',end:'2026-10-10'})
  assert.equal(state.tab.value,'list')
  assert.equal(state.month.value,'2026-10')
  assert.equal(state.entryTypeFilter.value,'all')
  assert.equal(state.selectedDay.value,'')
  assert.equal(state.detailFilter.value.cardName,'楽天カード')
  assert.deepEqual({start:state.detailFilter.value.start,end:state.detailFilter.value.end},{start:'2026-09-11',end:'2026-10-10'})
  assert.equal(state.detailSourceEntries.value.length,1)
  assert.equal(state.detailSourceEntries.value[0].type,'transfer')
  assert.equal(state.visibleEntryCount.value,20)
  assert.equal(state.detailLoading.value,false)
  assert.equal(state.paymentSources.value.includes('過去カード'),false)
  await open({name:'過去カード',month:'2026-10',start:'2026-09-11',end:'2026-10-10'})
  assert.equal(state.detailFilter.value.cardName,'過去カード')
  assert.equal(state.tab.value,'list')
})

test('ledger shows billing period, transfer-aware totals and a way to clear filtering',()=>{
  assert.match(app,/detailFilter\.value\?\.period === 'card-bill'\s*\? source\.filter\(entry => isCardBilledEntry\(entry, detailFilter\.value, detailFilter\.value\.cardName\)\)/)
  assert.match(ledger,/detailFilter\?\.period === 'card-bill'[^<]*\{\{ detailFilter\.cardName \}\}/)
  assert.match(ledger,/detailFilter\.start \}\} ～ \{\{ detailFilter\.end/)
  assert.match(ledger,/カードの締め期間で絞り込み中（資産移動を含む）/)
  assert.match(app,/detailFilter\.value\?\.period === 'card-bill' \? cardBilledAmount\(entry\) : Number\(entry\.amount \|\| 0\)/)
  assert.match(ledger,/detailFilter\?\.period === 'card-bill' \|\| detailFilter\?\.paymentMethod \? yen\(group\.total\)/)
  assert.match(ledger,/@click="clearDetailFilter">絞り込みを解除/)
})

test('billing detail refreshes across both months after editing and manual month changes clear it',()=>{
  assert.match(app,/if \(period === 'card-bill'\) return fetchCardBillDetailRows\(detailFilter\.value\)/)
  assert.match(app,/const requestId = detailRequestId\s+const rows = await fetchPeriodDetailRows\(filter\.period, requestId\)/)
  assert.match(app,/if \(requestId === detailRequestId && filter === detailFilter\.value\)/)
  assert.match(app,/if \(!returning && detailFilter\.value\?\.period === 'card-bill'\)/)
})

test('editing a charge dated in previous month retains closing-month billing context',()=>{
  const saveEdit = app.match(/async function saveEdit\(\) \{([\s\S]*?)\n\}\n\nconst pendingTransfers/)?.[1] || ''
  assert.match(saveEdit, /destinationMonth && destinationMonth !== month\.value && detailFilter\.value\?\.period !== 'card-bill'/)
  assert.match(saveEdit, /await refreshDetailSource\(\)/)
  assert.match(saveEdit, /editListReturn\.value = \{/)
})
