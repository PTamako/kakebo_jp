// Draft P0-4: point QUANTITY is not currency and earning points is NOT cash income.
// This pure accounting policy does not write to the household ledger or bank.
// Actual counterpart debits/credits must be verified in the same future D1 transaction.
const operations=new Set([
 'earn_purchase','earn_campaign','redeem_discount','redeem_purchase',
 'redeem_asset','transfer_prepaid','offset_card','exchange_out','transfer_out',
 'transfer_in','expire','reversal'
]);
const credit=new Set(['earn_purchase','earn_campaign','transfer_in']);
const debit=new Set(['redeem_discount','redeem_purchase','redeem_asset',
 'transfer_prepaid','offset_card','exchange_out','transfer_out','expire']);
const targets={transfer_prepaid:'prepaid',offset_card:'credit_card',
 redeem_asset:'securities',exchange_out:'points',transfer_out:'points',transfer_in:'points'};
const linkedExpense=new Set(['redeem_discount','redeem_purchase']);
const linkedReward=new Set(['earn_purchase','earn_campaign']);
const max=1000000000;
export function pointAccountingPlan(x){
 if(!x||!operations.has(x.operation)||!Number.isSafeInteger(x.units)||
    x.units<1||x.units>max)return {ok:false,code:'INVALID_POINT_UNITS'};
 const {operation,units}=x;
 if(operation==='reversal'){
  const old=x.original;
  if(!old||!operations.has(old.operation)||old.operation==='reversal'||
   !Number.isSafeInteger(old.delta_units)||Math.abs(old.delta_units)!==units||
   !Number.isSafeInteger(old.yen_value)&&old.yen_value!==null)
   return {ok:false,code:'REVERSAL_REQUIRES_ORIGINAL'};
 }
 const n=x.rate_numerator,d=x.rate_denominator;
 const anyRate=n!==undefined||d!==undefined||x.yen_value!==undefined;
 if(anyRate && (!Number.isSafeInteger(n)||n<1||n>max||
   !Number.isSafeInteger(d)||d<1||d>max||
   !Number.isSafeInteger(x.yen_value)||x.yen_value<0||x.yen_value>max||
   BigInt(x.yen_value)*BigInt(d)!==BigInt(units)*BigInt(n)))
  return {ok:false,code:'POINT_RATE_OR_JPY_MISMATCH'};
 const target=targets[operation]||null;
 if(target && (!x.target_account_id||x.target_account_id===x.points_account_id||
    x.target_account_kind!==target))
   return {ok:false,code:'POINT_TARGET_REQUIRED'};
 if(linkedExpense.has(operation)&&!(Number.isSafeInteger(x.linked_entry_id)&&x.linked_entry_id>0))
  return {ok:false,code:'LINKED_PURCHASE_REQUIRED'};
 if(linkedReward.has(operation)&&!(Number.isSafeInteger(x.linked_entry_id)&&x.linked_entry_id>0)&&
   !/^[a-f0-9]{64}$/i.test(x.source_reference_hash||''))
  return {ok:false,code:'REWARD_EVIDENCE_REQUIRED'};
 if(operation==='reversal' && !(x.original?.homeflow_request_id))
  return {ok:false,code:'REVERSAL_REFERENCE_REQUIRED'};
 // A linked purchase already has its own expense. Discounting/point-paying
 // the SAME purchase must never create a SECOND household expense.
 const direction=credit.has(operation)?1:
   debit.has(operation)?-1:-Math.sign(x.original.delta_units);
 const delta=direction*units;
 const counterpart=target||null;
 const noNewExpense=true;
 return {ok:true,operation,delta_units:delta,
  yen_value:anyRate?x.yen_value:null,
  yen_per_unit_numerator:anyRate?n:null,
  yen_per_unit_denominator:anyRate?d:null,
  household_cash_income_delta_jpy:0,
  household_cash_outflow_delta_jpy:0,
  new_household_expense_entry:noNewExpense?false:null,
  existing_purchase_entry_id:linkedExpense.has(operation)?x.linked_entry_id:null,
  liability_offset_jpy:operation==='offset_card'?x.yen_value:null,
  prepaid_credit_jpy:operation==='transfer_prepaid'?x.yen_value:null,
  investment_point_funding_jpy:operation==='redeem_asset'?x.yen_value:null,
  counterpart_kind:counterpart,
  requires_atomic_counterpart:!!counterpart||linkedExpense.has(operation)||
   operation==='reversal'||operation==='redeem_purchase',
  never_classify_as_sbi_monthly:true};
}
