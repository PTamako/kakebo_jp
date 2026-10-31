import test from 'node:test'
import assert from 'node:assert/strict'
import { receiptZip } from '../src/receipt-export.js'
test('ZIP exports unmodified images using standard local and directory signatures',async()=>{
 const blob=new Blob([new Uint8Array([1,2,3,4])],{type:'image/jpeg'})
 const zip=await receiptZip([{entryId:17,blob}]),bytes=new Uint8Array(await zip.arrayBuffer())
 const view=new DataView(bytes.buffer)
 assert.equal(view.getUint32(0,true),0x04034b50)
 assert.equal(view.getUint32(bytes.length-22,true),0x06054b50)
 assert.equal(new TextDecoder().decode(bytes).includes('receipt-17.jpg'),true)
 assert.equal(zip.type,'application/zip')
})
test('cannot export an empty archive or unsupported image',async()=>{
 await assert.rejects(()=>receiptZip([]))
 await assert.rejects(()=>receiptZip([{entryId:1,blob:new Blob(['x'],{type:'text/plain'})}]))
})
