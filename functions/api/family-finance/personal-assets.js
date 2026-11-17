// Personal balances read model. The legacy account is kept on the original
// owner-only API; member-created accounts must never inherit its source names.
// No amounts are guessed for cash/bank accounts without a verified ledger.
import {memberPrepaidBalances} from './prepaid-balance-projection.js';
import {memberPointsBalances} from './points-balance-projection.js';
import {memberCardLiabilities} from './card-settlement-summary.js';
import {memberSbiCashPositions} from './sbi-cash-lot-projection.js';

const json=(data,status=200)=>Response.json(data,{status,headers:{
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'
}});
const validId=x=>typeof x==='string'&&/^[a-f0-9]{32}$/i.test(x);
const money=n=>Number.isSafeInteger(n)&&n>=0;
export async function familyPersonalAssets(env,user){
 if(!user?.household_id||!user?.user_id)return json({code:'IDENTITY_REQUIRED'},401);
 try{
  const db=env.DB;
  // First authorize the account objects using the verified user identity.
  const result=await db.prepare(
   'SELECT account_id,account_kind,label,origin,opening_balance,is_archived,version '+
   'FROM family_financial_accounts WHERE household_id=? AND owner_user_id=? '+
   'ORDER BY is_archived,sort_order,account_id LIMIT 101')
   .bind(user.household_id,user.user_id).all();
  const rows=result.results||[];
  if(rows.length>100)return json({code:'ACCOUNT_LIMIT_REVIEW_REQUIRED'},409);
  if(rows.some(a=>!validId(a.account_id)||!money(a.opening_balance)||
    !['credit_card','prepaid','cash','bank','points','securities','other'].includes(a.account_kind)))
   return json({code:'ACCOUNT_DATA_REVIEW_REQUIRED'},409);
  // Do not ask for shared legacy asset snapshots. They contain the owner's
  // personal cards and SBI holdings and must not be accessible to members.
  const [prepaid,points,liabilities,sbi]=await Promise.all([
   env.KAKEIBO_PREPAID_ACTIONS_ENABLED==='true'
    ?memberPrepaidBalances(db,user.household_id):Promise.resolve({accounts:[]}),
   env.KAKEIBO_POINTS_ACTIONS_ENABLED==='true'
    ?memberPointsBalances(db,user.household_id):Promise.resolve({accounts:[]}),
   env.KAKEIBO_CARD_PURCHASES_ENABLED==='true'
    ?memberCardLiabilities(db,user.household_id,true)
    :Promise.resolve({items:[]}),
   env.KAKEIBO_SBI_CASH_ENABLED==='true'
    ?memberSbiCashPositions(db,user.household_id):Promise.resolve({positions:[]})
  ]);
  if(!prepaid||!points||!liabilities||!sbi)
   return json({code:'ASSET_PROJECTION_FAILED'},503);
  // ID-based intersection, not display-name matching.
  const own=new Set(rows.map(a=>a.account_id));
  const personalPrepaid=prepaid.accounts.filter(a=>own.has(a.account_id)&&
   a.owner_user_id===user.user_id);
  const personalPoints=points.accounts.filter(a=>own.has(a.account_id)&&
   a.owner_user_id===user.user_id);
  const personalLiabilities=liabilities.items.filter(a=>own.has(a.account_id)&&
   a.owner_user_id===user.user_id);
  const personalSbi=sbi.positions.filter(a=>own.has(a.securities_account_id)&&
   a.owner_user_id===user.user_id);
  const accountRows=rows.map(a=>{
   const prepaidAccount=personalPrepaid.find(b=>b.account_id===a.account_id);
   const pointAccount=personalPoints.find(b=>b.account_id===a.account_id);
   const bills=personalLiabilities.filter(b=>b.account_id===a.account_id);
   const lots=personalSbi.filter(b=>b.securities_account_id===a.account_id);
   // Unreconciled opening balances do not equal actual bank/cash balances.
   return {account_id:a.account_id,account_kind:a.account_kind,
    label:a.label,origin:a.origin,is_archived:!!a.is_archived,
    version:a.version,opening_balance_jpy:a.opening_balance,
    balance_jpy:prepaidAccount?.balance_jpy??null,
    balance_units:pointAccount?.balance_units??null,
    credit_liability_jpy:a.account_kind==='credit_card'
     ?bills.reduce((sum,b)=>sum+b.liability_jpy,0):null,
    // A real settlement/points offset on an original card may exceed the
    // corrected card charge. Expose the unapplied asset credit separately;
    // no fabricated bank/points refunds or spouse-private card access.
    unapplied_card_credit_jpy:a.account_kind==='credit_card'
     ?bills.reduce((sum,b)=>sum+(b.unapplied_card_credit_jpy||0),0):null,
    sbi_confirmed_cost_jpy:a.account_kind==='securities'
     ?lots.reduce((sum,l)=>sum+l.acquisition_cost_jpy,0):null,
    sbi_market_value_jpy:null,
    balance_verified:a.account_kind==='prepaid'&&!!prepaidAccount,
    balance_note:['bank','cash','other'].includes(a.account_kind)
     ?'未提供银行或现金实时余额，不使用期初值冒充现有余额'
     :a.account_kind==='securities'?'券商市值未核对，仅显示已登记成本':null};
  });
  if(accountRows.some(a=>(a.balance_jpy!==null&&!money(a.balance_jpy))||
      (a.credit_liability_jpy!==null&&!money(a.credit_liability_jpy))||
      (a.unapplied_card_credit_jpy!==null&&!money(a.unapplied_card_credit_jpy))||
      (a.sbi_confirmed_cost_jpy!==null&&!money(a.sbi_confirmed_cost_jpy))))
   return json({code:'UNSAFE_PERSONAL_BALANCE'},409);
  return json({ok:true,scope:'personal',viewer_user_id:user.user_id,
   household_id:user.household_id,accounts:accountRows,
   read_only:true,as_of:new Date().toISOString(),ledger_changed:false});
 }catch{
  return json({code:'PERSONAL_ASSETS_UNAVAILABLE'},503);
 }
}
