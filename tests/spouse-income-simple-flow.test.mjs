import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('ordinary owner and member entry editor contains no standalone spouse-income shortcut',()=>{
 const entry=file('src/EntryInputPage.vue')
 const owner=file('src/App.vue')
 const member=file('src/FamilyMemberWorkspace.vue')
 assert.doesNotMatch(entry,/spouse-income-shortcut|@click="addSpouseIncome"|＋ 配偶からの収入/)
 assert.doesNotMatch(owner,/function addSpouseIncome\(/)
 assert.doesNotMatch(member,/function addMemberSpouseIncome\(/)
 assert.match(entry,/<TransactionForm/)
 assert.match(owner,/family:cross-bank/)
 assert.match(member,/sharedMutationRef.value\?\.submitEntry\(record\)/)
})

test('do not silently convert sender asset transfers into ordinary income or expense',()=>{
 const form=file('src/TransactionForm.vue')
 const owner=file('src/App.vue')
 assert.match(form,/id:'transfer',label:'資産移動'/)
 assert.match(owner,/f.type==='transfer'&&f.transferTarget==='family:cross-bank'/)
 assert.match(owner,/配偶間の資産移動は入出金として二重計上しません/)
})
