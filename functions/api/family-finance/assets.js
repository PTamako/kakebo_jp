// Stage C: household-facing read-only balances. Both HomeFlow members see
// identical totals; no owner filter is applied to family assets/statistics.
// Reuse the established prepaid and SBI valuation code (never duplicate its
// effective-date, rewards or reported NAV rounding rules).
// This route never changes the ledger, account configuration or R2 objects.
import {handlePrepaid} from '../prepaid-assets.js'
import {handlePortfolio} from '../investment-portfolio.js'
import {getCardBillSnapshots} from '../card-bill-snapshots.js'
import {verifiedFamilyAssetOwners} from './asset-owner-projection.js'

const reply=(body,status=200)=>Response.json(body,{status,headers:{
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'
}})
const validMonth=value=>typeof value==='string'&&/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(value)
const number=value=>Number.isSafeInteger(value)?value:null
function addSafe(values){
 let sum=0
 for(const value of values){
  if(!Number.isSafeInteger(value))return null
  sum+=value
  if(!Number.isSafeInteger(sum))return null
 }
 return sum
}
async function cachedJson(response){
 if(response.status!==200)return null
 try{return await response.json()}catch{return null}
}
export async function familyAssetSummary(env,url,user,request){
 const month=url.searchParams.get('month')||
  new Date(Date.now()+9*3600000).toISOString().slice(0,7)
 if(!validMonth(month))return reply({code:'INVALID_MONTH'},400)
 try{
  // Parallel READs use the exact same calculations as existing PWA pages.
  // In particular, an SBI plan is NOT an investment holding or an asset.
  const [prepaidResponse,portfolioResponse,bills]=await Promise.all([
   handlePrepaid({db:env.DB,request,method:'GET',sub:undefined}),
   handlePortfolio({db:env.DB,request,method:'GET',sub:undefined,url:
    new URL(url.origin+'/api/investment-portfolio?month='+month)}),
   getCardBillSnapshots(env.DB)
  ])
  const prepaid=await cachedJson(prepaidResponse)
  const portfolio=await cachedJson(portfolioResponse)
  if(!prepaid||!portfolio||!Array.isArray(prepaid.cards)||
    !Array.isArray(portfolio.holdings)||!portfolio.valuation)
   return reply({code:'ASSET_SOURCE_NOT_READY',ledger_changed:false},409)
  const cards=[]
  for(const item of prepaid.cards){
   const balance=number(item.balance)
   if(balance===null)return reply({code:'UNSAFE_BALANCE',ledger_changed:false},409)
   cards.push({name:item.name,kind:'prepaid',balance_jpy:balance,
    is_archived:item.is_archived===1,
    // The original source type name is global and can be duplicated by
    // a member's NEW account; never pretend it identifies both accounts.
    identity_basis:'legacy_payment_source'})
  }
  const holdings=[]
  for(const item of portfolio.holdings){
   const cost=number(item.acquisition_cost),value=item.market_value===null?null:number(item.market_value)
   if(cost===null||(item.market_value!==null&&value===null))
    return reply({code:'UNSAFE_HOLDING_VALUE',ledger_changed:false},409)
   holdings.push({fund_code:item.fund_code,account_type:item.account_type,
    fund_name:item.fund_name,acquisition_cost_jpy:cost,market_value_jpy:value,
    valuation_source:item.valuation_source})
  }
  const allValued=holdings.length>0&&holdings.every(x=>x.market_value_jpy!==null)
  const prepaidTotal=addSafe(cards.map(x=>x.balance_jpy))
  const sbiTotal=allValued?addSafe(holdings.map(x=>x.market_value_jpy)):null
  const knownAssets=addSafe([prepaidTotal,allValued?sbiTotal:0].filter(x=>x!==null))
  if(prepaidTotal===null||knownAssets===null||
    (allValued&&sbiTotal===null))
   return reply({code:'ASSET_SUM_OVERFLOW',ledger_changed:false},409)
  const items=[]
  for(const bill of bills){
   const snapshot=number(bill.total),current=number(bill.currentTotal)
   if(snapshot===null||current===null)
    return reply({code:'UNSAFE_CARD_BILL',ledger_changed:false},409)
   items.push({payment_source:bill.name,month:bill.month,
    snapshot_total_jpy:snapshot,current_total_jpy:current,
    stale:bill.stale})
  }
  const ownership=await verifiedFamilyAssetOwners(env.DB,user.household_id,{cards,holdings,bills:items})
  if(!ownership)return reply({code:'ASSET_IDENTITY_REVIEW_REQUIRED',ledger_changed:false},409)
  // Bills are liabilities/snapshots and must NOT be subtracted from asset
  // total here (they may already be reflected in prepaid funding transfers).
  // No bank/cash balance is available in the legacy D1; return a partial
  // tracked-total, NEVER label it net worth or complete family assets.
  return reply({ok:true,household_id:user.household_id,
   scope:'household',month,as_of_jst:
    new Date(Date.now()+9*3600000).toISOString().slice(0,10),
   prepaid:{cards:ownership.prepaid,total_jpy:prepaidTotal},
   securities:{holdings:ownership.securities,total_market_value_jpy:sbiTotal,
    missing_valuations:holdings.filter(x=>x.market_value_jpy===null).length,
    count:holdings.length},
   credit_card_bills:ownership.creditCardBills,
   ownership_verification:ownership.verification,
   tracked_assets_jpy:knownAssets,
   tracked_assets_complete:allValued||holdings.length===0,
   excluded_from_assets:['untracked_bank_cash_balances',
    'credit_card_bill_snapshots','unposted_member_accounts'],
   note:'仅为已跟踪储值卡余额与可确认的SBI持仓估值；无银行/现金实时余额，不能视为家庭总资产。',
   ledger_changed:false})
 }catch{return reply({code:'ASSET_READ_UNAVAILABLE',ledger_changed:false},503)}
}
