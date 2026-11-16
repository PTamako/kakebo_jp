// Read-only adapter: the original SBI view consumes the same presentation
// contract for both identities, but member data must come only from the
// authenticated member endpoints. Never mirror legacy owner holdings/NAV.
const month=/^20\d\d-(0[1-9]|1[0-2])$/
const safeMoney=n=>Number.isSafeInteger(Number(n))&&Number(n)>=0
export function memberInvestmentSnapshot({userId,requestedMonth,plans=[],occurrences=[]}){
 if(!userId||!month.test(requestedMonth))throw Error('MEMBER_INVESTMENT_SCOPE_INVALID')
 if(!Array.isArray(plans)||!Array.isArray(occurrences))throw Error('MEMBER_INVESTMENT_SOURCE_INVALID')
 const own=plans.filter(p=>p&&p.owner_user_id===userId&&p.plan_type==='sbi_tsumitate'&&
   /^[A-Z0-9]{8}$/.test(p.fund_code||'')&&safeMoney(p.amount_jpy)&&
   /^20\d\d-(0[1-9]|1[0-2])$/.test(p.start_month||'')&&
   /^20\d\d-(0[1-9]|1[0-2])$/.test(p.end_month||''))
 const normalized=own.map(p=>({
  fund_code:p.fund_code,fund_name:p.fund_name,
  account_type:p.account_type==='growth'?'growth':'tsumitate',
  monthly_amount:Number(p.amount_jpy),order_day:Number(p.due_day)||1,
  enabled:p.state==='active'&&p.start_month<=requestedMonth&&p.end_month>=requestedMonth,
  plan_resource_id:p.plan_resource_id,status:p.state,
  start_month:p.start_month,end_month:p.end_month,
  source_account_id:p.source_bank_account_id,
  securities_account_id:p.securities_account_id
 }))
 // Only a server-confirmed applied occurrence is an executed internal entry.
 // This number is NOT a claim that the bank or broker independently verified it.
 const applied=occurrences.filter(o=>o&&o.owner_user_id===userId&&
  o.plan_type==='sbi_tsumitate'&&o.period_key===requestedMonth&&
  (o.applied===true||o.ledger_applied===true||o.status==='applied')&&
  safeMoney(o.amount_jpy))
 const appliedIds=new Set()
 const confirmed=applied.reduce((sum,o)=>{
  if(!o.occurrence_id||appliedIds.has(o.occurrence_id))return sum
  appliedIds.add(o.occurrence_id)
  return sum+Number(o.amount_jpy)
 },0)
 const scheduled=normalized.filter(p=>p.enabled).reduce((sum,p)=>sum+p.monthly_amount,0)
 return {
  month:requestedMonth,scope:'personal',viewer_user_id:userId,
  institution_verified:false,holdings:[],prices:[],plans:normalized,transfers:[],
  valuation:{value:null,pnl:null},
  reconciliation:{
   monthly_amount:scheduled,registered:confirmed,
   unregistered:Math.max(0,scheduled-confirmed),
   planned_difference:Math.max(0,confirmed-scheduled),
   funded:confirmed,pending:0,member_internal_only:true
  }
 }
}
