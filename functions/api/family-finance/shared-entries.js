import {familySharedAttachments} from './shared-entry-attachments.js';
// DRAFT shared household ledger lifecycle. Only ordinary income/expense;
// signed immutable finance journals, SBI lots and account transfers stay separate.
// Original D1 entries remain the unique source for household totals.
const enc=new TextEncoder(),id32=/^[a-f0-9]{32}$/,yyyy=/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false},status);
const rand=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const exact=(x,k)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.slice().sort().join(',');
const validDay=x=>typeof x==='string'&&yyyy.test(x)&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const validTime=x=>typeof x==='string'&&(x===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(x));
const enabled=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_SHARED_ENTRY_ENABLED==='true'&&!!e.DB?.prepare;
const schema=['date','time','amount','type','category','merchant','note'];
function canon(input){
 const spouse=exact(input,[...schema,'transfer_target','transfer_date']);
 if(!(exact(input,schema)||spouse)||!validDay(input.date)||!validTime(input.time)||
  !Number.isSafeInteger(input.amount)||input.amount<1||input.amount>10000000||
  !['income','expense','transfer'].includes(input.type)||
  (input.type==='transfer'&&(!spouse||input.transfer_target!=='spouse'||
   input.transfer_date!==input.date||input.category!=='投資・資産移動'||
   input.merchant!=='配偶への振替'))||
  (input.type!=='transfer'&&spouse)||
  typeof input.category!=='string'||!input.category.trim()||input.category.length>100||
  typeof input.merchant!=='string'||input.merchant.length>120||
  typeof input.note!=='string'||input.note.length>500) return null;
 return {date:input.date,time:input.time,amount:input.amount,type:input.type,
  category:input.category.trim(),merchant:input.merchant.trim(),note:input.note.trim(),
  ...(spouse?{transfer_target:'spouse',transfer_date:input.transfer_date}:{})};
}
function parse(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return Promise.resolve(null);
 return req.text().then(raw=>raw.length<=2400?JSON.parse(raw):null).catch(()=>null);
}
async function liveRole(db,u){
 const r=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(u.user_id,u.household_id).first();
 return r?.state==='active'&&['owner','member'].includes(r.role)?r.role:null;
}
const select='SELECT r.resource_id,r.household_id,r.entry_id,r.creator_user_id,r.last_actor_user_id,'+
 'r.version,r.state,r.snapshot_json,r.payload_sha256,r.created_at,r.updated_at,r.deleted_at,r.purged_at ';
const get=(db,resource,u)=>db.prepare(select+'FROM family_shared_entry_registry r WHERE resource_id=? AND household_id=? LIMIT 1')
 .bind(resource,u.household_id).first();
function visible(r){
 if(!r)return null;
 return {resource_id:r.resource_id,entry_id:r.entry_id,state:r.state,version:r.version,
  creator_user_id:r.creator_user_id,last_actor_user_id:r.last_actor_user_id,
  entry:r.state==='purged'||r.state==='purge_pending'?null:JSON.parse(r.snapshot_json),
  created_at:r.created_at,updated_at:r.updated_at,deleted_at:r.deleted_at,
  attachment_available:r.state==='active'||r.state==='deleted'};
}
const entryArgs=x=>[x.date,x.time,x.amount,x.category,x.merchant,x.note,x.type];
const requireVersion=x=>Number.isSafeInteger(x)&&x>=1;
function context(db,r,u,action,now){
 return db.prepare('INSERT INTO family_shared_entry_write_context'+
  '(resource_id,entry_id,actor_user_id,action,expected_version,stamp) VALUES(?,?,?,?,?,?)')
  .bind(r.resource_id,r.entry_id,u.user_id,action,r.version,now);
}
const clear=(db,resource)=>db.prepare('DELETE FROM family_shared_entry_write_context WHERE resource_id=?').bind(resource);
const auditCount=(db,id)=>db.prepare('SELECT COUNT(*) AS n FROM family_shared_entry_audit WHERE resource_id=?').bind(id).first();
function changesOk(result,count){return result.length===count&&result.every(r=>r.meta?.changes===1);}
async function create(req,e,url,u){
 const x=await parse(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('SHARED_ENTRY_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','idempotency_key','entry'])||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key))
  return fail('SHARED_ENTRY_INVALID_CREATE',400);
 const entry=canon(x.entry);if(!entry)return fail('SHARED_ENTRY_INVALID_FIELDS',400);
 const resource=await hash([u.household_id,u.user_id,'shared-entry',x.idempotency_key].join('\0'));
 const id=resource.slice(0,32),snapshot=JSON.stringify(entry),digest=await hash(snapshot);
 const prior=await get(e.DB,id,u);
 if(prior)return prior.payload_sha256===digest?json({ok:true,action:visible(prior),replayed:true}):
  fail('SHARED_ENTRY_IDEMPOTENCY_CONFLICT');
 const at=Date.now(),client='hfshare:'+id;
 const db=e.DB;
 try{
  const stmts=[
   (entry.type==='transfer'?
    db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,transfer_target,transfer_date,transfer_applied) '+
     "VALUES(?,?,?,?,?,?,'',?,?,'','spouse',?,0) ON CONFLICT(client_request_id) DO NOTHING")
     .bind(...entryArgs(entry),client,entry.date):
    db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) '+
     "VALUES(?,?,?,?,?,?,'',?,?,'') ON CONFLICT(client_request_id) DO NOTHING")
     .bind(...entryArgs(entry),client)),
   db.prepare('INSERT INTO family_shared_entry_write_context '+
    '(resource_id,entry_id,actor_user_id,action,expected_version,stamp) '+
    "SELECT ?,id,?,'create',0,? FROM entries WHERE client_request_id=? AND changes()=1")
    .bind(id,u.user_id,at,client),
   db.prepare('INSERT INTO family_shared_entry_registry '+
    '(resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,state,'+
    'version,snapshot_json,payload_sha256,created_at,updated_at) '+
    "SELECT ?,?,id,?,?,'active',1,?,?,?,? FROM entries WHERE client_request_id=? AND changes()=1")
    .bind(id,u.household_id,u.user_id,u.user_id,snapshot,digest,at,at,client),
   clear(db,id)
  ];
  const results=await db.batch(stmts);
  if(!changesOk(results,4))return fail('SHARED_ENTRY_CREATE_UNCONFIRMED',503);
  const saved=await get(db,id,u);
  return saved?json({ok:true,action:visible(saved),replayed:false},201):
    fail('SHARED_ENTRY_CREATE_RECEIPT_UNKNOWN',503);
 }catch{
  const raced=await get(db,id,u).catch(()=>null);
  return raced?.payload_sha256===digest?json({ok:true,action:visible(raced),replayed:true}):
   fail('SHARED_ENTRY_CREATE_CONFLICT');
 }
}
async function modify(req,e,url,u,id,action){
 const x=await parse(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('SHARED_ENTRY_ACTOR_CHANGED',403);
 if(!requireVersion(x?.expected_version))return fail('SHARED_ENTRY_EXPECTED_VERSION_REQUIRED',400);
 const r=await get(e.DB,id,u);
 if(!r)return fail('SHARED_ENTRY_NOT_FOUND',404);
 if(r.version!==x.expected_version)return fail('SHARED_ENTRY_STALE_VERSION');
 const expected=action==='update'?['expected_user_id','expected_version','entry']:
  ['expected_user_id','expected_version'];
 if(!exact(x,expected))return fail('SHARED_ENTRY_INVALID_MUTATION',400);
 if(action==='update'&&r.state!=='active'||action==='delete'&&r.state!=='active'||
   action==='restore'&&r.state!=='deleted')return fail('SHARED_ENTRY_STATE_CONFLICT');
 let next=action==='update'?canon(x.entry):null;
 if(action==='update'&&!next)return fail('SHARED_ENTRY_INVALID_FIELDS',400);
 if(action==='restore')next=JSON.parse(r.snapshot_json);
 const snapshot=next?JSON.stringify(next):r.snapshot_json;
 const digest=await hash(snapshot);
 const at=Date.now(),db=e.DB,ref='hfshare:'+id;
 // If the additive adoption migration/feature is not enabled, existing 0051
 // ordinary shared entries must remain writable without requiring 0055.
 // If the flag IS enabled but the table is missing, this query fails closed.
 const adopted=e.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED==='true'?
  await db.prepare('SELECT original_row_json,original_client_request_id,account_id '+
   'FROM family_legacy_shared_adoptions WHERE resource_id=? AND entry_id=?').bind(id,r.entry_id).first():null;
 const original=adopted?JSON.parse(adopted.original_row_json):null;
 const statements=[context(db,r,u,action,at)];
 const spouseRevision=next?.type==='transfer'||JSON.parse(r.snapshot_json)?.type==='transfer';
 if(action==='update'){
  const allowed=adopted?'client_request_id IS ? AND family_account_id=?':'client_request_id=? AND family_account_id IS NULL';
  const source=adopted?[adopted.original_client_request_id,adopted.account_id]:[ref];
  statements.push(spouseRevision?
   db.prepare('UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=?,transfer_target=?,transfer_date=?,transfer_applied=0 '+
    'WHERE id=? AND '+allowed+" AND (type IN('expense','income') OR (type='transfer' AND transfer_target='spouse')) AND family_transfer_target_account_id IS NULL")
    .bind(...entryArgs(next),next.type==='transfer'?'spouse':null,next.type==='transfer'?next.date:null,r.entry_id,...source):
   db.prepare('UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=? '+
    'WHERE id=? AND '+allowed+" AND type IN('expense','income') AND family_transfer_target_account_id IS NULL")
    .bind(...entryArgs(next),r.entry_id,...source));
 }else if(action==='delete'){
  statements.push(db.prepare('DELETE FROM entries WHERE id=? AND '+
   (adopted?'client_request_id IS ? AND family_account_id=?':'client_request_id=? AND family_account_id IS NULL')+
   (spouseRevision?" AND (type IN('income','expense') OR (type='transfer' AND transfer_target='spouse')) AND family_transfer_target_account_id IS NULL":
    " AND type IN('income','expense') AND family_transfer_target_account_id IS NULL"))
   .bind(r.entry_id,...(adopted?[adopted.original_client_request_id,adopted.account_id]:[ref])));
 }else{
  if(adopted){
   const old={...original,...next};
   const columns=Object.keys(old);
   if(columns.some(k=>!/^[a-z][a-z0-9_]*$/i.test(k)))return fail('LEGACY_SHARED_RESTORE_SCHEMA_REVIEW_REQUIRED');
   statements.push(db.prepare('INSERT INTO entries('+columns.map(k=>'"'+k+'"').join(',')+') VALUES('+
    columns.map(()=>'?').join(',')+')').bind(...columns.map(k=>old[k])));
  }else statements.push(next.type==='transfer'?
   db.prepare('INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,transfer_target,transfer_date,transfer_applied) '+
    "VALUES(?,?,?,?,?,?,?,'',?,?,'','spouse',?,0)").bind(r.entry_id,...entryArgs(next),ref,next.date):
   db.prepare('INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) '+
    "VALUES(?,?,?,?,?,?,?,'',?,?,'')").bind(r.entry_id,...entryArgs(next),ref));
 }
 statements.push(db.prepare('UPDATE family_shared_entry_registry SET state=?,snapshot_json=?,'+
  'payload_sha256=?,version=version+1,last_actor_user_id=?,updated_at=?,'+
  "deleted_at=CASE WHEN ?='delete' THEN ? WHEN ?='restore' THEN NULL ELSE deleted_at END "+
  'WHERE resource_id=? AND version=? AND state=?')
  .bind(action==='delete'?'deleted':'active',snapshot,digest,u.user_id,at,action,at,action,
   id,r.version,action==='restore'?'deleted':'active'));
 statements.push(clear(db,id));
 try{
  const out=await db.batch(statements);
  if(!changesOk(out,4))return fail('SHARED_ENTRY_ATOMIC_CONFIRMATION_REQUIRED',503);
  const saved=await get(db,id,u);
  return json({ok:true,action:visible(saved),applied:true});
 }catch{return fail('SHARED_ENTRY_MUTATION_ROLLED_BACK')}
}
async function purge(req,e,url,u,id){
 const x=await parse(req,url);
 if(!exact(x,['expected_user_id','expected_version','confirm_resource_id'])||
  x.expected_user_id!==u.user_id||x.confirm_resource_id!==id||
  !requireVersion(x.expected_version))return fail('SHARED_ENTRY_PURGE_CONFIRM_REQUIRED',428);
 const db=e.DB,r=await get(db,id,u);
 if(!r)return fail('SHARED_ENTRY_NOT_FOUND',404);
 if(r.state==='purged')return json({ok:true,purged:true,already:true});
 if(!['deleted','purge_pending'].includes(r.state)||r.version!==x.expected_version)
  return fail('SHARED_ENTRY_PURGE_STATE_CONFLICT');
 if(r.state==='deleted'){
  const at=Date.now();
  try{
   const out=await db.batch([
    context(db,r,u,'purge',at),
    db.prepare("UPDATE family_shared_entry_registry SET state='purge_pending',snapshot_json=NULL,"+
     'version=version+1,last_actor_user_id=?,updated_at=? WHERE resource_id=? AND state=\'deleted\' AND version=?')
     .bind(u.user_id,at,id,r.version),
    db.prepare("UPDATE family_shared_entry_attachments SET state='purge_pending',updated_at=? "+
     "WHERE resource_id=? AND state IN('ready','pending')").bind(at,id),
    clear(db,id)
   ]);
   if(out[0]?.meta?.changes!==1||out[1]?.meta?.changes!==1||out[3]?.meta?.changes!==1)
    return fail('SHARED_ENTRY_PURGE_PREPARE_UNKNOWN',503);
  }catch{return fail('SHARED_ENTRY_PURGE_PREPARE_FAILED',503)}
 }
 return cleanupPurge(e,u,id);
}
async function cleanupPurge(e,u,id){
 const db=e.DB,bucket=e.RECEIPTS_R2;
 const p=await get(db,id,u);
 if(p?.state!=='purge_pending')return fail('SHARED_ENTRY_PURGE_STATE_CONFLICT');
 const rows=(await db.prepare("SELECT object_id FROM family_shared_entry_attachments "+
  "WHERE resource_id=? AND state='purge_pending' LIMIT 101").bind(id).all()).results||[];
 if(rows.length>100)return fail('SHARED_ENTRY_PURGE_BATCH_REQUIRED',409);
 if(rows.length&&(!bucket||typeof bucket.delete!=='function'))return fail('SHARED_ENTRY_R2_UNAVAILABLE',503);
 const keys=rows.map(x=>'shared/v1/'+id+'/'+x.object_id);
 try{
  if(keys.length)await bucket.delete(keys);
  const at=Date.now();
  const updated=await db.prepare("UPDATE family_shared_entry_attachments SET state='purged',updated_at=? "+
   "WHERE resource_id=? AND state='purge_pending'").bind(at,id).run();
  const r=await get(db,id,u);
  const out=await db.batch([
   context(db,r,u,'purge',at),
   db.prepare("UPDATE family_shared_entry_registry SET state='purged',"+
     'purged_at=?,version=version+1,last_actor_user_id=?,updated_at=? '+
     "WHERE resource_id=? AND state='purge_pending' AND NOT EXISTS("+
     "SELECT 1 FROM family_shared_entry_attachments WHERE resource_id=? AND state!='purged')")
      .bind(at,u.user_id,at,id,id),
   clear(db,id)
  ]);
  if(out[1]?.meta?.changes!==1)return fail('SHARED_ENTRY_PURGE_FINALIZE_PENDING',503);
  return json({ok:true,purged:true,deleted_objects:rows.length,applied:true});
 }catch{return fail('SHARED_ENTRY_R2_CLEANUP_RETRY',503)}
}
async function list(db,u,url){
 const state=url.searchParams.get('state')||'active';
 if(!['active','deleted','purge_pending','purged'].includes(state))return fail('SHARED_ENTRY_BAD_FILTER',400);
 const rows=(await db.prepare(select+'FROM family_shared_entry_registry r '+
  'WHERE household_id=? AND state=? ORDER BY updated_at DESC,resource_id DESC LIMIT 50')
  .bind(u.household_id,state).all()).results||[];
 return json({ok:true,items:rows.map(visible),household_id:u.household_id,
  ledger_projection:'existing_entries_only',ledger_changed:false});
}
export async function familySharedEntries(req,e,url,u,parts){
 if(!enabled(e))return fail('SHARED_ENTRY_DISABLED',503);
 const role=await liveRole(e.DB,u);
 if(!role)return fail('SHARED_ENTRY_CURRENT_IDENTITY_REQUIRED',403);
 const p=parts.slice(1),method=req.method;
 if(p.length>=2&&p[1]==='attachments')return familySharedAttachments(req,e,url,u,p);
 if(!p.length&&method==='GET')return list(e.DB,u,url);
 if(p.length===1&&id32.test(p[0])&&method==='GET'){
  const r=await get(e.DB,p[0],u);
  return r?json({ok:true,action:visible(r)}):fail('SHARED_ENTRY_NOT_FOUND',404);
 }
 if(role!=='owner')return fail('SHARED_ENTRY_OWNER_REVIEW_REQUIRED',403);
 if(!p.length&&method==='POST')return create(req,e,url,u);
 if(p.length===1&&id32.test(p[0])&&method==='PUT')return modify(req,e,url,u,p[0],'update');
 if(p.length===1&&id32.test(p[0])&&method==='DELETE')return modify(req,e,url,u,p[0],'delete');
 if(p.length===2&&id32.test(p[0])&&method==='POST'){
  if(p[1]==='restore')return modify(req,e,url,u,p[0],'restore');
  if(p[1]==='purge')return purge(req,e,url,u,p[0]);
 }
 return fail('NOT_FOUND',404);
}
