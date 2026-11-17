import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {familyMemberCardUsage} from '../functions/api/family-finance/member-card-usage.js'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('member card management displays own cards only and shares stay in payment choices',async()=>{
 const calls=[]
 const db={prepare(sql){return {bind(...args){calls.push({sql,args})
  return {
   all:async()=>{
    if(sql.includes('FROM family_financial_accounts'))return {results:[
     {account_id:'a'.repeat(32),label:'本人カード',closing_day:10}]}
    if(sql.includes('SELECT id,date,merchant'))return {results:[
     {id:9,date:'2026-11-05',merchant:'食事',category:'外食',amount:1200}]}
    throw Error('Unexpected query '+sql)
   },
   first:async()=>{
    if(sql.includes('COALESCE(SUM(amount)'))return {count:1,amount:1200}
    throw Error('Unexpected query '+sql)
   }
  }}}
 }}
 const user={user_id:'member',household_id:'household',role:'member'}
 const url=new URL('https://example.com/api/family-finance/member-card-usage?month=2026-11')
 const response=await familyMemberCardUsage(new Request(url),{DB:db},url,user,['member-card-usage'])
 assert.equal(response.status,200)
 const data=await response.json()
 assert.equal(data.viewer_user_id,'member')
 assert.equal(data.scope,'personal-card-usage')
 assert.deepEqual(data.items.map(x=>[x.scope,x.amount_jpy,x.owner_user_id]),[['personal',1200,'member']])
 assert.deepEqual(data.items[0].period,{start:'2026-10-11',end:'2026-11-10'})
 assert.ok(calls.some(c=>c.sql.includes('family_account_id=?')&&c.args[0]==='a'.repeat(32)))
 assert.ok(calls.some(c=>c.sql.includes('owner_user_id=?')&&c.args[1]==='member'))
 assert.ok(calls.every(c=>!c.sql.includes('family_legacy_card_shares')))
 assert.ok(calls.every(c=>!c.sql.includes('SELECT * FROM entries')))
 const usage=source('src/MemberCardUsage.vue'),member=source('src/FamilyMemberWorkspace.vue')
 assert.doesNotMatch(usage,/shared-own-usage/)
 assert.match(usage,/x.owner_user_id!==actor/)
 assert.match(member,/cardAccounts=computed\(\(\)=>myAccounts.value.filter/)
 assert.match(member,/buildMemberPaymentChoices\(myAccounts.value,sharedCards.value\)/)
 const invalid=await familyMemberCardUsage(new Request('https://example.com/?month=2026-13'),{DB:db},
  new URL('https://example.com/?month=2026-13'),user,['member-card-usage'])
 assert.equal(invalid.status,400)
})

test('member approval-based trash restoration preserves immutable registry CAS',()=>{
 const workspace=source('src/FamilyMemberWorkspace.vue')
 const request=source('src/FamilySharedMutationRequests.vue')
 const finance=source('src/FinanceTools.vue')
 assert.match(workspace,/async function loadMemberSharedTrash\(/)
 assert.match(workspace,/async function restoreMemberSharedTrash\(/)
 assert.match(workspace,/submitRestore\(row\)/)
 assert.match(workspace,/memberLoadTrash:loadMemberSharedTrash/)
  assert.match(finance,/:on-open-trash="memberView\?memberLoadTrash:/)
 assert.match(request,/submitIntent\('restore',null,target\)/)
 assert.match(request,/target\.version!==record\.version/)
 assert.match(request,/target\.state!=='deleted'/)
})

test('member payment reassignment requires both deployment gates plus owner and grant checks',()=>{
 const member=source('src/FamilyMemberWorkspace.vue')
 const memberApi=source('functions/api/family-finance/shared-mutation-requests.js')
 const executor=source('functions/api/internal/shared-entries/[[path]].js')
 assert.match(member,/memberPaymentReassignmentEnabled=ref\(false\)/)
 assert.match(memberApi,/OTHER_MEMBERS_PAYMENT_READ_ONLY/)
 assert.match(executor,/SHARED_CARD_GRANT_REVOKED/)
 assert.match(executor,/SHARED_MUTATION_PAYMENT_OWNER_MISMATCH/)
 assert.match(memberApi,/KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED/)
 assert.match(executor,/KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED/)
})

test('original balance keeps one wallet and funds tree; member account settings are nested within funds',()=>{
 const assets=source('src/pages/AssetsPage.vue')
 const sbi=source('src/SbiPortfolio.vue')
 assert.match(assets,/<template #after-holdings>/)
 assert.match(sbi,/<slot name="after-holdings"/)
 assert.match(assets,/<PrepaidAssets/)
 assert.match(assets,/<SbiPortfolio/)
})

test('approval-sensitive statistics and wallet remain reactive beyond list tab, while refresh retains verified data',()=>{
 const owner=source('src/App.vue'),member=source('src/FamilyMemberWorkspace.vue')
 assert.match(owner,/\['list','stat','investments','finance'\]\.includes\(tab\.value\)/)
 assert.match(member,/\['list','stat','investments','finance'\]\.includes\(tab\.value\)/)
 assert.doesNotMatch(member,/error\.value='';accounts\.value=\[\];assets\.value=\[\];sharedEntries\.value=\[\]/)
 assert.match(member,/<MemberCardUsage /)
})

test('production Pages and private worker advertise the same guarded payment reassignment capability',()=>{
 const pages=source('wrangler.toml')
 const worker=source('wrangler.homeflow-bridge.toml')
 assert.match(pages,/KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED = "true"/)
 assert.match(worker,/KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED = "true"/)
 const preview=pages.split('[env.preview.vars]')[1]||''
 assert.doesNotMatch(preview,/KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED/)
})
