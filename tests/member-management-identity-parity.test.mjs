import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const read=file=>readFileSync(new URL(file,import.meta.url),'utf8')
test('both members use one original five-page tree and management header',()=>{
 const owner=read('../src/App.vue')
 const member=read('../src/FamilyMemberWorkspace.vue')
 const pages=read('../src/OriginalKakeiboPages.vue')
 const finance=read('../src/FinanceTools.vue')
 assert.match(owner,/<OriginalKakeiboPages :identity="familyIdentity"/)
 assert.match(member,/<OriginalKakeiboPages :identity="user"/)
 for(const tag of ['EntryInputPage','LedgerPage','StatisticsPage','AssetsPage','ManagementPage']){
  assert.match(pages,new RegExp('<'+tag+'\\b'))
 }
 assert.match(finance,/<FinanceManagementHeader v-model="managementTab"/)
 assert.match(finance,/<OriginalCardManagementPanel v-show="managementTab === 'cards'"/)
 assert.match(finance,/<OriginalOtherManagement v-if="memberView"/)
 assert.match(finance,/<OriginalOtherManagement :active="managementTab===.tools."/)
})
test('member management sections are lazy mounted and retained across tabs to preserve unsaved drafts',()=>{
 const finance=read('../src/FinanceTools.vue')
 assert.match(finance,/visitedMemberSections\s*=\s*ref\(new Set\(\['cards'\]\)\)/)
 assert.match(finance,/watch\(managementTab,\s*section\s*=>/)
 assert.match(finance,/visitedMemberSections\.value\.add\(section\)/)
 assert.match(finance,/visitedMemberSections\.has\('plans'\)" v-show="managementTab==='plans'"/)
 assert.match(finance,/visitedMemberSections\.has\('investment'\)" v-show="managementTab==='investment'"/)
 assert.match(finance,/v-if="memberView" v-show="managementTab==='cards'"/)
 assert.match(finance,/<slot name="member-plans"\/>/)
 assert.match(finance,/<slot name="member-investment"\/>/)
 assert.match(finance,/<slot name="member-card-usage"\/>/)
 assert.doesNotMatch(finance,/<slot v-if="memberView&&managementTab==='cards'"/)
 assert.doesNotMatch(finance,/<slot v-if="memberView&&\['plans','investment'\]/)
})
test('shared fixed-cost and credit-card UI still use owner-scoped member callbacks',()=>{
 const finance=read('../src/FinanceTools.vue')
 const member=read('../src/FamilyMemberWorkspace.vue')
 const fixed=read('../src/MemberFixedCosts.vue')
 assert.match(finance,/const unifiedCardProps=computed\(\(\)=>props\.memberView/)
 assert.match(finance,/<OriginalCardManagementPanel v-show=/)
 assert.match(member,/memberCardConfig:getMemberCardConfig\(\)/, 'the member adapter is bound to the shared card panel')
 assert.match(member,/<MemberFixedCosts/)
 assert.match(fixed,/<FixedCostEditorFields/)
 assert.match(fixed,/<OriginalFixedCostList/)
 assert.match(member,/owner_user_id===props\.user\.user_id/)
 assert.match(fixed,/owner_user_id===actor/)
})
