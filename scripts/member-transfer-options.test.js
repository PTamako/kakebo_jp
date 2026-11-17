import test from 'node:test'
import assert from 'node:assert/strict'
import {memberTransferChoices,memberTransferOperation,memberOwnActiveAssets} from '../src/member-transfer-options.js'
const uid='member-1',other='member-2'
const account=(kind,id,owner=uid,rest={})=>({
 account_id:id,owner_user_id:owner,origin:'member_created',
 account_kind:kind,label:id,is_archived:false,version:1,...rest})
test('same original transfer selector: no personal assets means spouse only',()=>{
 assert.deepEqual(memberTransferChoices([],uid).map(x=>x.value),['spouse'])
 assert.deepEqual(memberTransferChoices([account('prepaid','p1',other)],uid).map(x=>x.value),['spouse'])
})
test('new personal prepaid creates one additional transfer entry',()=>{
 const rows=[account('prepaid','p1'),account('credit_card','c1',other)]
 assert.deepEqual(memberTransferChoices(rows,uid).map(x=>x.value),['spouse','prepaid:p1'])
})
test('point operations require both registered accounts of correct types',()=>{
 const rows=[account('points','points1'),account('prepaid','prepaid1'),
  account('credit_card','card1'),account('securities','sbi1'),account('points','points2')]
 assert.deepEqual(memberTransferChoices(rows,uid).map(x=>x.value),[
  'spouse','prepaid:prepaid1','points:prepaid','points:card','points:sbi',
  'points:move','points:exchange'])
})
test('archived, other-member and unregistered sources never leak into transfer menu',()=>{
 const rows=[account('points','points1'),
  account('prepaid','archived',uid,{is_archived:true}),
  account('prepaid','shared',other),
  account('securities','other-sbi',other),
  account('prepaid','legacy',uid,{origin:'legacy'})]
 assert.deepEqual(memberTransferChoices(rows,uid).map(x=>x.value),['spouse'])
 assert.deepEqual(memberOwnActiveAssets(rows,uid).map(x=>x.account_id),['points1'])
})
test('member operation dispatch is strict and never accepts arbitrary account reference',()=>{
 assert.equal(memberTransferOperation('spouse'),'spouse')
 assert.equal(memberTransferOperation('prepaid:p1'),'prepaid')
 assert.equal(memberTransferOperation('points:sbi'),'redeem_asset')
 assert.equal(memberTransferOperation('points:exchange'),'exchange_out')
 assert.equal(memberTransferOperation('sbi'),null)
 assert.equal(memberTransferOperation('prepaid:'),null)
 assert.equal(memberTransferOperation('shared:card'),null)
})

test('point conversion is hidden until both accounts satisfy backend zero-opening-balance requirement',()=>{
 const rows=[account('points','point1',uid,{opening_balance:100}),account('prepaid','prepaid1')]
 assert.deepEqual(memberTransferChoices(rows,uid).map(x=>x.value),['spouse','prepaid:prepaid1'])
})
