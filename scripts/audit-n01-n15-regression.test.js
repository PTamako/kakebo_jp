import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {resolveRecurringApproval} from '../functions/api/recurring-approval.js'
import {previewRecurringEntries} from '../src/recurring-check.js'
import {validateBackup,backupVersion} from '../src/finance-tools.js'
const text=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const plan={id:'11111111-2222-3333-4444-555555555555',name:'家賃',amount:101500,day:25,category:'居住',
  payment_source:'現金',start_month:'2026-10',enabled:1}
const approved=(amount=101500)=>({month:'2026-10',expected:{name:'家賃',amount,day:25,category:'居住',
  paymentSource:'現金',startMonth:'2026-10',date:'2026-10-25'}})

test('N01: only the exact preview amount may be automatically posted',()=>{
  assert.deepEqual(resolveRecurringApproval(approved(),plan),{date:'2026-10-25'})
  assert.equal(resolveRecurringApproval(approved(102000),plan).status,409)
  assert.equal(resolveRecurringApproval({month:'2026-10'},plan).status,409)
  assert.equal(resolveRecurringApproval({...approved(),expected:{...approved().expected,date:'2026-10-26'}},plan).status,409)
})
test('manual entry for a month overrides the fixed expense regardless of modified amount',()=>{
  const schedule={id:plan.id,name:plan.name,amount:plan.amount,day:plan.day,category:plan.category,
    paymentSource:'現金',startMonth:'2026-10',enabled:true}
  for(const amount of [98000,101500,102000]){
    const saved=[{date:'2026-10-25',merchant:'家賃',amount,payment_source:'現金',type:'expense'}]
    const found=previewRecurringEntries([schedule],saved,{today:new Date(2026,9,29)})
    assert.equal(found.length,1)
    assert.equal(found[0].conflict,true)
  }
  const manuallyEdited=[{date:'2026-10-24',merchant:'別名',amount:98000,payment_source:'現金',type:'expense',
    client_request_id:'recurring_'+plan.id.replace(/-/g,'')+'_202610'}]
  assert.equal(previewRecurringEntries([schedule],manuallyEdited,{today:new Date(2026,9,29)}).length,0)
})
test('N06/N08: historical recurring rows require individual approval and deletion confirmation',()=>{
  const ui=text('src/FinanceTools.vue')
  assert.match(ui,/const recurringSelected = ref\(new Set\(\)\)/)
  assert.match(ui,/preview\.filter\(row=>!row\.conflict && row\.month===current\)/)
  assert.match(ui,/<input type="checkbox" :checked="recurringSelected\.has\(/)
  assert.match(ui,/if \(!confirm\('固定支出「'/)
})
test('N02/N03: restore recognizes verified self writes and export detects concurrent edits',()=>{
  const ui=text('src/FinanceTools.vue')
  assert.match(ui,/unrelatedLedgerFingerprint\(rows\.value\)/)
  assert.match(ui,/restoreOwnKeys\.value = new Map\(\[\.\.\.restoreOwnKeys\.value,\[key,transactionKey\(entry\)\]\]\)/)
  assert.match(ui,/ledgerFingerprint\(rows\.value\)!==before/)
})
test('N07: backup rejects malformed child settings before touching the database',()=>{
  const base={format:'kakeibo-ledger-backup',version:backupVersion,entries:[]}
  for(const extra of [{plans:[{id:plan.id,name:'家賃',amount:-1}]},
    {bills:[{name:'カード',month:'2026-10',total:-1}]},
    {paymentSources:[{name:'現金',closing_day:100}]},
    {customRules:[{keyword:'テスト'}]},
    {merchantPaymentRules:[{keyword:'店',payment_source:42}]},
    {categories:[null]}]){
    assert.throws(()=>validateBackup({...base,...extra}))
  }
  assert.equal(validateBackup({...base,version:1}).version,1)
})
test('N04/N09/N10/N11/logo: safe preview gate, transfer disclosure, no logo border',()=>{
  const api=text('functions/api/[[path]].js')
  const app=text('src/App.vue')+'\n'+text('src/pages/AssetsPage.vue')
  assert.match(api,/env\.PREVIEW_D1_ISOLATED === 'true'/)
  // New UI states the distinction more clearly: bookkeeping application is
  // neither SBI account funding nor completed fund purchase.
  assert.match(app,/期日反映は証券口座への入金・買付完了を保証しません/)
  assert.match(app,/回数上限≠料金上限/)
  assert.match(app,/main\.theme-green \.brand-mark\{[\s\S]*?background:transparent;[\s\S]*?box-shadow:none;/)
})
