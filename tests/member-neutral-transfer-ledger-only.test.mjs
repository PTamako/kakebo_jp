import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('neutral spouse revisions reuse the original editor but bypass HomeFlow approval only for their creator',()=>{
 const api=source('functions/api/family-finance/shared-entries.js')
 const member=source('src/FamilyMemberWorkspace.vue')
 const requests=source('src/FamilySharedMutationRequests.vue')
 const intents=source('functions/api/family-finance/shared-mutation-requests.js')
 assert.match(api,/ONLY_OWN_NEUTRAL_TRANSFER_IS_DIRECT/)
 assert.match(api,/NEUTRAL_TRANSFER_TYPE_LOCKED/)
 assert.match(api,/role==='member'/)
 assert.match(member,/allReadOnly:entry.transfer_target!=='spouse'\|\|!isOwn/)
 assert.match(member,/!result\?\.proposalId&&!result\?\.applied/)
 assert.match(requests,/directNeutralTransfer\(operation,target,entry\)/)
 assert.match(requests,/directNeutralTransfer\('restore',target\)/)
 assert.match(requests,/return submitIntent\('restore',null,target\)/)
 assert.match(intents,/NEUTRAL_SPOUSE_TRANSFER_NO_OWNER_REVIEW/)
})
test('legacy personal approval submitters are retired only in household-ledger-only production',()=>{
 const config=source('wrangler.toml')
 assert.match(config,/KAKEIBO_HOUSEHOLD_LEDGER_ONLY = "true"/)
 const paths=['functions/api/family-finance/prepaid-actions.js',
  'functions/api/family-finance/points-actions.js',
  'functions/api/family-finance/sbi-cash-actions.js',
  'functions/api/family-finance/bank-transfers.js']
 for(const p of paths)assert.match(source(p),/KAKEIBO_HOUSEHOLD_LEDGER_ONLY==='true'/,p)
 assert.match(source(paths[0]),/p.action==='topup'/)
 assert.match(source(paths[0]),/finance.prepaid.spend|action==='spend'/)
 assert.match(source('functions/api/family-finance/member-prepaid-topups.js'),/No shared entry or admin review/)
 assert.match(source('functions/api/family-finance/member-personal-points.js'),/never edits household/)
})
