// Stage C: read-only, bounded, immutable ownership projection for legacy
// fixed-fee / SBI plans. A legacy plan key is NOT a new financial account ID.
// This endpoint must never grant write permission to a spouse or mutate plans.
const reply=(data,status=200)=>Response.json(data,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}})
const specs=Object.freeze({
 recurring_plan:{
  sql:"SELECT id AS legacy_key,name AS label FROM recurring_plans WHERE id>? ORDER BY id LIMIT ?"
 },
 investment_plan:{
  sql:"SELECT fund_code||':'||account_type AS legacy_key,fund_name AS label FROM investment_plans WHERE (fund_code||':'||account_type)>? ORDER BY legacy_key LIMIT ?"
 },
 investment_plan_history:{
  sql:"SELECT fund_code||':'||account_type||':'||effective_month AS legacy_key,fund_name AS label FROM investment_plan_history WHERE (fund_code||':'||account_type||':'||effective_month)>? ORDER BY legacy_key LIMIT ?"
 }
})
const safeCursor=s=>typeof s==='string'&&s.length<=240&&!/[\u0000-\u001f]/.test(s)
const safeValue=s=>typeof s==='string'&&s.length>0&&s.length<=240&&!/[\u0000-\u001f]/.test(s)
export async function familyPlanOwnership(env,url,user){
 const kind=url.searchParams.get('kind')||'recurring_plan'
 const cursor=url.searchParams.get('after')||''
 const limitRaw=url.searchParams.get('limit')||'20'
 if(!Object.hasOwn(specs,kind)||!safeCursor(cursor)||
  !/^[1-9][0-9]?$/.test(limitRaw)||Number(limitRaw)>30)
  return reply({code:'INVALID_PLAN_QUERY',ledger_changed:false},400)
 const limit=Number(limitRaw),db=env.DB
 try{
  // Every query is index/keyset-bounded; never scan all plans on an iPhone.
  const source=(await db.prepare(specs[kind].sql).bind(cursor,limit+1).all()).results||[]
  const batch=source.slice(0,limit)
  if(batch.some(x=>!safeValue(x.legacy_key)||!safeValue(x.label))||
   new Set(batch.map(x=>x.legacy_key)).size!==batch.length)
   return reply({code:'PLAN_SOURCE_REVIEW_REQUIRED',ledger_changed:false},409)
  const keys=batch.map(x=>x.legacy_key)
  const proofs=keys.length?(await db.prepare(
   'SELECT o.legacy_key,o.owner_user_id FROM family_financial_resource_owners o '+
   'JOIN homeflow_identity_links l ON l.user_id=o.owner_user_id '+
   "AND l.household_id=o.household_id AND l.role='owner' "+
   "WHERE o.origin='legacy' AND o.household_id=? AND o.resource_kind=? "+
   'AND o.legacy_key IN ('+keys.map(()=>'?').join(',')+')'
  ).bind(user.household_id,kind,...keys).all()).results||[]:[]
  const proofMap=new Map()
  for(const proof of proofs){
   if(!keys.includes(proof.legacy_key)||proofMap.has(proof.legacy_key)||
    !safeValue(proof.owner_user_id))
    return reply({code:'PLAN_OWNER_PROOF_CONFLICT',ledger_changed:false},409)
   proofMap.set(proof.legacy_key,proof.owner_user_id)
  }
  const items=batch.map(x=>({
   legacy_key:x.legacy_key,label:x.label,
   owner_user_id:proofMap.get(x.legacy_key)||null,
   identity_status:proofMap.has(x.legacy_key)?'verified_legacy':'unverified'
  }))
  return reply({ok:true,scope:'household',household_id:user.household_id,
   kind,items,next_cursor:source.length>limit?items.at(-1).legacy_key:null,
   ownership_proof:'immutable_legacy_resource_owner',
   read_only:true,ledger_changed:false})
 }catch{return reply({code:'PLAN_OWNER_READ_UNAVAILABLE',ledger_changed:false},503)}
}
