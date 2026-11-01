import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8')
const sbi=read('src/SbiPortfolio.vue')
const finance=read('src/FinanceTools.vue')
const api=read('functions/api/[[path]].js')
const restore=read('functions/api/restore-atomic.js')
const backup=read('src/finance-tools.js')
const schema=read('schema.sql')
const migration=read('migrations/0012_unified_trash_items.sql')

test('SBI month fields fit within the iPhone dialog including the native date text',()=>{
  assert.match(sbi,/<label>適用開始月<input v-model="plan.effectiveMonth" type="month" required/)
  assert.match(sbi,/\.sbi-dialog\{min-width:0;max-width:min\(100vw,520px\);overflow-x:hidden\}/)
  assert.match(sbi,/\.sbi-dialog>label\{[^}]*min-width:0;max-width:100%;width:100%;[^}]*overflow:hidden\}/)
  assert.match(sbi,/\.sbi-dialog label input\[type=month\]\{[^}]*-webkit-appearance:none;appearance:none;[^}]*min-width:0!important;max-width:100%!important/)
  assert.match(sbi,/\.sbi-dialog label input\[type=month\]::-webkit-date-and-time-value\{[^}]*min-width:0/)
})

test('recurring plan trash is additive and never drops or updates financial records in migration',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS trash_items/)
  assert.match(migration,/INSERT OR IGNORE INTO trash_items/)
  assert.match(schema,/CREATE TABLE IF NOT EXISTS trash_items/)
  assert.doesNotMatch(migration,/\b(?:DROP|DELETE|UPDATE|ALTER)\s+(?:TABLE|FROM|entries|recurring_plans)/i)
  assert.doesNotMatch(migration,/INSERT INTO recurring_plans|INSERT INTO entries/)
})

test('archiving is non-destructive and does not remove recurring-plan exclusions',()=>{
  const section=api.match(/if \(a === 'recurring-plans'\) \{([\s\S]*?)\n      \} else \{/)?.[1]||''
  assert.ok(section)
  assert.match(section,/INSERT OR IGNORE INTO trash_items\(item_type,item_id\) VALUES\('recurring_plan',\?1\)/)
  assert.match(section,/params\.path\?\.\[2\] === 'restore'/)
  assert.match(section,/DELETE FROM trash_items WHERE item_type='recurring_plan' AND item_id=\?1/)
  assert.match(section,/params\.path\?\.\[2\] === 'purge'/)
  assert.match(section,/request\.headers\.get\('x-confirm-purge'\) !== b/)
  assert.match(section,/DELETE FROM recurring_plans WHERE id=\?1 AND EXISTS/)
  assert.doesNotMatch(section,/DELETE FROM entries/)
  assert.match(section,/WHERE NOT EXISTS \(SELECT 1 FROM trash_items/)
})

test('before 0012 migration, ordinary recurring-plan list and approval remain usable',()=>{
  assert.match(api,/no such table: trash_items/i)
  assert.match(api,/SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans ORDER BY name,id/)
  assert.match(api,/plan = await db\.prepare\('SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans WHERE id=\?1'\)/)
  assert.match(api,/SELECT id,name,amount,day,category,payment_source,start_month,enabled[\s\S]*NOT EXISTS \(SELECT 1 FROM trash_items t/)
})

test('archived plan is not shown in active fixed-expense list and its original enabled flag survives restore',()=>{
  assert.match(finance,/const trashedRecurringPlans = ref\(\[\]\)/)
  assert.match(finance,/props\.api\('recurring-plans\?trash=1'\)/)
  assert.match(finance,/props\.api\('recurring-plans\/' \+ encodeURIComponent\(item\.id\) \+ '\/restore', \{method:'POST'\}\)/)
  assert.match(finance,/const result = await props\.api\('recurring-plans\/'\+encodeURIComponent\(id\),\{method:'DELETE'\}\)/)
  assert.match(finance,/plans\.value = plans\.value\.filter\(x=>x\.id!==id\)/)
  assert.match(finance,/trashedRecurringPlans\.value = \[target,/)
  assert.doesNotMatch(finance.match(/async function removePlan\(id\) \{[\s\S]*?\n\}/)?.[0]||'',/recurringExclusions\.value=recurringExclusions\.value\.filter/)
})

test('four trash categories collapse and separate deleted recurring settings from month exclusions',()=>{
  const panel=finance.match(/<details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure review-trash-panel"[\s\S]*?<\/details>\n<\/section>/)?.[0]||''
  assert.ok(panel)
  assert.equal((panel.match(/class="review-trash-category"/g)||[]).length,5)
  assert.match(panel,/<summary>重複確認/)
  assert.match(panel,/<summary>削除した明細/)
  assert.match(panel,/<summary>削除した固定費/)
  assert.match(panel,/<summary>固定費の月別除外/)
  assert.match(panel,/<summary>振替の確認/)
  assert.match(panel,/固定費の登録を削除した項目です/)
  assert.match(panel,/指定した月だけ記帳候補から除外した項目です/)
  assert.match(panel,/@restore="restoreDeletedPlan\(item\)"/)
  assert.match(panel,/@restore="restoreRecurringExclusion\(item\)"/)
  assert.match(panel,/@restore="restoreTransferReminder\(item\)"/)
})

test('emptying trash requires confirmation and preserves ledger and SBI data while purging only deleted plans',()=>{
  const handler=finance.match(/async function emptyReviewTrash\(\) \{([\s\S]*?)\n\}/)?.[1]||''
  assert.ok(handler)
  assert.match(handler,/if \(!confirm\(warning\)\) return/)
  assert.match(handler,/trashedRecurringPlans\.value/)
  assert.match(handler,/\/purge'/)
  assert.match(handler,/x-confirm-purge/)
  assert.match(handler,/await writeReviewNotices\(keys\)/)
  assert.match(handler,/archivedTrashKeys\.value = new Set\(\[\.\.\.archivedTrashKeys\.value,\.\.\.keys\]\)/)
  assert.doesNotMatch(handler,/saveArchivedTrash|DELETE FROM entries|UPDATE entries/)
  assert.doesNotMatch(handler,/api\('entries|investment|UPDATE entries|DELETE FROM entries/)
  assert.match(finance,/!transferTrashLoaded\.value \|\| !deletedPlanLoaded\.value/)
})

test('new backup and staged restore preserve archived plans without overwriting existing destination plans',()=>{
  assert.match(api,/archivedPlans:recurringArchiveReady/)
  assert.match(finance,/archivedPlans:archivedPlansBackup\.map/)
  assert.match(backup,/['"]archivedPlans['"]/)
  assert.match(restore,/for\(const plan of archive\.archivedPlans\|\|\[\]\)/)
  assert.match(restore,/incomingActivePlanIds\.has\(plan\.id\)/)
  assert.match(restore,/await db\.prepare\('SELECT 1 FROM recurring_plans WHERE id=\?1'\)\.bind\(plan\.id\)\.first\(\)/)
  assert.match(restore,/INSERT OR IGNORE INTO trash_items\(item_type,item_id\) SELECT 'recurring_plan',\?1/)
})
