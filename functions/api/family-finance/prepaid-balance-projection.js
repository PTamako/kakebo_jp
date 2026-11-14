// New stable-account prepaid balances ONLY. Never map legacy payment-source
// names to these account IDs, never infer any pre-existing Suica balance.
// Result is household-shared (no current-viewer filter) but labels real owners.
export async function memberPrepaidBalances(db,household){
 if(typeof household!=='string'||!household)return null;
 const query='SELECT a.account_id,a.owner_user_id,a.label,a.version,'+
  'COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j '+
  'WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id),0) '+
  '+COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c '+
  'WHERE c.prepaid_account_id=a.account_id AND c.household_id=a.household_id),0) '+
  '-COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r '+
  'WHERE r.prepaid_account_id=a.account_id AND r.household_id=a.household_id),0) balance_jpy '+
  'FROM family_financial_accounts a WHERE a.household_id=? '+
  "AND a.account_kind='prepaid' AND a.origin='member_created' AND a.is_archived=0 "+
  'ORDER BY a.created_at DESC,a.account_id LIMIT 200';
 const rows=(await db.prepare(query).bind(household).all()).results||[];
 let total=0;
 const accounts=[];
 for(const row of rows){
  if(typeof row.account_id!=='string'||!/^[0-9a-f]{32}$/i.test(row.account_id)||
   typeof row.owner_user_id!=='string'||!row.owner_user_id||
   typeof row.label!=='string'||!row.label||
   !Number.isSafeInteger(row.version)||row.version<1||
   !Number.isSafeInteger(row.balance_jpy)||row.balance_jpy<0)return null;
  total+=row.balance_jpy;
  if(!Number.isSafeInteger(total))return null;
  accounts.push({account_id:row.account_id,owner_user_id:row.owner_user_id,
   account_label:row.label,account_version:row.version,balance_jpy:row.balance_jpy,
   identity_basis:'member_created_stable_id'});
 }
 return {accounts,total_jpy:total,scope:'household',ledger_changed:false};
}
