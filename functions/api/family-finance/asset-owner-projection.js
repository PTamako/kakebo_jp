// Household-wide asset provenance is read-only: every displayed legacy owner
// must be proven by a same-household immutable ownership row. Never infer
// ownership from a payment-source label, a nickname or an app session.
const eligibleId=/^[a-f0-9]{32}$/i
const safeKey=v=>typeof v==='string'&&v.length>=1&&v.length<=240
const results=async (db,sql,args)=>args.length?(await db.prepare(sql).bind(...args).all()).results||[]:[]
const placeholders=n=>Array(n).fill('?').join(',')
function unique(values){return [...new Set(values)]}
function proven(account,kind){
 return account&&account.account_kind===kind&&eligibleId.test(account.account_id)&&
  typeof account.owner_user_id==='string'&&account.owner_user_id.length>0
}
export async function verifiedFamilyAssetOwners(db,householdId,{cards,holdings,bills}){
 if(typeof householdId!=='string'||!householdId||
  !Array.isArray(cards)||!Array.isArray(holdings)||!Array.isArray(bills))return null
 const names=unique([...cards.map(x=>x.name),...bills.map(x=>x.payment_source)])
 const holdingKeys=unique(holdings.map(x=>x.fund_code+':'+x.account_type))
 const billKeys=unique(bills.map(x=>x.payment_source+':'+x.month))
 if(names.length>300||holdingKeys.length>300||billKeys.length>300||
  [...names,...holdingKeys,...billKeys].some(k=>!safeKey(k)))return null
 const [legacy,holdingOwners,billOwners]=await Promise.all([
  names.length?results(db,
   "SELECT account_id,legacy_source_name,owner_user_id,account_kind FROM family_financial_accounts "+
   "WHERE household_id=? AND origin='legacy' AND legacy_source_name IN ("+placeholders(names.length)+")",
   [householdId,...names]):[],
  holdingKeys.length?results(db,
   "SELECT legacy_key,owner_user_id FROM family_financial_resource_owners "+
   "WHERE household_id=? AND resource_kind='investment_holding' "+
   "AND legacy_key IN ("+placeholders(holdingKeys.length)+")",
   [householdId,...holdingKeys]):[],
  billKeys.length?results(db,
   "SELECT legacy_key,owner_user_id FROM family_financial_resource_owners "+
   "WHERE household_id=? AND resource_kind='card_bill' "+
   "AND legacy_key IN ("+placeholders(billKeys.length)+")",
   [householdId,...billKeys]):[]
 ])
 // A broken or duplicate ownership mapping fails closed, rather than
 // exposing an arbitrary member as the verified owner of an asset.
 const accountMap=new Map(),holdingMap=new Map(),billMap=new Map()
 for(const a of legacy){
  if(!names.includes(a.legacy_source_name)||accountMap.has(a.legacy_source_name))return null
  accountMap.set(a.legacy_source_name,a)
 }
 for(const r of holdingOwners){
  if(!holdingKeys.includes(r.legacy_key)||holdingMap.has(r.legacy_key))return null
  holdingMap.set(r.legacy_key,r)
 }
 for(const r of billOwners){
  if(!billKeys.includes(r.legacy_key)||billMap.has(r.legacy_key))return null
  billMap.set(r.legacy_key,r)
 }
 const verified=(entry,accountId,owner)=>({...entry,
  account_id:accountId||null,owner_user_id:owner||null,
  identity_status:owner?'verified_legacy':'unverified'})
 const prepaid=cards.map(c=>{
  const a=accountMap.get(c.name)
  return verified(c,proven(a,'prepaid')?a.account_id:null,
   proven(a,'prepaid')?a.owner_user_id:null)
 })
 const securities=holdings.map(h=>{
  const receipt=holdingMap.get(h.fund_code+':'+h.account_type)
  return verified(h,null,typeof receipt?.owner_user_id==='string'&&
   receipt.owner_user_id?receipt.owner_user_id:null)
 })
 const creditCardBills=bills.map(b=>{
  const account=accountMap.get(b.payment_source)
  const receipt=billMap.get(b.payment_source+':'+b.month)
  const owner=proven(account,'credit_card')&&
   receipt?.owner_user_id===account.owner_user_id?account.owner_user_id:null
  return verified(b,owner?account.account_id:null,owner)
 })
 const count=arr=>arr.filter(x=>x.identity_status==='verified_legacy').length
 return {prepaid,securities,creditCardBills,
  verification:{prepaid_verified:count(prepaid),prepaid_unverified:prepaid.length-count(prepaid),
   holdings_verified:count(securities),holdings_unverified:securities.length-count(securities),
   card_bills_verified:count(creditCardBills),
   card_bills_unverified:creditCardBills.length-count(creditCardBills),
   proof:'immutable_legacy_owner_mapping',read_only:true}}
}
