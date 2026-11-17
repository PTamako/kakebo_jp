import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {sharedDeleteConfirmed} from '../src/shared-ledger-edit.js'

test('owner deletion accepts only committed, deleted, same-entry CAS receipts',()=>{
 const receipt={ok:true,applied:true,action:{
  entry_id:525,state:'deleted',version:10,entry:{amount:960,merchant:'長門'}
 }}
 assert.equal(sharedDeleteConfirmed(receipt,525,9),true)
 assert.equal(sharedDeleteConfirmed(receipt,526,9),false)
 assert.equal(sharedDeleteConfirmed(receipt,525,10),false)
 assert.equal(sharedDeleteConfirmed({...receipt,applied:false},525,9),false)
 assert.equal(sharedDeleteConfirmed({...receipt,action:{...receipt.action,state:'active'}},525,9),false)
 assert.equal(sharedDeleteConfirmed({ok:false},525,9),false)
})
test('original owner ledger removal routes through authenticated shared CAS before legacy deletion',()=>{
 const src=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const begin=src.indexOf('async function remove(id,visibleSnapshot=null)')
 const end=src.indexOf('function startEdit(entry)',begin)
 assert(begin>=0&&end>begin)
 const ownerDelete=src.slice(begin,end)
 assert.match(ownerDelete,/familyIdentity\.value\?\.role==='owner'/)
 assert.match(ownerDelete,/shared-entries\?entry_id=/)
 assert.match(ownerDelete,/expected_version:target\.version/)
 assert.match(ownerDelete,/method:'DELETE',credentials:'same-origin'/)
 assert.match(ownerDelete,/sharedDeleteConfirmed\(receipt,id,target\.version\)/)
 assert.match(ownerDelete,/if\(!sharedRemoved\)/)
 const correctEndpoint=ownerDelete.indexOf("method:'DELETE',credentials:'same-origin'")
 const legacyEndpoint=ownerDelete.indexOf("api('entries/' + id")
 assert(correctEndpoint>=0&&legacyEndpoint>correctEndpoint)
})
