// PRIVATE shared ledger attachments. Never use legacy receipts/v1/<numeric ID>.
// D1 metadata first, R2 second; unfinished deletes remain tombstoned and retryable.
const id32=/^[a-f0-9]{32}$/,h64=/^[a-f0-9]{64}$/,types=new Set(['image/webp','image/jpeg']);
const maxBytes=200*1024;
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code},status);
const enc=new TextEncoder();
const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',v))].map(b=>b.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const key=(entry,object)=>'shared/v1/'+entry+'/'+object;
const list=(db,r)=>db.prepare('SELECT object_id,state,content_type,sha256,size_bytes,created_at FROM family_shared_entry_attachments '+
 'WHERE resource_id=? ORDER BY created_at DESC,object_id DESC LIMIT 20').bind(r);
async function parent(db,u,id){
 return db.prepare('SELECT resource_id,household_id,creator_user_id,state FROM family_shared_entry_registry '+
  'WHERE resource_id=? AND household_id=? LIMIT 1').bind(id,u.household_id).first();
}
async function row(db,r,o){
 return db.prepare('SELECT * FROM family_shared_entry_attachments WHERE resource_id=? AND object_id=? LIMIT 1')
  .bind(r,o).first();
}
async function validActor(db,u){
 const r=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(u.user_id,u.household_id).first();
 return r?.state==='active'&&['owner','member'].includes(r.role)?r.role:null;
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=300?JSON.parse(raw):null}catch{return null}
}
const exposed=a=>({object_id:a.object_id,state:a.state,size_bytes:a.size_bytes,
 content_type:a.content_type,sha256:a.sha256});
async function begin(req,e,url,u,r){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id','idempotency_key','content_type','sha256','size_bytes'])||
  x.expected_user_id!==u.user_id||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !types.has(x.content_type)||!h64.test(x.sha256)||
  !Number.isSafeInteger(x.size_bytes)||x.size_bytes<1||x.size_bytes>maxBytes)
  return fail('SHARED_ATTACHMENT_INVALID',400);
 const digest=await hash(enc.encode([r.resource_id,u.user_id,x.idempotency_key].join('\0')));
 const id=digest.slice(0,32);
 const prev=await row(e.DB,r.resource_id,id);
 if(prev)return prev.sha256===x.sha256&&prev.content_type===x.content_type&&prev.size_bytes===x.size_bytes?
  json({ok:true,attachment:exposed(prev),replayed:true}):fail('SHARED_ATTACHMENT_CONFLICT');
 const at=Date.now();
 try{
  const changed=await e.DB.prepare('INSERT INTO family_shared_entry_attachments '+
   '(object_id,resource_id,state,content_type,sha256,size_bytes,created_by_user_id,created_at,updated_at) '+
   "SELECT ?,?,'pending',?,?,?,?,?,? WHERE EXISTS("+
   "SELECT 1 FROM family_shared_entry_registry WHERE resource_id=? AND state='active')")
   .bind(id,r.resource_id,x.content_type,x.sha256,x.size_bytes,u.user_id,at,at,r.resource_id).run();
  return changed.meta?.changes===1?
   json({ok:true,attachment:exposed(await row(e.DB,r.resource_id,id)),replayed:false},201):
   fail('SHARED_ATTACHMENT_PARENT_CHANGED');
 }catch{return fail('SHARED_ATTACHMENT_PREPARE_CONFLICT')}
}
async function upload(req,e,url,u,parentRow,existing){
 if(parentRow.state!=='active'||existing.state!=='pending')return fail('SHARED_ATTACHMENT_NOT_WRITABLE');
 if(req.headers.get('origin')!==url.origin)return fail('SHARED_ATTACHMENT_ORIGIN',403);
 const mime=(req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(mime!==existing.content_type)return fail('SHARED_ATTACHMENT_MIME_CHANGED',415);
 const size=Number(req.headers.get('content-length')||0);
 if(size>maxBytes)return fail('SHARED_ATTACHMENT_TOO_LARGE',413);
 const bytes=await req.arrayBuffer();
 if(bytes.byteLength!==existing.size_bytes||bytes.byteLength>maxBytes||
  await hash(bytes)!==existing.sha256)return fail('SHARED_ATTACHMENT_HASH_CHANGED',409);
 const objectKey=key(parentRow.resource_id,existing.object_id);
 let confirmed;
 try{
  const saved=await e.RECEIPTS_R2.put(objectKey,bytes,{
   onlyIf:new Headers({'If-None-Match':'*'}),
   httpMetadata:{contentType:mime},
   customMetadata:{sha256:existing.sha256},
   sha256:existing.sha256
  });
  confirmed=saved||await e.RECEIPTS_R2.head(objectKey);
  if(confirmed?.size!==bytes.byteLength||confirmed?.customMetadata?.sha256!==existing.sha256||
    confirmed?.httpMetadata?.contentType!==mime)return fail('SHARED_ATTACHMENT_R2_INDETERMINATE',503);
  // A concurrent deletion / purge can never promote the object to readable.
  const changed=await e.DB.prepare("UPDATE family_shared_entry_attachments SET state='ready',updated_at=? "+
   "WHERE object_id=? AND resource_id=? AND state='pending' AND EXISTS("+
   "SELECT 1 FROM family_shared_entry_registry WHERE resource_id=? AND state='active')")
   .bind(Date.now(),existing.object_id,parentRow.resource_id,parentRow.resource_id).run();
  if(changed.meta?.changes!==1)return fail('SHARED_ATTACHMENT_TOMBSTONED_AFTER_UPLOAD',503);
  return json({ok:true,attachment:exposed(await row(e.DB,parentRow.resource_id,existing.object_id))});
 }catch{return fail('SHARED_ATTACHMENT_WRITE_RETRY',503)}
}
async function remove(e,parentRow,existing){
 if(existing.state==='purged')return json({ok:true,purged:true,replayed:true});
 const at=Date.now();
 if(existing.state!=='purge_pending'){
  try{
   const d=await e.DB.prepare("UPDATE family_shared_entry_attachments SET state='purge_pending',updated_at=? "+
    "WHERE object_id=? AND resource_id=? AND state IN('ready','pending')")
    .bind(at,existing.object_id,parentRow.resource_id).run();
   if(d.meta?.changes!==1)return fail('SHARED_ATTACHMENT_DELETE_STATE_UNKNOWN');
  }catch{return fail('SHARED_ATTACHMENT_DELETE_STATE_UNKNOWN')}
 }
 // Always deny reads after the D1 tombstone, including on failed R2.delete.
 try{
  await e.RECEIPTS_R2.delete(key(parentRow.resource_id,existing.object_id));
  const d=await e.DB.prepare("UPDATE family_shared_entry_attachments SET state='purged',updated_at=? "+
   "WHERE object_id=? AND resource_id=? AND state='purge_pending'")
   .bind(Date.now(),existing.object_id,parentRow.resource_id).run();
  return d.meta?.changes===1?json({ok:true,purged:true}):
   fail('SHARED_ATTACHMENT_DELETE_RECEIPT_UNKNOWN',503);
 }catch{return fail('SHARED_ATTACHMENT_R2_DELETE_RETRY',503)}
}
async function download(e,r,a){
 if(a.state!=='ready')return fail('SHARED_ATTACHMENT_NOT_FOUND',404);
 const object=await e.RECEIPTS_R2.get(key(r.resource_id,a.object_id));
 if(!object)return fail('SHARED_ATTACHMENT_R2_MISSING',503);
 if(object.size!==a.size_bytes||object.httpMetadata?.contentType!==a.content_type||
  object.customMetadata?.sha256!==a.sha256)return fail('SHARED_ATTACHMENT_R2_MISMATCH',503);
 return new Response(object.body,{status:200,headers:{
  'content-type':a.content_type,'content-length':String(a.size_bytes),
  'cache-control':'no-store, private','x-content-type-options':'nosniff',
  'cross-origin-resource-policy':'same-origin'
 }});
}
export async function familySharedAttachments(req,e,url,u,parts){
 if(!e.RECEIPTS_R2||typeof e.RECEIPTS_R2.get!=='function')return fail('SHARED_ATTACHMENT_R2_DISABLED',503);
 if(parts.length<2||parts[1]!=='attachments'||!id32.test(parts[0]))
  return fail('NOT_FOUND',404);
 const role=await validActor(e.DB,u);
 if(!role)return fail('SHARED_ATTACHMENT_ACTOR_REVOKED',403);
 const r=await parent(e.DB,u,parts[0]);
 if(!r)return fail('SHARED_ATTACHMENT_NOT_FOUND',404);
 const owner=role==='owner';
 const method=req.method;
 if(parts.length===2&&method==='GET'){
  if(r.state==='purge_pending'||r.state==='purged')return fail('SHARED_ATTACHMENT_PURGED',410);
  if(r.state==='deleted'&&!owner)return fail('SHARED_ATTACHMENT_TRASH_OWNER_ONLY',403);
  const result=(await list(e.DB,r.resource_id).all()).results||[];
  return json({ok:true,items:result.map(exposed)});
 }
 if(parts.length===2&&method==='POST'&&owner&&r.state==='active')
  return begin(req,e,url,u,r);
 if(parts.length!==3||!id32.test(parts[2]))return fail('NOT_FOUND',404);
 if(r.state==='purge_pending'||r.state==='purged')return fail('SHARED_ATTACHMENT_PURGED',410);
 const a=await row(e.DB,r.resource_id,parts[2]);
 if(!a)return fail('SHARED_ATTACHMENT_NOT_FOUND',404);
 if(method==='GET'&&r.state==='active'||method==='GET'&&owner&&r.state==='deleted')
  return download(e,r,a);
 if(!owner)return fail('SHARED_ATTACHMENT_OWNER_REQUIRED',403);
 if(method==='PUT')return upload(req,e,url,u,r,a);
 if(method==='DELETE'){
  if(req.headers.get('origin')!==url.origin||
    req.headers.get('x-confirm-attachment')!==a.object_id)return fail('SHARED_ATTACHMENT_DELETE_CONFIRM',428);
  return remove(e,r,a);
 }
 return fail('NOT_FOUND',404);
}
