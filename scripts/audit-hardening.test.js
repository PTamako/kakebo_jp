import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  backupVersion, validateBackup, transactionKey, prepareRestoreRows, restoreMissingByKey
} from '../src/finance-tools.js'

const row = (id, overrides={}) => ({
  id, date:'2026-10-28', time:'12:00', amount:1000, type:'expense',
  merchant:'スーパー', category:'饮食料品', payment_source:'現金',
  note:'食材', ...overrides
})

test('v2 complete backup accepts explicit SBI data, v1 legacy archive is still readable', () => {
  const value={ format:'kakeibo-ledger-backup', version:backupVersion, entries:[row(1)],
    investments:[{platform:'sbi',current_value:70000,pnl:10000}],plans:[],bills:[],
    paymentSources:[{name:'現金',closing_day:null}],customRules:[],merchantPaymentRules:[],
    categories:['饮食料品'],categoryIcons:{} }
  assert.equal(validateBackup(value),value)
  assert.equal(validateBackup({format:value.format,version:1,entries:[row(1)]}).version,1)
  assert.throws(()=>validateBackup({...value,investments:[{platform:'sbi',current_value:-1,pnl:0}]}))
  assert.throws(()=>validateBackup({...value,entries:[row(1,{date:'2026-02-30'})]}))
})

test('restore sees both same-day purchases with different notes or cards', () => {
  const existing=[row(1,{payment_source:'現金',note:'午前'})]
  const incoming=[
    row(11,{payment_source:'現金',note:'午前'}),
    row(12,{payment_source:'PayPay',note:'午前'}),
    row(13,{payment_source:'現金',note:'午後'}),
    row(14,{payment_source:'現金',note:'午前'})
  ]
  const result=prepareRestoreRows(existing,incoming)
  assert.deepEqual(result.newRows.map(e=>e.id),[12,13])
  assert.deepEqual(result.conflicts.map(e=>e.id),[11,14])
  assert.deepEqual(result.conflicts.map(e=>e.backupIndex),[0,3])
  assert.notEqual(transactionKey(incoming[0]),transactionKey(incoming[1]))
})

test('restore of settings never chooses a row already registered in D1', () => {
  const existing=[{id:'plan-12345',name:'現行の家賃',amount:100000}]
  const backup=[{id:'plan-12345',name:'過去の家賃',amount:80000},{id:'plan-56789',name:'新しい予定',amount:2000}]
  assert.deepEqual(restoreMissingByKey(existing,backup,plan=>plan.id),[backup[1]])
})

const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const api=source('functions/api/[[path]].js')
const app=source('src/App.vue')
const finance=source('src/FinanceTools.vue')
const recurring=source('src/recurring-check.js')

test('fixed expenses use atomic server-side conflict avoidance and existing valuations remain safe', () => {
  assert.match(api,/if \(a === 'recurring-post' && m === 'POST'\)/)
  assert.match(api,/const samePeriod=perDate\?'e\.date=\?1':'substr\(e\.date,1,7\)=\?8'/)
  assert.match(api,/SELECT COUNT\(\*\) FROM entries e WHERE \$\{samePeriod\}/)
  assert.match(api,/recurringManualSlot\(db,plan,date\)/)
  assert.match(api,/ON CONFLICT\(client_request_id\) DO NOTHING/)
  assert.match(recurring,/api\('recurring-post'/)
  assert.match(finance,/postApprovedRecurringEntries\(props\.api/)
  assert.doesNotMatch(api,/SELECT .*investment_snapshots|UPDATE investment_snapshots|INSERT INTO investment_snapshots/)
  assert.doesNotMatch(api,/UPDATE investment_snapshots SET current_value\s*=\s*current_value\s*\+/)
})

test('all years are dynamically discovered; monthly API uses pages',()=>{
  assert.match(api,/if \(a === 'entry-years' && m === 'GET'\)/)
  assert.match(finance,/await props\.api\('entry-years'\)/)
  assert.doesNotMatch(finance,/for\(let year=2018;year<=/)
  assert.match(app,/async function fetchMonthEntries\(targetMonth\)/)
  assert.match(app,/api\('entries\?month=' \+ targetMonth \+ '&cursor=' \+ cursor\)/)
})

test('stats and calendar do not show old-period data or unfiltered payment amounts',()=>{
  assert.match(app,/loadedMonth = ''/)
  assert.match(app,/stats\.value = null/)
  assert.match(app,/annualStats\.value = null/)
  assert.match(app,/detailFilter\.value\.paymentMethod \? entry\.type === 'expense' && paymentMethodMatches/)
  assert.match(api,/集計月を確認してください/)
})

test('restoring backup data never overwrites existing finance or category settings',()=>{
  assert.match(finance,/async function downloadBackup\(\)/)
  assert.doesNotMatch(finance,/props\.api\('investments'\)/)
  assert.match(finance,/backupPreview\.value/)
  assert.match(finance,/restoreIncludeConflicts/)
  assert.match(finance,/chunkRestoreSettings\(backup,BATCH_SIZE\)/)
  assert.match(finance,/prepaidFinalize:i===finalizationIndex\?prepaidFinal:\[\]/)
  assert.doesNotMatch(finance,/props\.api\('investments\/restore-empty'/)
  assert.doesNotMatch(api,/UPDATE rules SET category = \?1 WHERE keyword = \?2 AND category = \?3/)
})

test('AI OCR remains opt-in and D1 drafts never enter the ledger automatically',()=>{
  assert.match(app,/const aiOcrEnabled = ref\(/)
  assert.match(app,/localStorage\.setItem\(OCR_PREF_KEY, String\(checked === true\)\)/)
  assert.match(app,/if \(!aiOcrEnabled\.value\)/)
  assert.match(app,/const DRAFT_KEY = 'unsaved_draft'/)
  assert.match(app,/api\('app-state\?key='\+DRAFT_KEY,\{method:'DELETE'\}\)/)
  assert.match(app,/receiptImage:null,\s*receiptFileName:''/)
  assert.doesNotMatch(app,/localStorage\.setItem\(DRAFT_KEY/)
  assert.doesNotMatch(api,/INSERT INTO entries.*app_client_state/)
})
