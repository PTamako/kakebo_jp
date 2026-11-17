import test from 'node:test'
import assert from 'node:assert/strict'
import {planAccountLinkedExpenseCorrection,closingMonth} from '../src/approved-account-correction-plan.js'
const member='member-uuid',admin='admin-uuid';
const cardA={account_id:'a',owner_user_id:member,account_kind:'credit_card',
 origin:'member_created',is_archived:0,closing_day:10}
const cardB={account_id:'b',owner_user_id:member,account_kind:'credit_card',
 origin:'member_created',is_archived:0,closing_day:20}
const prepaid={account_id:'p',owner_user_id:member,account_kind:'prepaid',
 origin:'member_created',is_archived:0}
const other={account_id:'other',owner_user_id:admin,account_kind:'credit_card',
 origin:'member_created',is_archived:0,closing_day:15}
const before={date:'2026-11-09',amount:1000,type:'expense',accountId:'a'};
const plan=(b,a,more={})=>planAccountLinkedExpenseCorrection({
 before:b,after:a,accounts:[cardA,cardB,prepaid,other],
 spenderUserId:member,editorUserId:member,prepaidBalances:{p:10000},...more
});
test('card amount increase replaces the effective liability with an immutable delta',()=>{
 const out=plan(before,{...before,amount:1500});
 assert.equal(out.requiresHomeFlowApproval,true);
 assert.equal(out.immutableOriginal,true);
 assert.deepEqual(out.effects,[{accountId:'a',kind:'credit_card',
  billMonth:'2026-11',deltaJpy:500}]);
});
test('changing own card moves liabilities between both accounts without double counting',()=>{
 const out=plan(before,{...before,accountId:'b',amount:1250});
 assert.deepEqual(out.effects,[
  {accountId:'a',kind:'credit_card',billMonth:'2026-11',deltaJpy:-1000},
  {accountId:'b',kind:'credit_card',billMonth:'2026-11',deltaJpy:1250}
 ]);
});
test('changing date across statement cutoff moves the liability between months',()=>{
 assert.equal(closingMonth('2026-11-11',10),'2026-12');
 const out=plan(before,{...before,date:'2026-11-11'});
 assert.deepEqual(out.effects,[
  {accountId:'a',kind:'credit_card',billMonth:'2026-11',deltaJpy:-1000},
  {accountId:'a',kind:'credit_card',billMonth:'2026-12',deltaJpy:1000}
 ]);
});
test('card to prepaid changes card liability and prepaid spending once',()=>{
 const out=plan(before,{...before,accountId:'p',amount:1100});
 assert.deepEqual(out.effects,[
  {accountId:'a',kind:'credit_card',billMonth:'2026-11',deltaJpy:-1000},
  {accountId:'p',kind:'prepaid',billMonth:null,deltaJpy:-1100}
 ]);
});
test('prepaid purchase increases refund balance when later amount is reduced',()=>{
 const original={...before,accountId:'p',amount:2000};
 const out=plan(original,{...original,amount:1200});
 assert.deepEqual(out.effects,[{accountId:'p',kind:'prepaid',
  billMonth:null,deltaJpy:800}]);
});
test('deny overdrafts and unauthorized spouse account selection',()=>{
 assert.throws(()=>plan(before,{...before,accountId:'p',amount:11000}),/CORRECTION_PREPAID_INSUFFICIENT_BALANCE/);
 assert.throws(()=>plan(before,{...before,accountId:'other'}),/CORRECTION_ACCOUNT_NOT_OWNED_OR_ACTIVE/);
 assert.throws(()=>plan(before,{...before,accountId:'b'},{
  editorUserId:admin}),/CORRECTION_OTHER_PERSON_ACCOUNT_READ_ONLY/);
});
test('attached settlements or point offsets prevent an unsafe ordinary amendment',()=>{
 for(const field of ['settledJpy','offsetJpy'])
  assert.throws(()=>plan(before,{...before,amount:1500},{[field]:200}),
   /CORRECTION_EXISTING_ALLOCATION_REQUIRES_REVERSAL/);
});
test('editing merchant/category alone never invents a financial delta',()=>{
 const out=plan(before,{...before,merchant:'New merchant',category:'Food'});
 assert.equal(out.changed,false);assert.deepEqual(out.effects,[]);
});
test('neither income nor transfer may enter the card/prepaid expense amendment path',()=>{
 assert.throws(()=>plan(before,{...before,type:'transfer'}),/CORRECTION_INVALID_ENTRY/);
 assert.throws(()=>plan(before,{...before,amount:0}),/CORRECTION_INVALID_ENTRY/);
});
