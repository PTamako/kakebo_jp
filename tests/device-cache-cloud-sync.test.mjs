import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const migration=readFileSync(new URL('../src/receipt-migration.js',import.meta.url),'utf8')
test('drafts persist immediately and copy to D1 after idle, background and fallback',()=>{
 assert.match(app,/DRAFT_IDLE_SYNC_MS = 4000/)
 assert.match(app,/scheduleDraftIdleSync\(\)/)
 assert.match(app,/draftIdleTimer=setTimeout\([\s\S]*?syncDraftToD1\(\)/)
 assert.match(app,/document.visibilityState!=='hidden'/)
 assert.match(app,/DRAFT_SYNC_MS = 30000/)
 assert.match(app,/void persistDraftLocally\(\)/)
})
test('only verified owner recovers old receipt images; failed SHA checks retain local files',()=>{
 assert.match(app,/identity.role!=='owner'\|\|locked.value/)
 assert.match(app,/listReceiptImageIds\(\)/)
 assert.match(app,/recoverLegacyReceiptsAfterOwnerLogin\(identity\)/)
 assert.match(migration,/await sha\(verified\)!==await sha\(item.blob\)/)
 assert.match(migration,/result.conflicts\+\+/)
})
