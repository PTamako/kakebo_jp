// Household-shared, account-ID-scoped CARD liability projection.
// Purchases are the only expenses. Approved bank settlement allocations
// reduce the payable; transfer entries are never counted as spending.
const safe=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):null;
export async function memberCardLiabilities(db,household,settlementEnabled){
 if(!household||typeof household!=='string')return null;
 // Keep immutable original charges, then apply ONLY owner-approved,
 // signed adjustment effects. No direct mutation of the purchase evidence.
 const hasCorrections=!!await db.prepare("SELECT 1 FROM sqlite_master "+
  "WHERE type='table' AND name='family_approved_account_effects' LIMIT 1").bind().first();
 const hasOwnerCorrections=!!await db.prepare("SELECT 1 FROM sqlite_master "+
  "WHERE type='table' AND name='family_owner_account_effects' LIMIT 1").bind().first();
 const ownerUnion=hasOwnerCorrections?
   " UNION ALL SELECT o.account_id,o.bill_month,o.delta_jpy,o.purchase_count_delta "+
   "FROM family_owner_account_effects o WHERE o.household_id=? AND o.account_kind='credit_card'":'';
 const common=hasCorrections?
  'SELECT x.account_id,x.bill_month,COALESCE(SUM(x.amount_jpy),0) amount_jpy,'+
   'SUM(x.purchases) purchases FROM ('+
   'SELECT p.account_id,p.bill_month,p.amount_jpy,1 purchases '+
   'FROM family_card_purchase_applied p WHERE p.household_id=? UNION ALL '+
   "SELECT e.account_id,e.bill_month,e.delta_jpy,e.purchase_count_delta "+
   "FROM family_approved_account_effects e WHERE e.household_id=? AND e.account_kind='credit_card'"+
   ownerUnion+') x GROUP BY x.account_id,x.bill_month':
  'SELECT p.account_id,p.bill_month,COALESCE(SUM(p.amount_jpy),0) amount_jpy,'+
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
  'GROUP BY original.account_id,original.bill_month), offsets AS ('+
  'SELECT original.account_id,original.bill_month,'+
   'SUM(o.amount_jpy-COALESCE(ref.restored_jpy,0)) points_offset_jpy '+
  'FROM family_points_card_offsets o JOIN family_card_purchase_applied original '+
  'ON original.homeflow_request_id=o.purchase_request_id '+
   'LEFT JOIN family_points_card_offset_refunds ref ON ref.original_request_id=o.homeflow_request_id '+
  'WHERE original.household_id=? GROUP BY original.account_id,original.bill_month) '+
  'SELECT g.account_id,g.bill_month,g.amount_jpy,g.purchases,a.label,a.owner_user_id,'+
  'COALESCE(paid.settled_jpy,0) settled_jpy,COALESCE(offsets.points_offset_jpy,0) points_offset_jpy FROM gross g '+
  'JOIN family_financial_accounts a ON a.account_id=g.account_id '+
  'LEFT JOIN paid ON paid.account_id=g.account_id AND paid.bill_month=g.bill_month '+
  'LEFT JOIN offsets ON offsets.account_id=g.account_id AND offsets.bill_month=g.bill_month '+
  'WHERE a.household_id=? AND (g.amount_jpy>0 AND g.purchases>0 '+
  'OR COALESCE(paid.settled_jpy,0)>0 OR COALESCE(offsets.points_offset_jpy,0)>0) '+
  'ORDER BY g.bill_month DESC,g.account_id LIMIT 200':
  'WITH gross AS ('+common+') '+
  'SELECT g.account_id,g.bill_month,g.amount_jpy,g.purchases,a.label,a.owner_user_id,'+
  '0 settled_jpy,0 points_offset_jpy FROM gross g JOIN family_financial_accounts a ON a.account_id=g.account_id '+
  'WHERE a.household_id=? AND g.amount_jpy>0 AND g.purchases>0 ORDER BY g.bill_month DESC,g.account_id LIMIT 200';
 const commonArgs=hasCorrections?[household,household,...(hasOwnerCorrections?[household]:[])]:[household];
 const args=settlementEnabled?
  [...commonArgs,household,household,household,household]:[...commonArgs,household];
 const rows=(await db.prepare(sql).bind(...args).all()).results||[];
 const items=[];let total=0,totalCredit=0;
 for(const x of rows){
  const gross=safe(x.amount_jpy),settled=safe(x.settled_jpy),pointsOffset=safe(x.points_offset_jpy),count=safe(x.purchases);
  if(gross===null||settled===null||pointsOffset===null||count===null)return null;
  // Real bank payments and redeemed points remain CREDIT on their real
  // source card after a correction moves the purchase elsewhere. No fake
  // bank refund or points issuance. Positive liability and unapplied credit
  // are reported separately, so neither disappears from the balance sheet.
  const net=gross-settled-pointsOffset;
  const outstanding=Math.max(0,net),unappliedCredit=Math.max(0,-net);
  total+=outstanding;totalCredit+=unappliedCredit;
  if(!Number.isSafeInteger(total)||!Number.isSafeInteger(totalCredit))return null;
  items.push({account_id:x.account_id,account_label:x.label,owner_user_id:x.owner_user_id,
   closing_month:x.bill_month,gross_charges_jpy:gross,settled_jpy:settled,
   points_offset_jpy:pointsOffset,unapplied_card_credit_jpy:unappliedCredit,
   liability_jpy:outstanding,net_position_jpy:net,purchases:count,payment_due_date:null,
   settlement_status:!settlementEnabled?'not_reconciled':
    unappliedCredit>0?'unapplied_credit':
    outstanding===0?'settled':settled+pointsOffset>0?'partially_settled':'unsettled'});
 }
 return {items,total,total_unapplied_card_credit_jpy:totalCredit,
  net_card_position_jpy:total-totalCredit};
}
