import test from 'node:test'
import assert from 'node:assert/strict'
import {readPendingReceiptMarkers,markPendingReceipt,clearPendingReceipt,PENDING_RECEIPTS_KEY} from '../src/pending-receipts.js'
function memoryStorage(){
  const items=new Map()
  return {getItem:key=>items.get(key)??null,setItem:(key,value)=>items.set(key,value),
    removeItem:key=>items.delete(key),items}
}
test('retry marker survives reload without writing Blob or photo bytes',()=>{
  const storage=memoryStorage()
  markPendingReceipt(42,'2026-11-10',storage)
  assert.deepEqual(readPendingReceiptMarkers(storage),[{id:42,month:'2026-11'}])
  assert.equal(storage.getItem(PENDING_RECEIPTS_KEY).includes('base64'),false)
  assert.deepEqual(clearPendingReceipt(42,storage),[])
  assert.equal(storage.getItem(PENDING_RECEIPTS_KEY),null)
})
test('reject malformed markers and keep the latest ID only',()=>{
  const storage=memoryStorage()
  storage.setItem(PENDING_RECEIPTS_KEY,'bad json')
  assert.deepEqual(readPendingReceiptMarkers(storage),[])
  markPendingReceipt(42,'2026-10-11',storage)
  markPendingReceipt(42,'2026-11-02',storage)
  assert.deepEqual(readPendingReceiptMarkers(storage),[{id:42,month:'2026-11'}])
  assert.throws(()=>markPendingReceipt(0,'',storage))
})
