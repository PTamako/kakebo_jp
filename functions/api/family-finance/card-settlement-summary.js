// Household-shared, account-ID-scoped CARD liability projection.
// Purchases are the only expenses. Approved bank settlement allocations
// reduce the payable; transfer entries are never counted as spending.
const safe=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):null;
export async function memberCardLiabilities(db,household,settlementEnabled){
 if(!household||typeof household!=='string')return null;
 const common='SELECT p.account_id,p.bill_month,COALESCE(SUM(p.amount_jpy),0) amount_jpy,'+
   'COUNT(*) purchases FROM family_card_purchase_applied p '+
   'WHERE p.household_id=? GROUP BY p.account_id,p.bill_month';
 const sql=settlementEnabled?
  'WITH gross AS ('+common+'), paid AS ('+
  'SELECT original.account_id,original.bill_month,SUM(alloc.amount_jpy) settled_jpy '+
  'FROM family_card_settlement_allocations alloc '+
  'JOIN family_card_purchase_applied original ON original.homeflow_request_id=alloc.purchase_request_id '+
  'JOIN family_card_settlements_applied settled ON settled.homeflow_request_id=alloc.homeflow_request_id '+
  'WHERE original.household_id=? AND settled.household_id=? '+
  'AND settled.card_account_id=original.account_id '+
  'GROUP BY original.account_id,original.bill_month) '+
  'SELECT g.account_id,g.bill_month,g.amount_jpy,g.purchases,a.label,a.owner_user_id,'+
  'COALESCE(paid.settled_jpy,0) settled_jpy FROM gross g '+
  'JOIN family_financial_accounts a ON a.account_id=g.account_id '+
  'LEFT JOIN paid ON paid.account_id=g.account_id AND paid.bill_month=g.bill_month '+
  'WHERE a.household_id=? ORDER BY g.bill_month DESC,g.account_id LIMIT 200':
  'WITH gross AS ('+common+') '+
  'SELECT g.account_id,g.bill_month,g.amount_jpy,g.purchases,a.label,a.owner_user_id,'+
  '0 settled_jpy FROM gross g JOIN family_financial_accounts a ON a.account_id=g.account_id '+
  'WHERE a.household_id=? ORDER BY g.bill_month DESC,g.account_id LIMIT 200';
 const args=settlementEnabled?[household,household,household,household]:[household,household];
 const rows=(await db.prepare(sql).bind(...args).all()).results||[];
 const items=[];let total=0;
 for(const x of rows){
  const gross=safe(x.amount_jpy),settled=safe(x.settled_jpy),count=safe(x.purchases);
  if(gross===null||settled===null||count===null||settled>gross)return null;
  const outstanding=gross-settled;
  total+=outstanding;
  if(!Number.isSafeInteger(total))return null;
  items.push({account_id:x.account_id,account_label:x.label,owner_user_id:x.owner_user_id,
   closing_month:x.bill_month,gross_charges_jpy:gross,settled_jpy:settled,
   liability_jpy:outstanding,purchases:count,payment_due_date:null,
   settlement_status:!settlementEnabled?'not_reconciled':
    outstanding===0?'settled':settled>0?'partially_settled':'unsettled'});
 }
 return {items,total};
}
