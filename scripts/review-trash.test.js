import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { duplicateTrashKey, recurringTrashKey, transferTrashKey, readArchivedTrash, saveArchivedTrash, visibleReviewedTrash } from '../src/review-trash.js'
import { duplicateReviewSignature } from '../src/duplicate-review.js'

const src = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const finance = src('src/FinanceTools.vue')
const api = src('functions/api/[[path]].js')
const app = src('src/App.vue')
const row = (id=1) => ({id,date:'2026-10-30',time:'19:20',type:'expense',merchant:'Suicaチャージ',amount:1000,payment_source:'楽天カード'})
const store = () => {
  const m = new Map()
  return {getItem:key=>m.get(key) ?? null,setItem:(key,value)=>m.set(key,value),snapshot:()=>[...m.values()]}
}

test('trash shows three categories, previous sections do not show confirmed or excluded rows',()=>{
  assert.ok(finance.includes('<summary>ゴミ箱'))
  assert.ok(finance.includes('<summary>重複確認 <span>'))
  assert.ok(finance.includes('<summary>固定費 <span>'))
  assert.ok(finance.includes('<summary>振替の確認 <span>'))
  assert.ok(!finance.includes('<summary>除外済み'))
  assert.ok(!finance.includes('<summary>確認済み'))
  assert.ok(finance.includes('setDuplicateConfirmation(group, true)'))
  assert.ok(finance.includes('@restore="restoreRecurringExclusion(item)"'))
  assert.ok(finance.includes('@restore="restoreTransferReminder(item)"'))
  assert.ok(finance.includes('emptyReviewTrash'))
  assert.ok(finance.includes('onReviewTrashToggle'))
})

test('trash archiving is per exact group, plan-month and transfer ID',()=>{
  const duplicates = [[row(1),row(2)]]
  const excluded = [{planId:'fixed-uuid_1',month:'2026-09',name:'家賃'}]
  const transfers = [{id:300,amount:15000,transfer_applied:1}]
  const archived = new Set()
  const signature = duplicateReviewSignature
  const all = visibleReviewedTrash(duplicates,excluded,transfers,archived,signature)
  assert.deepEqual(all.duplicateGroups,duplicates)
  assert.deepEqual(all.recurringExclusions,excluded)
  assert.deepEqual(all.transferReminders,transfers)
  const selected = [duplicateTrashKey(signature(duplicates[0])),recurringTrashKey(excluded[0]),transferTrashKey(transfers[0])]
  assert.equal(selected.length,3)
  assert.ok(selected.every(Boolean))
  const saved=store()
  assert.equal(saveArchivedTrash(new Set(selected),saved),true)
  const hidden=visibleReviewedTrash(duplicates,excluded,transfers,readArchivedTrash(saved),signature)
  assert.deepEqual(hidden,{duplicateGroups:[],recurringExclusions:[],transferReminders:[]})
  // Neither active exclusions nor transfer status was removed from D1.
  assert.equal(excluded.length,1)
  assert.equal(transfers[0].transfer_applied,1)
})

test('clear archives reviewed notifications but explicitly purges previously deleted fixed-expense settings',()=>{
  const body=finance.match(/async function emptyReviewTrash\(\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body)
  assert.ok(body.includes('saveArchivedTrash(next)'))
  assert.ok(body.includes('new Set(archivedTrashKeys.value)'))
  assert.ok(body.includes('duplicateTrashKey('))
  assert.ok(body.includes('recurringTrashKey('))
  assert.ok(body.includes('transferTrashKey('))
  assert.ok(body.includes("api('recurring-plans/'"))
  assert.ok(body.includes("method:'DELETE'"))
  assert.ok(finance.includes('削除済み固定費は完全削除'))
})

test('transfer reminder GET details and DELETE restoration use only dismissed-reminder table',()=>{
  const handler=api.match(/if \(a === 'dismissed-transfer-reminders'\) \{([\s\S]*?)\n    \}\n    if \(a === 'transfers'/)?.[1]
  assert.ok(handler)
  assert.ok(handler.includes("url.searchParams.get('details') === '1'"))
  assert.ok(handler.includes("JOIN entries e ON e.id = d.entry_id"))
  assert.ok(handler.includes("WHERE e.type='transfer' AND e.transfer_target='sbi'"))
  assert.ok(handler.includes("if(m==='DELETE')"))
  assert.ok(handler.includes("DELETE FROM dismissed_transfer_reminders WHERE entry_id=?1"))
  assert.ok(!handler.includes('DELETE FROM entries'))
  assert.ok(!handler.includes('UPDATE entries'))
  assert.ok(api.includes('SELECT entry_id FROM dismissed_transfer_reminders ORDER BY entry_id'))
  assert.ok(app.includes("api('transfers/' + item.id + '/dismiss'"))
})

test('transfer restore refreshes source list without mutating the investment',()=>{
  const body=finance.match(/async function restoreTransferReminder\(item\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body)
  assert.ok(body.includes("api('dismissed-transfer-reminders', {method:'DELETE'"))
  assert.ok(body.includes('appContext.loadTransfers()'))
  assert.ok(body.includes('saveArchivedTrash(next)'))
  assert.ok(!body.includes("api('entries/"))
  assert.ok(!body.includes('transfer_applied ='))
  assert.ok(finance.includes("api('dismissed-transfer-reminders?details=1')"))
})

test('recurring exclusion and duplicate confirmation remain active after trash is emptied',()=>{
  const archived = new Set([recurringTrashKey({planId:'plan_123',month:'2026-10'}),transferTrashKey({id:14})])
  const storeInstance=store()
  assert.equal(saveArchivedTrash(archived,storeInstance),true)
  const excluded=[{planId:'plan_123',month:'2026-10'}]
  const transfers=[{id:14,transfer_applied:1}]
  const hidden=visibleReviewedTrash([],excluded,transfers,readArchivedTrash(storeInstance),duplicateReviewSignature)
  assert.deepEqual(hidden.recurringExclusions,[])
  assert.deepEqual(hidden.transferReminders,[])
  assert.ok(finance.includes('recurringExclusions.value='))
  assert.ok(api.includes("SELECT 1 FROM recurring_candidate_exclusions WHERE plan_id=?1 AND month=?2"))
  assert.ok(api.includes("NOT EXISTS (SELECT 1 FROM dismissed_transfer_reminders d WHERE d.entry_id = entries.id)"))
})

test('invalid trash keys and storage errors fail without deleting anything',()=>{
  const invalid = new Set(['t:01','t:abc','r:notvalid','d:v1:zzzzzzzzzzzzzzzz'])
  assert.equal(saveArchivedTrash(invalid,store()),false)
  assert.equal(saveArchivedTrash(new Set(['t:1']),null),false)
  assert.equal(saveArchivedTrash(new Set(['t:1']),{setItem(){throw Error('quota')}}),false)
  const good=store()
  assert.equal(saveArchivedTrash(new Set(['t:1']),good),true)
  assert.deepEqual([...readArchivedTrash(good)],['t:1'])
})

test('category detail groups collapse independently, with archive and excluded months sharing fixed-expense group',()=>{
  assert.match(finance,/<details v-if="reviewTrash\.duplicateGroups\.length" class="review-trash-category">/)
  assert.match(finance,/<details v-if="reviewTrash\.recurringExclusions\.length \|\| trashedRecurringPlans\.length" class="review-trash-category">/)
  assert.match(finance,/<details v-if="reviewTrash\.transferReminders\.length" class="review-trash-category">/)
  assert.match(finance,/class="review-trash-subheading">削除済み/)
  assert.match(finance,/class="review-trash-subheading">除外した候補/)
  assert.match(finance,/@restore="restoreDeletedPlan\(item\)"/)
  assert.match(finance,/@restore="restoreRecurringExclusion\(item\)"/)
})
