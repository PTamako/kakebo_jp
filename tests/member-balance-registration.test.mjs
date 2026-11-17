import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('member bank and securities use verified scoped account adapter in the shared balance page',()=>{
 assert.match(read('src/OriginalKakeiboPages.vue'),/:personal-accounts="member\?personalAccounts:\[\]"/)
 assert.match(read('src/pages/AssetsPage.vue'),/<PersonalAccountRegistry v-if="isPersonal"/)
 assert.match(read('src/FamilyMemberWorkspace.vue'),/:personal-accounts="myAccounts"/)
 assert.match(read('src/PersonalAccountRegistry.vue'),/props.onCreate\(kind.value,name.value.trim\(\)\)/)
})
test('prepaid balance add always routes to cards management',()=>{
 const m=read('src/FamilyMemberWorkspace.vue')
 assert.match(m,/memberCardSettingsRequest.value\+\+;tab.value='finance'/)
 assert.match(m,/cardSettingsRequest:memberCardSettingsRequest/)
 assert.match(read('src/FinanceTools.vue'),/watch\(\(\)=>props.cardSettingsRequest/)
})
test('member plan no longer shows stale HomeFlow owner approval prompt',()=>{
 assert.doesNotMatch(read('src/SbiPortfolio.vue'),/本人の積立変更は HomeFlow 承認/)
 assert.match(read('src/FamilyRecurringFinance.vue'),/管理者の承認は不要です/)
})
test('member balance and entry page never require a bank account or bank transfer UI',()=>{
 const member=read('src/FamilyMemberWorkspace.vue')
 const access=read('src/FamilyFinanceAccess.vue')
 const form=read('src/TransactionForm.vue')
 assert.doesNotMatch(member,/<FamilyFinanceBankTransfers/)
 assert.doesNotMatch(member,/\['bank','銀行'\]/)
 assert.doesNotMatch(access,/<FamilyFinanceBankTransfers/)
 assert.doesNotMatch(access,/value:'bank',label:'銀行'/)
 assert.match(form,/record.transferTarget==='spouse'/)
})
