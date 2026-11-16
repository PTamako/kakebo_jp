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

test('member recipient records spouse income with original form and HomeFlow confirmation',()=>{
 assert.match(workspace,/entryIncomeCategories=\['給与','賞与','副収入','ポイント還元',SPOUSE_INCOME_CATEGORY/)
 assert.match(workspace,/<TransactionForm :record="f"/)
 assert.match(workspace,/sharedMutationRef.value\?\.submitEntry\(record\)/)
 assert.match(approval,/async function submitEntry\(input\)/)
 assert.match(approval,/submitIntent\('create',canonical\(input\)\)/)
 assert.match(approval,/operation,resource_id:target\?\.resource_id\|\|null/)
 assert.match(approval,/\/api\/family-finance\/shared-mutation-requests/)
 assert.match(approval,/encodeURIComponent\(pending.proposalId\)\+'\/submit'/)
 assert.doesNotMatch(approval,/\/api\/entries/)
 assert.doesNotMatch(workspace,/FamilyPersonalBankSettings/)
})

test('retired UI does not invalidate existing bank consent and approval evidence',()=>{
 assert.match(bank,/bank_debit_posted:true/)
 assert.match(bank,/bank_credit_posted:true/)
 assert.match(bank,/request-consent/)
 assert.doesNotMatch(form,/import FamilyCrossMemberBankTransfer/)
})
