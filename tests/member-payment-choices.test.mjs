import test from 'node:test'
import assert from 'node:assert/strict'
import {memberPaymentChoices,resolveMemberPayment} from '../src/member-payment-choices.js'

test('cash exists for a member with no cards',()=>{
 assert.deepEqual(memberPaymentChoices([],[]),[{value:'cash',label:'現金'}])
 assert.deepEqual(resolveMemberPayment('cash',[],[]),{kind:'cash'})
})
test('own cards and authorized owner cards share one payment dropdown',()=>{
 const own=[{account_id:'a1',label:'My Card',account_kind:'credit_card',origin:'member_created',is_archived:0},
 {account_id:'a2',label:'Old Card',account_kind:'prepaid',origin:'member_created',is_archived:1}]
 const cards=[{card_name:'セブンカード',owner_display_name:'白ちゃん'}]
 assert.deepEqual(memberPaymentChoices(own,cards),[
  {value:'cash',label:'現金'},
  {value:'personal:a1',label:'My Card'},
  {value:'shared:セブンカード',label:'セブンカード（白ちゃん）'}])
 assert.equal(resolveMemberPayment('personal:a1',own,cards).account.account_id,'a1')
 assert.equal(resolveMemberPayment('shared:セブンカード',own,cards).card.card_name,'セブンカード')
 assert.equal(resolveMemberPayment('personal:a2',own,cards),null)
})
test('revoked grants and unregistered card labels cannot be submitted',()=>{
 assert.equal(resolveMemberPayment('shared:セブンカード',[],[]),null)
 assert.equal(resolveMemberPayment('other:unauthorized',[],[]),null)
})
