import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {SPOUSE_INCOME_CATEGORY,SPOUSE_INCOME_SOURCE} from '../src/spouse-income.js'
const read=path=>readFileSync(new URL('../src/'+path,import.meta.url),'utf8')
const form=read('TransactionForm.vue')
const owner=read('FinanceTools.vue')
const workspace=read('FamilyMemberWorkspace.vue')
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

test('both recipients have an explicit spouse-source income category',()=>{
 assert.equal(SPOUSE_INCOME_CATEGORY,'配偶からの収入')
 assert.equal(SPOUSE_INCOME_SOURCE,'配偶')
 assert.match(form,/SPOUSE_INCOME_CATEGORY/)
 assert.match(form,/orderedIncomeCategories/)
 assert.match(form,/record.type==='income' && record.category===SPOUSE_INCOME_CATEGORY/)
 assert.match(form,/record.value.merchant=SPOUSE_INCOME_SOURCE/)
 assert.match(proposal,/SPOUSE_INCOME_CATEGORY/)
})

test('member recipient records spouse income without creating any bank account',()=>{
 assert.match(workspace,/spouseIncomeRequestRef\?\.openSpouseIncome\(\)/)
 assert.match(workspace,/<FamilySharedMutationRequests ref="spouseIncomeRequestRef"/)
 assert.match(approval,/async function openSpouseIncome\(\)/)
 assert.match(approval,/action.value='create'/)
 assert.match(approval,/type:'income',category:SPOUSE_INCOME_CATEGORY/)
 assert.match(approval,/merchant:SPOUSE_INCOME_SOURCE/)
 assert.match(approval,/\/api\/family-finance\/shared-mutation-requests/)
 assert.match(approval,/\/submit'/)
 assert.doesNotMatch(approval,/\/api\/entries/)
 assert.doesNotMatch(workspace,/FamilyPersonalBankSettings/)
})

test('retired UI does not invalidate existing bank consent and approval evidence',()=>{
 assert.match(bank,/bank_debit_posted:true/)
 assert.match(bank,/bank_credit_posted:true/)
 assert.match(bank,/request-consent/)
 assert.doesNotMatch(form,/import FamilyCrossMemberBankTransfer/)
})
