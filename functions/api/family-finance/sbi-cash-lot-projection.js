// Cash-funded SBI lots, net of immutable approved FULL reversals.
// Never add to investment_holdings/NAV/tracked assets before broker reconciliation.
// A reversal never mutates the original lot. Read both journal sides without double valuation.
export async function memberSbiCashPositions(db,householdId){
 if(typeof householdId!=='string'||!householdId)return null;
 const r=(await db.prepare('SELECT l.securities_account_id,l.owner_user_id,'+
  'a.label AS account_label,l.fund_code,l.account_type,l.kind,'+
  'SUM(l.confirmed_units-COALESCE(rev.reversed_units,0)) AS confirmed_units,'+
  'SUM(l.acquisition_cost_jpy-COALESCE(rev.reversed_cost_jpy,0)) AS acquisition_cost_jpy,'+
  'COUNT(*) AS confirmed_trades,COUNT(rev.homeflow_request_id) AS reversed_trades,'+
  'MAX(l.effective_date) AS latest_effective_date '+
  'FROM family_sbi_cash_lots l LEFT JOIN family_sbi_cash_reversals rev '+
  'ON rev.original_request_id=l.homeflow_request_id AND rev.household_id=l.household_id '+
  'JOIN family_financial_accounts a ON a.account_id=l.securities_account_id '+
  'AND a.owner_user_id=l.owner_user_id AND a.household_id=l.household_id '+
  "AND a.account_kind='securities' "+
  'WHERE l.household_id=? GROUP BY l.securities_account_id,l.owner_user_id,'+
  'a.label,l.fund_code,l.account_type,l.kind ORDER BY l.securities_account_id,l.fund_code LIMIT 201')
  .bind(householdId).all()).results||[];
 if(r.length>200)return null;
 const positions=[];
 for(const x of r){
  if(!/^[a-f0-9]{32}$/i.test(x.securities_account_id||'')||
   !/^[A-Z0-9]{8}$/.test(x.fund_code||'')||
   !['growth','tsumitate'].includes(x.account_type)||!['tsumitate','additional'].includes(x.kind)||
   !Number.isSafeInteger(x.confirmed_units)||x.confirmed_units<0||
   !Number.isSafeInteger(x.acquisition_cost_jpy)||x.acquisition_cost_jpy<0||
   !Number.isSafeInteger(x.confirmed_trades)||x.confirmed_trades<1||
   !Number.isSafeInteger(x.reversed_trades)||x.reversed_trades<0||
   x.reversed_trades>x.confirmed_trades||
   (x.confirmed_units===0)!==(x.acquisition_cost_jpy===0)||
   typeof x.owner_user_id!=='string'||!x.owner_user_id)return null;
  positions.push({...x,market_value_jpy:null,broker_reconciled:false,
   included_in_tracked_assets_jpy:false,identity_basis:'member_created_stable_accounts',
   evidence_basis:'owner_confirmed_bank_statement_and_broker_execution',
   reconciliation_state:'not_reconciled',all_trades_reversed:x.reversed_trades===x.confirmed_trades});
 }
 return {positions,scope:'household',read_only:true,ledger_changed:false,
  total_cost_jpy:positions.reduce((v,p)=>v+p.acquisition_cost_jpy,0),
  included_in_legacy_investment_holdings:false,included_in_tracked_assets_jpy:false,
  note:'SBI现金买付减去经审批的不可变全额退款；旧截图/证券持仓未完成逐笔核对，不加入家庭资产估值。'};
}
