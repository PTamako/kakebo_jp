// Original PrepaidAssets presentation, member-owned underlying accounts.
// No legacy payment_source names, no owner R2/receipts, no unverified bank data.
const response=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}})
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
export async function familyPrepaidReport(env,user){
 if(!env.DB||!user?.user_id||!user?.household_id)
  return response({ok:false,code:'IDENTITY_REQUIRED'},403)
 const db=env.DB,month=today().slice(0,7)+'-01'
 try{
  const q=await db.prepare('SELECT a.account_id,a.label,a.opening_balance,a.version,a.is_archived,a.created_at,'+
   'COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id),0) journal,'+
   'COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=a.account_id AND t.household_id=a.household_id),0) direct_topups,'+
   'COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id AND j.effective_date>=? AND j.delta_jpy>0),0) charged_month,'+
   'COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=a.account_id AND t.household_id=a.household_id AND t.effective_date>=?),0) direct_charged_month,'+
   'COALESCE((SELECT SUM(-j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=a.account_id AND j.household_id=a.household_id AND j.effective_date>=? AND j.delta_jpy<0),0) spent_month,'+
   'COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c WHERE c.prepaid_account_id=a.account_id AND c.household_id=a.household_id),0) points_credit,'+
   'COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r WHERE r.prepaid_account_id=a.account_id AND r.household_id=a.household_id),0) points_refund '+
   'FROM family_financial_accounts a WHERE a.household_id=? AND a.owner_user_id=? '+
   "AND a.account_kind='prepaid' AND a.origin='member_created' AND a.is_archived=0 "+
   'ORDER BY a.sort_order,a.created_at DESC LIMIT 101')
   .bind(month,month,month,user.household_id,user.user_id).all()
  const rows=q.results||[]
  if(rows.length>100)return response({ok:false,code:'ACCOUNT_LIMIT'},409)
  const cards=[]
  for(const a of rows){
   if(!/^[a-f0-9]{32}$/i.test(a.account_id)||typeof a.label!=='string'||
    ![a.opening_balance,a.journal,a.direct_topups,a.direct_charged_month,a.charged_month,a.spent_month,a.points_credit,a.points_refund]
      .every(Number.isSafeInteger))return response({ok:false,code:'INVALID_WALLET_BALANCE'},409)
   const balance=a.opening_balance+a.journal+a.direct_topups+a.points_credit-a.points_refund
   if(!Number.isSafeInteger(balance)||balance<0)return response({ok:false,code:'BALANCE_NEEDS_REVIEW'},409)
   cards.push({name:a.label,account_id:a.account_id,version:a.version,
    is_archived:!!a.is_archived,opening_balance:a.opening_balance,
    opening_date:String(a.created_at||'').slice(0,10)||'登録時',
    balance,charged_month:a.charged_month+a.direct_charged_month,spent_month:a.spent_month,
    transferred_out_month:0,earned_month:0,tracked_only:true})
  }
  const journal=await db.prepare('SELECT j.effective_date,j.delta_jpy,a.label '+
   'FROM family_prepaid_balance_journal j JOIN family_financial_accounts a '+
   'ON a.account_id=j.prepaid_account_id AND a.household_id=j.household_id '+
   'WHERE j.household_id=? AND a.owner_user_id=? AND a.account_kind=\'prepaid\' '+
   'ORDER BY j.effective_date DESC,j.created_at DESC LIMIT 100')
   .bind(user.household_id,user.user_id).all()
  const recentDirect=(await db.prepare('SELECT t.effective_date,t.amount_jpy AS delta_jpy,a.label,t.created_at FROM family_member_prepaid_topups t JOIN family_financial_accounts a ON a.account_id=t.prepaid_account_id WHERE t.household_id=? AND t.owner_user_id=? ORDER BY t.created_at DESC LIMIT 100').bind(user.household_id,user.user_id).all()).results||[]
  const acts=[...(journal.results||[]).map(r=>({...r,created_at:0})),...recentDirect].sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||b.created_at-a.created_at)
  const latest=(sign)=>{const j=acts.find(x=>sign>0?x.delta_jpy>0:x.delta_jpy<0)
   return j?{card:j.label,merchant:'',amount:Math.abs(j.delta_jpy),date:j.effective_date}:null}
  return response({ok:true,scope:'personal',owner_user_id:user.user_id,cards,
   latestUsage:latest(-1),latestCharge:latest(1),institution_verified:false,ledger_changed:false})
 }catch{return response({ok:false,code:'PERSONAL_PREPAID_REPORT_UNAVAILABLE'},503)}
}
