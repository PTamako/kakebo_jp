import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  findLedgerDuplicateGroups,
  duplicateReviewSignature,
  readConfirmedDuplicateGroups,
  saveConfirmedDuplicateGroups
} from '../src/duplicate-review.js'

const row = (id, changes = {}) => ({
  id, date:'2026-10-30', time:'19:20', type:'expense',
  merchant:'Suicaチャージ', amount:1000, payment_source:'楽天カード',
  ...changes
})
const storage = () => {
  const data = new Map()
  return {
    getItem:key=>data.get(key) ?? null,
    setItem:(key,value)=>data.set(key,String(value)),
    snapshot:()=>[...data.values()].join('')
  }
}

test('confirmed separate purchases disappear from duplicate suggestions and survive restart', () => {
  const group = findLedgerDuplicateGroups([row(1),row(2,{time:'19:22'})])[0]
  assert.equal(group.length,2)
  const key = duplicateReviewSignature(group)
  const store = storage()
  const confirmed = readConfirmedDuplicateGroups(store)
  assert.equal(confirmed.has(key),false)
  confirmed.add(key)
  assert.equal(saveConfirmedDuplicateGroups(confirmed,store),true)
  const restored = readConfirmedDuplicateGroups(store)
  assert.equal(restored.has(key),true)
  assert.equal(findLedgerDuplicateGroups([row(1),row(2)]).filter(g=>!restored.has(duplicateReviewSignature(g))).length,0)
  // The original ledger entries have never been touched.
  assert.deepEqual(group.map(r=>r.id),[1,2])
})

test('review is tied to exact IDs, relevant fields and entire group', () => {
  const group = [row(1),row(2,{time:'19:22'})]
  const key = duplicateReviewSignature(group)
  assert.match(key,/^v1:[0-9a-f]{16}$/)
  assert.equal(key, duplicateReviewSignature([...group].reverse()))
  assert.notEqual(key,duplicateReviewSignature([row(1),row(3,{time:'19:22'})]))
  assert.notEqual(key,duplicateReviewSignature([...group,row(3,{time:'19:21'})]))
  assert.notEqual(key,duplicateReviewSignature([group[0],{...group[1],merchant:'別の店'}]))
  assert.notEqual(key,duplicateReviewSignature([group[0],{...group[1],date:'2026-10-31'}]))
  assert.notEqual(key,duplicateReviewSignature([group[0],{...group[1],time:'19:24'}]))
  assert.notEqual(key,duplicateReviewSignature([group[0],{...group[1],amount:1100}]))
  assert.notEqual(key,duplicateReviewSignature([group[0],{...group[1],payment_source:'PayPayカード'}]))
  assert.equal(duplicateReviewSignature([{...group[0],id:null},group[1]]),'')
})

test('another purchase at a different time is reviewed separately, even with the same store and amount', () => {
  const groups = findLedgerDuplicateGroups([row(1),row(2,{time:'19:22'}),row(3,{time:'21:30'}),row(4,{time:'21:33'})])
  assert.equal(groups.length,2)
  const store = storage()
  const keys = new Set([duplicateReviewSignature(groups[0])])
  assert.equal(saveConfirmedDuplicateGroups(keys,store),true)
  assert.equal(groups.filter(g=>!readConfirmedDuplicateGroups(store).has(duplicateReviewSignature(g))).length,1)
})

test('undo brings a confirmed duplicate group back without changing D1', () => {
  const store = storage()
  const key = duplicateReviewSignature([row(1),row(2)])
  const keys = new Set([key])
  assert.equal(saveConfirmedDuplicateGroups(keys,store),true)
  keys.delete(key)
  assert.equal(saveConfirmedDuplicateGroups(keys,store),true)
  assert.equal(readConfirmedDuplicateGroups(store).has(key),false)
})

test('no merchant, card, amount or other transaction data is stored on the device', () => {
  const store = storage()
  const key = duplicateReviewSignature([row(1),row(2)])
  saveConfirmedDuplicateGroups(new Set([key]),store)
  assert.match(store.snapshot(),/^\\["v1:[0-9a-f]{16}"\\]$/)
  assert.doesNotMatch(store.snapshot(),/Suica|楽天|1000|2026-10-30/)
})

test('bad, absent or write-protected storage safely fails without confirming', () => {
  const invalid = { getItem:() => '{not JSON}', setItem:()=>{} }
  assert.deepEqual([...readConfirmedDuplicateGroups(invalid)],[])
  assert.deepEqual([...readConfirmedDuplicateGroups(null)],[])
  assert.equal(saveConfirmedDuplicateGroups(new Set(['v1:0000000000000000']),null),false)
  assert.equal(saveConfirmedDuplicateGroups(new Set(['v1:0000000000000000']),{setItem:()=>{throw Error('quota')}}),false)
  const malformed = {getItem:()=>JSON.stringify(['bad','v1:0000000000000000','v1:xxxxxxxxxxxxxxxx'])}
  assert.deepEqual([...readConfirmedDuplicateGroups(malformed)],['v1:0000000000000000'])
})

test('review screen has explicit dismiss and undo, keeping the original transaction links', () => {
  const src = readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  assert.match(src,/const duplicates=computed\\(\\(\\) => findLedgerDuplicateGroups\\(rows\\.value\\)\\)/)
  assert.match(src,/const pendingDuplicates = computed\\(\\(\\) => duplicates\\.value\\.filter/)
  assert.match(src,/const confirmedDuplicates = computed\\(\\(\\) => duplicates\\.value\\.filter/)
  assert.match(src,/if \\(!saveConfirmedDuplicateGroups\\(next\\)\\)/)
  assert.match(src,/confirmedDuplicateKeys\\.value = next/)
  assert.match(src,/@click="emit\\('open-duplicate', group\\[0\\]\\.date\\)"/)
  assert.match(src,/@click="setDuplicateConfirmation\\(group, true\\)">重複ではない/)
  assert.match(src,/@click="setDuplicateConfirmation\\(group, false\\)">再確認/)
  assert.match(src,/確認済み（\\{\\{confirmedDuplicates\\.length\\}\\}件）/)
  assert.match(src,/@toggle="refreshDuplicateReview"/)
  assert.doesNotMatch(src.match(/function setDuplicateConfirmation\\(group, isConfirmed\\) \\{[\\s\\S]*?\\n\\}/)?.[0] || '',/props\\.api|DELETE FROM|UPDATE entries/)
})

test('confirmation action modifies only the saved confirmation set on success', () => {
  const src = readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  const body = src.match(/function setDuplicateConfirmation\\(group, isConfirmed\\) \\{([\\s\\S]*?)\\n\\}/)?.[1]
  assert.ok(body)
  const one = row(1), two = row(2)
  const group = [one,two]
  const before = JSON.stringify(group)
  const confirmedDuplicateKeys = {value:new Set()}
  const duplicateReviewMessage = {value:''}
  const store=storage()
  const action = new Function('group','isConfirmed','confirmedDuplicateKeys','duplicateReviewMessage','duplicateReviewSignature','saveConfirmedDuplicateGroups',body)
  const execute = (confirmed,persist) => action(group,confirmed,confirmedDuplicateKeys,duplicateReviewMessage,duplicateReviewSignature,persist)
  execute(true,keys=>saveConfirmedDuplicateGroups(keys,store))
  const key=duplicateReviewSignature(group)
  assert.equal(confirmedDuplicateKeys.value.has(key),true)
  assert.equal(readConfirmedDuplicateGroups(store).has(key),true)
  execute(false,keys=>saveConfirmedDuplicateGroups(keys,store))
  assert.equal(confirmedDuplicateKeys.value.has(key),false)
  execute(true,()=>false)
  assert.equal(confirmedDuplicateKeys.value.has(key),false)
  assert.match(duplicateReviewMessage.value,/保存できません/)
  assert.equal(JSON.stringify(group),before)
})
