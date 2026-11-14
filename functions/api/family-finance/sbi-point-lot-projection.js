// Read-only distinct owner-created SBI point-funded lots.
// These are user-ATTESTED broker confirmations, not an external brokerage API.
// Legacy investment_holdings, NISA plans, old screenshot positions and market
// NAV are deliberately NEVER added to these units or acquisition cost.
// Until manual broker-position reconciliation, keep their JPY cost out of
// tracked household asset market value to prevent duplicate legacy counting.
export async function memberSbiPointPositions(db,householdId){
 if(typeof householdId!=='string'||!householdId)return null;
 const result=await db.prepare('SELECT l.securities_account_id,l.owner_user_id,'+
  'a.label AS account_label,l.fund_code,l.account_type,'+
  'SUM(l.confirmed_units) AS confirmed_units,'+
  'SUM(l.acquisition_cost_jpy) AS acquisition_cost_jpy,'+
  'COUNT(*) AS executed_trade_count,MAX(l.trade_date) AS latest_trade_date '+
  'FROM family_sbi_point_lots l JOIN family_financial_accounts a '+
  'ON a.account_id=l.securities_account_id AND a.household_id=l.household_id '+
  "AND a.owner_user_id=l.owner_user_id AND a.account_kind='securities' "+
  'WHERE l.household_id=? GROUP BY l.securities_account_id,l.owner_user_id,'+
  'a.label,l.fund_code,l.account_type ORDER BY l.securities_account_id,'+
  'l.fund_code,l.account_type LIMIT 201').bind(householdId).all();
 const rows=result.results||[];
 if(rows.length>200)return null;
 const positions=[];
 for(const r of rows){
  if(!/^[a-f0-9]{32}$/i.test(r.securities_account_id||'')||
   !/^[A-Z0-9]{8}$/.test(r.fund_code||'')||
   !['growth','tsumitate'].includes(r.account_type)||
   !Number.isSafeInteger(r.confirmed_units)||r.confirmed_units<1||
   !Number.isSafeInteger(r.acquisition_cost_jpy)||r.acquisition_cost_jpy<1||
   !Number.isSafeInteger(r.executed_trade_count)||r.executed_trade_count<1||
   typeof r.account_label!=='string'||!r.account_label||
   typeof r.owner_user_id!=='string'||!r.owner_user_id||
   !/^20\d\d-\d\d-\d\d$/.test(r.latest_trade_date||''))return null;
  positions.push({securities_account_id:r.securities_account_id,
   owner_user_id:r.owner_user_id,account_label:r.account_label,
   fund_code:r.fund_code,account_type:r.account_type,
   confirmed_units:r.confirmed_units,acquisition_cost_jpy:r.acquisition_cost_jpy,
   executed_trade_count:r.executed_trade_count,
   latest_trade_date:r.latest_trade_date,market_value_jpy:null,
   identity_basis:'owner_created_stable_securities_account',
   evidence_basis:'user_attested_broker_execution',broker_reconciled:false});
 }
 return {positions,scope:'household',read_only:true,ledger_changed:false,
  total_acquisition_cost_jpy:positions.reduce((n,p)=>n+p.acquisition_cost_jpy,0),
  included_in_legacy_investment_holdings:false,
  included_in_tracked_assets_jpy:false,
  note:'SBI积分买付：已确认的内部基金份额/取得成本独立流水，未与旧截图持仓核对，不加入旧持仓及家庭资产估值以防重复；不是券商下单。'};
}
