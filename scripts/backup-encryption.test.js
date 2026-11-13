import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { encryptBackupBlob, decryptBackupBlob } from '../src/backup-encryption.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const password='correct horse backup 2026'
test('encrypted JSON restores only with password',async ()=>{
 const plain='{"format":"kakeibo-ledger-backup","version":4,"entries":[]}'
 const encrypted=await encryptBackupBlob(new Blob([plain],{type:'application/json'}),password)
 assert.equal(encrypted.type,'application/octet-stream')
 assert.equal(await encrypted.text().then(x=>x.includes('kakeibo-ledger-backup')),false)
 const recovered=await decryptBackupBlob(encrypted,password)
 assert.equal(recovered.format,'json')
 assert.equal(await recovered.blob.text(),plain)
 await assert.rejects(decryptBackupBlob(encrypted,'incorrect password!'),/パスワード/)
})
test('encrypted ZIP restores exact bytes',async ()=>{
 const bytes=Uint8Array.from([80,75,3,4,9,8,7,6,5,4,3,2,1])
 const encrypted=await encryptBackupBlob(new Blob([bytes],{type:'application/zip'}),password)
 const recovered=await decryptBackupBlob(encrypted,password)
 assert.equal(recovered.format,'zip')
 assert.deepEqual(new Uint8Array(await recovered.blob.arrayBuffer()),bytes)
})
test('tampering header or ciphertext fails before restoring any ledger',async ()=>{
 const encrypted=await encryptBackupBlob(new Blob(['{"a":1}']),password)
 const altered=new Uint8Array(await encrypted.arrayBuffer())
 altered[altered.length-1]^=0x01
 await assert.rejects(decryptBackupBlob(new Blob([altered]),password),/パスワード/)
 altered[0]^=0x01
 await assert.rejects(decryptBackupBlob(new Blob([altered]),password),/家計簿/)
})
test('short passwords and invalid input never produce a backup',async ()=>{
 await assert.rejects(encryptBackupBlob(new Blob(['{}']),'short'),/10～128/)
 await assert.rejects(decryptBackupBlob(new Blob(['not a backup']),password),/サイズ/)
})