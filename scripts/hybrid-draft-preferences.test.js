import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readDeviceDraft, writeDeviceDraft } from '../src/draft-store.js'

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('device draft storage writes the same IndexedDB key, without ledger or receipt mutations',async t=>{
  const old=globalThis.indexedDB
  const records=new Map()
  let created=false, opens=0
  globalThis.indexedDB={
    open(name,version){
      assert.equal(name,'kakeibo-drafts')
      assert.equal(version,1)
      opens++
      const request={result:null}
      queueMicrotask(()=>{
        const database={
          objectStoreNames:{contains:store=>created && store==='current'},
          createObjectStore:store=>{assert.equal(store,'current');created=true},
          transaction(store,mode){
            assert.equal(store,'current')
            const tx={
              objectStore:()=>({
                get(key){
                  const operation={}
                  queueMicrotask(()=>{operation.result=records.get(key);operation.onsuccess?.();tx.oncomplete?.()})
                  return operation
                },
                put(value,key){
                  assert.equal(mode,'readwrite')
                  const operation={}
                  queueMicrotask(()=>{records.set(key,value);operation.onsuccess?.();tx.oncomplete?.()})
                  return operation
                }
              })
            }
            return tx
          },
          close(){}
        }
        request.result=database
        if(!created)request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    }
  }
  t.after(()=>{globalThis.indexedDB=old})
  const first={updatedAt:101,mode:'manual',input:'未記帳',forms:[]}
  const second={updatedAt:102,mode:'manual',input:'新しい下書き',forms:[]}
  await writeDeviceDraft(first)
  assert.deepEqual(await readDeviceDraft(),first)
  await writeDeviceDraft(second)
  assert.deepEqual(await readDeviceDraft(),second)
  assert.equal(records.size,1,'repeated edits overwrite one local record')
  assert.equal(opens,4)
  const tombstone={updatedAt:103,deleted:true}
  await writeDeviceDraft(tombstone)
  assert.deepEqual(await readDeviceDraft(),tombstone,'deletion survives reload')
})

test('hybrid autosave is local-first, with a dirty-only 30s cloud backup',()=>{
  const app=read('src/App.vue'),store=read('src/draft-store.js'),api=read('functions/api/[[path]].js')
  assert.match(app,/const DRAFT_SYNC_MS = 30000/)
  assert.match(app,/setInterval\(\(\) => void syncDraftToD1\(\),DRAFT_SYNC_MS\)/)
  assert.match(app,/watch\(\[forms,input,entryInputMode\], \(\) => \{\s*if \(draftHydrated\) void persistDraftLocally\(\)/)
  assert.match(app,/signature === draftCurrentSignature/)
  assert.match(app,/draftCurrentSignature === draftRemoteSignature/)
  assert.match(app,/await queueDeviceDraft\(tombstone\)/)
  assert.match(app,/await queueDraftSave\(null\)/)
  assert.match(app,/await persistDraftLocally\(\)/)
  assert.match(app,/function onDraftVisibilityChange\(\)/)
  assert.match(store,/receipt photos/i)
  assert.doesNotMatch(store,/\bentries\b|investment_snapshots|localStorage/)
  assert.match(api,/new Set\(\['remember_device','unsaved_draft'\]\)/)
  assert.doesNotMatch(app,/key:'ai_ocr_enabled'|key:'fx_currency'/)
})
