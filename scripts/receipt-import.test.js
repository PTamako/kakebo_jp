import test from 'node:test'
import assert from 'node:assert/strict'
import {ledgerAndReceiptsZip,receiptZip} from '../src/receipt-export.js'
import {readCompleteBackupZip} from '../src/receipt-import.js'
import {planReceiptRestoration} from '../src/receipt-restore-plan.js'

const old={id:17,date:'2026-11-08',time:'12:00',amount:1234,type:'expense',category:'日用品',
  merchant:'スーパー',note:'',payment_source:'現金',transfer_target:null,transfer_date:null}
const image=new Blob([new Uint8Array([2,10,20])],{type:'image/jpeg'})
test('complete ZIP is parsed locally and preserves original photo identifiers',async()=>{
  const ledger={format:'kakeibo-ledger-backup',version:4,entries:[old]}
  const file=await ledgerAndReceiptsZip(ledger,[{entryId:17,blob:image}])
  const result=await readCompleteBackupZip(file)
  assert.deepEqual(result.ledger,ledger)
  assert.equal(result.images.size,1)
  assert.deepEqual(new Uint8Array(await result.images.get(17).arrayBuffer()),new Uint8Array([2,10,20]))
})
test('ZIP rejects corrupted CRC, unexpected compression and missing ledger',async()=>{
  const src=await ledgerAndReceiptsZip({format:'kakeibo-ledger-backup',version:4,entries:[]},[{entryId:17,blob:image}])
  const broken=new Uint8Array(await src.arrayBuffer())
  broken[32]^=1
  await assert.rejects(()=>readCompleteBackupZip(new Blob([broken])))
  const invalid=new Uint8Array(await src.arrayBuffer())
  invalid[8]=8;invalid[9]=0
  await assert.rejects(()=>readCompleteBackupZip(new Blob([invalid])))
  await assert.rejects(()=>readCompleteBackupZip(await receiptZip([{entryId:17,blob:image}])))
})
test('restore maps new D1 IDs with a verified deterministic request ID',()=>{
  const prepared=[{id:17,clientRequestId:'restore_a1'}]
  const current=[{...old,id:110,client_request_id:'restore_a1'},{...old,id:111,merchant:'別の店'}]
  const result=planReceiptRestoration([old],new Map([[17,image]]),current,prepared)
  assert.deepEqual(result.items.map(x=>x.id),[110])
  assert.equal(result.unmatched,0)
  const altered=[{...old,id:110,amount:999,client_request_id:'restore_a1'}]
  assert.equal(planReceiptRestoration([old],new Map([[17,image]]),altered,prepared).items.length,0)
})
test('ambiguous, orphaned, and unrelated local photos cannot be assigned to a random entry',()=>{
  const a=planReceiptRestoration([old],new Map([[17,image],[18,image]]),[{...old,id:44},{...old,id:45}])
  assert.equal(a.unmatched,2)
  assert.equal(a.items.length,0)
  const sameId=planReceiptRestoration([old],new Map([[17,image]]),[{...old,id:17}])
  assert.deepEqual(sameId.items.map(x=>x.id),[17])
})
