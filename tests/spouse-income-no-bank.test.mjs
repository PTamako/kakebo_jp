import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {SPOUSE_INCOME_CATEGORY,SPOUSE_INCOME_SOURCE} from '../src/spouse-income.js'
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
const form=read('TransactionForm.vue')
const owner=read('FinanceTools.vue')
const workspace=read('FamilyMemberWorkspace.vue')
const shared=read('OriginalKakeiboPages.vue')
const approval=read('FamilySharedMutationRequests.vue')
const proposal=read('FamilyFinanceProposals.vue')
const bank=read('FamilyCrossMemberBankTransfer.vue')

test('remove personal bank registration panel, retain original owner cards',()=>{
 assert.doesNotMatch(owner,/FamilyPersonalBankSettings/)
 assert.doesNotMatch(form,/<FamilyCrossMemberBankTransfer/)
 assert.doesNotMatch(form,/value:'family:cross-bank',label:/)
 assert.match(owner,/MobileCardEditorSheet/)
 assert.match(form,/value:'sbi'/)
 assert.match(form,/props.transferDestinations.map/)
})

test('spouse income shortcut is absent while the original neutral transfer remains',()=>{
 assert.equal(SPOUSE_INCOME_CATEGORY,'配偶からの収入')
 assert.equal(SPOUSE_INCOME_SOURCE,'配偶')
 assert.doesNotMatch(form,/SPOUSE_INCOME_CATEGORY/)
 assert.doesNotMatch(proposal,/SPOUSE_INCOME_CATEGORY/)
 assert.doesNotMatch(workspace,/SPOUSE_INCOME_CATEGORY/)
 assert.doesNotMatch(approval,/openSpouseIncome|spouseQuickMode/)
 assert.match(form,/record.transferTarget==='spouse'/)
 assert.match(form,/両者の収入・支出に計上せず、口座の指定も不要/)
})
test('neutral spouse asset transfer uses one ordinary shared-ledger proposal',()=>{
 assert.match(shared,/<EntryInputPage v-if="activeTab==='add'"/)
 assert.match(read('EntryInputPage.vue'),/<TransactionForm /)
 assert.match(workspace,/sharedMutationRef.value\?\.submitEntry\(record\)/)
 assert.match(approval,/async function submitEntry\(input\)/)
 assert.match(approval,/submitIntent\('create',canonical\(input\)\)/)
 assert.match(approval,/\/api\/family-finance\/shared-mutation-requests/)
 assert.match(approval,/transfer_target='spouse'/)
 assert.doesNotMatch(approval,/\/api\/entries/)
})
test('retired UI does not invalidate existing bank consent and approval evidence',()=>{
 assert.match(bank,/bank_debit_posted:true/)
 assert.match(bank,/bank_credit_posted:true/)
 assert.match(bank,/request-consent/)
 assert.doesNotMatch(form,/import FamilyCrossMemberBankTransfer/)
})
