// Read-only household projection of NEW stable point-account unit balances.
// Points from unrelated rewards programs cannot be added as if they were JPY.
// Legacy point income/automatic transfers remain in old entries; reviewed
// legacy links are EVIDENCE ONLY and never cause additional unit issuance.
export async function memberPointsBalances(db,householdId){
 if(typeof householdId!=='string'||!householdId)return null;
 const query='SELECT a.account_id,a.owner_user_id,a.label,a.version,'+
  'COALESCE((SELECT SUM(j.delta_units) FROM family_points_journal j '+
  'WHERE j.points_account_id=a.account_id AND j.household_id=a.household_id),0) '+
  '+COALESCE((SELECT SUM(c.target_units) FROM family_points_transfer_credits c '+
  'WHERE c.target_account_id=a.account_id AND c.household_id=a.household_id),0) AS balance_units,'+
  '(SELECT COUNT(*) FROM family_points_legacy_links l '+
  'WHERE l.household_id=a.household_id AND l.points_account_id=a.account_id) AS legacy_reviewed_count '+
  'FROM family_financial_accounts a '+
  'WHERE a.household_id=? AND a.account_kind=\'points\' '+
  'AND a.origin=\'member_created\' AND a.is_archived=0 '+
  'GROUP BY a.account_id,a.owner_user_id,a.label,a.version,a.household_id '+
  'ORDER BY a.created_at DESC,a.account_id LIMIT 200';
 const rows=(await db.prepare(query).bind(householdId).all()).results||[];
 const accounts=[];
 for(const row of rows){
  if(!/^[0-9a-f]{32}$/i.test(row.account_id||'')||
   typeof row.owner_user_id!=='string'||!row.owner_user_id||
   typeof row.label!=='string'||!row.label||
   !Number.isSafeInteger(row.version)||row.version<1||
   !Number.isSafeInteger(row.balance_units)||row.balance_units<0||
   !Number.isSafeInteger(row.legacy_reviewed_count)||row.legacy_reviewed_count<0)return null;
  accounts.push({account_id:row.account_id,owner_user_id:row.owner_user_id,
   account_label:row.label,account_version:row.version,
   balance_units:row.balance_units,legacy_reviewed_count:row.legacy_reviewed_count,
   unit:'program_specific_points',valuation_jpy:null,
   identity_basis:'member_created_stable_id'});
 }
 return {accounts,scope:'household',ledger_changed:false,
  monetary_total_jpy:null,included_in_tracked_assets:false,
  note:'积分数量不是日元，未核实兑换比例及全部余额前不计入已跟踪资产；旧积分历史仍使用原记录。'};
}
