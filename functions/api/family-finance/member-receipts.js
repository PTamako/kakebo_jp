// Private member receipts: same source image form as owner, distinct R2 keys and D1 ownership.
// Never use receipts/v1/<legacy-id> or the owner's global receipt index.
const ID=/^[a-f0-9]{32}$/,HEX=/^[a-f0-9]{64}$/,MIME=new Set(['image/jpeg','image/webp']);
const MAX=200*1024,ENC=new TextEncoder();
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code},status);
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(v=>v.toString(16).padStart(2,'0')).join('');
const exact=(x,fields)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===fields.slice().sort().join('|');
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const randomId=()=>[...crypto.getRandomValues(new Uint8Array(16))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
const fields='receipt_id,receipt_ref,receipt_date,merchant,state,content_type,size_bytes,sha256,created_at,updated_at';
const exposed=r=>({receipt_id:r.receipt_id,receipt_ref:r.receipt_ref,date:r.receipt_date,
 merchant:r.merchant,state:r.state,content_type:r.content_type,
 size_bytes:r.size_bytes,created_at:r.created_at,updated_at:r.updated_at});
const isDate=s=>typeof s==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const safeString=(x,n)=>typeof x==='string'&&x.length<=n&&[...x].every(y=>y.charCodeAt(0)>=32);
async function parse(req,url){
 if(req.headers.get('origin')!==url.origin||
    req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const body=await req.text();if(body.length>950)return null;
  return JSON.parse(body)}catch{return null}
}
async function owner(db,user){
 if(user?.role!=='member'||!user.user_id||!user.household_id)return false;
 const row=await first(db,"SELECT role,state FROM homeflow_identity_links "+
  "WHERE user_id=? AND household_id=?",user.user_id,user.household_id);
 return row?.role==='member'&&row?.state==='active';
}
async function referenceOwned(db,user,ref){
 if(typeof ref!=='string'||ref.length>96)return false;
 const [kind,value]=ref.split(':');
 if(kind==='proposal'&&ID.test(value)){
  return !!await first(db,"SELECT 1 FROM family_shared_mutation_intents WHERE "+
   "proposal_id=? AND requester_user_id=? AND household_id=? AND operation='create' "+
   "AND status IN('submitted','prepared')",value,user.user_id,user.household_id);
 }
 if(kind==='entry'&&/^[1-9]\d{0,14}$/.test(value)&&Number.isSafeInteger(Number(value))){
  return !!await first(db,"SELECT 1 FROM family_legacy_card_spends "+
   "WHERE entry_id=? AND actor_user_id=? AND household_id=?",Number(value),
   user.user_id,user.household_id);
 }
 if(kind==='request'&&ID.test(value)){
  const card=await first(db,"SELECT 1 FROM family_card_purchase_intents WHERE "+
   "request_id=? AND requester_user_id=? AND household_id=?",value,user.user_id,user.household_id);
  if(card)return true;
  return !!await first(db,"SELECT 1 FROM family_prepaid_action_intents WHERE "+
   "request_id=? AND requester_user_id=? AND household_id=? AND action='spend'",
   value,user.user_id,user.household_id);
 }
 return false;
}
async function row(db,user,id){
 return first(db,'SELECT * FROM family_member_receipts WHERE receipt_id=? '+
 'AND household_id=? AND owner_user_id=?',id,user.household_id,user.user_id);
}
async function objectKey(user,id){
 const scope=(await digest(ENC.encode(user.household_id+'\u0000'+user.user_id))).slice(0,32);
 return 'member/v1/'+scope+'/'+id;
}
async function list(req,e,user){
 const items=(await e.DB.prepare('SELECT '+fields+' FROM family_member_receipts '+
  "WHERE household_id=? AND owner_user_id=? AND state='ready' "+
  'ORDER BY created_at DESC,receipt_id DESC LIMIT 1001')
  .bind(user.household_id,user.user_id).all()).results||[];
 if(items.length>1000)return fail('MEMBER_RECEIPTS_LIMIT',413);
 return json({ok:true,scope:'personal',viewer_user_id:user.user_id,items:items.map(exposed)});
}
async function prepare(req,e,url,user){
 const x=await parse(req,url);
 if(x?.expected_user_id!==user.user_id)return fail('MEMBER_RECEIPT_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','idempotency_key','receipt_ref','receipt_date','merchant',
  'content_type','size_bytes','sha256'])||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !isDate(x.receipt_date)||!safeString(x.merchant,120)||
  !MIME.has(x.content_type)||!Number.isSafeInteger(x.size_bytes)||
  x.size_bytes<1||x.size_bytes>MAX||!HEX.test(x.sha256))
  return fail('MEMBER_RECEIPT_BAD_INPUT',400);
 if(!await referenceOwned(e.DB,user,x.receipt_ref))return fail('MEMBER_RECEIPT_REFERENCE_FORBIDDEN',403);
 const hash=await digest(ENC.encode([user.household_id,user.user_id,x.idempotency_key].join('\u0000')));
 const previous=await first(e.DB,'SELECT * FROM family_member_receipts WHERE idempotency_hash=?',hash);
 if(previous){
  return previous.household_id===user.household_id&&previous.owner_user_id===user.user_id&&
   previous.receipt_ref===x.receipt_ref&&previous.sha256===x.sha256&&
   previous.content_type===x.content_type&&previous.size_bytes===x.size_bytes?
   json({ok:true,item:exposed(previous),replayed:true}):fail('MEMBER_RECEIPT_IDEMPOTENCY_CONFLICT');
 }
 const id=randomId(),at=Date.now();
 try{
  const r=await e.DB.prepare('INSERT INTO family_member_receipts '+
   '(receipt_id,household_id,owner_user_id,receipt_ref,receipt_date,merchant,'+
   'idempotency_hash,content_type,size_bytes,sha256,state,created_at,updated_at) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)")
   .bind(id,user.household_id,user.user_id,x.receipt_ref,x.receipt_date,x.merchant,
     hash,x.content_type,x.size_bytes,x.sha256,at,at).run();
  if(r.meta?.changes!==1)return fail('MEMBER_RECEIPT_PREPARE_UNKNOWN',503);
  return json({ok:true,item:exposed(await row(e.DB,user,id))},201);
 }catch{return fail('MEMBER_RECEIPT_PREPARE_FAILED',503)}
}
async function upload(req,e,url,user,id){
 const a=await row(e.DB,user,id);
 if(!a)return fail('MEMBER_RECEIPT_NOT_FOUND',404);
 if(a.state==='ready')return json({ok:true,item:exposed(a),replayed:true});
 if(a.state!=='pending')return fail('MEMBER_RECEIPT_TOMBSTONED',410);
 if(req.headers.get('origin')!==url.origin)return fail('MEMBER_RECEIPT_ORIGIN_REQUIRED',403);
 const mime=req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
 if(!MIME.has(mime)||mime!==a.content_type)return fail('MEMBER_RECEIPT_TYPE_CHANGED',415);
 if(Number(req.headers.get('content-length')||0)>MAX)return fail('MEMBER_RECEIPT_TOO_LARGE',413);
 const bytes=await req.arrayBuffer();
 if(bytes.byteLength!==a.size_bytes||bytes.byteLength>MAX||
  await digest(bytes)!==a.sha256)return fail('MEMBER_RECEIPT_DIGEST_MISMATCH',409);
 // Repeat identity check before writing; revoked or deleted originating proposals
 // cannot create new R2 data.
 if(!await referenceOwned(e.DB,user,a.receipt_ref))return fail('MEMBER_RECEIPT_REFERENCE_REVOKED',403);
 const key=await objectKey(user,id);
 try{
  const stored=await e.RECEIPTS_R2.put(key,bytes,{
   onlyIf:new Headers({'If-None-Match':'*'}),
   httpMetadata:{contentType:mime},customMetadata:{sha256:a.sha256}
  });
  const object=stored||await e.RECEIPTS_R2.head(key);
  if(object?.size!==a.size_bytes||object?.httpMetadata?.contentType!==mime||
    object?.customMetadata?.sha256!==a.sha256)return fail('MEMBER_RECEIPT_R2_UNCONFIRMED',503);
  const updated=await e.DB.prepare("UPDATE family_member_receipts SET state='ready',updated_at=? "+
    "WHERE receipt_id=? AND household_id=? AND owner_user_id=? AND state='pending'")
    .bind(Date.now(),id,user.household_id,user.user_id).run();
  if(updated.meta?.changes!==1)return fail('MEMBER_RECEIPT_RECONCILE_REQUIRED',503);
  return json({ok:true,item:exposed(await row(e.DB,user,id))});
 }catch{return fail('MEMBER_RECEIPT_UPLOAD_RETRY',503)}
}
async function download(e,user,id){
 const a=await row(e.DB,user,id);
 if(!a||a.state!=='ready')return fail('MEMBER_RECEIPT_NOT_FOUND',404);
 const object=await e.RECEIPTS_R2.get(await objectKey(user,id));
 if(!object||object.size!==a.size_bytes||
   object.httpMetadata?.contentType!==a.content_type||
   object.customMetadata?.sha256!==a.sha256)return fail('MEMBER_RECEIPT_R2_MISMATCH',503);
 return new Response(object.body,{status:200,headers:{
  'content-type':a.content_type,'content-length':String(a.size_bytes),
  'cache-control':'no-store, private','cross-origin-resource-policy':'same-origin',
  'content-security-policy':"default-src 'none'; sandbox", 'x-content-type-options':'nosniff'
 }});
}
async function remove(req,e,url,user,id){
 const a=await row(e.DB,user,id);
 if(!a)return fail('MEMBER_RECEIPT_NOT_FOUND',404);
 if(req.headers.get('origin')!==url.origin||req.headers.get('x-confirm-receipt')!==id)
  return fail('MEMBER_RECEIPT_DELETE_CONFIRM_REQUIRED',428);
 if(a.state==='purged')return json({ok:true,purged:true,replayed:true});
 if(!['ready','pending','purge_pending'].includes(a.state))return fail('MEMBER_RECEIPT_NOT_DELETABLE');
 if(a.state!=='purge_pending'){
  const deleted=await e.DB.prepare("UPDATE family_member_receipts SET state='purge_pending',updated_at=? "+
    "WHERE receipt_id=? AND household_id=? AND owner_user_id=? AND state IN('ready','pending')")
    .bind(Date.now(),id,user.household_id,user.user_id).run();
  if(deleted.meta?.changes!==1)return fail('MEMBER_RECEIPT_DELETE_CONFLICT');
 }
 try{
  await e.RECEIPTS_R2.delete(await objectKey(user,id));
  const out=await e.DB.prepare("UPDATE family_member_receipts SET state='purged',updated_at=? "+
    "WHERE receipt_id=? AND household_id=? AND owner_user_id=? AND state='purge_pending'")
    .bind(Date.now(),id,user.household_id,user.user_id).run();
  if(out.meta?.changes!==1)return fail('MEMBER_RECEIPT_DELETE_RETRY',503);
  return json({ok:true,purged:true});
 }catch{return fail('MEMBER_RECEIPT_R2_DELETE_RETRY',503)}
}
export async function familyMemberReceipts(req,e,url,user,parts){
 if(!e.DB?.prepare||!e.RECEIPTS_R2||typeof e.RECEIPTS_R2.get!=='function')
  return fail('MEMBER_RECEIPT_STORAGE_UNAVAILABLE',503);
 try{
  if(!await owner(e.DB,user))return fail('MEMBER_RECEIPT_MEMBER_REQUIRED',403);
  if(parts.length===1){
   if(req.method==='GET')return list(req,e,user);
   if(req.method==='POST')return prepare(req,e,url,user);
   return fail('METHOD_NOT_ALLOWED',405);
  }
  if(parts.length===2&&ID.test(parts[1])){
   if(req.method==='GET')return download(e,user,parts[1]);
   if(req.method==='PUT')return upload(req,e,url,user,parts[1]);
   if(req.method==='DELETE')return remove(req,e,url,user,parts[1]);
  }
  return fail('NOT_FOUND',404);
 }catch{return fail('MEMBER_RECEIPT_SERVICE_UNAVAILABLE',503)}
}
