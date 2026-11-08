import test from 'node:test'
import assert from 'node:assert/strict'
import { receiptZip, ledgerAndReceiptsZip } from '../src/receipt-export.js'
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

test('complete bundle exports signed JSON plus local photos without network access',async()=>{
 const ledger={format:'kakeibo-ledger-backup',version:4,entries:[],integrity:{algorithm:'SHA-256',digest:'test'}}
 const image=new Blob([new Uint8Array([11,22,33])],{type:'image/webp'})
 const zip=await ledgerAndReceiptsZip(ledger,[{entryId:25,blob:image}])
 const bytes=new Uint8Array(await zip.arrayBuffer()),text=new TextDecoder().decode(bytes)
 const tail=new DataView(bytes.buffer).getUint16(bytes.length-22+8,true)
 assert.equal(tail,2,'ledger and image must both be present')
 assert.ok(text.includes('kakeibo-ledger-settings.json'))
 assert.ok(text.includes('receipt-25.webp'))
 assert.ok(text.includes('kakeibo-ledger-backup'))
 const emptyImages=await ledgerAndReceiptsZip(ledger,[])
 assert.equal(new DataView(await emptyImages.arrayBuffer()).getUint16(emptyImages.size-22+8,true),1)
 assert.throws(()=>ledgerAndReceiptsZip({},[]))
})
