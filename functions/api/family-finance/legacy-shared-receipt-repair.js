// Release-only, owner-initiated recovery of a MISSING private shared receipt.
// Recreate bytes only from its still-retained verified original; never overwrite
// a conflicting object or delete anything. Needs 0059 and explicit OFF-by-default
// release flags. A durable intent precedes any R2 write so lost responses resume.
const json=(v,s=200)=>Response.json(v,{status:s,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff'}});
const fail=(code,s=409)=>json({ok:false,code,ledger_changed:false,
 original_deleted:false,source_purge_authorized:false},s);
const id32=/^[a-f0-9]{32}$/,hex64=/^[a-f0-9]{64}$/;
const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))]
 .map(v=>v.toString(16).padStart(2,'0')).join('');
const keyHash=k=>hash(new TextEncoder().encode(k));
const same=(o,fields)=>o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===fields.slice().sort().join(',');
export async function legacySharedReceiptRepair(req,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_SOURCE_REFCOUNT_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_R2_WRITES_FROZEN!=='true'||
  env.KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED!=='true'||
  !env.DB?.prepare||!env.RECEIPTS_R2?.get||!env.RECEIPTS_R2?.put||
  !env.RECEIPTS_R2?.head)return fail('LEGACY_RECEIPT_REPAIR_DISABLED',503);
 if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 if(req.headers.get('origin')!==url.origin||
   req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return fail('BAD_ORIGIN_OR_BODY',403);
 let x;try{const raw=await req.text();x=raw.length<=650?JSON.parse(raw):null}
 catch{return fail('INVALID_JSON',400)}
 if(!same(x,['expected_user_id','entry_id','resource_id','expected_sha256','request_id','confirm'])||
  x.confirm!==true||x.expected_user_id!==user?.user_id||
  !Number.isSafeInteger(x.entry_id)||x.entry_id<1||x.entry_id>999999999999||
  !id32.test(x.resource_id)||!id32.test(x.request_id)||
  !hex64.test(x.expected_sha256)||user?.role!=='owner'||!user.household_id)
  return fail('OWNER_EXPLICIT_REPAIR_CONFIRMATION_REQUIRED',403);
 const db=env.DB;
 let c;
 try{
  c=await db.prepare('SELECT c.*,reg.state AS registry_state, a.state AS attachment_state, '+
   'old.deleted AS old_deleted FROM family_legacy_shared_receipt_copies c '+
   'JOIN family_legacy_shared_receipt_claims claim ON claim.entry_id=c.entry_id '+
   'AND claim.resource_id=c.resource_id AND claim.object_id=c.object_id '+
   'JOIN family_legacy_shared_adoptions adopted ON adopted.entry_id=c.entry_id '+
   'AND adopted.resource_id=c.resource_id AND adopted.original_owner_user_id=c.owner_user_id '+
   'JOIN family_shared_entry_registry reg ON reg.resource_id=c.resource_id '+
   'AND reg.entry_id=c.entry_id AND reg.household_id=c.household_id '+
   'JOIN family_shared_entry_attachments a ON a.object_id=c.object_id '+
   'AND a.resource_id=c.resource_id AND a.sha256=c.byte_sha256 '+
   'AND a.size_bytes=c.size_bytes AND a.content_type=c.content_type '+
   'JOIN receipt_r2_state old ON old.entry_id=c.entry_id '+
   'JOIN homeflow_identity_links owner ON owner.user_id=c.owner_user_id '+
   'AND owner.household_id=c.household_id AND owner.role=\'owner\' AND owner.state=\'active\' '+
   'JOIN family_financial_accounts account ON account.account_id=c.account_id '+
   'AND account.owner_user_id=c.owner_user_id AND account.household_id=c.household_id '+
   'AND account.is_archived=0 WHERE c.entry_id=? AND c.resource_id=? '+
   'AND c.owner_user_id=? AND c.household_id=? AND c.state=\'verified\' LIMIT 1')
   .bind(x.entry_id,x.resource_id,user.user_id,user.household_id).first();
 }catch{return fail('REPAIR_SCHEMA_UNAVAILABLE',503)}
 if(!c||c.old_deleted!==1||c.attachment_state!=='ready'||
   !['active','deleted'].includes(c.registry_state)||c.byte_sha256!==x.expected_sha256)
  return fail('REPAIR_CLAIM_OR_OWNER_CONFLICT');
 const originalKey='receipts/v1/'+x.entry_id;
 const targetKey='shared/v1/'+c.resource_id+'/'+c.object_id;
 if(await keyHash(originalKey)!==c.source_object_key_sha256)
  return fail('REPAIR_SOURCE_KEY_CONFLICT');
 try{
  const refs=await db.prepare('SELECT '+
   '(SELECT COUNT(*) FROM receipt_r2_state WHERE entry_id=? AND deleted=0) AS old_live, '+
   '(SELECT COUNT(*) FROM family_legacy_shared_receipt_copies WHERE source_object_key_sha256=?) AS copies, '+
   '(SELECT COUNT(*) FROM family_legacy_shared_receipt_claims WHERE entry_id=?) AS claims, '+
   '(SELECT COUNT(*) FROM family_shared_entry_attachments WHERE object_id=? AND resource_id=? AND state=\'ready\') AS attachments')
   .bind(x.entry_id,c.source_object_key_sha256,x.entry_id,c.object_id,c.resource_id).first();
  if(!refs||refs.old_live!==0||refs.copies!==1||refs.claims!==1||refs.attachments!==1)
   return fail('REPAIR_REFERENCE_COUNT_CONFLICT');
 }catch{return fail('REPAIR_REFERENCE_COUNT_UNAVAILABLE',503)}
 // Never replace a present-but-corrupt target: independent investigation only.
 let original,target,bytes;
 try{
  [original,target]=await Promise.all([
   env.RECEIPTS_R2.get(originalKey),env.RECEIPTS_R2.head(targetKey)]);
  if(!original)return fail('REPAIR_RETAINED_SOURCE_MISSING',503);
  if(original.size!==c.size_bytes||original.httpEtag!==c.source_http_etag||
   original.httpMetadata?.contentType!==c.content_type)
   return fail('REPAIR_SOURCE_METADATA_CHANGED');
  bytes=await original.arrayBuffer();
  if(bytes.byteLength!==c.size_bytes||await hash(bytes)!==c.byte_sha256)
   return fail('REPAIR_SOURCE_BYTES_CHANGED');
 }catch{return fail('REPAIR_SOURCE_READ_ERROR',503)}
 const checkTarget=async()=>{
  const object=await env.RECEIPTS_R2.get(targetKey);
  if(!object||object.size!==c.size_bytes||
   object.httpMetadata?.contentType!==c.content_type||
   object.customMetadata?.sha256!==c.byte_sha256||
   object.customMetadata?.sourceKeyHash!==c.source_object_key_sha256)
   return false;
  const b=await object.arrayBuffer();
  return b.byteLength===c.size_bytes&&await hash(b)===c.byte_sha256;
 };
 let prior;
 try{prior=await db.prepare('SELECT * FROM family_legacy_shared_receipt_repairs WHERE request_id=?')
  .bind(x.request_id).first()}catch{return fail('REPAIR_INTENT_SCHEMA_UNAVAILABLE',503)}
 const matches=r=>r?.entry_id===c.entry_id&&r.resource_id===c.resource_id&&
  r.object_id===c.object_id&&r.owner_user_id===user.user_id&&
  r.household_id===user.household_id&&r.byte_sha256===c.byte_sha256;
 if(prior&&!matches(prior))return fail('REPAIR_REQUEST_ID_REUSED');
 if(target){
  try{if(!await checkTarget())return fail('REPAIR_PRESENT_TARGET_CONFLICT')}
  catch{return fail('REPAIR_TARGET_READ_ERROR',503)}
  if(!prior)return json({ok:true,repaired:false,already_present:true,
   original_deleted:false,source_purge_authorized:false,ledger_changed:false});
  if(prior.status==='completed')return json({ok:true,repaired:true,replayed:true,
   original_deleted:false,source_purge_authorized:false,ledger_changed:false});
  // Pending intent can complete if PUT succeeded but its response was lost.
 }else if(prior?.status==='completed'){
  return fail('REPAIR_COMPLETED_TARGET_MISSING_NEW_REVIEW_REQUIRED');
 }
 if(!prior){
  try{
   await db.prepare('INSERT INTO family_legacy_shared_receipt_repairs '+
    '(request_id,entry_id,resource_id,object_id,household_id,owner_user_id,'+
    'byte_sha256,status,prepared_at) VALUES(?,?,?,?,?,?,?,\'pending\',?)')
    .bind(x.request_id,c.entry_id,c.resource_id,c.object_id,c.household_id,
     c.owner_user_id,c.byte_sha256,Date.now()).run();
   prior=await db.prepare('SELECT * FROM family_legacy_shared_receipt_repairs WHERE request_id=?')
    .bind(x.request_id).first();
  }catch{
   prior=await db.prepare('SELECT * FROM family_legacy_shared_receipt_repairs WHERE request_id=?')
    .bind(x.request_id).first().catch(()=>null);
  }
  if(!matches(prior))return fail('REPAIR_INTENT_RESERVATION_FAILED',503);
 }
 if(!target){
  try{
   const sourceNow=await env.RECEIPTS_R2.head(originalKey);
   if(!sourceNow||sourceNow.httpEtag!==c.source_http_etag||sourceNow.size!==c.size_bytes)
    return fail('REPAIR_SOURCE_CHANGED_BEFORE_PUT');
   await env.RECEIPTS_R2.put(targetKey,bytes,{
    onlyIf:new Headers({'If-None-Match':'*'}),
    httpMetadata:{contentType:c.content_type},
    customMetadata:{sha256:c.byte_sha256,sourceKeyHash:c.source_object_key_sha256},
    sha256:c.byte_sha256});
  }catch{return fail('REPAIR_R2_PUT_RETRY',503)}
 }
 try{
  if(!await checkTarget())return fail('REPAIR_TARGET_VERIFY_RETRY',503);
  const sourceFinal=await env.RECEIPTS_R2.head(originalKey);
  if(!sourceFinal||sourceFinal.httpEtag!==c.source_http_etag||
   sourceFinal.size!==c.size_bytes)return fail('REPAIR_SOURCE_CHANGED_AFTER_PUT');
 }catch{return fail('REPAIR_FINAL_R2_VERIFY_RETRY',503)}
 if(prior.status==='pending'){
  try{
   const saved=await db.prepare('UPDATE family_legacy_shared_receipt_repairs '+
    'SET status=\'completed\',completed_at=? WHERE request_id=? AND status=\'pending\'')
    .bind(Date.now(),x.request_id).run();
   if(saved.meta?.changes!==1)return fail('REPAIR_AUDIT_COMMIT_RETRY',503);
  }catch{return fail('REPAIR_AUDIT_COMMIT_RETRY',503)}
 }
 return json({ok:true,repaired:true,replayed:!!target,
  entry_id:c.entry_id,resource_id:c.resource_id,byte_sha256:c.byte_sha256,
  original_deleted:false,source_purge_authorized:false,ledger_changed:false});
}
