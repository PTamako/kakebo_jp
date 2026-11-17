import {resolveSharedMutationSealedReference} from '../../family-finance/shared-mutation-sealed-reference.js';
// One immutable HOMEFLOW approval -> one D1 mutation, never an external payment.
// Authentic owner proof, encrypted member intent and receipt are all separate.
const enc=new TextEncoder(),h64=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,s=409)=>reply({ok:false,code,applied:false},s);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const digest=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_SHARED_ENTRY_ENABLED==='true'&&e.KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED==='true'&&
 h64.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 h64.test(e.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET||'')&&
 h64.test(e.KAKEIBO_SHARED_MUTATION_PROOF_SECRET||'')&&e.DB?.prepare&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function signed(req,e,mode){
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||req.headers.get('x-approval-client')!=='homeflow'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 const stamp=req.headers.get('x-approval-timestamp')||'',sig=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||!h64.test(sig))return null;
 let raw,b;try{raw=await req.text();b=raw.length<=1200?JSON.parse(raw):null}catch{return null}
 if(!exact(b,mode==='execute'?['request_id','resource_id','household_id',
   'requester_user_id','payload_sha256','execution_nonce']:
   mode==='preview'?['request_id','resource_id','household_id','requester_user_id',
    'payload_sha256','approver_user_id']:
    ['request_id','resource_id','household_id','requester_user_id','payload_sha256'])||
  !uuid.test(b.request_id)||!id32.test(b.resource_id)||!h64.test(b.payload_sha256)||
  mode==='execute'&&!h64.test(b.execution_nonce)||!b.household_id||!b.requester_user_id)
  return null;
 const expected=await mac(e.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET,
  'homeflow:shared-entry-'+mode,stamp,raw);
 return sig.toLowerCase()===expected?b:null;
}
async function readIntent(e,p){
 try{
  p=await resolveSharedMutationSealedReference(e.DB,p);
  if(!p)return null;
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0));
  const cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>2500)return null;
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(
    e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
    'AES-GCM',false,['decrypt']);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({
   name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-shared-mutation:'+p.proposal_id)},key,cipher));
  if(await digest(raw)!==p.payload_sha256)return null;
  const d=JSON.parse(raw);
  if(!exact(d,['operation','resource_id','expected_version','entry'])||
    d.operation!==p.operation||d.resource_id!==p.resource_id||
    d.expected_version!==p.expected_version||
    !['create','update','delete','restore'].includes(d.operation)||
    (d.operation==='create'||d.operation==='update')!==!!d.entry)return null;
  if(d.entry){
   const x=d.entry,keys=['date','time','amount','type','category','merchant','note'];
   const paid=exact(x,[...keys,'payment_source']);
   const spouse=exact(x,[...keys,'transfer_target','transfer_date']);
   if(!(exact(x,keys)||paid||spouse)||!/^20\d{2}-\d\d-\d\d$/.test(x.date)||
    new Date(x.date+'T00:00:00Z').toISOString().slice(0,10)!==x.date||
    (x.time!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time))||
    !Number.isSafeInteger(x.amount)||x.amount<1||x.amount>10000000||
    !['expense','income','transfer'].includes(x.type)||
    (x.type==='transfer'&&(!spouse||x.transfer_target!=='spouse'||x.transfer_date!==x.date||
     x.category!=='投資・資産移動'||x.merchant!=='配偶への振替'))||
    (x.type!=='transfer'&&spouse)||!x.category||x.category.length>100||
    typeof x.merchant!=='string'||x.merchant.length>120||
    typeof x.note!=='string'||x.note.length>500||
    (paid&&(x.type!=='expense'||typeof x.payment_source!=='string'||
      (d.operation!=='update'&&!x.payment_source.trim())||
      x.payment_source.length>80||x.payment_source!==x.payment_source.trim())))return null;
  }
  return d;
 }catch{return null}
}
async function proof(e,b,expectedVersion,operation){
 const envelope={...b,idempotency_key:'kakeibo:shared-entry:'+b.resource_id,
  expected_version:expectedVersion,purpose:'execute'};
 const raw=JSON.stringify(envelope),stamp=String(Date.now());
 try{
  const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-shared-entry','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(e.KAKEIBO_SHARED_MUTATION_PROOF_SECRET,
     'kakeibo-shared-entry:execution-proof',stamp,raw)},body:raw}));
  if(response.status!==200||response.headers.has('location'))return null;
  const t=await response.text(),r=t.length<=2200?JSON.parse(t):null;
  return r?.ok===true&&r.verified===true&&r.execution_authorized===true&&
    r.execution_status==='executing'&&r.source_app==='kakebo'&&r.target_app==='kakebo'&&
    r.resource_type==='shared_entry_mutation'&&r.operation==='finance.entry.'+operation&&
    r.idempotency_key===envelope.idempotency_key&&r.expected_version===expectedVersion&&
    r.request_id===b.request_id&&r.resource_id===b.resource_id&&
    r.payload_sha256===b.payload_sha256&&r.household_id===b.household_id&&
    r.requester_user_id===b.requester_user_id&&
    r.approver_user_id&&r.approver_user_id!==b.requester_user_id&&
    Number.isSafeInteger(r.approved_at)&&Number.isSafeInteger(r.expires_at)&&
    r.expires_at>Date.now()&&r.applied===false?r:null;
 }catch{return null}
}
const same=(j,b)=>j&&j.homeflow_request_id===b.request_id&&j.proposal_id===b.resource_id&&
 j.household_id===b.household_id&&j.requester_user_id===b.requester_user_id&&
 j.payload_sha256===b.payload_sha256;
async function receipt(db,j,b,replayed){
 const [audit,r,p]=await Promise.all([
  db.prepare('SELECT * FROM family_shared_entry_audit WHERE resource_id=? AND to_version=? LIMIT 1')
   .bind(j.resource_id,j.version_after).first(),
  db.prepare('SELECT * FROM family_shared_entry_registry WHERE resource_id=? AND entry_id=? LIMIT 1')
   .bind(j.resource_id,j.entry_id).first(),
  db.prepare('SELECT * FROM family_shared_mutation_intents WHERE proposal_id=?').bind(j.proposal_id).first()
 ]);
 if(!same(j,b)||!audit||!r||!p||audit.action!==j.action||
  audit.actor_user_id!==j.approver_user_id||audit.from_version!==j.version_before||
  audit.to_version!==j.version_after||r.household_id!==j.household_id||
  p.homeflow_approval_id!==j.homeflow_request_id||p.operation!==j.action||
  p.payload_sha256!==j.payload_sha256)return fail('SHARED_MUTATION_RECEIPT_COUNTERPART_UNKNOWN',503);
 return reply({ok:true,applied:true,approval_id:j.homeflow_request_id,
  proposal_id:j.proposal_id,household_id:j.household_id,
  requester_user_id:j.requester_user_id,approver_user_id:j.approver_user_id,
  actor_user_id:j.actor_user_id,payload_sha256:j.payload_sha256,
  operation:'finance.entry.'+j.action,resource_type:'shared_entry_mutation',
  action:j.action,resource_id:j.resource_id,entry_id:j.entry_id,
  version_before:j.version_before,version_after:j.version_after,
  applied_at:j.applied_at,already_applied:replayed,
  entry_type:'ordinary_income_expense',immutable_receipt:true,
  financial_journal_rewritten:false});
}
async function write(e,p,b,approval,payload){
 const db=e.DB,at=Date.now();
 const source=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?')
  .bind(p.requester_user_id,p.household_id).first();
 const owner=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?')
  .bind(approval.approver_user_id,p.household_id).first();
 if(source?.state!=='active'||source.role!=='member'||owner?.state!=='active'||owner.role!=='owner')
  return fail('SHARED_MUTATION_CURRENT_ROLE_REVOKED',403);
 const action=p.operation,newRecord=action==='create';
 const registry=newRecord?null:await db.prepare('SELECT * FROM family_shared_entry_registry WHERE resource_id=? AND household_id=? LIMIT 1')
  .bind(p.resource_id,p.household_id).first();
 if(!newRecord&&(!registry||registry.version!==p.expected_version||
  registry.state!==(action==='restore'?'deleted':'active')))
  return fail('SHARED_MUTATION_TARGET_CAS_CHANGED');
 const id=newRecord?(await digest([p.household_id,approval.approver_user_id,
  'shared-entry','approved:'+p.proposal_id].join('\0'))).slice(0,32):registry.resource_id;
 if(newRecord&&await db.prepare('SELECT 1 FROM family_shared_entry_registry WHERE resource_id=?')
  .bind(id).first())return fail('SHARED_MUTATION_RESOURCE_COLLISION');
 // An adopted legacy shared row retains its original account, request ID,
 // OCR/raw fields and exact primary key. It must never be rewritten as a new
 // hfshare row during an approved member update/delete/restore.
 const adopted=!newRecord&&e.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED==='true'?
  await db.prepare('SELECT * FROM family_legacy_shared_adoptions WHERE resource_id=? '+
   'AND entry_id=? AND household_id=? AND original_owner_user_id=? LIMIT 1')
   .bind(registry.resource_id,registry.entry_id,p.household_id,approval.approver_user_id).first():null;
 let original=null;
 if(adopted){
  const acct=await db.prepare('SELECT owner_user_id,household_id,is_archived '+
   'FROM family_financial_accounts WHERE account_id=? LIMIT 1').bind(adopted.account_id).first();
  try{original=JSON.parse(adopted.original_row_json)}catch{return fail('SHARED_MUTATION_LEGACY_ROW_INVALID')}
  if(!original||typeof original!=='object'||Array.isArray(original)||
    Object.keys(original).length>40||
    Object.keys(original).some(k=>!/^[a-z][a-z0-9_]*$/i.test(k))||
    Object.values(original).some(v=>v!==null&&typeof v!=='string'&&
     !(typeof v==='number'&&Number.isSafeInteger(v)))||
    original.id!==registry.entry_id||original.family_account_id!==adopted.account_id||
    original.client_request_id!==adopted.original_client_request_id||
    original.family_transfer_target_account_id!==null||
    acct?.owner_user_id!==approval.approver_user_id||
    acct.household_id!==p.household_id||acct.is_archived!==0)
   return fail('SHARED_MUTATION_LEGACY_OWNER_OR_PROVENANCE_CHANGED',409);
 }
 const previous=registry?JSON.parse(registry.snapshot_json):null;
 const explicitPayment=action==='update'&&
  Object.hasOwn(payload.entry,'payment_source');
 let originalPayment='';
 if(action==='update'){
  const physical=await db.prepare('SELECT type,payment_source,family_account_id FROM entries WHERE id=? LIMIT 1')
   .bind(registry.entry_id).first();
  if(!physical)return fail('SHARED_MUTATION_ENTRY_MISSING',409);
  originalPayment=String(physical.payment_source||'');
  // A card charge cannot be converted into income without reversing its bill.
  if(physical.type==='expense'&&originalPayment&&payload.entry.type!=='expense')
   return fail('SHARED_MUTATION_CARD_TYPE_LOCKED',409);
  if(explicitPayment){
   const author=await db.prepare("SELECT requester_user_id FROM family_shared_mutation_applied "+
    "WHERE entry_id=? AND action='create' LIMIT 1").bind(registry.entry_id).first();
   if(author?.requester_user_id!==p.requester_user_id||
    physical.family_account_id!==null||physical.type!=='expense'||
    payload.entry.type!=='expense'||adopted)
    return fail('SHARED_MUTATION_PAYMENT_OWNER_MISMATCH',403);
   if(payload.entry.payment_source){
    // Recheck the grant at execution, not just when the request was prepared.
    const granted=await db.prepare("SELECT 1 FROM family_legacy_card_shares s "+
     "JOIN payment_sources card ON card.name=s.card_name "+
     "WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? "+
     "AND s.owner_user_id=? AND s.is_active=1 AND card.is_archived=0 "+
     "AND card.stat_group='card' AND card.source_type IN ('standard','prepaid') LIMIT 1")
     .bind(payload.entry.payment_source,p.household_id,p.requester_user_id,
      approval.approver_user_id).first();
    if(!granted)return fail('SHARED_CARD_GRANT_REVOKED',403);
   }
  }
 }
 const entry=action==='restore'?previous:action==='update'&&!explicitPayment&&previous?.payment_source?
  {...payload.entry,payment_source:previous.payment_source}:payload.entry;
 // Explicit change is approved by HomeFlow; omitted payment keeps the old source.
 if(action==='restore'&&entry?.payment_source){
  const active=await db.prepare("SELECT 1 FROM family_legacy_card_shares s "+
   "JOIN payment_sources card ON card.name=s.card_name "+
   "WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? "+
   "AND s.owner_user_id=? AND s.is_active=1 AND card.is_archived=0 "+
   "AND card.stat_group='card' AND card.source_type IN ('standard','prepaid') LIMIT 1")
   .bind(entry.payment_source,p.household_id,p.requester_user_id,approval.approver_user_id).first();
  if(!active)return fail('SHARED_CARD_GRANT_REVOKED',403);
 }
 const snapshot=action==='delete'?registry.snapshot_json:JSON.stringify(entry);
 const sha=await digest(snapshot);
 const reference='hfshare:'+id;
 const stmts=[];
 if(newRecord){
  if(entry.payment_source){
   // Recheck the active grant inside the same D1 batch that posts the entry.
   // A revoked/shared card cannot be posted by an old approved request.
   stmts.push(db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) '+
    "SELECT ?,?,?,?,?,?,'',?,?,card.name FROM family_legacy_card_shares s "+
    "JOIN payment_sources card ON card.name=s.card_name "+
    "JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id "+
    "WHERE s.card_name=? AND s.household_id=? AND s.owner_user_id=? "+
    "AND s.grantee_user_id=? AND s.is_active=1 AND card.is_archived=0 "+
    "AND card.stat_group='card' AND card.source_type IN ('standard','prepaid') "+
    "AND o.household_id=s.household_id AND o.role='owner' AND o.state='active'")
    .bind(entry.date,entry.time,entry.amount,entry.category,entry.merchant,
     entry.note,entry.type,reference,entry.payment_source,p.household_id,
     approval.approver_user_id,p.requester_user_id));
  }else if(entry.type==='transfer'){
   stmts.push(db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,transfer_target,transfer_date,transfer_applied) '+
    "VALUES(?,?,?,?,?,?,'',?,?,'','spouse',?,0)")
    .bind(entry.date,entry.time,entry.amount,entry.category,entry.merchant,entry.note,'transfer',reference,entry.date));
  }else{
   stmts.push(db.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) '+
    "VALUES(?,?,?,?,?,?,'',?,?,'')")
    .bind(entry.date,entry.time,entry.amount,entry.category,entry.merchant,entry.note,entry.type,reference));
  }
  stmts.push(db.prepare('INSERT INTO family_shared_entry_write_context '+
   '(resource_id,entry_id,actor_user_id,action,expected_version,stamp) '+
   "SELECT ?,id,?,'create',0,? FROM entries WHERE client_request_id=? AND changes()=1")
   .bind(id,approval.approver_user_id,at,reference));
  stmts.push(db.prepare('INSERT INTO family_shared_entry_registry '+
   '(resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,state,version,'+
   'snapshot_json,payload_sha256,created_at,updated_at) '+
   "SELECT ?,?,id,?,?,'active',1,?,?,?,? FROM entries WHERE client_request_id=? AND changes()=1")
   .bind(id,p.household_id,approval.approver_user_id,approval.approver_user_id,snapshot,sha,at,at,reference));
 }else{
  stmts.push(db.prepare('INSERT INTO family_shared_entry_write_context '+
   '(resource_id,entry_id,actor_user_id,action,expected_version,stamp) VALUES(?,?,?,?,?,?)')
   .bind(id,registry.entry_id,approval.approver_user_id,action,p.expected_version,at));
  // SQL CAS checks the immutable original source identifiers for adopted
  // rows; stale accounts or mismatched IDs cause the entire D1 batch to abort.
  const where=adopted?
   'client_request_id IS ? AND family_account_id=?':
   'client_request_id=? AND family_account_id IS NULL';
  const sourceArgs=adopted?[adopted.original_client_request_id,adopted.account_id]:[reference];
  const spouseRevision=entry?.type==='transfer'||previous?.type==='transfer';
  if(action==='update')stmts.push(spouseRevision?
   db.prepare('UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=?,transfer_target=?,transfer_date=?,transfer_applied=0'+
    (explicitPayment?',payment_source=?':'')+' '+
    'WHERE id=? AND '+where+' AND family_transfer_target_account_id IS NULL '+
    "AND (type IN('income','expense') OR (type='transfer' AND transfer_target='spouse'))")
    .bind(entry.date,entry.time,entry.amount,entry.category,entry.merchant,entry.note,entry.type,
     entry.type==='transfer'?'spouse':null,entry.type==='transfer'?entry.date:null,
     ...(explicitPayment?[entry.payment_source]:[]),registry.entry_id,...sourceArgs):
   db.prepare('UPDATE entries SET date=?,time=?,amount=?,category=?,merchant=?,note=?,type=?'+
    (explicitPayment?',payment_source=?':'')+' '+
    'WHERE id=? AND '+where+' AND family_transfer_target_account_id IS NULL '+
    "AND type IN('income','expense')")
    .bind(entry.date,entry.time,entry.amount,entry.category,entry.merchant,entry.note,entry.type,
     ...(explicitPayment?[entry.payment_source]:[]),registry.entry_id,...sourceArgs));
  else if(action==='delete')stmts.push(db.prepare('DELETE FROM entries WHERE id=? AND '+where+
   (spouseRevision?" AND (type IN('income','expense') OR (type='transfer' AND transfer_target='spouse')) AND family_transfer_target_account_id IS NULL":
    " AND type IN('income','expense') AND family_transfer_target_account_id IS NULL"))
   .bind(registry.entry_id,...sourceArgs));
  else if(adopted){
   const old={...original,...entry},columns=Object.keys(old);
   stmts.push(db.prepare('INSERT INTO entries('+
    columns.map(k=>'"'+k+'"').join(',')+') VALUES('+
    columns.map(()=>'?').join(',')+')').bind(...columns.map(k=>old[k])));
  }else stmts.push(entry.type==='transfer'?
   db.prepare('INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,transfer_target,transfer_date,transfer_applied) '+
    "VALUES(?,?,?,?,?,?,?,'',?,?,?,?,?,0)")
    .bind(registry.entry_id,entry.date,entry.time,entry.amount,entry.category,entry.merchant,entry.note,entry.type,reference,entry.payment_source||'','spouse',entry.date):
   db.prepare('INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source) '+
    "VALUES(?,?,?,?,?,?,?,'',?,?,?)")
    .bind(registry.entry_id,entry.date,entry.time,entry.amount,entry.category,entry.merchant,entry.note,entry.type,reference,entry.payment_source||''));
  stmts.push(db.prepare('UPDATE family_shared_entry_registry SET version=version+1,'+
   'state=?,snapshot_json=?,payload_sha256=?,last_actor_user_id=?,updated_at=?,'+
   "deleted_at=CASE WHEN ?='delete' THEN ? WHEN ?='restore' THEN NULL ELSE deleted_at END "+
   'WHERE resource_id=? AND household_id=? AND state=? AND version=?')
   .bind(action==='delete'?'deleted':'active',snapshot,sha,approval.approver_user_id,at,
    action,at,action,id,p.household_id,action==='restore'?'deleted':'active',registry.version));
 }
 stmts.push(db.prepare('INSERT INTO family_shared_mutation_applied '+
  '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,'+
  'actor_user_id,resource_id,entry_id,action,version_before,version_after,payload_sha256,applied_at) '+
  'SELECT ?,?,?,?,?,?,?,entry_id,?,?,?,?,? FROM family_shared_entry_registry WHERE resource_id=?')
  .bind(b.request_id,p.proposal_id,p.household_id,p.requester_user_id,
   approval.approver_user_id,approval.approver_user_id,id,action,p.expected_version,
   p.expected_version+1,p.payload_sha256,at,id));
 stmts.push(db.prepare('DELETE FROM family_shared_entry_write_context WHERE resource_id=?').bind(id));
 // D1 can commit the complete batch while a statement reports an unreliable
 // affected-row count. Read the immutable, versioned receipt before deciding.
 let metadataConfirmed=false,batchThrew=false;
 try{
  const result=await db.batch(stmts);
  metadataConfirmed=result.length===stmts.length&&result.every(x=>x.meta?.changes===1);
 }catch{batchThrew=true}
 const saved=await db.prepare('SELECT * FROM family_shared_mutation_applied WHERE homeflow_request_id=?')
  .bind(b.request_id).first().catch(()=>null);
 if(same(saved,b))return receipt(db,saved,b,batchThrew||!metadataConfirmed);
 if(batchThrew)return fail('SHARED_MUTATION_BATCH_ROLLED_BACK',503);
 return fail(metadataConfirmed?'SHARED_MUTATION_RECEIPT_UNKNOWN':
  'SHARED_MUTATION_ATOMIC_CONFIRMATION_REQUIRED',503);
}
async function preview(e,b){
 // Private, read-only view of a sealed household ledger proposal for its
 // current owner. The HomeFlow endpoint authenticates the owner browser.
 // Kakeibo independently checks roles and immutable proposal identity.
 const db=e.DB;
 const owner=await db.prepare('SELECT role,state FROM homeflow_identity_links '+
  'WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(b.approver_user_id,b.household_id).first();
 const member=await db.prepare('SELECT role,state FROM homeflow_identity_links '+
  'WHERE user_id=? AND household_id=? LIMIT 1')
  .bind(b.requester_user_id,b.household_id).first();
 if(owner?.role!=='owner'||owner.state!=='active'||
  member?.role!=='member'||member.state!=='active'||
  b.approver_user_id===b.requester_user_id)return fail('SHARED_MUTATION_PREVIEW_FORBIDDEN',403);
 const p=await db.prepare('SELECT * FROM family_shared_mutation_intents '+
  'WHERE proposal_id=? AND homeflow_approval_id=? AND household_id=? '+
  'AND requester_user_id=? AND payload_sha256=? LIMIT 1')
  .bind(b.resource_id,b.request_id,b.household_id,b.requester_user_id,b.payload_sha256).first();
 if(!p||p.status!=='submitted')return fail('SHARED_MUTATION_PREVIEW_NOT_FOUND',404);
 const intent=await readIntent(e,p);
 if(!intent)return fail('SHARED_MUTATION_PREVIEW_UNAVAILABLE',503);
 let before=null;
 if(p.operation!=='create'){
  const r=await db.prepare('SELECT snapshot_json,state,version FROM family_shared_entry_registry '+
   'WHERE resource_id=? AND household_id=? LIMIT 1')
   .bind(p.resource_id,p.household_id).first();
  if(r?.snapshot_json){
   try{before=JSON.parse(r.snapshot_json)}
   catch{return fail('SHARED_MUTATION_PREVIEW_UNAVAILABLE',503)}
  }
 }
 return reply({ok:true,approval_id:b.request_id,proposal_id:p.proposal_id,
  operation:'finance.entry.'+p.operation,ledger_changed:false,
  entry:intent.entry||null,before,expected_version:p.expected_version});
}
export async function approvedSharedMutationRoute(req,e,parts){
 if(!ready(e))return fail('SHARED_MUTATION_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt','preview'].includes(parts[0]))return fail('NOT_FOUND',404);
 const mode=parts[0],b=await signed(req,e,mode);
 if(!b||mode==='preview'&&(!b.approver_user_id||
   typeof b.approver_user_id!=='string'||b.approver_user_id.length>128))
  return fail('SHARED_MUTATION_SIGNATURE_REQUIRED',403);
 if(mode==='preview')return preview(e,b);
 const db=e.DB;
 const prev=await db.prepare('SELECT * FROM family_shared_mutation_applied '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1').bind(b.request_id,b.resource_id).first();
 if(prev)return same(prev,b)?receipt(db,prev,b,true):fail('SHARED_MUTATION_APPROVAL_CONFLICT');
 if(mode==='receipt')return fail('SHARED_MUTATION_RECEIPT_UNKNOWN',404);
 const p=await db.prepare('SELECT * FROM family_shared_mutation_intents '+
  'WHERE proposal_id=? AND homeflow_approval_id=? LIMIT 1').bind(b.resource_id,b.request_id).first();
 if(!p||p.status!=='submitted'||p.household_id!==b.household_id||
  p.requester_user_id!==b.requester_user_id||p.payload_sha256!==b.payload_sha256||
  p.expires_at<=Date.now())return fail('SHARED_MUTATION_INTENT_NOT_CURRENT');
 const payload=await readIntent(e,p);
 if(!payload)return fail('SHARED_MUTATION_SEALED_INTENT_INVALID');
 const approved=await proof(e,b,p.expected_version,p.operation);
 if(!approved)return fail('SHARED_MUTATION_OWNER_PROOF_INVALID',409);
 return write(e,p,b,approved,payload);
}

export async function onRequest({request,env,params}){
 return approvedSharedMutationRoute(request,env,params.path||[])
}
