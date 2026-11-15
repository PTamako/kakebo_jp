// 0055+0057 DRAFT: one original-owner explicit ordinary entry adoption.
// Existing legacy R2 may be claimed only from verified, owner-bound 0056 copy;
// retain original bytes and tombstone old numeric path. No auto bulk migration.
import {legacySharedAdoptionPreflight} from './legacy-shared-adoption-preflight.js';
const fail=(code,status=409)=>Response.json({ok:false,code,adopted:false,ledger_changed:false},
 {status,headers:{'cache-control':'no-store'}});
const out=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const id32=/^[a-f0-9]{32}$/,hex64=/^[a-f0-9]{64}$/;
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>Object.keys(a).length===b.length&&b.every(k=>Object.hasOwn(a,k));
const originalSnapshot=r=>JSON.stringify([
 r.id,r.date,r.time,r.amount,r.type,r.category,r.merchant,r.note,r.raw,
 r.payment_source,r.client_request_id,r.family_account_id,
 r.family_transfer_target_account_id,r.created_at,r.actor_user_id,
 r.account_id,r.original_source,r.source_digest
]);
async function fetchOriginal(db,entryId,household,userId){
 return db.prepare('SELECT e.*,l.actor_user_id,l.account_id,l.original_source,l.source_digest '+
  'FROM family_finance_legacy_entry_links l JOIN entries e ON e.id=l.entry_id '+
  'WHERE l.entry_id=? AND l.household_id=? AND l.actor_user_id=? LIMIT 1')
 .bind(entryId,household,userId).first();
}
const view=r=>({resource_id:r.resource_id,entry_id:r.entry_id,
 original_owner_user_id:r.original_owner_user_id,source_snapshot_sha256:r.source_snapshot_sha256});
export async function legacySharedAdopt(req,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
    env.KAKEIBO_SHARED_ENTRY_ENABLED!=='true'||
    env.KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED!=='true'||
    env.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED!=='true'||
    env.KAKEIBO_LEGACY_R2_WRITES_FROZEN!=='true'||!env.DB?.batch)
   return fail('LEGACY_SHARED_ADOPTION_DISABLED',503);
 if(req.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 if(req.headers.get('origin')!==url.origin||
    req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
   return fail('BAD_ORIGIN_OR_BODY',403);
 const raw=await req.text().catch(()=>null);
 let input;try{input=raw?.length<=600?JSON.parse(raw):null}catch{return fail('INVALID_JSON',400)}
 if(!same(input||{},['expected_user_id','entry_id','account_id','source_snapshot_sha256','confirm'])||
    input.confirm!==true||input.expected_user_id!==user.user_id||
    !Number.isSafeInteger(input.entry_id)||input.entry_id<1||
    !id32.test(input.account_id)||!hex64.test(input.source_snapshot_sha256))
  return fail('EXPLICIT_SINGLE_OWNER_CONFIRMATION_REQUIRED',403);
 const db=env.DB;
 const live=await db.prepare('SELECT role,state FROM homeflow_identity_links '+
  'WHERE user_id=? AND household_id=? LIMIT 1').bind(user.user_id,user.household_id).first();
 if(user.role!=='owner'||live?.role!=='owner'||live?.state!=='active')
  return fail('ORIGINAL_OWNER_REQUIRED',403);
 const resource=(await hash([user.household_id,user.user_id,'legacy-shared',
  input.entry_id,input.account_id].join('\0'))).slice(0,32);
 const prev=await db.prepare('SELECT * FROM family_legacy_shared_adoptions WHERE entry_id=?')
  .bind(input.entry_id).first();
 const replay=async r=>{
  const registered=await db.prepare('SELECT resource_id,state,version FROM family_shared_entry_registry '+
   'WHERE entry_id=? AND household_id=?').bind(input.entry_id,user.household_id).first();
  const audited=registered&&await db.prepare('SELECT COUNT(*) n FROM family_shared_entry_audit '+
   "WHERE resource_id=? AND action='create'").bind(registered.resource_id).first();
  if(r.resource_id!==resource||r.account_id!==input.account_id||
    r.original_owner_user_id!==user.user_id||r.household_id!==user.household_id||
    r.source_snapshot_sha256!==input.source_snapshot_sha256||
    registered?.resource_id!==resource||audited?.n!==1)return null;
  return out({ok:true,adopted:true,replayed:true,ledger_changed:false,
   registry_state:registered.state,registry_version:registered.version,adoption:view(r)});
 };
 if(prev)return await replay(prev)||fail('LEGACY_SHARED_ADOPTION_CONFLICT');
 const checked=await legacySharedAdoptionPreflight(
  new Request(new URL('?after_id='+String(input.entry_id-1),url),{method:'GET'}),
  env,url,user);
 if(checked.status!==200)return fail('LEGACY_SHARED_PREFLIGHT_FAILED',checked.status);
 const data=await checked.json();
 const candidate=data.items?.find(x=>x.entry_id===input.entry_id);
 if(!candidate||candidate.source_snapshot_sha256!==input.source_snapshot_sha256)
  return fail('LEGACY_SHARED_REVIEW_OR_DIGEST_CONFLICT');
 const hasReceipt=JSON.stringify(candidate.blockers)===
  JSON.stringify(['requires_original_r2_object_and_tombstone_review']);
 if(candidate.blockers?.length&&!hasReceipt)return fail('LEGACY_SHARED_REVIEW_OR_DIGEST_CONFLICT');
 if(typeof env.RECEIPTS_R2?.head!=='function')
  return fail('LEGACY_SHARED_R2_EVIDENCE_UNAVAILABLE',503);
 // With an existing legacy receipt, only a 0056 verified, same-owner,
 // same-source copy may be atomically claimed under 0057. Never accept a
 // browser-supplied object key or "copy completed" claim.
 const copied=hasReceipt&&env.KAKEIBO_LEGACY_SHARED_RECEIPT_COPY_ENABLED==='true'?
   await db.prepare('SELECT * FROM family_legacy_shared_receipt_copies '+
    'WHERE entry_id=? AND resource_id=? AND household_id=? AND owner_user_id=?')
    .bind(input.entry_id,resource,user.household_id,user.user_id).first():null;
 if(hasReceipt){
  if(!copied||copied.state!=='verified'||copied.account_id!==input.account_id||
     copied.source_snapshot_sha256!==input.source_snapshot_sha256)
    return fail('LEGACY_SHARED_VERIFIED_RECEIPT_COPY_REQUIRED');
  const state=await db.prepare('SELECT deleted,size_bytes FROM receipt_r2_state '+
   'WHERE entry_id=?').bind(input.entry_id).first();
  if(state?.deleted!==0||state.size_bytes!==null&&
    Number(state.size_bytes)!==copied.size_bytes)
    return fail('LEGACY_SHARED_RECEIPT_TOMBSTONED_OR_CHANGED');
  try{
   const original=await env.RECEIPTS_R2.head('receipts/v1/'+input.entry_id);
   const destination=await env.RECEIPTS_R2.head(
    'shared/v1/'+resource+'/'+copied.object_id);
   if(!original||!destination||original.httpEtag!==copied.source_http_etag||
      original.size!==copied.size_bytes||destination.size!==copied.size_bytes||
      destination.httpMetadata?.contentType!==copied.content_type||
      destination.customMetadata?.sha256!==copied.byte_sha256||
      destination.customMetadata?.sourceKeyHash!==copied.source_object_key_sha256)
     return fail('LEGACY_SHARED_RECEIPT_R2_EVIDENCE_CHANGED');
  }catch{return fail('LEGACY_SHARED_R2_EVIDENCE_UNAVAILABLE',503)}
 }else{
  try{if(await env.RECEIPTS_R2.head('receipts/v1/'+input.entry_id))
    return fail('LEGACY_SHARED_R2_ATTACHMENT_REVIEW_REQUIRED');}
  catch{return fail('LEGACY_SHARED_R2_EVIDENCE_UNAVAILABLE',503)}
 }
 const r=await fetchOriginal(db,input.entry_id,user.household_id,user.user_id);
 if(!r||await hash(originalSnapshot(r))!==input.source_snapshot_sha256||
    !Number.isSafeInteger(r.amount)||r.amount<1||r.amount>10000000||
    !['income','expense'].includes(r.type)||
    !['date','time','category','merchant','note'].every(k=>typeof r[k]==='string')||
    !/^\d{4}-\d\d-\d\d$/.test(r.date)||r.time.length>5||
    r.category.length>100||r.merchant.length>120||r.note.length>500)
  return fail('LEGACY_SHARED_SOURCE_CHANGED_OR_UNSUPPORTED');
 const original={...r};
 for(const k of ['actor_user_id','account_id','original_source','source_digest'])delete original[k];
 if(Object.keys(original).some(k=>!/^[a-z][a-z0-9_]*$/i.test(k))||
    Object.values(original).some(x=>x!==null&&typeof x!=='string'&&typeof x!=='number'))
  return fail('LEGACY_SHARED_ROW_SCHEMA_UNSUPPORTED');
 const fields=Object.keys(original).filter(k=>k!=='id');
 const where=fields.map(k=>'"'+k+'" IS ?').join(' AND ');
 const entry={date:r.date,time:r.time,amount:r.amount,type:r.type,
  category:r.category,merchant:r.merchant,note:r.note};
 const at=Date.now(),snapshot=JSON.stringify(entry),digest=await hash(snapshot);
 const insert='INSERT INTO family_legacy_shared_adoptions '+
  '(resource_id,entry_id,household_id,original_owner_user_id,account_id,'+
  'source_snapshot_sha256,original_link_digest,original_client_request_id,original_row_json,adopted_at) '+
  'SELECT ?,?,?,?,?,?,?,?,?,? FROM entries e WHERE e.id=? AND '+where+
  (hasReceipt?
   " AND EXISTS(SELECT 1 FROM family_legacy_shared_receipt_copies c JOIN receipt_r2_state rs ON rs.entry_id=c.entry_id WHERE c.entry_id=e.id AND c.resource_id='"+resource+"' AND c.state='verified' AND c.source_snapshot_sha256='"+input.source_snapshot_sha256+"' AND rs.deleted=0) ":
   ' AND NOT EXISTS(SELECT 1 FROM receipt_r2_state WHERE entry_id=e.id) ')+
  'AND NOT EXISTS(SELECT 1 FROM family_shared_entry_registry WHERE entry_id=e.id) '+
  'AND EXISTS(SELECT 1 FROM family_finance_legacy_entry_links l '+
  'JOIN family_financial_accounts a ON a.account_id=l.account_id '+
  'JOIN homeflow_identity_links u ON u.user_id=l.actor_user_id '+
  'WHERE l.entry_id=e.id AND l.household_id=? AND l.actor_user_id=? '+
  'AND l.account_id=? AND l.source_digest=? AND a.owner_user_id=u.user_id '+
  'AND a.household_id=l.household_id AND a.is_archived=0 '+
  "AND u.state='active' AND u.role='owner' AND e.payment_source=l.original_source)";
 const stmts=[
  db.prepare(insert).bind(resource,input.entry_id,user.household_id,user.user_id,
   input.account_id,input.source_snapshot_sha256,r.source_digest,r.client_request_id,
   JSON.stringify(original),at,input.entry_id,...fields.map(k=>original[k]),
   user.household_id,user.user_id,input.account_id,r.source_digest),
  db.prepare('INSERT INTO family_shared_entry_write_context '+
   '(resource_id,entry_id,actor_user_id,action,expected_version,stamp) '+
   "SELECT resource_id,entry_id,original_owner_user_id,'create',0,? "+
   'FROM family_legacy_shared_adoptions WHERE entry_id=? AND resource_id=? AND changes()=1')
   .bind(at,input.entry_id,resource),
  db.prepare('INSERT INTO family_shared_entry_registry '+
   '(resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,'+
   'state,version,snapshot_json,payload_sha256,created_at,updated_at) '+
   "SELECT resource_id,household_id,entry_id,original_owner_user_id,original_owner_user_id,"+
   "'active',1,?,?,?,? FROM family_legacy_shared_adoptions "+
   'WHERE entry_id=? AND resource_id=? AND changes()=1')
   .bind(snapshot,digest,at,at,input.entry_id,resource),
  // The final actor event is created only after any shared receipt reference,
  // old D1 tombstone, and immutable claim all succeed in ONE local D1 batch.
  ...(hasReceipt?[
   db.prepare('INSERT INTO family_shared_entry_attachments '+
    '(object_id,resource_id,state,content_type,sha256,size_bytes,'+
    'created_by_user_id,created_at,updated_at) '+
    "SELECT object_id,resource_id,'ready',content_type,byte_sha256,size_bytes,"+
    'owner_user_id,?,? FROM family_legacy_shared_receipt_copies '+
    "WHERE entry_id=? AND resource_id=? AND state='verified' "+
    'AND EXISTS(SELECT 1 FROM family_shared_entry_registry WHERE resource_id=?)')
    .bind(at,at,input.entry_id,resource,resource),
   db.prepare('UPDATE receipt_r2_state SET deleted=1,updated_at=CURRENT_TIMESTAMP '+
    'WHERE entry_id=? AND deleted=0 AND EXISTS('+
    'SELECT 1 FROM family_legacy_shared_receipt_copies WHERE entry_id=? '+
    "AND resource_id=? AND state='verified')")
    .bind(input.entry_id,input.entry_id,resource),
   db.prepare('INSERT INTO family_legacy_shared_receipt_claims '+
    '(entry_id,resource_id,object_id,household_id,original_owner_user_id,claimed_at) '+
    'SELECT entry_id,resource_id,object_id,household_id,owner_user_id,? '+
    'FROM family_legacy_shared_receipt_copies WHERE entry_id=? AND resource_id=? '+
    "AND state='verified' AND changes()=1")
    .bind(at,input.entry_id,resource)
  ]:[]),
  db.prepare('INSERT INTO family_finance_events '+
   '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
   "SELECT ?,?,?,?,'legacy_shared_entry_adopted',? WHERE changes()=1")
   .bind(crypto.randomUUID().replace(/-/g,''),user.household_id,user.user_id,resource,at),
  db.prepare('DELETE FROM family_shared_entry_write_context WHERE resource_id=?').bind(resource)
 ];
 try{
  const result=await db.batch(stmts);
  if(result.length!==(hasReceipt?8:5)||result.some(x=>x.meta?.changes!==1))
   return fail('LEGACY_SHARED_ATOMIC_ADOPTION_NOT_CONFIRMED',503);
  const saved=await db.prepare('SELECT * FROM family_legacy_shared_adoptions WHERE entry_id=?')
   .bind(input.entry_id).first();
  return saved?out({ok:true,adopted:true,replayed:false,ledger_changed:false,
   registry_state:'active',registry_version:1,
   receipt_claimed:!!hasReceipt,legacy_object_deleted:false,adoption:view(saved)},201):
   fail('LEGACY_SHARED_ADOPTION_RECEIPT_UNKNOWN',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_legacy_shared_adoptions WHERE entry_id=?')
    .bind(input.entry_id).first().catch(()=>null);
  return raced?await replay(raced)||fail('LEGACY_SHARED_ADOPTION_CONFLICT'):
   fail('LEGACY_SHARED_ADOPTION_ROLLED_BACK',503);
 }
}
