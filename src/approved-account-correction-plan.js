// Future-only household correction planning for personally owned credit/prepaid
// payment accounts. This module does not write to D1; execution must append
// immutable effects in the SAME approved transaction that updates the ledger.
// Never alter the original purchase receipt or original prepaid balance journal.
const money=n=>Number.isSafeInteger(n)&&n>=1&&n<=10000000;
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00.000Z'))&&
 new Date(s+'T00:00:00.000Z').toISOString().slice(0,10)===s;
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
export function closingMonth(d,closingDay){
 if(!date(d))fail('CORRECTION_INVALID_DATE');
 const [year,month,day]=d.split('-').map(Number);
 const last=new Date(Date.UTC(year,month,0)).getUTCDate();
 const cutoff=closingDay===null||closingDay===0||closingDay===undefined?
  last:Math.min(Math.max(Number(closingDay)||0,1),last);
 const next=day>cutoff?new Date(Date.UTC(year,month,1)):new Date(Date.UTC(year,month-1,1));
 return next.toISOString().slice(0,7);
}
function account(id,accounts,spender){
 if(!id)return null;
 const a=accounts.find(x=>x.account_id===id);
 if(!a||a.owner_user_id!==spender||a.origin!=='member_created'||
  !['credit_card','prepaid'].includes(a.account_kind)||Number(a.is_archived)!==0)
  fail('CORRECTION_ACCOUNT_NOT_OWNED_OR_ACTIVE');
 return a;
}
function identity(row,mayBeVoid=false){
 if(!row||row.type!=='expense'||!(money(Number(row.amount))||
  mayBeVoid&&Number(row.amount)===0)||!date(row.date)||
  typeof row.accountId!=='string')fail('CORRECTION_INVALID_ENTRY');
}
function effectKey(v){return [v.accountId,v.kind,v.billMonth||''].join('\0');}
export function planAccountLinkedExpenseCorrection(input){
 const {before,after,accounts,spenderUserId,editorUserId,
  prepaidBalances={},settledJpy=0,offsetJpy=0,operation='update'}=input||{};
 if(!spenderUserId||!editorUserId||!Array.isArray(accounts))
  fail('CORRECTION_IDENTITY_REQUIRED');
 if(!['update','delete','restore'].includes(operation))fail('CORRECTION_INVALID_OPERATION');
 identity(before,operation==='restore');identity(after,operation==='delete');
 if(operation==='delete'&&after.amount!==0||operation==='restore'&&before.amount!==0)
  fail('CORRECTION_INVALID_VOID_TRANSITION');
 if(!before.accountId)fail('CORRECTION_NOT_ACCOUNT_LINKED');
 const old=account(before.accountId,accounts,spenderUserId);
 const newer=account(after.accountId,accounts,spenderUserId);
 if(old.account_id!==newer?.account_id&&editorUserId!==spenderUserId)
  fail('CORRECTION_OTHER_PERSON_ACCOUNT_READ_ONLY');
 const changed=before.amount!==after.amount||before.date!==after.date||
  before.accountId!==after.accountId;
 // A previously settled or points-offset card charge must be reversed and
 // reallocated by a separate institutional/journal reconciliation first.
 if(changed&&(settledJpy!==0||offsetJpy!==0))
  fail('CORRECTION_EXISTING_ALLOCATION_REQUIRES_REVERSAL');
 const effects=new Map();
 function post(a,amount,when,reverse){
  if(!a)return;
  if(amount===0)return;
  const row={accountId:a.account_id,kind:a.account_kind,
   billMonth:a.account_kind==='credit_card'?closingMonth(when,a.closing_day):null,
   deltaJpy:reverse?-amount:amount};
  if(a.account_kind==='prepaid')row.deltaJpy=-row.deltaJpy;
  const key=effectKey(row);
  effects.set(key,{...row,deltaJpy:(effects.get(key)?.deltaJpy||0)+row.deltaJpy});
 }
 if(changed){
  post(old,Number(before.amount),before.date,true);
  post(newer,Number(after.amount),after.date,false);
 }
 const deltas=[...effects.values()].filter(x=>x.deltaJpy!==0);
 for(const delta of deltas)if(delta.kind==='prepaid'){
  const current=Number(prepaidBalances[delta.accountId]);
  if(!Number.isSafeInteger(current)||current<0)
   fail('CORRECTION_PREPAID_BALANCE_UNKNOWN');
  if(current+delta.deltaJpy<0||current+delta.deltaJpy>100000000)
   fail('CORRECTION_PREPAID_INSUFFICIENT_BALANCE');
 }
 return {changed,effects:deltas,
  ledgerAfter:{...after,amount:Number(after.amount)},
  // This plan is not itself a permission to post.
  requiresHomeFlowApproval:true,immutableOriginal:true};
}
