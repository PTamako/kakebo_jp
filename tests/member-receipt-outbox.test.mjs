import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {memberReceiptOutboxKey,stageMemberReceiptOutbox,bindMemberReceiptOutbox,
 readMemberReceiptOutbox,removeMemberReceiptOutbox} from '../src/member-receipt-outbox.js'

if(!globalThis.crypto)globalThis.crypto=webcrypto

// Minimal IndexedDB transaction simulator: resolve calls at transaction
// completion, not at request success, just as the real browser must.
function fakeIndexedDB(){
 const stores=new Map()
 const names={contains:name=>stores.has(name)}
 const db={
  objectStoreNames:names,
  createObjectStore:name=>{stores.set(name,new Map())},
  close(){},
  transaction(name){
   const data=stores.get(name)
   const tx={
    objectStore(){return {
     get:key=>request(()=>data.get(key),tx),
     put:(value,key)=>request(()=>{data.set(key,value);return key},tx),
     delete:key=>request(()=>data.delete(key),tx),
     getAll:range=>request(()=>[...data.entries()]
      .filter(([key])=>key>=range.lower&&key<=range.upper)
      .map(([,value])=>value),tx)
    }}
   }
   return tx
  }
 }
 const request=(operation,tx)=>{
  const req={}
  queueMicrotask(()=>{
   try{req.result=operation();req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.())}
   catch(e){req.error=e;req.onerror?.();tx.onerror?.()}
  })
  return req
 }
 return {
  open(){
   const req={}
   queueMicrotask(()=>{
    req.result=db
    req.onupgradeneeded?.()
    queueMicrotask(()=>req.onsuccess?.())
   })
   return req
  }
 }
}
const originalIdb=globalThis.indexedDB,originalRange=globalThis.IDBKeyRange
globalThis.indexedDB=fakeIndexedDB()
globalThis.IDBKeyRange={bound:(lower,upper)=>({lower,upper})}

const first={userId:'user-a',householdId:'home-a',
 key:'receipt:12345678-1234-4234-8234-123456789abc'}
const other={userId:'user-b',householdId:'home-a'}
const blob=new Blob([new Uint8Array([12,22,32])],{type:'image/jpeg'})
test('owner-scoped outbox stores and restores the exact image Blob',async()=>{
 await stageMemberReceiptOutbox({...first,blob,date:'2026-11-20',merchant:'store'})
 const rows=await readMemberReceiptOutbox(first.userId,first.householdId)
 assert.equal(rows.length,1)
 assert.deepEqual(new Uint8Array(await rows[0].blob.arrayBuffer()),new Uint8Array([12,22,32]))
 assert.equal((await readMemberReceiptOutbox(other.userId,other.householdId)).length,0)
 await bindMemberReceiptOutbox({...first,receiptRef:'proposal:'+'a'.repeat(32)})
 assert.equal((await readMemberReceiptOutbox(first.userId,first.householdId))[0].receiptRef,'proposal:'+'a'.repeat(32))
 await removeMemberReceiptOutbox(first.userId,first.householdId,first.key)
 assert.equal((await readMemberReceiptOutbox(first.userId,first.householdId)).length,0)
})
test('outbox refuses changed image under same replay key and mismatched receipt reference',async()=>{
 await stageMemberReceiptOutbox({...first,blob,date:'2026-11-20',merchant:'store'})
 await assert.rejects(()=>stageMemberReceiptOutbox({...first,
  blob:new Blob(['different'],{type:'image/jpeg'}),date:'2026-11-20'}),/異なります/)
 await bindMemberReceiptOutbox({...first,receiptRef:'proposal:'+'a'.repeat(32)})
 await assert.rejects(()=>bindMemberReceiptOutbox({...first,receiptRef:'proposal:'+'b'.repeat(32)}),/別の記帳先/)
 await removeMemberReceiptOutbox(first.userId,first.householdId,first.key)
})
test('invalid owner and replay keys fail before any storage access',()=>{
 assert.throws(()=>memberReceiptOutboxKey('../other','home-a',first.key),/本人確認/)
 assert.throws(()=>memberReceiptOutboxKey('user-a','home-a','no-key'),/本人確認/)
})
test('shared form stays shared, posting records receipt ack before upload, and editing stages image',()=>{
 const app=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 const draft=readFileSync(new URL('../src/member-draft-safety.js',import.meta.url),'utf8')
 assert.match(app,/OriginalKakeiboPages/)
 assert.match(app,/if\(record.type==='expense'&&record.receiptImage\)await stageMemberReceipt\(record\)/)
 assert.match(app,/record.receiptSubmitRef=receiptRef[\s\S]*?await persistMemberDraft\(\)[\s\S]*?await bindMemberReceipt/)
 assert.match(app,/await removeMemberReceiptOutbox/)
 assert.match(app,/readMemberReceiptOutbox\(user,household\)/)
 assert.match(app,/if\(edited.receiptImage\)await stageMemberReceipt\(edited\)/)
 assert.match(draft,/const \{receiptImage,receiptFileName,showReceiptAttachment,/)
})
test.after(()=>{
 globalThis.indexedDB=originalIdb
 globalThis.IDBKeyRange=originalRange
})
