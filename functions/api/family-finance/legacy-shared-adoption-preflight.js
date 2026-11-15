// Stage C read-only preflight for historical ordinary entries. Never write a
// family_shared_entry_registry row using an old hfshare: ID; the old lifecycle
// triggers intentionally require a NEW entry created by the current owner.
// A separate reviewed migration is required to retain original entry/attachment.
const json=(data,status=200)=>Response.json(data,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer'}});
const fail=(code,status=409)=>json({ok:false,code,adopted:false},status);
const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const snapshot=row=>JSON.stringify([
 row.id,row.date,row.time,row.amount,row.type,row.category,row.merchant,row.note,
 row.raw,row.payment_source,row.client_request_id,row.family_account_id,
 row.family_transfer_target_account_id,row.created_at,row.actor_user_id,row.account_id,
 row.original_source,row.source_digest
]);
export async function legacySharedAdoptionPreflight(request,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED!=='true'||!env.DB?.prepare)
  return fail('LEGACY_SHARED_PREFLIGHT_DISABLED',503);
 if(request.method!=='GET')return fail('READ_ONLY_PREFLIGHT',405);
 const who=await env.DB.prepare('SELECT role,state FROM homeflow_identity_links '+
  'WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(user.user_id,user.household_id).first();
 if(user.role!=='owner'||who?.role!=='owner'||who?.state!=='active')
  return fail('LEGACY_SHARED_ORIGINAL_OWNER_REQUIRED',403);
 const raw=url.searchParams.get('after_id')||'0';
 if(!/^(0|[1-9][0-9]{0,11})$/.test(raw)||!Number.isSafeInteger(Number(raw)))
  return fail('LEGACY_SHARED_PREFLIGHT_CURSOR_INVALID',400);
 // No fuzzy matching by merchant, year or historical payment-source label:
 // only original immutable owner confirmation in 002x legacy link journal.
 const rows=(await env.DB.prepare(
  'SELECT e.id,e.date,e.time,e.amount,e.type,e.category,e.merchant,e.note,'+
  'e.raw,e.payment_source,e.client_request_id,e.family_account_id,'+
  'e.family_transfer_target_account_id,e.created_at,'+
  'l.actor_user_id,l.account_id,l.original_source,l.source_digest,'+
  'a.owner_user_id AS account_owner,a.household_id AS account_household,'+
  'a.is_archived AS account_archived,'+
  '(SELECT COUNT(*) FROM receipt_r2_state rs WHERE rs.entry_id=e.id) AS r2_rows,'+
  '(SELECT COUNT(*) FROM family_shared_entry_registry r WHERE r.entry_id=e.id) AS registered '+
  'FROM family_finance_legacy_entry_links l '+
  'JOIN entries e ON e.id=l.entry_id '+
  'LEFT JOIN family_financial_accounts a ON a.account_id=l.account_id '+
  'WHERE l.household_id=? AND l.actor_user_id=? AND l.entry_id>? '+
  'ORDER BY l.entry_id LIMIT 11'
 ).bind(user.household_id,user.user_id,Number(raw)).all()).results||[];
 const result=[];
 for(const r of rows.slice(0,10)){
  const blockers=[];
  if(r.actor_user_id!==user.user_id||r.account_owner!==user.user_id||
   r.account_household!==user.household_id)blockers.push('owner_or_household_not_current');
  if(r.account_archived!==0)blockers.push('account_not_current');
  if(!['income','expense'].includes(r.type)||!Number.isSafeInteger(r.amount)||
   r.amount<1)blockers.push('nonordinary_financial_operation');
  if(r.family_account_id!==r.account_id||r.payment_source!==r.original_source)
   blockers.push('linked_account_or_payment_source_drift');
  if(r.family_transfer_target_account_id!==null||
   r.client_request_id?.startsWith('hfshare:')||
   r.client_request_id?.startsWith('hfrecurring:')||
   r.client_request_id?.startsWith('hfbanktransfer:'))
   blockers.push('already_special_finance_or_shared_entry');
  if(r.registered!==0)blockers.push('already_under_shared_lifecycle');
  if(r.r2_rows>0)blockers.push('requires_original_r2_object_and_tombstone_review');
  // Even an otherwise eligible row is REVIEW ONLY: no ownerless or silent
  // transition to mutable shared registry, no double-counted ledger copy.
  result.push({entry_id:r.id,original_owner_user_id:r.actor_user_id,
   entry_type:r.type,source_snapshot_sha256:await sha(snapshot(r)),
   blockers,requires_explicit_owner_confirmation:true,
   requires_attachment_review:true,may_mutate:false,
   adoption_state:blockers.length?'blocked':'manual_review_required'});
 }
 return json({ok:true,read_only:true,adopted:false,ledger_applied:false,
  external_institution_verified:false,items:result,
  next_after_id:rows.length>10?result.at(-1).entry_id:null,
  requires_signed_single_entry_adoption_migration:true});
}
