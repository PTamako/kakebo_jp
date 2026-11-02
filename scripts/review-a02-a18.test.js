import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { previewRecurringEntries, postApprovedRecurringEntries } from '../src/recurring-check.js'
import { backupVersion, validateBackup, nextScheduledDate } from '../src/finance-tools.js'
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const sample = {id:'11111111-2222-3333-4444-555555555555',name:'家賃',amount:102000,day:25,
  category:'居住',paymentSource:'現金',startMonth:'2025-01',enabled:true}
const today = new Date(2026,9,29)

test('A02: current-month preview is read-only, historical 120-month backfill needs opt-in', () => {
  const now=previewRecurringEntries([sample],[],{today})
  assert.deepEqual(now.map(x=>x.date),['2026-10-25'])
  const old=previewRecurringEntries([sample],[],{today,historicalMonths:3})
  assert.deepEqual(old.map(x=>x.date),['2026-07-25','2026-08-25','2026-09-25','2026-10-25'])
  const api=read('src/App.vue')
  assert.doesNotMatch(api,/checkRecurringEntries\(api,/)
  assert.match(read('src/FinanceTools.vue'),/if\(!confirm\(summary\)\)return/)
})

test('A03/A06: existing manually entered or previously automated charge is never auto duplicated', () => {
  const rows=[{date:'2026-10-25',merchant:'家賃',amount:102000,payment_source:'現金',type:'expense',client_request_id:'recurring_oldid_202610'}]
  assert.equal(previewRecurringEntries([sample],rows,{today})[0].conflict,true)
  assert.equal(previewRecurringEntries([sample],[],{today})[0].conflict,false)
  assert.equal(previewRecurringEntries([{...sample,enabled:false}],[],{today}).length,0)
  assert.match(read('functions/api/[[path]].js'),/UPDATE recurring_plans SET name=\?1,amount=\?2/)
})

test('A02: only specifically approved rows are written to D1', async () => {
  const calls=[]
  const approved=[{planId:sample.id,month:'2026-10'}]
  const result=await postApprovedRecurringEntries(async(path,opt)=>{calls.push({path,...opt});return {created:true} },approved)
  assert.equal(result.created,1)
  assert.equal(calls.length,1)
  assert.equal(calls[0].path,'recurring-post')
})

test('A17: next scheduled date honors a future start and the stopped state',()=>{
  assert.equal(nextScheduledDate(31,new Date(2026,9,29),'2026-12',true),'2026-12-31')
  assert.equal(nextScheduledDate(25,new Date(2026,9,29),'2026-10',false),'停止中')
})

test('A04/A07/A08: v4 SBI archive still accepts v1-v3 backups and guards restore',()=>{
  const data={format:'kakeibo-ledger-backup',version:backupVersion,entries:[],dismissedTransfers:[1,4]}
  assert.equal(backupVersion,4)
  assert.equal(validateBackup(data),data)
  assert.equal(validateBackup({...data,version:3}).version,3)
  assert.equal(validateBackup({...data,version:2}).version,2)
  assert.throws(()=>validateBackup({...data,dismissedTransfers:[-3]}))
  const ui=read('src/FinanceTools.vue')
  assert.match(ui,/api\('entries\?year='\+year\+'&cursor='\+cursor\)/)
  assert.match(ui,/backupLedgerFingerprint\.value!==unrelatedLedgerFingerprint\(rows\.value\)/)
  assert.match(ui,/props\.api\('dismissed-transfer-reminders'\)/)
  assert.match(read('functions/api/[[path]].js'),/SELECT \* FROM entries WHERE date LIKE \?1 AND id > \?2 ORDER BY id ASC LIMIT 500/)
})

test('A05/A09/A10/A11/A12: filters, privacy, quota, local imagery and due transfers',()=>{
  const app=read('src/App.vue')+'\n'+read('src/pages/AssetsPage.vue')
  const api=read('functions/api/[[path]].js')
  assert.match(app,/detailFilter\.value\.paymentMethod \|\| ''/)
  assert.match(app,/setRememberDevice\(/)
  assert.match(app,/function clearLocalDraft\(/)
  assert.match(read('functions/api/ai-quota.js'),/ai_ocr_daily_usage/)
  assert.match(app,/本日のAI残り回数：\{\{aiQuota\.remaining\}\}\/\{\{aiQuota\.limit\}\}回/)
  assert.doesNotMatch(app,/cdn2\.cdnstep\.com/)
  assert.doesNotMatch(app,/api\('transfers\/process-due',\{method:'POST'\}\)/)
  assert.match(read('workers/fund-nav-cron.js'),/applyDueSbiTransfers\(env\.DB, today\)/)
  assert.match(api,/if \(a === 'transfers' && b === 'process-due' && m === 'POST'\)/)
})
