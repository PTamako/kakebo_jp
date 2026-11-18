import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import {sealBackup,verifyBackupIntegrity} from '../src/backup-integrity.js'
import {ledgerAndReceiptsZip} from '../src/receipt-export.js'
import {readCompleteBackupZip} from '../src/receipt-import.js'
import {planReceiptRestoration} from '../src/receipt-restore-plan.js'

if(!globalThis.crypto)globalThis.crypto=webcrypto

const entry={id:101,date:'2026-11-18',time:'10:30',amount:1250,
 type:'expense',category:'食費',merchant:'検証専用',note:'isolated ZIP recovery',
 payment_source:'現金',transfer_target:null,transfer_date:null}
const ledger=()=>({format:'kakeibo-ledger-backup',version:4,
 entries:[{...entry}],paymentSources:[{name:'現金',source_type:'cash'}]})
const photo=()=>new Blob([Uint8Array.from([255,216,255,224,1,2,255,217])],
 {type:'image/jpeg'})

test('full signed ZIP round-trip restores ledger and exact R2 photo bytes without changing identifiers',async()=>{
 const signed=await sealBackup(ledger())
 const zip=await ledgerAndReceiptsZip(signed,[{entryId:101,blob:photo()}])
 assert.equal(zip.type,'application/zip')
 const restored=await readCompleteBackupZip(zip)
 assert.deepEqual(restored.ledger,signed)
 assert.equal(await verifyBackupIntegrity(restored.ledger),true)
 assert.deepEqual([...restored.images.keys()],[101])
 assert.deepEqual(new Uint8Array(await restored.images.get(101).arrayBuffer()),
  new Uint8Array(await photo().arrayBuffer()))
 const current=[{...entry,id:503,client_request_id:'restore_0123456789abcdef0123456789abcdef'}]
 const plan=planReceiptRestoration(restored.ledger.entries,restored.images,current)
 assert.equal(plan.unmatched,0)
 assert.equal(plan.items.length,1)
 assert.equal(plan.items[0].id,503,'photo must attach to the restored D1 entry ID, not old ID')
})

test('ZIP image ID ambiguity is not guessed during recovery',async()=>{
 const signed=await sealBackup(ledger())
 const restored=await readCompleteBackupZip(
  await ledgerAndReceiptsZip(signed,[{entryId:101,blob:photo()}]))
 const duplicateEntries=[{...entry,id:503},{...entry,id:504}]
 const planned=planReceiptRestoration(restored.ledger.entries,restored.images,duplicateEntries)
 assert.equal(planned.items.length,0)
 assert.equal(planned.unmatched,1)
})

test('JSON tampering is detected before the restored ledger can be accepted',async()=>{
 const signed=await sealBackup(ledger())
 const restored=await readCompleteBackupZip(
  await ledgerAndReceiptsZip(signed,[{entryId:101,blob:photo()}]))
 restored.ledger.entries[0].amount=9000
 await assert.rejects(verifyBackupIntegrity(restored.ledger),/バックアップ/)
})

test('ZIP export rejects image larger than 200 KB instead of creating an unrestorable backup',async()=>{
 const signed=await sealBackup(ledger())
 const tooLarge=new Blob([new Uint8Array(200*1024+1)],{type:'image/jpeg'})
 await assert.rejects(
  ledgerAndReceiptsZip(signed,[{entryId:101,blob:tooLarge}]),
  /200KB/)
})

test('private finance bridge deploy remains opt-in with no main-branch push trigger',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/deploy-private-bridge.yml',import.meta.url),'utf8')
 assert.match(workflow,/on:\s*\n\s*# Explicit dispatch only;[\s\S]*?workflow_dispatch:/)
 assert.doesNotMatch(workflow,/^\s*push:\s*$/m)
 assert.match(workflow,/npx wrangler deploy --config wrangler\.homeflow-bridge\.toml/)
})
