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
  assert.equal(findLedgerDuplicateGroups([row(1),row(2,{time:'19:22'})]).filter(g=>!restored.has(duplicateReviewSignature(g))).length,0)
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
  assert.match(store.snapshot(),/^\["v1:[0-9a-f]{16}"\]$/)
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

test('review screen persists D1 confirmations and preserves original transaction links',()=>{
  const src = readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  assert.match(src,/const duplicates=computed\(\(\) => findLedgerDuplicateGroups\(rows\.value\)\)/)
  assert.match(src,/const pendingDuplicates = computed\(\(\) => reviewStateReady\.value \? duplicates\.value\.filter/)
  assert.match(src,/const confirmedDuplicates = computed\(\(\) => reviewStateReady\.value \? duplicates\.value\.filter/)
  assert.match(src,/await writeReviewNotices\(isConfirmed \? \['c:'\+key\] : \[\]/)
  assert.match(src,/confirmedDuplicateKeys\.value = next/)
  assert.match(src,/@click="emit\('open-duplicate', group\[0\]\.date\)"/)
  assert.match(src,/@click="setDuplicateConfirmation\(group, true\)">重複ではない/)
  assert.match(src,/@restore="setDuplicateConfirmation\(group, false\)"/)
  assert.match(src,/<summary>ゴミ箱/)
  assert.match(src,/@toggle="refreshDuplicateReview"/)
  assert.doesNotMatch(src.match(/async function setDuplicateConfirmation\(group, isConfirmed\) \{[\s\S]*?\n\}/)?.[0] || '',/saveConfirmedDuplicateGroups|DELETE FROM entries|UPDATE entries/)
})

test('D1 success and failure keep duplicate decisions correct without mutating ledger', async()=>{
  const src = readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  const body = src.match(/async function setDuplicateConfirmation\(group, isConfirmed\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(body)
  const group = [row(1),row(2)]
  const original = JSON.stringify(group)
  const key=duplicateReviewSignature(group)
  const confirmedDuplicateKeys={value:new Set()}
  const archivedTrashKeys={value:new Set(['d:'+key])}
  const reviewStateReady={value:true}
  const reviewStateBusy={value:false}
  const reviewStateError={value:''}
  const duplicateReviewMessage={value:''}
  const remote=new Set()
  let rejectWrites=false
  const calls=[]
  const writeReviewNotices=async(add,remove=[])=>{
    calls.push({add,remove})
    if(rejectWrites)throw Error('D1 unavailable')
    for(const k of remove)remote.delete(k)
    for(const k of add)remote.add(k)
  }
  const duplicateTrashKey=key=>'d:'+key
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor
  const action=new AsyncFunction('group','isConfirmed','confirmedDuplicateKeys','archivedTrashKeys',
    'reviewStateReady','reviewStateBusy','reviewStateError','duplicateReviewMessage',
    'duplicateReviewSignature','duplicateTrashKey','writeReviewNotices',body)
  const execute=confirmed=>action(group,confirmed,confirmedDuplicateKeys,archivedTrashKeys,
    reviewStateReady,reviewStateBusy,reviewStateError,duplicateReviewMessage,
    duplicateReviewSignature,duplicateTrashKey,writeReviewNotices)
  await execute(true)
  assert.equal(confirmedDuplicateKeys.value.has(key),true)
  assert.equal(remote.has('c:'+key),true)
  assert.equal(archivedTrashKeys.value.has('d:'+key),false)
  assert.deepEqual(calls[0],{add:['c:'+key],remove:['d:'+key]})
  await execute(false)
  assert.equal(confirmedDuplicateKeys.value.has(key),false)
  assert.equal(remote.has('c:'+key),false)
  assert.deepEqual(calls[1],{add:[],remove:['c:'+key,'d:'+key]})
  rejectWrites=true
  await execute(true)
  assert.equal(confirmedDuplicateKeys.value.has(key),false)
  assert.equal(remote.has('c:'+key),false)
  assert.match(duplicateReviewMessage.value,/保存に失敗しました/)
  assert.equal(reviewStateBusy.value,false)
  assert.equal(JSON.stringify(group),original)
})
