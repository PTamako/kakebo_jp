// Release-only read-only G6 reference and original-byte proof. This endpoint
// NEVER deletes a legacy R2 object, infers a backup, or authorizes deletion.
// A separate signed backup/drain/manual release gate is required before purge.
const json=(value,status=200)=>Response.json(value,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const deny=(code,status=409)=>json({ok:false,code,read_only:true,
 original_deleted:false,source_purge_authorized:false},status);
const hash=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))]
 .map(v=>v.toString(16).padStart(2,'0')).join('');
const keyHash=async key=>hash(new TextEncoder().encode(key));
const validId=/^[1-9][0-9]{0,11}$/;
export async function legacySharedSourceRefcount(req,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_R2_WRITES_FROZEN!=='true'||
  env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED!=='true'||
  !env.DB?.prepare||typeof env.RECEIPTS_R2?.get!=='function')
  return deny('LEGACY_SOURCE_REFCOUNT_DISABLED',503);
 if(req.method!=='GET')return deny('LEGACY_SOURCE_REFCOUNT_READ_ONLY',405);
 const raw=url.searchParams.get('entry_id');
 if(!validId.test(raw||'')||!Number.isSafeInteger(Number(raw)))
  return deny('LEGACY_SOURCE_ENTRY_ID_INVALID',400);
 if(user?.role!=='owner'||!user.user_id||!user.household_id)
  return deny('LEGACY_SOURCE_ORIGINAL_OWNER_REQUIRED',403);
 const entryId=Number(raw),db=env.DB;
 let claim;
 try{
  claim=await db.prepare('SELECT c.*,r.state AS registry_state,a.state AS attachment_state,'+
   'rs.deleted AS legacy_tombstone FROM family_legacy_shared_receipt_copies c '+
   'JOIN family_legacy_shared_receipt_claims claimed ON claimed.entry_id=c.entry_id '+
   'AND claimed.resource_id=c.resource_id AND claimed.object_id=c.object_id '+
   'JOIN family_legacy_shared_adoptions adopted ON adopted.entry_id=c.entry_id '+
   'AND adopted.resource_id=c.resource_id AND adopted.household_id=c.household_id '+
   'AND adopted.original_owner_user_id=c.owner_user_id AND adopted.account_id=c.account_id '+
   'JOIN family_shared_entry_registry r ON r.resource_id=c.resource_id '+
   'AND r.entry_id=c.entry_id AND r.household_id=c.household_id '+
   'JOIN family_shared_entry_attachments a ON a.object_id=c.object_id '+
   'AND a.resource_id=c.resource_id AND a.sha256=c.byte_sha256 '+
   'AND a.size_bytes=c.size_bytes AND a.content_type=c.content_type '+
   'JOIN receipt_r2_state rs ON rs.entry_id=c.entry_id '+
   'JOIN homeflow_identity_links own ON own.user_id=c.owner_user_id '+
   'AND own.household_id=c.household_id AND own.role=\'owner\' AND own.state=\'active\' '+
   'JOIN family_financial_accounts fa ON fa.account_id=c.account_id '+
   'AND fa.owner_user_id=c.owner_user_id AND fa.household_id=c.household_id AND fa.is_archived=0 '+
   'WHERE c.entry_id=? AND c.owner_user_id=? AND c.household_id=? AND c.state=\'verified\' LIMIT 1')
   .bind(entryId,user.user_id,user.household_id).first();
 }catch{return deny('LEGACY_SOURCE_REFERENCE_SCHEMA_UNAVAILABLE',503)}
 if(!claim||claim.legacy_tombstone!==1||claim.attachment_state!=='ready'||
  !['active','deleted'].includes(claim.registry_state))
  return deny('LEGACY_SOURCE_VERIFIED_CLAIM_OR_REFERENCE_MISSING');
 const oldKey='receipts/v1/'+entryId;
 if(await keyHash(oldKey)!==claim.source_object_key_sha256)
  return deny('LEGACY_SOURCE_KEY_PROVENANCE_CONFLICT');
 let refs;
 try{
  refs=await db.prepare('SELECT '+
   '(SELECT COUNT(*) FROM receipt_r2_state WHERE entry_id=? AND deleted=0) AS old_live_refs,'+
   '(SELECT COUNT(*) FROM family_legacy_shared_receipt_copies WHERE source_object_key_sha256=?) AS source_copy_refs,'+
   '(SELECT COUNT(*) FROM family_legacy_shared_receipt_claims WHERE entry_id=?) AS claim_refs,'+
   '(SELECT COUNT(*) FROM family_shared_entry_attachments WHERE object_id=? AND resource_id=? AND state=\'ready\') AS shared_ready_refs')
   .bind(entryId,claim.source_object_key_sha256,entryId,claim.object_id,claim.resource_id).first();
 }catch{return deny('LEGACY_SOURCE_REFCOUNT_UNAVAILABLE',503)}
 if(refs?.old_live_refs!==0||refs.source_copy_refs!==1||refs.claim_refs!==1||
  refs.shared_ready_refs!==1)
  return deny('LEGACY_SOURCE_REFERENCE_CONFLICT');
 const sharedKey='shared/v1/'+claim.resource_id+'/'+claim.object_id;
 try{
  const [original,target]=await Promise.all([
   env.RECEIPTS_R2.get(oldKey),env.RECEIPTS_R2.get(sharedKey)]);
  if(!original||!target)return deny('LEGACY_SOURCE_OR_TARGET_OBJECT_MISSING',503);
  if(original.size!==claim.size_bytes||target.size!==claim.size_bytes||
   original.httpEtag!==claim.source_http_etag||
   original.httpMetadata?.contentType!==claim.content_type||
   target.httpMetadata?.contentType!==claim.content_type||
   target.customMetadata?.sha256!==claim.byte_sha256||
   target.customMetadata?.sourceKeyHash!==claim.source_object_key_sha256)
   return deny('LEGACY_SOURCE_OR_TARGET_METADATA_CONFLICT',503);
  const [srcBytes,dstBytes]=await Promise.all([original.arrayBuffer(),target.arrayBuffer()]);
  if(srcBytes.byteLength!==claim.size_bytes||dstBytes.byteLength!==claim.size_bytes||
   await hash(srcBytes)!==claim.byte_sha256||await hash(dstBytes)!==claim.byte_sha256)
   return deny('LEGACY_SOURCE_OR_TARGET_BYTE_HASH_CONFLICT',503);
 }catch{return deny('LEGACY_SOURCE_REFERENCE_R2_READ_FAILED',503)}
 return json({ok:true,read_only:true,entry_id:entryId,resource_id:claim.resource_id,
  object_id:claim.object_id,byte_sha256:claim.byte_sha256,size_bytes:claim.size_bytes,
  source_copy_refs:refs.source_copy_refs,claim_refs:refs.claim_refs,
  shared_ready_refs:refs.shared_ready_refs,old_live_refs:refs.old_live_refs,
  original_and_shared_sha256_verified:true,
  original_deleted:false,source_purge_authorized:false,
  original_retention_required_until_new_backup_and_writer_drain:true,
  registry_state:claim.registry_state,ledger_changed:false});
}
