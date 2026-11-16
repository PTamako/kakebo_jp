// Stage F DRAFT, read-only: verify owner, original receipt bytes and tombstone
// before planning a legacy R2 migration. This does NOT copy, relink or adopt.
const json=(body,status=200)=>Response.json(body,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff'}});
const denied=(code,status=409)=>json({ok:false,code,read_only:true,adopted:false,
 copied:false,attachment_authorized:false},status);
const sha=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');
export async function legacySharedReceiptReview(req,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_RECEIPT_REVIEW_ENABLED!=='true'||!env.DB?.prepare)
  return denied('LEGACY_RECEIPT_REVIEW_DISABLED',503);
 if(req.method!=='GET')return denied('LEGACY_RECEIPT_READ_ONLY',405);
 const raw=url.searchParams.get('entry_id');
 if(!/^[1-9][0-9]{0,11}$/.test(raw||'')||!Number.isSafeInteger(Number(raw)))
  return denied('LEGACY_RECEIPT_INVALID_ID',400);
 if(user?.role!=='owner'||!user.user_id||!user.household_id)
  return denied('LEGACY_RECEIPT_OWNER_REQUIRED',403);
 const db=env.DB,id=Number(raw);
 const valid=await db.prepare("SELECT l.entry_id,l.account_id,e.payment_source,"+
  "r.deleted,r.size_bytes, a.is_archived "+
  "FROM family_finance_legacy_entry_links l "+
  "JOIN entries e ON e.id=l.entry_id "+
  "JOIN family_financial_accounts a ON a.account_id=l.account_id "+
  "JOIN homeflow_identity_links owner ON owner.user_id=l.actor_user_id "+
  "LEFT JOIN receipt_r2_state r ON r.entry_id=e.id "+
  "WHERE l.entry_id=? AND l.actor_user_id=? AND l.household_id=? "+
  "AND owner.household_id=? AND owner.role='owner' AND owner.state='active' "+
  "AND a.household_id=? AND a.owner_user_id=? AND a.is_archived=0 "+
  "AND e.family_account_id=a.account_id AND e.payment_source=l.original_source "+
  "AND e.type IN('income','expense') AND e.family_transfer_target_account_id IS NULL "+
  "AND NOT EXISTS(SELECT 1 FROM family_shared_entry_registry x WHERE x.entry_id=e.id) "+
  "LIMIT 1").bind(id,user.user_id,user.household_id,user.household_id,
   user.household_id,user.user_id).first();
 if(!valid)return denied('LEGACY_RECEIPT_OWNERSHIP_OR_LEDGER_INVALID',403);
 if(valid.deleted===1)return denied('LEGACY_RECEIPT_TOMBSTONED',410);
 if(valid.deleted===null)return denied('LEGACY_RECEIPT_METADATA_MISSING');
 if(typeof env.RECEIPTS_R2?.get!=='function')return denied('LEGACY_RECEIPT_BUCKET_UNAVAILABLE',503);
 const key='receipts/v1/'+id;
 try{
  const object=await env.RECEIPTS_R2.get(key);
  if(!object)return denied('LEGACY_RECEIPT_OBJECT_MISSING');
  const mime=object.httpMetadata?.contentType;
  if(!['image/webp','image/jpeg'].includes(mime)||!Number.isSafeInteger(object.size)||
   object.size<1||object.size>204800||valid.size_bytes!==null&&
    Number(valid.size_bytes)!==object.size)
   return denied('LEGACY_RECEIPT_METADATA_CONFLICT');
  const bytes=await object.arrayBuffer();
  if(bytes.byteLength!==object.size)return denied('LEGACY_RECEIPT_LENGTH_CONFLICT');
  const computed=await sha(bytes),stored=object.customMetadata?.sha256;
  if(stored!==undefined&&stored!==computed)return denied('LEGACY_RECEIPT_HASH_CONFLICT');
  // SHA is verified from original bytes, even for older objects lacking sha
  // metadata. No source bytes are returned or cached in browser.
  return json({ok:true,read_only:true,adopted:false,copied:false,
   attachment_authorized:false,entry_id:id,account_id:valid.account_id,
   original_size_bytes:object.size,original_sha256:computed,
   original_content_type:mime,stored_sha256_verified:stored===computed,
   object_etag:object.httpEtag||null,
   source_object_key_sha256:await sha(new TextEncoder().encode(key)),
   requires_owner_explicit_copy_confirmation:true,
   requires_safe_d1_r2_copy_and_refcount:true,
   ledger_changed:false,external_institution_verified:false});
 }catch{return denied('LEGACY_RECEIPT_READ_FAILED',503);}
}
