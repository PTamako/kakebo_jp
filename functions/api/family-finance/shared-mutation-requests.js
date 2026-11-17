import {resolveSharedMutationSealedReference} from './shared-mutation-sealed-reference.js';
// DRAFT: member-originated ordinary shared ledger mutation proposals.
// This module stores AES-GCM encrypted intent, NOT an executed entry.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const json=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,s=409)=>json({ok:false,code,applied:false},s);
const exact=(x,k)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===k.slice().sort().join(',');
const fresh=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
const digest=async str=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(str)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_SHARED_ENTRY_ENABLED==='true'&&e.KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED==='true'&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&hex.test(e.KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET||'')&&
 e.DB?.prepare&&typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function member(db,u){
 const r=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?')
  .bind(u.user_id,u.household_id).first();
 return u.role==='member'&&r?.role==='member'&&r?.state==='active';
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const t=await req.text();return t.length<=2100?JSON.parse(t):null}catch{return null}
}
const date=s=>typeof s==='string'&&/^20\d\d-\d\d-\d\d$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const entryKeys=['date','time','amount','type','category','merchant','note'];
function cleanEntry(x,allowCashSelection=false){
 const paid=exact(x,[...entryKeys,'payment_source']);
 const spouse=exact(x,[...entryKeys,'transfer_target','transfer_date']);
 if(!(exact(x,entryKeys)||paid||spouse)||!date(x.date)||
  typeof x.time!=='string'||(x.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))||
  !Number.isSafeInteger(x.amount)||x.amount<1||x.amount>10000000||
  !['income','expense','transfer'].includes(x.type)||
  (x.type==='transfer'&&(!spouse||x.transfer_target!=='spouse'||x.transfer_date!==x.date||
   x.category!=='投資・資産移動'||x.merchant!=='配偶への振替'))||
  (x.type!=='transfer'&&spouse)||
  typeof x.category!=='string'||!x.category.trim()||x.category.length>100||
  typeof x.merchant!=='string'||x.merchant.length>120||
  typeof x.note!=='string'||x.note.length>500||
  (paid&&(x.type!=='expense'||typeof x.payment_source!=='string'||
   (!allowCashSelection&&!x.payment_source.trim())||
   x.payment_source.length>80||x.payment_source!==x.payment_source.trim())))return null;
 return {date:x.date,time:x.time,amount:x.amount,type:x.type,
  category:x.category.trim(),merchant:x.merchant.trim(),note:x.note.trim(),
  ...(paid?{payment_source:x.payment_source}:{}),
  ...(spouse?{transfer_target:'spouse',transfer_date:x.transfer_date}:{})};
}
const shape=p=>({proposal_id:p.proposal_id,operation:p.operation,resource_id:p.resource_id,
 expected_version:p.expected_version,payload_sha256:p.payload_sha256,
 status:p.status==='submitted'?'submitted_status_unknown':p.status,
 homeflow_approval_id:p.homeflow_approval_id||null,
 created_at:p.created_at,expires_at:p.expires_at,applied:false});
const get=(db,id,u)=>db.prepare('SELECT * FROM family_shared_mutation_intents '+
 'WHERE proposal_id=? AND household_id=? AND requester_user_id=? LIMIT 1')
 .bind(id,u.household_id,u.user_id).first();
async function seal(e,id,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-shared-mutation:'+id)},key,enc.encode(raw));
 const b64=x=>btoa(String.fromCharCode(...x));
 return {iv:b64(iv),cipher:b64(new Uint8Array(cipher))};
}
async function mac(secret,stamp,raw,domain='kakeibo-shared-entry:submit'){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,
  enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
const operation=o=>'finance.entry.'+o;
async function prepare(req,e,url,u){
 const x=await read(req,url);
 if(!x||x.expected_user_id!==u.user_id)return fail('SHARED_MUTATION_ACTOR_CHANGED',403);
 if(!exact(x,['expected_user_id','idempotency_key','operation','resource_id','expected_version','entry'])||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !['create','update','delete','restore'].includes(x.operation)||
  (x.operation==='create'?(x.resource_id!==null||x.expected_version!==0):
   (!id.test(x.resource_id)||!Number.isSafeInteger(x.expected_version)||x.expected_version<1)))
  return fail('SHARED_MUTATION_INVALID_FIELDS',400);
 const entry=x.operation==='create'||x.operation==='update'?
  cleanEntry(x.entry,x.operation==='update'):null;
 if((x.operation==='create'||x.operation==='update')&&!entry||
    ['delete','restore'].includes(x.operation)&&x.entry!==null)
  return fail('SHARED_MUTATION_INVALID_ENTRY',400);
 // Neutral spouse transfers are applied via the one-row shared-entry path,
 // never converted into a pending owner review by an old cached PWA.
 if(x.operation==='create'&&entry?.type==='transfer')
  return fail('NEUTRAL_SPOUSE_TRANSFER_NO_OWNER_REVIEW',410);
 if(entry?.payment_source){
  const granted=await e.DB.prepare("SELECT 1 FROM family_legacy_card_shares s "+
   "JOIN payment_sources card ON card.name=s.card_name "+
   "JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id "+
   "WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? "+
   "AND s.is_active=1 AND card.is_archived=0 AND card.stat_group='card' "+
   "AND card.source_type IN ('standard','prepaid') "+
   "AND o.household_id=s.household_id AND o.role='owner' AND o.state='active' LIMIT 1")
   .bind(entry.payment_source,u.household_id,u.user_id).first();
  if(!granted)return fail('SHARED_CARD_GRANT_REQUIRED',403);
 }
 if(x.operation!=='create'){
  const reg=await e.DB.prepare('SELECT state,version,entry_id,creator_user_id,snapshot_json FROM family_shared_entry_registry '+
   'WHERE resource_id=? AND household_id=?').bind(x.resource_id,u.household_id).first();
  if(reg?.version!==x.expected_version||reg.state!==(x.operation==='restore'?'deleted':'active'))
   return fail('SHARED_MUTATION_RESOURCE_CHANGED');
  // A member may submit an edit for a spouse-created neutral transfer too:
  // HomeFlow owner approval, not the submitter, authorizes any ledger change.
  // What never changes through this route is the neutral spouse-only target.
  let before;
  try{before=JSON.parse(reg.snapshot_json)}catch{return fail('SHARED_MUTATION_RESOURCE_CHANGED')}
  if(before?.type==='transfer'&&(before.transfer_target!=='spouse'||
   x.operation==='update'&&(entry.type!=='transfer'||entry.transfer_target!=='spouse')))
   return fail('SHARED_MUTATION_TRANSFER_TYPE_LOCKED',409);
  if(x.operation==='update'&&Object.hasOwn(entry,'payment_source')){
   // The private executor and Pages must both explicitly permit this operation.
   if(e.KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED!=='true')
    return fail('SHARED_PAYMENT_EXECUTOR_NOT_READY',503);
   // Only the original posting member may propose a payment-source revision.
   // Administrator authority and an unrelated member's ledger visibility do
   // not grant ownership of another person's card.
   const [author,physical]=await Promise.all([
    e.DB.prepare("SELECT requester_user_id FROM family_shared_mutation_applied "+
     "WHERE entry_id=? AND action='create' LIMIT 1").bind(reg.entry_id).first(),
    e.DB.prepare('SELECT family_account_id,type FROM entries WHERE id=? LIMIT 1')
     .bind(reg.entry_id).first()
   ]);
   if(author?.requester_user_id!==u.user_id||!physical||
    physical.family_account_id!==null||physical.type!=='expense'||entry.type!=='expense')
    return fail('OTHER_MEMBERS_PAYMENT_READ_ONLY',403);
  }
 }
 const payload={operation:x.operation,resource_id:x.resource_id,expected_version:x.expected_version,entry};
 const raw=JSON.stringify(payload),sha=await digest(raw);
 const scope=await digest([u.household_id,u.user_id,'shared-mutation',x.idempotency_key].join('\0'));
 const prev=await e.DB.prepare('SELECT * FROM family_shared_mutation_intents WHERE idempotency_hash=?')
  .bind(scope).first();
 if(prev)return prev.payload_sha256===sha&&prev.requester_user_id===u.user_id&&prev.household_id===u.household_id?
  json({ok:true,prepared:shape(prev),replayed:true}):fail('SHARED_MUTATION_IDEMPOTENCY_CONFLICT');
 const proposal=fresh(),at=Date.now(),cipher=await seal(e,proposal,raw);
 try{
  const res=await e.DB.prepare('INSERT INTO family_shared_mutation_intents '+
   '(proposal_id,household_id,requester_user_id,operation,resource_id,expected_version,'+
   'payload_sha256,payload_cipher,payload_iv,idempotency_hash,created_at,expires_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(proposal,u.household_id,u.user_id,x.operation,x.resource_id,x.expected_version,
    sha,cipher.cipher,cipher.iv,scope,at,at+14*86400000).run();
  return res.meta?.changes===1?json({ok:true,prepared:shape(await get(e.DB,proposal,u))},201):
   fail('SHARED_MUTATION_PREPARE_UNKNOWN',503);
 }catch{return fail('SHARED_MUTATION_PREPARE_CONFLICT')}
}
async function submit(req,e,url,u,proposal){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)
  return fail('SHARED_MUTATION_ACTOR_CHANGED',403);
 const p=await get(e.DB,proposal,u);
 if(!p)return fail('SHARED_MUTATION_NOT_FOUND',404);
 if(p.status==='submitted'&&uuid.test(p.homeflow_approval_id))
  return json({ok:true,approval_id:p.homeflow_approval_id,status:'submitted_status_unknown',
   applied:false,replayed:true});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('SHARED_MUTATION_NOT_SUBMITTABLE');
 if(p.operation!=='create'){
  const r=await e.DB.prepare('SELECT state,version FROM family_shared_entry_registry '+
   'WHERE resource_id=? AND household_id=?').bind(p.resource_id,u.household_id).first();
  if(r?.version!==p.expected_version||r.state!==(p.operation==='restore'?'deleted':'active'))
   return fail('SHARED_MUTATION_CAS_CHANGED');
 }
 const wire={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.proposal_id,payload_sha256:p.payload_sha256,
  operation:operation(p.operation),expected_version:p.expected_version};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 let remote;
 try{
  const r=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/shared-entry-submit',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-shared-entry','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET,stamp,raw)},body:raw}));
  if(![200,201].includes(r.status)||r.headers.has('location'))return fail('SHARED_MUTATION_HOMEFLOW_RETRY',503);
  const t=await r.text();remote=t.length<=1500?JSON.parse(t):null;
 }catch{return fail('SHARED_MUTATION_HOMEFLOW_RETRY',503)}
 if(remote?.ok!==true||!uuid.test(remote.approval_id)||remote.applied!==false||
  remote.resource_id!==p.proposal_id||remote.payload_sha256!==p.payload_sha256||
  remote.household_id!==p.household_id||remote.requester_user_id!==p.requester_user_id||
  remote.expected_version!==p.expected_version||remote.operation!==operation(p.operation))
  return fail('SHARED_MUTATION_HOMEFLOW_UNCONFIRMED',503);
 try{
  const res=await e.DB.prepare("UPDATE family_shared_mutation_intents SET status='submitted',"+
   'homeflow_approval_id=?,submitted_at=? WHERE proposal_id=? AND household_id=? '+
   "AND requester_user_id=? AND status='prepared' AND expires_at>?")
   .bind(remote.approval_id,Date.now(),proposal,u.household_id,u.user_id,Date.now()).run();
  if(res.meta?.changes!==1){
   const raced=await get(e.DB,proposal,u);
   return raced?.homeflow_approval_id===remote.approval_id?
    json({ok:true,approval_id:remote.approval_id,status:'submitted_status_unknown',applied:false,replayed:true}):
    fail('SHARED_MUTATION_SUBMISSION_RECONCILE',503);
  }
  return json({ok:true,approval_id:remote.approval_id,status:'submitted_status_unknown',applied:false});
 }catch{return fail('SHARED_MUTATION_SUBMISSION_RECONCILE',503)}
}

const pendingStates=new Set(['pending','approved','executing','failed_retryable','failed_final','conflict']);
async function decryptIntent(e,record){
 try{
  record=await resolveSharedMutationSealedReference(e.DB,record);
  if(!record)return null;
  const iv=Uint8Array.from(atob(record.payload_iv),x=>x.charCodeAt(0));
  const ciphertext=Uint8Array.from(atob(record.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||ciphertext.length<16||ciphertext.length>2500)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(
   e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
   'AES-GCM',false,['decrypt']);
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-shared-mutation:'+record.proposal_id)},key,ciphertext);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(await digest(raw)!==record.payload_sha256)return null;
  const value=JSON.parse(raw);
  if(!exact(value,['operation','resource_id','expected_version','entry'])||
   value.operation!==record.operation||value.resource_id!==record.resource_id||
   value.expected_version!==record.expected_version)return null;
  if(['create','update'].includes(value.operation)){
   const entry=cleanEntry(value.entry);
   return entry?{...value,entry}:null;
  }
  return value.entry===null?value:null;
 }catch{return null}
}
async function verifiedStatuses(e,u,rows){
 const ids=[...new Set(rows.map(x=>x.homeflow_approval_id))];
 if(!ids.length)return new Map();
 const raw=JSON.stringify({household_id:u.household_id,requester_user_id:u.user_id,
  approval_ids:ids}),stamp=String(Date.now());
 const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
  new URL('/api/internal/approvals/shared-entry-status',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-shared-entry','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET,stamp,raw,
     'kakeibo-shared-entry:status')},body:raw}));
 if(response.status!==200||response.headers.has('location'))
  throw Error('approval_status_not_verified');
 const result=await response.json();
 if(result?.ok!==true||!Array.isArray(result.items)||result.items.length!==ids.length)
  throw Error('approval_status_incomplete');
 const statuses=new Map();
 for(const item of result.items){
  const source=rows.find(row=>row.homeflow_approval_id===item.approval_id);
  if(!source||statuses.has(item.approval_id)||
   item.resource_id!==source.proposal_id||
   item.operation!=='finance.entry.'+source.operation||
   !['pending','approved','rejected','cancelled','expired','executing','applied',
    'failed_retryable','failed_final','conflict'].includes(item.status))
   throw Error('approval_status_mismatch');
  statuses.set(item.approval_id,item.status);
 }
 return statuses;
}
// Pending items are a UI-only projection. They never write entries or participate
// in household statistics, monthly totals or asset balances.
async function ledgerProjection(e,u,month){
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))
  return fail('INVALID_MONTH',400);
 const rows=(await e.DB.prepare("SELECT * FROM family_shared_mutation_intents "+
  "WHERE household_id=? AND requester_user_id=? AND status='submitted' "+
  "ORDER BY created_at DESC LIMIT 60").bind(u.household_id,u.user_id).all()).results||[];
 const candidates=rows.filter(row=>uuid.test(row.homeflow_approval_id||''));
 let states;
 try{states=await verifiedStatuses(e,u,candidates)}
 catch{return fail('APPROVAL_STATUS_UNAVAILABLE',503)}
 const items=[];
 for(const row of candidates){
  const status=states.get(row.homeflow_approval_id);
  if(!pendingStates.has(status))continue;
  const payload=await decryptIntent(e,row);
  if(!payload)return fail('SEALED_LEDGER_INTENT_INVALID',503);
  let original=null;
  if(row.operation!=='create'){
   original=await e.DB.prepare('SELECT entry_id,snapshot_json,version,state FROM family_shared_entry_registry '+
    'WHERE resource_id=? AND household_id=? LIMIT 1')
    .bind(row.resource_id,u.household_id).first();
   if(!original||original.state!=='active')continue;
  }
  let originalDate=null;
  if(original){
   try{originalDate=JSON.parse(original.snapshot_json).date}catch{return fail('LEDGER_SNAPSHOT_INVALID',503)}
  }
  if((originalDate||payload.entry?.date||'').slice(0,7)!==month)continue;
  items.push({proposal_id:row.proposal_id,approval_id:row.homeflow_approval_id,
   operation:row.operation,status,entry:payload.entry,
   source_entry_id:original?.entry_id||null,
   requested_at:row.created_at});
 }
 return json({ok:true,ledger_scope:'member_pending_only',items,applied:false});
}

async function cancel(req,e,url,u,proposal){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)return fail('SHARED_MUTATION_ACTOR_CHANGED',403);
 const p=await get(e.DB,proposal,u);
 if(!p)return fail('SHARED_MUTATION_NOT_FOUND',404);
 if(p.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('SHARED_MUTATION_SUBMITTED_CANCEL_IN_HOMEFLOW');
 try{
  const r=await e.DB.prepare("UPDATE family_shared_mutation_intents SET status='cancelled' "+
   "WHERE proposal_id=? AND requester_user_id=? AND status='prepared'")
   .bind(proposal,u.user_id).run();
  return r.meta?.changes===1?json({ok:true,status:'cancelled'}):fail('SHARED_MUTATION_CANCEL_RACE');
 }catch{return fail('SHARED_MUTATION_CANCEL_RACE')}
}
export async function familySharedMutationRequests(req,e,url,u,parts){
 if(!ready(e))return fail('SHARED_MUTATION_PROPOSALS_DISABLED',503);
 if(!await member(e.DB,u))return fail('SHARED_MUTATION_MEMBER_REQUIRED',403);
 if(parts.length===1&&req.method==='POST')return prepare(req,e,url,u);
 if(parts.length===1&&req.method==='GET'&&url.searchParams.get('view')==='ledger')
  return ledgerProjection(e,u,url.searchParams.get('month')||'');
 if(parts.length===1&&req.method==='GET'){
  const rows=(await e.DB.prepare('SELECT * FROM family_shared_mutation_intents '+
   'WHERE household_id=? AND requester_user_id=? ORDER BY created_at DESC LIMIT 30')
   .bind(u.household_id,u.user_id).all()).results||[];
  return json({ok:true,items:rows.map(shape)});
 }
 if(parts.length>=2&&!id.test(parts[1]))return fail('NOT_FOUND',404);
 if(parts.length===2&&req.method==='GET'){
  const p=await get(e.DB,parts[1],u);
  return p?json({ok:true,prepared:shape(p)}):fail('NOT_FOUND',404);
 }
 if(parts.length===3&&req.method==='POST'){
  if(parts[2]==='submit')return submit(req,e,url,u,parts[1]);
  if(parts[2]==='cancel')return cancel(req,e,url,u,parts[1]);
 }
 return fail('NOT_FOUND',404);
}
