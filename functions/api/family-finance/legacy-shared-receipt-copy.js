// 0056 draft: owner-authorized ORIGINAL BYTE COPY ONLY. This does not link
// the legacy entry into shared registry, change receipts, or delete old R2.
// Copy is durable+idempotent, pending after crash and resumable only with
// exactly matching source proof. No endpoint accepts arbitrary R2 object keys.
import {legacySharedAdoptionPreflight} from './legacy-shared-adoption-preflight.js';
const json=(v,s=200)=>Response.json(v,{status:s,headers:{'cache-control':'no-store'}});
const deny=(code,s=409)=>json({ok:false,code,ledger_changed:false,
 copied_to_shared_registry:false,legacy_object_deleted:false},s);
const hex32=/^[a-f0-9]{32}$/,hex64=/^[a-f0-9]{64}$/;
const h=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',v))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');
const textHash=v=>h(new TextEncoder().encode(v));
const shape=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).sort().join(',')===keys.slice().sort().join(',');
export async function legacySharedReceiptCopy(req,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_SHARED_RECEIPT_COPY_ENABLED!=='true'||
  env.KAKEIBO_LEGACY_R2_WRITES_FROZEN!=='true'||!env.DB?.batch||
  !env.RECEIPTS_R2?.get||!env.RECEIPTS_R2?.put||!env.RECEIPTS_R2?.head)
  return deny('LEGACY_SHARED_RECEIPT_COPY_DISABLED',503);
 if(req.method!=='POST')return deny('METHOD_NOT_ALLOWED',405);
 if(req.headers.get('origin')!==url.origin||
    req.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
  return deny('BAD_ORIGIN_OR_BODY',403);
 let x;try{const raw=await req.text();x=raw.length<=600?JSON.parse(raw):null}catch{return deny('BAD_JSON',400);}
 if(!shape(x,['expected_user_id','entry_id','account_id','source_snapshot_sha256','confirm'])||
   x?.expected_user_id!==user.user_id||x.confirm!==true||
   !Number.isSafeInteger(x.entry_id)||x.entry_id<1||!hex32.test(x.account_id)||
   !hex64.test(x.source_snapshot_sha256))
   return deny('SINGLE_OWNER_RECEIPT_COPY_CONFIRM_REQUIRED',403);
 const db=env.DB;
 const owner=await db.prepare('SELECT role,state FROM homeflow_identity_links '+
  'WHERE user_id=? AND household_id=? LIMIT 1').bind(user.user_id,user.household_id).first();
 if(user.role!=='owner'||owner?.state!=='active'||owner?.role!=='owner')
  return deny('ORIGINAL_OWNER_REQUIRED',403);
 const resource=(await textHash([user.household_id,user.user_id,'legacy-shared',
   x.entry_id,x.account_id].join('\0'))).slice(0,32);
 const sourceKey='receipts/v1/'+x.entry_id;
 const sourceKeyHash=await textHash(sourceKey);
 // Original source digest and link must still match. Ordinary R2 is the
 // ONLY permitted preflight blocker; all financial-special blockers deny.
 const check=await legacySharedAdoptionPreflight(new Request(
  new URL('?after_id='+(x.entry_id-1),url)),env,url,user);
 if(check.status!==200)return deny('ORIGINAL_PREFLIGHT_FAILED',check.status);
 const plan=(await check.json()).items?.find(v=>v.entry_id===x.entry_id);
 if(!plan||plan.account_id!==x.account_id||
  plan.source_snapshot_sha256!==x.source_snapshot_sha256||
  JSON.stringify(plan.blockers)!==JSON.stringify(['requires_original_r2_object_and_tombstone_review']))
  return deny('LEGACY_RECEIPT_COPY_NOT_ELIGIBLE');
 const receipt=await db.prepare('SELECT deleted,size_bytes FROM receipt_r2_state WHERE entry_id=?')
 .bind(x.entry_id).first();
 if(!receipt||receipt.deleted!==0)return deny('LEGACY_RECEIPT_TOMBSTONED_OR_MISSING',410);
 const key='shared/v1/'+resource+'/';
 let original;
 try{original=await env.RECEIPTS_R2.get(sourceKey)}catch{return deny('LEGACY_RECEIPT_R2_SOURCE_UNAVAILABLE',503)}
 if(!original||!Number.isSafeInteger(original.size)||original.size<1||
  original.size>204800||receipt.size_bytes!==null&&Number(receipt.size_bytes)!==original.size)
  return deny('LEGACY_RECEIPT_SOURCE_SIZE_CONFLICT');
 const mime=original.httpMetadata?.contentType,etag=original.httpEtag;
 if(!['image/webp','image/jpeg'].includes(mime)||typeof etag!=='string'||
    etag.length<3||etag.length>150)
  return deny('LEGACY_RECEIPT_SOURCE_METADATA_INVALID');
 let bytes;
 try{bytes=await original.arrayBuffer()}catch{return deny('LEGACY_RECEIPT_SOURCE_READ_FAILED',503)}
 if(bytes.byteLength!==original.size)return deny('LEGACY_RECEIPT_SOURCE_LENGTH_DRIFT');
 const digest=await h(bytes),sourceMetaHash=original.customMetadata?.sha256;
 if(sourceMetaHash&&sourceMetaHash!==digest)return deny('LEGACY_RECEIPT_SOURCE_HASH_DRIFT');
 const objId=(await textHash([resource,sourceKeyHash,digest].join('\0'))).slice(0,32);
 const targetKey=key+objId,at=Date.now();
 let existing=await db.prepare('SELECT * FROM family_legacy_shared_receipt_copies WHERE entry_id=?')
   .bind(x.entry_id).first();
 const stable=(r)=>r.resource_id===resource&&r.object_id===objId&&
  r.account_id===x.account_id&&r.household_id===user.household_id&&
  r.owner_user_id===user.user_id&&r.source_snapshot_sha256===x.source_snapshot_sha256&&
  r.source_object_key_sha256===sourceKeyHash&&r.source_http_etag===etag&&
  r.byte_sha256===digest&&r.size_bytes===original.size&&r.content_type===mime;
 if(existing&&!stable(existing))return deny('LEGACY_RECEIPT_COPY_PROVENANCE_CONFLICT');
 if(!existing){
  try{
   const c=await db.prepare('INSERT INTO family_legacy_shared_receipt_copies '+
    '(entry_id,resource_id,object_id,household_id,owner_user_id,account_id,'+
    'source_snapshot_sha256,source_object_key_sha256,source_http_etag,byte_sha256,'+
    'size_bytes,content_type,state,created_at) '+
    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)")
   .bind(x.entry_id,resource,objId,user.household_id,user.user_id,x.account_id,
    x.source_snapshot_sha256,sourceKeyHash,etag,digest,original.size,mime,at).run();
   if(c.meta?.changes!==1)return deny('LEGACY_RECEIPT_COPY_RESERVATION_UNCONFIRMED',503);
  }catch{
   existing=await db.prepare('SELECT * FROM family_legacy_shared_receipt_copies WHERE entry_id=?')
     .bind(x.entry_id).first().catch(()=>null);
   if(!existing||!stable(existing))return deny('LEGACY_RECEIPT_COPY_RESERVATION_FAILED',503);
  }
 }
 // A previous R2 PUT may have succeeded even if D1 status update was lost.
 // Conditional PUT and HEAD proof do not overwrite any existing object.
 let target;
 try{
  target=await env.RECEIPTS_R2.head(targetKey);
  if(!target){
   const stored=await env.RECEIPTS_R2.put(targetKey,bytes,{
    onlyIf:new Headers({'If-None-Match':'*'}),
    httpMetadata:{contentType:mime},
    customMetadata:{sha256:digest,sourceKeyHash},
    sha256:digest});
   target=stored||await env.RECEIPTS_R2.head(targetKey);
  }
 }catch{return deny('LEGACY_RECEIPT_COPY_R2_RETRY',503)}
 if(!target||target.size!==original.size||
   target.httpMetadata?.contentType!==mime||target.customMetadata?.sha256!==digest||
   target.customMetadata?.sourceKeyHash!==sourceKeyHash)
  return deny('LEGACY_RECEIPT_COPIED_OBJECT_CONFLICT',503);
 // If source was replaced while a prior request was already in flight,
 // leave R2 copied data unlinked, fail closed and require later review.
 let sourceNow;
 try{sourceNow=await env.RECEIPTS_R2.head(sourceKey)}
 catch{return deny('LEGACY_RECEIPT_SOURCE_RECHECK_FAILED',503)}
 if(!sourceNow||sourceNow.httpEtag!==etag||sourceNow.size!==original.size)
  return deny('LEGACY_RECEIPT_SOURCE_CHANGED_DURING_COPY');
 const prior=await db.prepare('SELECT * FROM family_legacy_shared_receipt_copies WHERE entry_id=?')
   .bind(x.entry_id).first();
 if(!prior||!stable(prior))return deny('LEGACY_RECEIPT_COPY_RESERVATION_CHANGED');
 if(prior.state==='pending'){
  try{
   const update=await db.prepare('UPDATE family_legacy_shared_receipt_copies '+
    "SET state='verified',verified_at=? WHERE entry_id=? AND state='pending' "+
    'AND source_snapshot_sha256=? AND EXISTS('+
    'SELECT 1 FROM receipt_r2_state rs WHERE rs.entry_id=? AND rs.deleted=0)')
   .bind(Date.now(),x.entry_id,x.source_snapshot_sha256,x.entry_id).run();
   if(update.meta?.changes!==1)return deny('LEGACY_RECEIPT_COPY_FINALIZE_RETRY',503);
  }catch{return deny('LEGACY_RECEIPT_COPY_AUDIT_FAILED_RETRY',503)}
 }
 const ready=await db.prepare('SELECT state FROM family_legacy_shared_receipt_copies '+
  'WHERE entry_id=?').bind(x.entry_id).first();
 if(ready?.state!=='verified')return deny('LEGACY_RECEIPT_COPY_NOT_READY',503);
 return json({ok:true,entry_id:x.entry_id,resource_id:resource,object_id:objId,
  state:'verified_copy_not_adopted',original_sha256:digest,
  source_object_key_sha256:sourceKeyHash,size_bytes:original.size,
  content_type:mime,replayed:prior.state==='verified',
  copied_to_shared_registry:false,legacy_object_deleted:false,
  ledger_changed:false,still_requires_atomic_registry_adoption:true});
}
