// Stage C: owner-only, bounded read-only reconciliation of old payment
// source names with verified stable financial account IDs. Never infer a
// member owner from a display label and NEVER rewrite legacy entries.
const json=(body,status=200)=>Response.json(body,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}})
const read=(db,sql,...args)=>db.prepare(sql).bind(...args).all()
export async function auditLegacyFinanceMappings(request,env,user){
 if(request.method!=='GET')return json({code:'METHOD_NOT_ALLOWED'},405)
 if(user.role!=='owner')return json({code:'OWNER_REQUIRED'},403)
 const db=env.DB
 const linked=await db.prepare(
  "SELECT user_id FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='owner' AND state='active'"
 ).bind(user.user_id,user.household_id).first()
 if(!linked)return json({code:'OWNER_LINK_NOT_VERIFIED'},403)
 // Group in D1; never download all rows or private OCR content.
 const [accounts,oldSources,payments,transfers,linkedEntries,linkedLegacy]=await Promise.all([
  read(db,"SELECT account_id,legacy_source_name,owner_user_id,household_id "+
    "FROM family_financial_accounts WHERE origin='legacy' "+
    "AND legacy_source_name IS NOT NULL ORDER BY legacy_source_name LIMIT 301"),
  read(db,"SELECT name FROM payment_sources ORDER BY name LIMIT 301"),
  read(db,"SELECT payment_source AS legacy_name,COUNT(*) AS row_count "+
    "FROM entries WHERE family_account_id IS NULL AND payment_source IS NOT NULL "+
    "AND trim(payment_source)<>'' GROUP BY payment_source ORDER BY legacy_name LIMIT 301"),
  read(db,"SELECT transfer_target AS legacy_name,COUNT(*) AS row_count "+
    "FROM entries WHERE family_account_id IS NULL AND type='transfer' "+
    "AND transfer_target IS NOT NULL AND trim(transfer_target)<>'' "+
    "GROUP BY transfer_target ORDER BY legacy_name LIMIT 301"),
  db.prepare("SELECT COUNT(*) AS n FROM entries WHERE family_account_id IS NOT NULL").first(),
  read(db,"SELECT a.legacy_source_name AS legacy_name,COUNT(*) AS row_count "+
   "FROM entries e JOIN family_financial_accounts a ON a.account_id=e.family_account_id "+
   "AND a.origin='legacy' AND a.owner_user_id=? AND a.household_id=? "+
   "AND e.payment_source=a.legacy_source_name "+
   "WHERE e.type IN ('income','expense') "+
   "GROUP BY a.legacy_source_name ORDER BY legacy_name LIMIT 301",
   user.user_id,user.household_id)
 ])
 const collections=[accounts.results||[],oldSources.results||[],
  payments.results||[],transfers.results||[],linkedLegacy.results||[]]
 if(collections.some(x=>x.length>300))
  return json({code:'LEGACY_SOURCE_COUNT_REVIEW_REQUIRED',ledger_changed:false},409)
 const [adopted,original,pays,dests,linked]=collections
 if(adopted.some(x=>x.owner_user_id!==user.user_id||x.household_id!==user.household_id))
  return json({code:'LEGACY_ACCOUNT_OWNER_CONFLICT',ledger_changed:false},409)
 const sourceSet=new Set(original.map(x=>x.name))
 const matching=new Map(adopted.map(x=>[x.legacy_source_name,x]))
 if(sourceSet.size!==original.length||matching.size!==adopted.length||
    adopted.some(x=>!sourceSet.has(x.legacy_source_name)))
  return json({code:'LEGACY_NAME_AMBIGUOUS',ledger_changed:false},409)
 const paymentCounts=new Map(pays.map(x=>[x.legacy_name,Number(x.row_count)]))
 const transferCounts=new Map(dests.map(x=>[x.legacy_name,Number(x.row_count)]))
 const linkedCounts=new Map(linked.map(x=>[x.legacy_name,Number(x.row_count)]))
 const names=[...new Set([...sourceSet,...paymentCounts.keys(),...transferCounts.keys()])].sort()
 if(names.length>300||names.some(n=>typeof n!=='string'||!n.trim()||n.length>240))
  return json({code:'LEGACY_NAME_REVIEW_REQUIRED',ledger_changed:false},409)
 if([...pays,...dests,...linked].some(x=>!Number.isSafeInteger(Number(x.row_count))||
   Number(x.row_count)<0)||
   !Number.isSafeInteger(Number(linkedEntries?.n))||Number(linkedEntries.n)<0)
  return json({code:'LEGACY_COUNTS_INVALID',ledger_changed:false},409)
 const items=names.map(name=>{
  const account=matching.get(name)
  const exists=sourceSet.has(name)
  const status=!exists?'historical_source_missing':
    account?'adopted_to_original_owner':'legacy_account_not_adopted'
  return {
   legacy_name:name,
   entry_source_count:paymentCounts.get(name)||0,
   linked_entry_count:linkedCounts.get(name)||0,
   transfer_target_count:transferCounts.get(name)||0,
   stable_account_id:exists&&account?account.account_id:null,
   status
  }
 })
 const unresolved=items.filter(x=>x.status!=='adopted_to_original_owner')
 return json({ok:true,read_only:true,household_id:user.household_id,
  ledger_changed:false,
  mapped_source_count:items.length-unresolved.length,
  unresolved_source_count:unresolved.length,
  previously_linked_entries:Number(linkedEntries.n),
  linked_legacy_entry_count:items.reduce((sum,x)=>sum+x.linked_entry_count,0),
  remaining_legacy_entry_count:items.reduce((sum,x)=>sum+x.entry_source_count,0),
  requires_manual_review:unresolved.length>0,
  items})
}
