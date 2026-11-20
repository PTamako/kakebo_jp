import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {readMemberDeviceState,writeMemberDeviceState,clearMemberDeviceState,
 memberDraftStorageKey,readDeviceDraft} from '../src/draft-store.js'
import {memberDraftSnapshot,verifiedMemberDraft} from '../src/member-draft-safety.js'

function fakeIndexedDb(){
 const disk=new Map()
 return {
  disk,
  open(){
   const req={}
   queueMicrotask(()=>{
    req.result={
     close(){},
     objectStoreNames:{contains:()=>true},
     transaction(){
      const tx={}
      tx.objectStore=()=>({
       get(key){return complete(key,'get')},
       put(value,key){return complete(key,'put',value)},
       delete(key){return complete(key,'delete')}
      })
      function complete(key,op,value){
       const request={}
       queueMicrotask(()=>{
        if(op==='put')disk.set(key,structuredClone(value))
        else if(op==='delete')disk.delete(key)
        request.result=op==='get'?disk.get(key):key
        request.onsuccess?.()
        queueMicrotask(()=>tx.oncomplete?.())
       })
       return request
      }
      return tx
     }
    }
    req.onsuccess?.()
   })
   return req
  }
 }
}

test('member draft storage cannot mix owner, spouse or other households',async()=>{
 const before=globalThis.indexedDB
 const db=fakeIndexedDb()
 globalThis.indexedDB=db
 try{
  const u='11111111-1111-4111-8111-111111111111'
  const spouse='22222222-2222-4222-8222-222222222222'
  const household='household-1'
  const a=memberDraftSnapshot({userId:u,householdId:household,forms:[{amount:123,
   merchant:'店A',receiptImage:new Blob(['secret']),receiptFileName:'private.jpg'}]})
  const b=memberDraftSnapshot({userId:spouse,householdId:household,forms:[{amount:456,merchant:'店B'}]})
  await writeMemberDeviceState(u,household,a)
  await writeMemberDeviceState(spouse,household,b)
  assert.equal((await readMemberDeviceState(u,household)).forms[0].merchant,'店A')
  assert.equal((await readMemberDeviceState(spouse,household)).forms[0].merchant,'店B')
  assert.equal(await readMemberDeviceState(u,'other-household'),undefined)
  assert.equal(await readDeviceDraft(),undefined,'member draft must not overwrite owner draft')
  assert.ok(!JSON.stringify(await readMemberDeviceState(u,household)).includes('private.jpg'))
  assert.equal(db.disk.size,2)
  await clearMemberDeviceState(u,household)
  assert.equal(await readMemberDeviceState(u,household),undefined)
  assert.equal((await readMemberDeviceState(spouse,household)).forms[0].amount,456)
 }finally{
  if(before===undefined)delete globalThis.indexedDB
  else globalThis.indexedDB=before
 }
})

test('recovery requires matching verified household identity and preserves retry',()=>{
 const user='11111111-1111-4111-8111-111111111111',household='household-1'
 const draft=memberDraftSnapshot({userId:user,householdId:household,rawText:'123 yen',
  inputMode:'scan',forms:[{type:'expense',amount:123,clientRequestId:'stable',
   receiptImage:new Blob(['jpg']),neutralSpouseTransferKey:'neutral-spouse:abc'}],
  pendingPaidEntry:{snapshot:JSON.stringify({user,source:'card',entry:{amount:123}}),
   key:'member-spend:123e4567-e89b-42d3-a456-426614174000',requestId:'request-001'}})
 const restored=verifiedMemberDraft(draft,user,household)
 assert.equal(restored.forms[0].clientRequestId,'stable')
 assert.equal(restored.forms[0].neutralSpouseTransferKey,'neutral-spouse:abc')
 assert.equal(restored.forms[0].receiptImage,null)
 assert.equal(restored.pendingPaidEntry.requestId,'request-001')
 assert.equal(verifiedMemberDraft(draft,'different-user',household),null)
 assert.equal(verifiedMemberDraft(draft,user,'different-household'),null)
 assert.throws(()=>memberDraftStorageKey('',household),/本人確認/)
 assert.notEqual(memberDraftStorageKey(user,household,'shared-inline'),
  memberDraftStorageKey(user,household,'shared-editor'))
})

test('member writes are gated by durable storage and consume receipts atomically',()=>{
 const member=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 const transfer=readFileSync(new URL('../src/member-asset-transfer-submit.js',import.meta.url),'utf8')
 const approval=readFileSync(new URL('../src/FamilySharedMutationRequests.vue',import.meta.url),'utf8')
 const submit=member.slice(member.indexOf('async function submitMemberEntry()'),
  member.indexOf('const ledgerEntries=computed('))
 const save=member.slice(member.indexOf('async function submitPaidExpense('),
  member.indexOf('async function submitMemberFixedCost('))
 const signed=member.slice(member.indexOf('async function submitNeutralSpouseTransfer('),
  member.indexOf('async function submitMemberEntry('))
 assert.match(submit,/await persistMemberDraft\(\)[\s\S]*?await submitPaidExpense/)
 assert.match(submit,/try\{await persistMemberDraft\(memberEntries\.value\.slice\(1\)\)\}/)
 assert.match(save,/await persistMemberDraft\(\)[\s\S]*?api\(path,request\(body\)\)/)
 assert.match(save,/if\(pending\.acknowledged\)/)
 assert.match(save,/pending\.acknowledged=true[\s\S]*await persistMemberDraft\(\)/)
 assert.match(signed,/neutralSpouseTransferKey[\s\S]*await persistMemberDraft\(\)[\s\S]*await api\('shared-entries'/)
 assert.match(transfer,/if\(record\.memberAssetPending\?\.acknowledged===true\)return/)
 assert.match(transfer,/if\(typeof persistPending==='function'\)await persistPending\(\)/)
 assert.match(approval,/readMemberDeviceState\(actor,household,'shared-inline'\)/)
 assert.match(approval,/writeMemberDeviceState\(actor,household,inlineRequest,'shared-inline'\)/)
 assert.match(approval,/await clearMemberDeviceState\(actor,household,'shared-editor'\)/)
 assert.doesNotMatch(member,/if\s*\(\s*(?:record\.type|prepared\.status)\s*=(?!=)/,
  'never use assignment instead of comparison in financial conditionals')
})
