// Original-owner card sharing. HomeFlow SSO identity is supplied by the
// family-finance router; the old access code never grants sharing authority.
// This API records only delegated expense entries, never transfers or card edits.
const id32=/^[a-f0-9]{32}$/i;
const enc=new TextEncoder();
const json=(body,status=200)=>Response.json(body,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer',
 'x-content-type-options':'nosniff'
}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false},status);
const newid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),
 b=>b.toString(16).padStart(2,'0')).join('');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest(
 'SHA-256',enc.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
const goodCard=n=>typeof n==='string'&&n.trim()===n&&n.length>0&&n.length<=80&&
 !['現金','その他','其他','ポイント還元'].includes(n);
const goodDay=v=>typeof v==='string'&&
 /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
 new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
async function body(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 try{
  const raw=await req.text();
  const value=raw.length<=2300?JSON.parse(raw):null;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null;}
}
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
async function list(db,u){
 if(u.role==='owner'){
  const [targets,outgoing]=await Promise.all([
   all(db,"SELECT user_id,display_name FROM homeflow_identity_links "+
    "WHERE household_id=? AND role='member' AND state='active' ORDER BY user_id LIMIT 10",u.household_id),
   all(db,"SELECT s.card_name,s.grantee_user_id,s.is_active,s.version "+
    "FROM family_legacy_card_shares s WHERE s.household_id=? AND s.owner_user_id=? "+
    "ORDER BY s.card_name,s.grantee_user_id LIMIT 200",u.household_id,u.user_id)
  ]);
  return json({ok:true,scope:'owner-card-settings',viewer_user_id:u.user_id,targets,outgoing,ledger_changed:false});
 }
 if(u.role==='member'){
  const incoming=await all(db,
   "SELECT p.name AS card_name,p.source_type,o.display_name AS owner_display_name "+
   "FROM family_legacy_card_shares s "+
   "JOIN payment_sources p ON p.name=s.card_name "+
   "JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id "+
   "JOIN homeflow_identity_links m ON m.user_id=s.grantee_user_id "+
   "WHERE s.household_id=? AND s.grantee_user_id=? AND s.is_active=1 "+
   "AND p.is_archived=0 AND p.stat_group='card' "+
   "AND p.source_type IN ('standard','prepaid') "+
   "AND o.household_id=? AND o.state='active' AND o.role='owner' "+
   "AND m.household_id=? AND m.state='active' AND m.role='member' "+
   "ORDER BY p.sort_order,p.name LIMIT 100",
   u.household_id,u.user_id,u.household_id,u.household_id);
  return json({ok:true,scope:'granted-cards',incoming,ledger_changed:false});
 }
 return fail('ROLE_NOT_ALLOWED',403);
}
async function share(req,db,url,u){
 if(u.role!=='owner')return fail('CARD_OWNER_REQUIRED',403);
 const x=await body(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','card_name','grantee_user_id','enabled','expected_version'])||
  !goodCard(x.card_name)||typeof x.grantee_user_id!=='string'||
  x.grantee_user_id===u.user_id||x.grantee_user_id.length>128||
  typeof x.enabled!=='boolean'||
  !Number.isSafeInteger(x.expected_version)||x.expected_version<0)
  return fail('BAD_CARD_SHARE',400);
 const target=await first(db,
  "SELECT m.user_id FROM homeflow_identity_links m "+
  "JOIN homeflow_identity_links o ON o.household_id=m.household_id "+
  "WHERE m.user_id=? AND m.household_id=? AND m.role='member' AND m.state='active' "+
  "AND o.user_id=? AND o.role='owner' AND o.state='active' "+
  "AND EXISTS(SELECT 1 FROM payment_sources p WHERE p.name=? "+
  "AND p.is_archived=0 AND p.stat_group='card' AND p.source_type IN ('standard','prepaid'))",
  x.grantee_user_id,u.household_id,u.user_id,x.card_name);
 if(!target)return fail('CARD_OR_MEMBER_NOT_SHAREABLE',403);
 const previous=await first(db,
  'SELECT owner_user_id,household_id,version,is_active FROM family_legacy_card_shares '+
  'WHERE card_name=? AND grantee_user_id=?',
  x.card_name,x.grantee_user_id);
 if(previous&&(previous.owner_user_id!==u.user_id||previous.household_id!==u.household_id))
  return fail('SHARE_OWNER_MISMATCH',403);
 if((previous?.version||0)!==x.expected_version)return fail('CARD_SHARE_STALE_VERSION',409);
 if(previous&&Boolean(previous.is_active)===x.enabled)
  return json({ok:true,changed:false,version:previous.version,ledger_changed:false});
 const at=Date.now(),dbStatements=[];
 if(previous){
  dbStatements.push(db.prepare(
   'UPDATE family_legacy_card_shares SET is_active=?,version=version+1,updated_at=? '+
   'WHERE card_name=? AND grantee_user_id=? AND household_id=? AND owner_user_id=? '+
   'AND version=? AND EXISTS(SELECT 1 FROM payment_sources p WHERE p.name=? '+
   "AND p.is_archived=0 AND p.stat_group='card' AND p.source_type IN ('standard','prepaid'))")
   .bind(x.enabled?1:0,at,x.card_name,x.grantee_user_id,u.household_id,
    u.user_id,x.expected_version,x.card_name));
 }else{
  dbStatements.push(db.prepare(
   'INSERT INTO family_legacy_card_shares '+
   '(card_name,household_id,owner_user_id,grantee_user_id,is_active,version,updated_at) '+
   'SELECT p.name,?,?,?,?,1,? FROM payment_sources p '+
   "WHERE p.name=? AND p.is_archived=0 AND p.stat_group='card' "+
   "AND p.source_type IN ('standard','prepaid')")
   .bind(u.household_id,u.user_id,x.grantee_user_id,x.enabled?1:0,at,x.card_name));
 }
 dbStatements.push(db.prepare(
  'INSERT INTO family_legacy_card_share_audit '+
  '(event_id,household_id,card_name,owner_user_id,grantee_user_id,action,version,created_at) '+
  'SELECT ?,household_id,card_name,owner_user_id,grantee_user_id,?,version,? '+
  'FROM family_legacy_card_shares WHERE card_name=? AND grantee_user_id=? AND changes()=1')
  .bind(newid(),x.enabled?'grant':'revoke',at,x.card_name,x.grantee_user_id));
 try{
  const results=await db.batch(dbStatements);
  if(results.some(r=>r.meta?.changes!==1))return fail('CARD_SHARE_CHANGED_DURING_SAVE',409);
  return json({ok:true,changed:true,version:x.expected_version+1,ledger_changed:false});
 }catch{return fail('CARD_SHARE_WRITE_FAILED',503);}
}
async function spend(req,env,db,url,u){
 if(u.role!=='member')return fail('SHARED_CARD_MEMBER_REQUIRED',403);
 const x=await body(req,url);
 if(x?.expected_user_id!==u.user_id)return fail('ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','idempotency_key','card_name','date','time',
  'amount_jpy','merchant','category','note'])||!goodCard(x.card_name)||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !goodDay(x.date)||typeof x.time!=='string'||
  !(x.time===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))||
  !Number.isSafeInteger(x.amount_jpy)||x.amount_jpy<1||x.amount_jpy>10000000||
  typeof x.merchant!=='string'||!x.merchant.trim()||x.merchant.length>120||
  typeof x.category!=='string'||!x.category.trim()||x.category.length>100||
  typeof x.note!=='string'||x.note.length>500)
  return fail('INVALID_SHARED_CARD_EXPENSE',400);
 const record={card_name:x.card_name,date:x.date,time:x.time,
  amount_jpy:x.amount_jpy,merchant:x.merchant.trim(),
  category:x.category.trim(),note:x.note.trim()};
 const digest=await hash(JSON.stringify(record));
 const scope=await hash([u.household_id,u.user_id,'shared-card',x.idempotency_key].join('\0'));
 const spendId=scope.slice(0,32),client='hflegacycard:'+spendId;
 const existing=await first(db,
  'SELECT entry_id,payload_sha256,actor_user_id,household_id,card_name '+
  'FROM family_legacy_card_spends WHERE spend_id=?',spendId);
 if(existing)return existing.actor_user_id===u.user_id&&existing.household_id===u.household_id&&
  existing.payload_sha256===digest&&existing.card_name===x.card_name?
  json({ok:true,entry_id:existing.entry_id,card_name:existing.card_name,
   applied:true,replayed:true,ledger_changed:true}):fail('CARD_SPEND_IDEMPOTENCY_CONFLICT');
 // Historical idempotent receipts remain readable; NEW delegated purchases
 // must use HomeFlow approval via shared-mutation-requests instead.
 if(env.KAKEIBO_LEGACY_CARD_DIRECT_SPEND_ENABLED!=='true')
  return fail('SHARED_CARD_LEDGER_APPROVAL_REQUIRED',409);
 const at=Date.now();
 try{
  // Cloudflare D1 batch commits atomically; the AFTER INSERT trigger writes
  // the spender proof before context is removed. No browser-selected actor.
  const out=await db.batch([
   db.prepare('INSERT INTO family_legacy_card_write_context '+
    '(client_request_id,card_name,household_id,actor_user_id,payload_sha256,created_at) '+
    'VALUES(?,?,?,?,?,?)')
    .bind(client,x.card_name,u.household_id,u.user_id,digest,at),
   db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,'+
    'type,client_request_id,payment_source) '+
    "SELECT ?,?,?,?,?,?,'','expense',?,p.name FROM family_legacy_card_shares s "+
    'JOIN payment_sources p ON p.name=s.card_name '+
    'JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id '+
    'JOIN homeflow_identity_links m ON m.user_id=s.grantee_user_id '+
    'WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? '+
    'AND s.is_active=1 AND p.is_archived=0 AND p.stat_group=\'card\' '+
    "AND p.source_type IN ('standard','prepaid') "+
    "AND o.household_id=? AND o.role='owner' AND o.state='active' "+
    "AND m.household_id=? AND m.role='member' AND m.state='active' "+
    'ON CONFLICT(client_request_id) DO NOTHING')
    .bind(record.date,record.time,record.amount_jpy,record.category,
     record.merchant,record.note,client,record.card_name,u.household_id,u.user_id,
     u.household_id,u.household_id),
   db.prepare('DELETE FROM family_legacy_card_write_context WHERE client_request_id=?').bind(client)
  ]);
  if(out[1]?.meta?.changes!==1){
   const raced=await first(db,'SELECT entry_id,payload_sha256,actor_user_id,household_id '+
    'FROM family_legacy_card_spends WHERE spend_id=?',spendId);
   if(raced?.payload_sha256===digest&&raced.actor_user_id===u.user_id&&
    raced.household_id===u.household_id)
    return json({ok:true,entry_id:raced.entry_id,card_name:record.card_name,
     applied:true,replayed:true,ledger_changed:true});
   return fail('SHARED_CARD_NOT_AUTHORIZED',403);
  }
  if(out[0]?.meta?.changes!==1||out[2]?.meta?.changes!==1)
   return fail('SHARED_CARD_RECEIPT_NOT_CONFIRMED',503);
  const saved=await first(db,'SELECT entry_id,payload_sha256,actor_user_id '+
   'FROM family_legacy_card_spends WHERE spend_id=?',spendId);
  if(!saved||saved.payload_sha256!==digest||saved.actor_user_id!==u.user_id)
   return fail('SHARED_CARD_RECEIPT_NOT_CONFIRMED',503);
  return json({ok:true,entry_id:saved.entry_id,card_name:record.card_name,
   applied:true,replayed:false,ledger_changed:true},201);
 }catch{
  const raced=await first(db,'SELECT entry_id,payload_sha256,actor_user_id,household_id '+
   'FROM family_legacy_card_spends WHERE spend_id=?',spendId).catch(()=>null);
  return raced?.payload_sha256===digest&&raced.actor_user_id===u.user_id&&
   raced.household_id===u.household_id?
   json({ok:true,entry_id:raced.entry_id,card_name:record.card_name,
    applied:true,replayed:true,ledger_changed:true}):fail('SHARED_CARD_WRITE_FAILED',503);
 }
}
export async function familyLegacyCardSharing(req,env,url,user,parts){
 if(!env.DB?.prepare)return fail('D1_UNAVAILABLE',503);
 const p=parts[0],method=req.method;
 if(p==='legacy-card-shares'){
  if(method==='GET'&&parts.length===1)return list(env.DB,user);
  if(method==='POST'&&parts.length===1)return share(req,env.DB,url,user);
 }
 if(p==='legacy-card-spends'&&method==='POST'&&parts.length===1)
  return spend(req,env,env.DB,url,user);
 return fail('NOT_FOUND',404);
}