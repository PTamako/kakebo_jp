import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {sharedEntryFromEditor,sameSharedEditValues,sharedEditConfirmed,isAnotherMembersPayment} from '../src/shared-ledger-edit.js'

test('original owner editor sends the selected expense payment and all changed fields',()=>{
 const record={date:'2026-11-17',time:'',amount:960,type:'expense',
  category:'外食',merchant:'長門',note:'修正済み',paymentSource:'テスト共有カード'}
 const entry=sharedEntryFromEditor(record)
 assert.deepEqual(entry,{date:'2026-11-17',time:'',amount:960,type:'expense',
  category:'外食',merchant:'長門',note:'修正済み',payment_source:'テスト共有カード'})
 assert.equal(sameSharedEditValues(entry,{...entry,payment_source:''}),false)
 const receipt={ok:true,applied:true,action:{version:10,state:'active',entry}}
 assert.equal(sharedEditConfirmed(entry,receipt,9),true)
 assert.equal(sharedEditConfirmed(entry,{...receipt,action:{...receipt.action,entry:{...entry,payment_source:''}}},9),false)
 assert.equal(sharedEditConfirmed(entry,{...receipt,action:{...receipt.action,entry:{...entry,category:'飲食料品'}}},9),false)
 assert.equal(sharedEditConfirmed(entry,{...receipt,action:{...receipt.action,entry:{...entry,amount:1200}}},9),false)
 assert.equal(sharedEditConfirmed(entry,{...receipt,action:{...receipt.action,version:9}},9),false)
})

test('unchanged cash is treated as no-op, but selecting card or cash explicitly is persisted',()=>{
 const original={date:'2026-11-17',time:'',amount:960,type:'expense',
  category:'飲食料品',merchant:'長門',note:''}
 const unchanged=sharedEntryFromEditor({...original,paymentSource:''})
 assert.equal(sameSharedEditValues(unchanged,original),true)
 const cash=sharedEntryFromEditor({...original,paymentSource:'現金'})
 assert.equal(sameSharedEditValues(cash,original),false)
 const card=sharedEntryFromEditor({...original,paymentSource:'セブンカード・プラス'})
 assert.equal(sameSharedEditValues(card,original),false)
 const oldCard={...original,payment_source:'セブンカード・プラス'}
 assert.equal(sameSharedEditValues(cash,oldCard),false)
})
test('owner editor wires the verified saved receipt and does not omit payment source',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 assert.match(app,/sharedEntryFromEditor\(e\)/)
 assert.match(app,/sharedEditConfirmed\(entry,receipt,target\.version\)/)
 assert.match(app,/sameSharedEditValues\(entry,target\.entry\)/)
 const form=readFileSync(new URL('../src/TransactionForm.vue',import.meta.url),'utf8')
 assert.match(form,/v-model="record\.category"/)
 assert.match(form,/@change="emit\('payment-change',\$event\)"/)
})


test('payment owner provenance locks spouse entries while preserving own edits',()=>{
 const owner='owner',member='member';
 assert.equal(isAnotherMembersPayment({shared_entry_requester_user_id:member},owner),true);
 assert.equal(isAnotherMembersPayment({shared_card_actor_user_id:member},owner),true);
 assert.equal(isAnotherMembersPayment({payment_account_owner_user_id:member},owner),true);
 assert.equal(isAnotherMembersPayment({shared_entry_requester_user_id:owner},owner),false);
 assert.equal(isAnotherMembersPayment({recorded_by:'鸡毛大王'},owner),false,
  'display names never confer or revoke payment editing rights');
 assert.equal(isAnotherMembersPayment({shared_entry_requester_user_id:member,
  payment_account_owner_user_id:owner},owner),true,
  'shared-card spender attribution remains protected');
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
 assert.match(app,/const foreignSource=isAnotherMembersPayment\(entry,viewerId\)/);
 assert.match(app,/paymentReadOnly:foreignSource/);
 assert.match(app,/paymentSource: entry\.payment_source \|\| ''/);
 assert.match(app,/paymentDisplay:entry\.type==='expense'/);
 assert.match(app,/ledgerTransferSourceLabel\(entry\)/);
});
