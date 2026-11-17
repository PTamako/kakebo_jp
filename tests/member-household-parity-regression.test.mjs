import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {familyMemberCardUsage} from '../functions/api/family-finance/member-card-usage.js'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('member personal and shared-card usage stays scope-bound and uses posted rows',async()=>{
 const calls=[]
 const db={prepare(sql){return {bind(...args){calls.push({sql,args})
  return {
   all:async()=>{
    if(sql.includes('FROM family_financial_accounts'))return {results:[
     {account_id:'a'.repeat(32),label:'本人カード',closing_day:10}]}
    if(sql.includes('FROM family_legacy_card_shares'))return {results:[
     {card_name:'家族共有カード',closing_day:15}]}
    if(sql.includes('SELECT id,date,merchant'))return {results:[
     {id:9,date:'2026-11-05',merchant:'食事',category:'外食',amount:1200}]}
    if(sql.includes('SELECT e.id,e.date'))return {results:[
     {id:10,date:'2026-11-06',merchant:'買物',category:'日用品',amount:650}]}
    throw Error('Unexpected query '+sql)
   },
   first:async()=>{
    if(sql.includes('COALESCE(SUM(amount)'))return {count:1,amount:1200}
    if(sql.includes('COALESCE(SUM(e.amount)'))return {count:1,amount:650}
    throw Error('Unexpected query '+sql)
   }
  }}}
 }}
 const user={user_id:'member',household_id:'household',role:'member'}
 const response=await familyMemberCardUsage(new Request('https://example.com/api/family-finance/member-card-usage?month=2026-11'),{DB:db},
  new URL('https://example.com/api/family-finance/member-card-usage?month=2026-11'),user,['member-card-usage'])
 assert.equal(response.status,200)
 const data=await response.json()
 assert.equal(data.viewer_user_id,'member')
 assert.deepEqual(data.items.map(x=>[x.scope,x.amount_jpy]),[['personal',1200],['shared-own-usage',650]])
 assert.deepEqual(data.items[0].period,{start:'2026-10-11',end:'2026-11-10'})
 assert.ok(calls.some(c=>c.sql.includes('family_account_id=?')&&c.args[0]==='a'.repeat(32)))
 assert.ok(calls.some(c=>c.sql.includes('ls.actor_user_id=?')&&c.args.slice(-2).join(',')==='member,member'))
 assert.ok(calls.every(c=>!c.sql.includes('SELECT * FROM entries')))
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
 assert.match(finance,/:on-open-trash="memberLoadTrash"/)
 assert.match(request,/submitIntent\('restore',null,target\)/)
 assert.match(request,/target\.version!==record\.version/)
 assert.match(request,/target\.state!=='deleted'/)
})

test('member payment reassignment requires both deployment gates plus owner and grant checks',()=>{
 const member=source('src/FamilyMemberWorkspace.vue')
 const memberApi=source('functions/api/family-finance/shared-mutation-requests.js')
 const executor=source('functions/api/internal/shared-entries/[[path]].js')
 assert.match(member,/memberPaymentReassignmentEnabled=ref\(true\)/)
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
