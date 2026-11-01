import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const finance = read('src/FinanceTools.vue')
const icons = read('src/ReviewTrashActions.vue')

test('each of five trash row types exposes both restore and delete icons',()=>{
  assert.equal((finance.match(/<ReviewTrashActions /g)||[]).length,5)
  for(const action of [
    '@restore="setDuplicateConfirmation(group, false)"',
    '@restore="restoreDeletedPlan(item)"',
    '@restore="restoreDeletedEntry(item)"',
    '@restore="restoreRecurringExclusion(item)"',
    '@restore="restoreTransferReminder(item)"',
    '@remove="removeReviewedTrashNotice(duplicateTrashKey(duplicateReviewSignature(group)))"',
    '@remove="purgeDeletedPlan(item)"',
    '@remove="purgeDeletedEntry(item)"',
    '@remove="removeReviewedTrashNotice(recurringTrashKey(item))"',
    '@remove="removeReviewedTrashNotice(transferTrashKey(item))"'
  ]) assert.ok(finance.includes(action), 'missing action: '+action)
  assert.match(icons,/defineEmits\(\['restore', 'remove'\]\)/)
  assert.match(icons,/restoreLabel \+ '：' \+ label/)
  assert.match(icons,/removeLabel \+ '：' \+ label/)
  assert.match(icons,/<svg aria-hidden="true"/)
  assert.equal((icons.match(/<svg aria-hidden="true"/g)||[]).length,2)
  assert.match(finance,/remove-label="固定費設定を完全削除"/)
  assert.match(finance,/remove-label="確認済み一覧から削除"/)
  assert.match(finance,/restore-label="その月の記帳候補を再表示"/)
})

test('one-line compact rows truncate text and preserve accessible 44px tap targets',()=>{
  assert.match(finance,/\.review-trash-item\{[^}]*min-height:44px;[^}]*padding:1px 0/)
  assert.match(finance,/\.review-trash-item \.review-trash-text\{[^}]*text-overflow:ellipsis;white-space:nowrap/)
  assert.match(icons,/height:44px;min-height:44px/)
  assert.match(icons,/@media\(max-width:360px\)/)
  assert.match(finance,/class="review-trash-category"/)
})

test('removing ordinary notices persists their archive keys in D1 without editing ledger entries',()=>{
  const body=finance.match(/async function removeReviewedTrashNotice\(key\) \{([\s\S]*?)\n\}/)?.[1]||''
  assert.ok(body)
  assert.match(body,/!reviewStateReady\.value/)
  assert.match(body,/await writeReviewNotices\(\[key\]\)/)
  assert.match(body,/archivedTrashKeys\.value = new Set\(\[\.\.\.archivedTrashKeys\.value,key\]\)/)
  assert.match(body,/catch \(e\)/)
  assert.doesNotMatch(body,/saveArchivedTrash|props\.api|DELETE FROM|UPDATE entries|recurringExclusions\.value\.filter/)
})

test('final purge of one deleted fixed expense requires explicit confirmation and never deletes ledger rows',()=>{
  const body=finance.match(/async function purgeDeletedPlan\(item\) \{([\s\S]*?)\n\}/)?.[1]||''
  assert.ok(body)
  assert.match(body,/if \(!confirm\(/)
  assert.match(body,/\/purge'/)
  assert.match(body,/x-confirm-purge/)
  assert.match(body,/trashedRecurringPlans\.value = trashedRecurringPlans\.value\.filter/)
  assert.match(body,/recurringExclusions\.value = recurringExclusions\.value\.filter/)
  assert.doesNotMatch(body,/api\('entries|investment|DELETE FROM entries/)
})

test('bulk purge also refreshes fixed-expense exclusion display after deleting archived plans',()=>{
  const body=finance.match(/async function emptyReviewTrash\(\) \{([\s\S]*?)\n\}/)?.[1]||''
  assert.ok(body)
  assert.match(body,/recurringExclusions\.value = recurringExclusions\.value\.filter\(row => row\.planId !== item\.id\)/)
  assert.match(body,/await writeReviewNotices\(keys\)/)
  assert.match(body,/if \(!confirm\(warning\)\) return/)
})
