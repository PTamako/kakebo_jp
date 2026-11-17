import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {SPOUSE_INCOME_CATEGORY,SPOUSE_INCOME_SOURCE,markSpouseIncome} from '../src/spouse-income.js'
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('spouse receipt is a normal income draft with no account or bank transfer prerequisite',()=>{
 const original={date:'2026-11-17',amount:12000,type:'transfer',category:'資産移動',merchant:'',
  paymentSource:'bank:123',transferTarget:'family:cross-bank',transferDate:'2026-11-17',rewardDestination:'sbi'}
 const next=markSpouseIncome(original)
 assert.equal(next,original)
 assert.equal(next.type,'income')
 assert.equal(next.category,SPOUSE_INCOME_CATEGORY)
 assert.equal(next.merchant,SPOUSE_INCOME_SOURCE)
 assert.equal(next.date,'2026-11-17')
 assert.equal(next.amount,12000)
 assert.equal(next.paymentSource,'')
 assert.equal(next.transferTarget,'')
 assert.equal(next.transferDate,'')
 assert.equal(next.rewardDestination,'')
 assert.equal('account_id' in next,false)
})

test('same spouse income shortcut on the owner and member original add screen, with no account choice',()=>{
 const entry=file('src/EntryInputPage.vue')
 const owner=file('src/App.vue')
 const member=file('src/FamilyMemberWorkspace.vue')
 const form=file('src/TransactionForm.vue')
 assert.match(entry,/@click="addSpouseIncome"/)
 assert.match(owner,/function addSpouseIncome\(\)[\s\S]*markSpouseIncome\(forms.value/)
 assert.match(member,/function addMemberSpouseIncome\(\)[\s\S]*markSpouseIncome\(newEntry\(\)\)/)
 assert.match(member,/addSpouseIncome:addMemberSpouseIncome/)
 assert.match(form,/record.category===SPOUSE_INCOME_CATEGORY/)
 assert.match(form,/銀行口座の登録は不要です/)
 assert.match(member,/sharedMutationRef.value\?\.submitEntry\(record\)/)
})
