import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHmac,createHash,webcrypto} from 'node:crypto'
import {familySharedMutationRequests} from '../functions/api/family-finance/shared-mutation-requests.js'
import {familySharedEntries} from '../functions/api/family-finance/shared-entries.js'
import {approvedSharedMutationRoute} from '../functions/api/internal/shared-entries/[[path]].js'
import {futurePaidRegistrationCommands} from '../functions/api/internal/future-paid-registration.js'
import {memberCardLiabilities} from '../functions/api/family-finance/card-settlement-summary.js'
import {memberPrepaidBalances} from '../functions/api/family-finance/prepaid-balance-projection.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const hh='primary'
const secrets={pending:'1'.repeat(64),submit:'2'.repeat(64),execution:'3'.repeat(64),proof:'4'.repeat(64)}
const makeMac=(domain,secret,stamp,raw)=>createHmac('sha256',Buffer.from(secret,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex')
const sample={date:'2026-11-14',time:'12:00',amount:1100,type:'expense',
 category:'食費',merchant:'スーパー',note:'普通の家庭費用'}
function fixture({accountCorrections=false}={}){
 const sql=new DatabaseSync(':memory:')
 sql.exec('PRAGMA foreign_keys=ON')
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)')
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)')
 sql.exec(accountCorrections?
  'CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,is_archived INTEGER,account_kind TEXT,origin TEXT,closing_day INTEGER,label TEXT,version INTEGER,created_at INTEGER)':
  'CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,is_archived INTEGER)')
 sql.exec('CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT)')
 sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER,size_bytes INTEGER)')
 sql.exec("CREATE TABLE payment_sources(name TEXT PRIMARY KEY,is_archived INTEGER DEFAULT 0,stat_group TEXT DEFAULT 'card',source_type TEXT DEFAULT 'standard')")
 sql.exec('CREATE TABLE family_legacy_card_shares(card_name TEXT,household_id TEXT,owner_user_id TEXT,grantee_user_id TEXT,is_active INTEGER)')
 sql.exec("INSERT INTO payment_sources(name) VALUES('楽天カード')")
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT,time TEXT,amount INTEGER,category TEXT,'+
  'merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,'+
  'family_account_id TEXT,family_transfer_target_account_id TEXT,transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER DEFAULT 0)')
 if(accountCorrections){
  for(const s of [
   'CREATE TABLE family_card_purchase_applied(entry_id INTEGER PRIMARY KEY,household_id TEXT,requester_user_id TEXT,homeflow_request_id TEXT,account_id TEXT,bill_month TEXT,amount_jpy INTEGER)',
   'CREATE TABLE family_prepaid_actions_applied(entry_id INTEGER PRIMARY KEY,household_id TEXT,requester_user_id TEXT,homeflow_request_id TEXT,action TEXT,prepaid_account_id TEXT)',
   'CREATE TABLE family_card_settlement_allocations(purchase_request_id TEXT,amount_jpy INTEGER)',
   'CREATE TABLE family_points_card_offsets(homeflow_request_id TEXT,purchase_request_id TEXT,amount_jpy INTEGER)',
   'CREATE TABLE family_points_card_offset_refunds(original_request_id TEXT,restored_jpy INTEGER)',
   'CREATE TABLE family_prepaid_balance_journal(prepaid_account_id TEXT,household_id TEXT,delta_jpy INTEGER)',
   'CREATE TABLE family_member_prepaid_topups(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)',
   'CREATE TABLE family_member_prepaid_topup_corrections(household_id TEXT,before_account_id TEXT,before_amount_jpy INTEGER,after_account_id TEXT,after_amount_jpy INTEGER)',
   'CREATE TABLE family_points_prepaid_credits(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)',
   'CREATE TABLE family_points_prepaid_refunds(prepaid_account_id TEXT,household_id TEXT,debited_prepaid_jpy INTEGER)',
  ])sql.exec(s)
 }
 if(accountCorrections)sql.exec("CREATE TRIGGER trg_family_card_purchase_entry_no_update BEFORE UPDATE ON entries "+
  "WHEN EXISTS(SELECT 1 FROM family_card_purchase_applied p WHERE p.entry_id=OLD.id) "+
  "BEGIN SELECT RAISE(ABORT,'CARD_PURCHASE_ENTRY_IMMUTABLE'); END");
 for(const version of ['0051_shared_entry_lifecycle.sql','0052_shared_mutation_approved_execution.sql','0055_legacy_shared_entry_adoption.sql','0058_adopted_shared_mutation_approval.sql','0068_neutral_spouse_transfer.sql','0069_member_neutral_spouse_transfer.sql','0074_member_neutral_spouse_revision.sql',...(accountCorrections?['0100_approved_account_corrections.sql','0101_future_paid_entry_registration.sql','0102_future_paid_correction_serial_guards.sql','0105_future_card_correction_entry_guard.sql','0106_owner_account_correction_journal.sql']:[])])
  sql.exec(readFileSync(new URL('../migrations/'+version,import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,?,'active')").run(u,hh,role)
 const db={prepare(q){return {bind(...args){return {
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(commands){
  sql.exec('BEGIN IMMEDIATE')
  try{const res=commands.map(s=>s.sync());sql.exec('COMMIT');return res}
  catch(e){sql.exec('ROLLBACK');if(accountCorrections)console.error('FUTURE_FINANCE_BATCH_ROLLBACK',e.message);throw e}
 }}
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_SHARED_ENTRY_ENABLED:'true',KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED:'true',
  KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED:'true',
  KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED:'true',
  KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED:accountCorrections?'true':'false',
  KAKEIBO_FAMILY_PENDING_KEY:secrets.pending,
  KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET:secrets.submit,
  KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET:secrets.execution,
  KAKEIBO_SHARED_MUTATION_PROOF_SECRET:secrets.proof,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test'}
 const approvals=new Map()
 let approved=true,receipts=0
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  const pathname=new URL(req.url).pathname,stamp=req.headers.get('x-approval-timestamp')
  const body=await req.text(),x=JSON.parse(body)
  if(pathname==='/api/internal/approvals/shared-entry-submit'){
   assert.equal(req.headers.get('x-approval-client'),'kakeibo-shared-entry')
   assert.equal(req.headers.get('x-approval-signature'),makeMac('kakeibo-shared-entry:submit',secrets.submit,stamp,body))
   const original=approvals.get(x.resource_id)
   if(original&&original.payload!==x.payload_sha256)
    return Response.json({ok:false},{status:409})
   const id=original?.id||crypto.randomUUID()
   approvals.set(x.resource_id,{id,payload:x.payload_sha256,operation:x.operation})
   return Response.json({ok:true,approval_id:id,resource_id:x.resource_id,
    household_id:x.household_id,requester_user_id:x.requester_user_id,
    payload_sha256:x.payload_sha256,operation:x.operation,
    expected_version:x.expected_version,applied:false})
  }
  assert.equal(pathname,'/api/internal/approvals/verify')
  assert.equal(req.headers.get('x-approval-client'),'kakeibo-shared-entry')
  assert.equal(req.headers.get('x-approval-signature'),
   makeMac('kakeibo-shared-entry:execution-proof',secrets.proof,stamp,body))
  if(!approved)return Response.json({error:'revoked'},{status:409})
  assert.equal(x.execution_nonce,'f'.repeat(64))
  const old=approvals.get(x.resource_id)
  assert.equal(x.request_id,old.id)
  return Response.json({ok:true,verified:true,execution_authorized:true,
   execution_status:'executing',source_app:'kakebo',target_app:'kakebo',
   resource_type:'shared_entry_mutation',operation:old.operation,
   idempotency_key:'kakeibo:shared-entry:'+x.resource_id,
   expected_version:x.expected_version,request_id:x.request_id,
   resource_id:x.resource_id,household_id:x.household_id,
   requester_user_id:x.requester_user_id,payload_sha256:x.payload_sha256,
   approver_user_id:owner,approved_at:Date.now()-1000,
   expires_at:Date.now()+100000,applied:false})
 }}
 const user={user_id:member,household_id:hh,role:'member'}
 const ownerUser={user_id:owner,household_id:hh,role:'owner'}
 const origin='https://kakeibo.example.test/api/family-finance/shared-mutation-requests'
 async function source(parts,body,actor=user){
  const req=new Request(origin,{method:'POST',
   headers:{origin:new URL(origin).origin,'content-type':'application/json'},
   body:JSON.stringify(body)})
  const res=await familySharedMutationRequests(req,env,new URL(origin),actor,parts)
  return {status:res.status,data:await res.json()}
 }
 async function apply(op,resourceId,version,entry,idempotency='shared-mutation-'+crypto.randomUUID()){
  const x={expected_user_id:member,idempotency_key:idempotency,operation:op,
   resource_id:resourceId,expected_version:version,entry}
  const p=await source(['shared-mutation-requests'],x)
  assert.equal(p.status,201,JSON.stringify(p))
  const proposal=p.data.prepared.proposal_id
  const sub=await source(['shared-mutation-requests',proposal,'submit'],{expected_user_id:member})
  assert.equal(sub.status,200,JSON.stringify(sub))
  return {request_id:sub.data.approval_id,resource_id:proposal,household_id:hh,
   requester_user_id:member,payload_sha256:p.data.prepared.payload_sha256}
 }
 async function target(mode,b,invalid=false){
  receipts++
  const wire=mode==='execute'?{...b,execution_nonce:'f'.repeat(64)}:b
  const raw=JSON.stringify(wire),stamp=String(Date.now())
  const req=new Request('https://kakeibo.internal/api/internal/shared-entries/'+mode,{
   method:'POST',headers:{'content-type':'application/json','x-approval-client':'homeflow',
    'x-approval-timestamp':stamp,
    'x-approval-signature':invalid?'0'.repeat(64):makeMac('homeflow:shared-entry-'+mode,secrets.execution,stamp,raw)},
   body:raw})
  const res=await approvedSharedMutationRoute(req,env,[mode])
  return {status:res.status,data:await res.json()}
 }
 const count=table=>sql.prepare('SELECT COUNT(*) n FROM '+table).get().n
 return {sql,env,apply,target,source,user,ownerUser,count,approvals,
  disableProof(){approved=false},close(){sql.close()}}
}
test('member cannot directly mutate ledger, but owner signed approval creates exactly one regular shared income/expense with immutable actors',async()=>{
 const f=fixture()
 try{
  const outsider=await f.source(['shared-mutation-requests'],
   {expected_user_id:owner,idempotency_key:'owner-fake-new-shared-entry',
    operation:'create',resource_id:null,expected_version:0,entry:sample},f.ownerUser)
  assert.equal(outsider.status,403)
  const b=await f.apply('create',null,0,sample)
  assert.equal(f.count('entries'),0)
  assert.equal((await f.target('receipt',b)).status,404)
  assert.equal((await f.target('execute',b,true)).status,403)
  const posted=await f.target('execute',b)
  assert.equal(posted.status,200,JSON.stringify(posted))
  assert.equal(posted.data.action,'create')
  assert.equal(posted.data.version_after,1)
  assert.equal(f.count('entries'),1)
  assert.equal(f.count('family_shared_entry_registry'),1)
  assert.equal(f.count('family_shared_entry_audit'),1)
  assert.equal(f.count('family_shared_mutation_applied'),1)
  assert.equal((await f.target('receipt',b)).data.already_applied,true)
  assert.equal((await f.target('execute',b)).data.already_applied,true)
  assert.equal(f.count('entries'),1)
  assert.throws(()=>f.sql.prepare('DELETE FROM family_shared_mutation_applied').run(),/IMMUTABLE/)
  assert.throws(()=>f.sql.prepare('UPDATE entries SET amount=1').run(),/CONTEXT_REQUIRED/)
 }finally{f.close()}
})
test('revision CAS, owner audit and cross-D1 receipt: approved update/delete/restore change only source entry once',async()=>{
 const f=fixture()
 try{
  const first=await f.target('execute',await f.apply('create',null,0,sample))
  assert.equal(first.status,200,JSON.stringify(first))
  const id=first.data.resource_id
  const update=await f.target('execute',await f.apply('update',id,1,{...sample,amount:1550}))
  assert.equal(update.status,200,JSON.stringify(update))
  assert.equal(update.data.version_before,1)
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,1550)
  const stale=await f.source(['shared-mutation-requests'],{expected_user_id:member,
   idempotency_key:'old-stale-shared-update',operation:'update',resource_id:id,
   expected_version:1,entry:{...sample,amount:2}})
  assert.equal(stale.status,409)
  const del=await f.target('execute',await f.apply('delete',id,2,null))
  assert.equal(del.status,200,JSON.stringify(del))
  assert.equal(f.count('entries'),0)
  const restore=await f.target('execute',await f.apply('restore',id,3,null))
  assert.equal(restore.status,200,JSON.stringify(restore))
  assert.equal(f.count('entries'),1)
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,1550)
  assert.equal(f.count('family_shared_entry_audit'),4)
  assert.equal(f.count('family_shared_mutation_applied'),4)
  assert.equal((await f.target('receipt',del.data&&{
   request_id:del.data.approval_id,resource_id:del.data.proposal_id,
   household_id:hh,requester_user_id:member,payload_sha256:del.data.payload_sha256
  })).status,200)
 }finally{f.close()}
})
test('revoked owner proof, account disabled and audit trigger fault atomically roll back true entries and applied journal',async()=>{
 for(const kind of ['proof','member','owner','audit']){
  const f=fixture()
  try{
   const b=await f.apply('create',null,0,sample)
   if(kind==='proof')f.disableProof()
   if(kind==='member')f.sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(member)
   if(kind==='owner')f.sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(owner)
   if(kind==='audit')f.sql.exec("CREATE TRIGGER fail_real_shared_audit BEFORE INSERT ON family_shared_entry_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FORCED'); END;")
   const bad=await f.target('execute',b)
   assert.notEqual(bad.status,200,kind+':'+JSON.stringify(bad))
   for(const table of ['entries','family_shared_entry_registry','family_shared_entry_audit',
    'family_shared_mutation_applied','family_shared_entry_write_context'])
    assert.equal(f.count(table),0,kind+':'+table)
  }finally{f.close()}
 }
})


const hashText=v=>createHash('sha256').update(v).digest('hex')
function seedAdopted(f){
 const sql=f.sql,resource='a'.repeat(32),account='b'.repeat(32),oldId=7;
 const now=Date.now(),linkDigest='c'.repeat(64),sourceDigest='d'.repeat(64);
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,0)').run(account,hh,owner)
 sql.prepare('INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) '+
  'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(oldId,sample.date,sample.time,900,sample.category,'旧商店','旧备注',
   '旧OCR原文','expense',null,'Bank',account,null)
 sql.prepare('INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?,?)')
  .run(oldId,hh,owner,account,'Bank',linkDigest)
 const original=sql.prepare('SELECT * FROM entries WHERE id=?').get(oldId)
 sql.prepare('INSERT INTO family_legacy_shared_adoptions(resource_id,entry_id,household_id,original_owner_user_id,account_id,'+
  'source_snapshot_sha256,original_link_digest,original_client_request_id,original_row_json,adopted_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run(resource,oldId,hh,owner,account,sourceDigest,linkDigest,null,JSON.stringify(original),now)
 const snapshot=JSON.stringify({...sample,amount:900,merchant:'旧商店',note:'旧备注'})
 sql.prepare('INSERT INTO family_shared_entry_write_context VALUES(?,?,?,?,?,?)')
  .run(resource,oldId,owner,'create',0,now)
 sql.prepare('INSERT INTO family_shared_entry_registry(resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,'+
  'state,version,snapshot_json,payload_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .run(resource,hh,oldId,owner,owner,'active',1,snapshot,hashText(snapshot),now,now)
 sql.prepare('DELETE FROM family_shared_entry_write_context WHERE resource_id=?').run(resource)
 return {resource,account,oldId,original}
}

test('member owner-approved update/delete/restore of adopted historical entry preserves original OCR, account and ID',async()=>{
 const f=fixture()
 try{
  const old=seedAdopted(f),baseline=f.count('entries')
  const u=await f.apply('update',old.resource,1,{...sample,amount:1500})
  const updated=await f.target('execute',u)
  assert.equal(updated.status,200,JSON.stringify(updated))
  assert.equal(updated.data.version_after,2)
  assert.equal(f.count('entries'),baseline)
  let row=f.sql.prepare('SELECT * FROM entries WHERE id=?').get(old.oldId)
  assert.equal(row.amount,1500)
  assert.equal(row.raw,old.original.raw)
  assert.equal(row.family_account_id,old.account)
  assert.equal(row.client_request_id,null)
  const d=await f.apply('delete',old.resource,2,null)
  assert.equal((await f.target('execute',d)).status,200)
  assert.equal(f.count('entries'),0)
  const r=await f.apply('restore',old.resource,3,null)
  const restored=await f.target('execute',r)
  assert.equal(restored.status,200,JSON.stringify(restored))
  row=f.sql.prepare('SELECT * FROM entries WHERE id=?').get(old.oldId)
  assert.equal(row.amount,1500)
  assert.equal(row.raw,old.original.raw)
  assert.equal(row.payment_source,old.original.payment_source)
  assert.equal(row.family_account_id,old.account)
  assert.equal(row.client_request_id,null)
  assert.equal(f.count('entries'),baseline)
  assert.equal(f.count('family_legacy_shared_adoptions'),1)
  assert.equal(f.count('family_shared_entry_audit'),4)
  assert.equal(f.count('family_shared_mutation_applied'),3)
  assert.equal((await f.target('receipt',r)).data.already_applied,true)
 }finally{f.close()}
})
test('adopted history cannot execute when source financial account archived, and journal remains empty',async()=>{
 const f=fixture()
 try{
  const old=seedAdopted(f)
  const b=await f.apply('update',old.resource,1,{...sample,amount:1500})
  f.sql.prepare('UPDATE family_financial_accounts SET is_archived=1 WHERE account_id=?').run(old.account)
  const result=await f.target('execute',b)
  assert.equal(result.status,409,JSON.stringify(result))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(old.oldId).amount,900)
  assert.equal(f.count('family_shared_mutation_applied'),0)
  assert.equal(f.count('family_shared_entry_audit'),1)
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,1)
 }finally{f.close()}
})

test('delegated credit card purchase stays pending until owner approves and retains original bill on restore',async()=>{
 const f=fixture()
 try{
  const purchase={...sample,payment_source:'楽天カード'}
  const denied=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'new-shared-card-denied',
   operation:'create',resource_id:null,expected_version:0,entry:purchase})
  assert.equal(denied.status,403)
  assert.equal(f.count('entries'),0)
  f.sql.prepare('INSERT INTO family_legacy_card_shares VALUES(?,?,?,?,1)')
   .run('楽天カード',hh,owner,member)
  const intent=await f.apply('create',null,0,purchase)
  assert.equal(f.count('entries'),0,'the card grant is not posting permission')
  const applied=await f.target('execute',intent)
  assert.equal(applied.status,200,JSON.stringify(applied))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード')
  const id=applied.data.resource_id
  const revised=await f.target('execute',await f.apply('update',id,1,{...sample,amount:1200}))
  assert.equal(revised.status,200,JSON.stringify(revised))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード')
  await f.target('execute',await f.apply('delete',id,2,null))
  const restored=await f.target('execute',await f.apply('restore',id,3,null))
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード')
  assert.equal(f.count('entries'),1)
 }finally{f.close()}
})


test('member posts and revises own neutral spouse transfer without family approval',async()=>{
 const f=fixture();try{
  const spouse={...sample,type:'transfer',amount:18000,category:'投資・資産移動',
   merchant:'配偶への振替',transfer_target:'spouse',transfer_date:sample.date};
  const old=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'member-spouse-old-review-20261117',
   operation:'create',resource_id:null,expected_version:0,entry:spouse});
  assert.equal(old.status,410,'old cached frontend must never create owner review for transfer');
  const directUrl=new URL('https://kakeibo.example.test/api/family-finance/shared-entries');
  const post=(data)=>familySharedEntries(new Request(directUrl,{method:'POST',
   headers:{origin:directUrl.origin,'content-type':'application/json'},
   body:JSON.stringify(data)}),f.env,directUrl,f.user,['shared-entries']);
  const payload={expected_user_id:member,idempotency_key:'member-spouse-transfer-20261117',entry:spouse};
  const first=await post(payload);
  assert.equal(first.status,201,await first.clone().text());
  const data=await first.json();
  assert.equal(data.action.creator_user_id,member);
  const id=data.action.resource_id;
  assert.equal(f.count('entries'),1);
  assert.equal(f.count('family_shared_entry_audit'),1);
  assert.equal(f.count('family_shared_mutation_applied'),0,'no owner approval exists for creation');
  const row=f.sql.prepare('SELECT * FROM entries').get();
  assert.equal(row.type,'transfer');assert.equal(row.amount,18000);
  assert.equal(row.transfer_target,'spouse');assert.equal(row.transfer_applied,0);
  const replay=await post(payload);
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).replayed,true);
  assert.equal(f.count('entries'),1);
  const totals=f.sql.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS inc,"+
   "COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS exp FROM entries").get();
  assert.equal(totals.inc,0);assert.equal(totals.exp,0);
  // Old approval requests are retired, while own transfer CAS changes are direct.
  const oldRevision=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'old-neutral-transfer-revision',
   operation:'update',resource_id:id,expected_version:1,
   entry:{...spouse,amount:19000}});
  assert.equal(oldRevision.status,410);
  const direct=async(method,parts,data)=>{
   const request=new Request(directUrl,{method,
    headers:{origin:directUrl.origin,'content-type':'application/json'},
    body:JSON.stringify(data)});
   const response=await familySharedEntries(request,f.env,directUrl,f.user,parts);
   return {status:response.status,data:await response.json()};
  };
  const changed=await direct('PUT',['shared-entries',id],{
   expected_user_id:member,expected_version:1,entry:{...spouse,amount:19000}});
  assert.equal(changed.status,200,JSON.stringify(changed));
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,19000);
  const removed=await direct('DELETE',['shared-entries',id],{
   expected_user_id:member,expected_version:2});
  assert.equal(removed.status,200,JSON.stringify(removed));
  assert.equal(f.count('entries'),0);
  const restored=await direct('POST',['shared-entries',id,'restore'],{
   expected_user_id:member,expected_version:3});
  assert.equal(restored.status,200,JSON.stringify(restored));
  assert.equal(f.count('entries'),1);
  assert.equal(f.count('family_shared_entry_audit'),4);
  assert.equal(f.count('family_shared_mutation_applied'),0);
  const fraud=await f.source(['shared-mutation-requests'],{expected_user_id:member,
   idempotency_key:'spouse-fake-bank-transfer',operation:'create',resource_id:null,
   expected_version:0,entry:{...spouse,transfer_target:'bank:other'}});
  assert.equal(fraud.status,400);
 }finally{f.close()}
});

test('owner HMAC preview decrypts original submitted entry without applying it',async()=>{
 const f=fixture();try{
  const b=await f.apply('create',null,0,sample)
  const preview=await f.target('preview',{...b,approver_user_id:owner})
  assert.equal(preview.status,200,JSON.stringify(preview))
  assert.equal(preview.data.entry.amount,sample.amount)
  assert.equal(preview.data.entry.merchant,sample.merchant)
  assert.equal(preview.data.entry.note,sample.note)
  assert.equal(preview.data.approval_id,b.request_id)
  assert.equal(preview.data.ledger_changed,false)
  assert.equal(f.count('entries'),0)
  assert.equal(f.count('family_shared_mutation_applied'),0)
  const unauthenticated=await f.target('preview',{...b,approver_user_id:owner},true)
  assert.equal(unauthenticated.status,403)
  const notOwner=await f.target('preview',{...b,approver_user_id:member})
  assert.equal(notOwner.status,403)
  assert.equal(f.count('entries'),0)
 }finally{f.close()}
})


test('operator replay of a deleted original uses a NEW pending approval and original sealed payload, with no duplicate debit',async()=>{
 const f=fixture();
 try{
  const old=await f.apply('create',null,0,sample);
  const first=await f.target('execute',old);
  assert.equal(first.status,200,JSON.stringify(first));
  const originalResource=first.data.resource_id;
  const deletion=await f.apply('delete',originalResource,1,null);
  assert.equal((await f.target('execute',deletion)).status,200);
  assert.equal(f.count('entries'),0);

  const proposal=crypto.randomUUID().replaceAll('-','');
  const requestId=crypto.randomUUID();
  const oldIntent=f.sql.prepare('SELECT * FROM family_shared_mutation_intents WHERE proposal_id=?')
   .get(old.resource_id);
  f.sql.prepare('INSERT INTO family_shared_mutation_intents '+
   '(proposal_id,household_id,requester_user_id,operation,resource_id,expected_version,'+
   'payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,'+
   'created_at,expires_at,submitted_at) VALUES(?,?,?, ?,NULL,0, ?,?,?,?, ?,?,?,?,?)')
   .run(proposal,hh,member,'create',old.payload_sha256,'sealed-ref:'+old.resource_id,
    'sealed-ref',createHash('sha256').update('replay:'+proposal).digest('hex'),
    'submitted',requestId,Date.now(),Date.now()+86400000,Date.now());
  const replacement={request_id:requestId,resource_id:proposal,
   household_id:hh,requester_user_id:member,payload_sha256:old.payload_sha256};
  f.approvals.set(proposal,{id:requestId,payload:old.payload_sha256,operation:'finance.entry.create'});
  // A replay only prepares a pending request. Nothing is posted until an
  // authenticated owner later reviews and the executor sends a signed proof.
  assert.equal(f.count('entries'),0);
  const preview=await f.target('preview',{...replacement,approver_user_id:owner});
  assert.equal(preview.status,200,JSON.stringify(preview));
  assert.deepEqual(preview.data.entry,sample);
  assert.equal(f.count('entries'),0);
  const applied=await f.target('execute',replacement);
  assert.equal(applied.status,200,JSON.stringify(applied));
  assert.equal(f.count('entries'),1);
  assert.equal(f.sql.prepare('SELECT merchant FROM entries').get().merchant,sample.merchant);
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,sample.amount);
  assert.equal(f.count('family_shared_mutation_applied'),3);
  assert.equal(f.count('family_shared_entry_registry'),2);
  assert.equal(f.sql.prepare('SELECT state FROM family_shared_entry_registry WHERE resource_id=?')
   .get(originalResource).state,'deleted');
  const replay=await f.target('execute',replacement);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.data.already_applied,true);
  assert.equal(f.count('entries'),1);
 }finally{f.close()}
});

test('a sealed-reference replay cannot be previewed before its original physical entry is deleted',async()=>{
 const f=fixture();
 try{
  const old=await f.apply('create',null,0,sample);
  assert.equal((await f.target('execute',old)).status,200);
  const proposal=crypto.randomUUID().replaceAll('-','');
  const requestId=crypto.randomUUID();
  f.sql.prepare('INSERT INTO family_shared_mutation_intents '+
   '(proposal_id,household_id,requester_user_id,operation,resource_id,expected_version,'+
   'payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,'+
   'created_at,expires_at,submitted_at) VALUES(?,?,?, ?,NULL,0, ?,?,?,?, ?,?,?,?,?)')
   .run(proposal,hh,member,'create',old.payload_sha256,'sealed-ref:'+old.resource_id,
    'sealed-ref',createHash('sha256').update('replay:'+proposal).digest('hex'),
    'submitted',requestId,Date.now(),Date.now()+86400000,Date.now());
  f.approvals.set(proposal,{id:requestId,payload:old.payload_sha256,operation:'finance.entry.create'});
  const replacement={request_id:requestId,resource_id:proposal,
   household_id:hh,requester_user_id:member,payload_sha256:old.payload_sha256};
  const result=await f.target('preview',{...replacement,approver_user_id:owner});
  assert.notEqual(result.status,200);
  assert.equal(f.count('entries'),1);
 }finally{f.close()}
});


test('D1 batch metadata can report zero after a committed household approval without causing false automatic reconciliation',async()=>{
 const f=fixture();
 try{
  const intent=await f.apply('create',null,0,{...sample,amount:960,merchant:'長門'});
  const originalBatch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
   const results=await originalBatch(statements);
   // Simulate a genuine Cloudflare D1 response: the atomic ledger and journal
   // committed, but a per-statement changes count is not authoritative.
   return results.map((result,i)=>i===1?{...result,meta:{...result.meta,changes:0}}:result);
  };
  const first=await f.target('execute',intent);
  assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(first.data.applied,true);
  assert.equal(first.data.approval_id,intent.request_id);
  assert.equal(f.count('entries'),1);
  assert.equal(f.count('family_shared_mutation_applied'),1);
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,960);
  const replay=await f.target('receipt',intent);
  assert.equal(replay.status,200,JSON.stringify(replay));
  assert.equal(replay.data.already_applied,true);
  const again=await f.target('execute',intent);
  assert.equal(again.status,200,JSON.stringify(again));
  assert.equal(f.count('entries'),1,'recovery never double-posts the same approval');
 }finally{f.close()}
});

test('recovery confirms immutable journal after transaction committed but batch response was lost',async()=>{
 const f=fixture();
 try{
  const intent=await f.apply('create',null,0,sample);
  const originalBatch=f.env.DB.batch;
  f.env.DB.batch=async statements=>{
   await originalBatch(statements);
   throw Error('response lost after durable commit');
  };
  const result=await f.target('execute',intent);
  assert.equal(result.status,200,JSON.stringify(result));
  assert.equal(result.data.applied,true);
  assert.equal(f.count('entries'),1);
  assert.equal(f.count('family_shared_mutation_applied'),1);
  assert.equal((await f.target('receipt',intent)).status,200);
 }finally{f.close()}
});


test('member cash to shared card and back is owner-approved and changes exactly one bill source',async()=>{
 const f=fixture()
 try{
  // Card must be actively shared. A UI-selected label alone cannot authorize it.
  const created=await f.target('execute',await f.apply('create',null,0,sample))
  assert.equal(created.status,200,JSON.stringify(created))
  const id=created.data.resource_id
  const denied=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'member-cannot-use-ungranted-card',
   operation:'update',resource_id:id,expected_version:1,
   entry:{...sample,payment_source:'楽天カード'}})
  assert.equal(denied.status,403)
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'')
  f.sql.prepare('INSERT INTO family_legacy_card_shares VALUES(?,?,?,?,1)')
   .run('楽天カード',hh,owner,member)
  const cardRequest=await f.apply('update',id,1,{...sample,payment_source:'楽天カード'})
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'',
   'pending review must not alter payment method')
  const card=await f.target('execute',cardRequest)
  assert.equal(card.status,200,JSON.stringify(card))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード')
  assert.equal(f.count('entries'),1)
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,2)

  const cashRequest=await f.apply('update',id,2,{...sample,payment_source:''})
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード',
   'payment is unchanged until the second approval')
  const cash=await f.target('execute',cashRequest)
  assert.equal(cash.status,200,JSON.stringify(cash))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'')
  assert.equal(f.count('entries'),1)
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,3)
  assert.equal((await f.target('receipt',cashRequest)).data.already_applied,true)
  assert.equal(f.count('family_shared_mutation_applied'),3)
  const restoredCard=await f.target('execute',await f.apply('update',id,3,{...sample,payment_source:'楽天カード'}))
  assert.equal(restoredCard.status,200,JSON.stringify(restoredCard))
  await f.target('execute',await f.apply('delete',id,4,null))
  await f.target('execute',await f.apply('restore',id,5,null))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード')
  assert.equal(f.count('entries'),1)
 }finally{f.close()}
})
test('other member payment and account-linked records reject source changes even if owner would approve',async()=>{
 const f=fixture()
 try{
  const ownerEntry=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'modify-other-person-payment-1',
   operation:'update',resource_id:'c'.repeat(32),expected_version:1,
   entry:{...sample,payment_source:''}})
  assert.equal(ownerEntry.status,409)
  const adopted=seedAdopted(f)
  const bad=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'modify-owner-account-payment',
   operation:'update',resource_id:adopted.resource,expected_version:1,
   entry:{...sample,payment_source:''}})
  assert.equal(bad.status,403)
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries WHERE id=?')
   .get(adopted.oldId).payment_source,'Bank')
  assert.equal(f.count('family_shared_mutation_intents'),0)
 }finally{f.close()}
})


test('mixed deployment cannot queue or apply payment revision until private executor is enabled',async()=>{
 const f=fixture()
 try{
  const first=await f.target('execute',await f.apply('create',null,0,sample))
  assert.equal(first.status,200,JSON.stringify(first))
  const id=first.data.resource_id
  f.env.KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED='false'
  const refused=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'blocked-old-executor-edit',
   operation:'update',resource_id:id,expected_version:1,
   entry:{...sample,payment_source:''}
  })
  assert.equal(refused.status,503,JSON.stringify(refused))
  assert.equal(refused.data.code,'SHARED_PAYMENT_EXECUTOR_NOT_READY')
  assert.equal(f.count('family_shared_mutation_intents'),1,'only original creation intent exists')
  f.env.KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED='true'
  f.sql.prepare('INSERT INTO family_legacy_card_shares VALUES(?,?,?,?,1)')
   .run('楽天カード',hh,owner,member)
  const intent=await f.apply('update',id,1,{...sample,payment_source:'楽天カード'})
  f.env.KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED='false'
  const blocked=await f.target('execute',intent)
  assert.equal(blocked.status,503,JSON.stringify(blocked))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'')
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,1)
  f.env.KAKEIBO_MEMBER_PAYMENT_REASSIGNMENT_ENABLED='true'
  const approved=await f.target('execute',intent)
  assert.equal(approved.status,200,JSON.stringify(approved))
  assert.equal(f.sql.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天カード')
 }finally{f.close()}
})

test('non-admin cannot edit administrator neutral spouse transfer and old review path is retired',async()=>{
 const f=fixture()
 try{
  const spouse={...sample,type:'transfer',amount:23000,category:'投資・資産移動',
   merchant:'配偶への振替',transfer_target:'spouse',transfer_date:sample.date};
  const url=new URL('https://kakeibo.example.test/api/family-finance/shared-entries')
  const create=await familySharedEntries(new Request(url,{method:'POST',
   headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify({expected_user_id:owner,idempotency_key:'admin-neutral-spouse-transfer',
    entry:spouse})}),f.env,url,f.ownerUser,['shared-entries'])
  assert.equal(create.status,201,await create.clone().text())
  const action=(await create.json()).action
  assert.equal(action.creator_user_id,owner)
  const legacy=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'old-foreign-transfer-approval',
   operation:'update',resource_id:action.resource_id,expected_version:1,
   entry:{...spouse,amount:26000}})
  assert.equal(legacy.status,410)
  const attempt=await familySharedEntries(new Request(url,{method:'PUT',
   headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify({expected_user_id:member,expected_version:1,
    entry:{...spouse,amount:26000}})}),f.env,url,f.user,
   ['shared-entries',action.resource_id])
  assert.equal(attempt.status,403)
  const ownerChange=await familySharedEntries(new Request(url,{method:'PUT',
   headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify({expected_user_id:owner,expected_version:1,
    entry:{...spouse,date:'2026-11-16',transfer_date:'2026-11-16',
     amount:26000,note:'双方确认后的修改'}})}),f.env,url,f.ownerUser,
   ['shared-entries',action.resource_id])
  assert.equal(ownerChange.status,200,await ownerChange.clone().text())
  const edited=f.sql.prepare('SELECT type,date,amount,note,transfer_target,transfer_applied FROM entries').get()
  assert.deepEqual({...edited},{type:'transfer',date:'2026-11-16',amount:26000,
   note:'双方确认后的修改',transfer_target:'spouse',transfer_applied:0})
  const totals=f.sql.prepare("SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,"+
   "SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expense FROM entries").get()
  assert.equal(totals.income,0)
  assert.equal(totals.expense,0)
  const incompatible=await f.source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'blocked-member-transfer-conversion',
   operation:'update',resource_id:action.resource_id,expected_version:2,
   entry:{date:spouse.date,time:spouse.time,amount:50000,
    type:'income',category:'給与',merchant:'給与',note:''}})
  assert.equal(incompatible.status,410)
  assert.equal(incompatible.data.code,'NEUTRAL_SPOUSE_TRANSFER_NO_OWNER_REVIEW')
 }finally{f.close()}
})


test('new member income is editable via new approvals without rewriting past rows',async()=>{
 const f=fixture()
 try{
  // Existing historical entry stays untouched; this test exercises only
  // freshly submitted and approved household-ledger records.
  f.sql.prepare("INSERT INTO entries(date,time,amount,type,category,merchant,note,raw,client_request_id,payment_source) "+
   "VALUES(?,?,?,?,?,?,?,?,?,?)").run('2026-11-01','',10000,'income','給与','履歴','','',
   'immutable-old-income','')
  const fresh={date:'2026-11-18',time:'09:10',type:'income',
   amount:180000,category:'給与',merchant:'勤務先',note:''}
  const proposed=await f.apply('create',null,0,fresh)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM entries WHERE date='2026-11-18'").get().n,0)
  const accepted=await f.target('execute',proposed)
  assert.equal(accepted.status,200,JSON.stringify(accepted))
  const id=accepted.data.resource_id
  const changed=await f.apply('update',id,1,{...fresh,
   amount:185000,note:'追加確認'})
  assert.equal(f.sql.prepare("SELECT amount FROM entries WHERE date='2026-11-18'").get().amount,180000)
  const applied=await f.target('execute',changed)
  assert.equal(applied.status,200,JSON.stringify(applied))
  assert.equal(f.sql.prepare("SELECT amount FROM entries WHERE date='2026-11-18'").get().amount,185000)
  const historical=f.sql.prepare("SELECT date,amount,note FROM entries WHERE client_request_id='immutable-old-income'").get()
  assert.equal(historical.date,'2026-11-01')
  assert.equal(historical.amount,10000)
  assert.equal(historical.note,'')
  assert.equal(f.count('family_shared_mutation_applied'),2)
 }finally{f.close()}
})

async function seedFuturePaid(f,kind='credit_card',balanceJpy=0){
 const accountId='a'.repeat(32),stamp=Date.now(),receipt='55555555-5555-4555-8555-555555555555'
 f.sql.prepare('INSERT INTO family_financial_accounts '+
  '(account_id,household_id,owner_user_id,is_archived,account_kind,origin,closing_day,label,version,created_at) '+
  'VALUES(?,?,?,?,?,?,?,?,?,?)').run(accountId,hh,member,0,kind,'member_created',10,'个人卡',1,stamp)
 const source=(kind==='credit_card'?'cc:':'prepaid:')+accountId
 const client=(kind==='credit_card'?'hfcard:':'hfprepaid:')+receipt
 const id=f.sql.prepare('INSERT INTO entries '+
  '(date,time,amount,type,category,merchant,note,raw,client_request_id,payment_source,'+
  'family_account_id,family_transfer_target_account_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .run('2026-11-18','',1000,'expense','食費','新交易','','',client,source,accountId,null).lastInsertRowid
 if(kind==='credit_card')
  f.sql.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?,?,?,?,?)')
   .run(id,hh,member,receipt,accountId,'2026-12',1000)
 else{
  f.sql.prepare('INSERT INTO family_prepaid_actions_applied VALUES(?,?,?,?,?,?)')
   .run(id,hh,member,receipt,'spend',accountId)
  f.sql.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?)')
   .run(accountId,hh,balanceJpy)
 }
 const linked=await futurePaidRegistrationCommands(f.env.DB,{householdId:hh,
  memberUserId:member,requestId:receipt,kind,accountId,date:'2026-11-18',
  amount:1000,category:'食費',merchant:'新交易',note:'',at:stamp})
 await f.env.DB.batch(linked.statements)
 return {resourceId:linked.resourceId,entryId:id,accountId,receipt}
}
test('approved correction updates new card expense, liability, household totals exactly once',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId,accountId}=await seedFuturePaid(f)
  const corrected={date:'2026-11-18',time:'',amount:1450,type:'expense',
   category:'日用品',merchant:'新交易',note:'审核后更正'}
  const pending=await f.apply('update',resourceId,1,corrected)
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1000)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM family_approved_account_corrections').get().n,0)
  const approved=await f.target('execute',pending)
  assert.equal(approved.status,200,JSON.stringify(approved))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1450)
  assert.equal(f.sql.prepare('SELECT SUM(amount) n FROM entries WHERE type=\'expense\'').get().n,1450)
  assert.equal(f.sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='family_approved_account_effects'").get().n,1)
  assert.equal(f.sql.prepare('SELECT COALESCE(SUM(delta_jpy),0) n FROM family_approved_account_effects').get().n,450)
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,1450)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) n FROM family_approved_account_effects').get().n,450)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,1)
  assert.equal(f.sql.prepare('SELECT amount_jpy FROM family_card_purchase_applied').get().amount_jpy,1000)
  assert.throws(()=>f.sql.prepare("UPDATE entries SET amount=900 WHERE id=?").run(entryId),
   /CARD_PURCHASE_ENTRY_IMMUTABLE|CONTEXT_REQUIRED/,
   'direct unapproved changes to the original linked card row remain forbidden');
  assert.equal((await f.target('execute',pending)).status,200)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_approved_account_corrections').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_approved_account_effects').get().n,1)
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,2)
 }finally{f.close()}
})
test('approved prepaid revision modifies real balance with original transaction immutable',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId,accountId}=await seedFuturePaid(f,'prepaid',2000)
  const edited={date:'2026-11-18',time:'',amount:1450,type:'expense',
   category:'食費',merchant:'新交易',note:'修正'}
  const request=await f.apply('update',resourceId,1,edited)
  const result=await f.target('execute',request)
  assert.equal(result.status,200,JSON.stringify(result))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1450)
  assert.equal((await memberPrepaidBalances(f.env.DB,hh)).total_jpy,1550)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) n FROM family_prepaid_balance_journal').get().n,2000)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) n FROM family_approved_account_effects').get().n,-450)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_prepaid_actions_applied').get().n,1)
 }finally{f.close()}
})
test('insufficient prepaid balance rejects approval without modifying ledger or journal',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId}=await seedFuturePaid(f,'prepaid',200)
  const edited={date:'2026-11-18',time:'',amount:1450,type:'expense',
   category:'食費',merchant:'新交易',note:''}
  const p=await f.apply('update',resourceId,1,edited)
  const result=await f.target('execute',p)
  assert.notEqual(result.status,200)
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1000)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_approved_account_corrections').get().n,0)
  assert.equal(f.sql.prepare('SELECT version FROM family_shared_entry_registry').get().version,1)
 }finally{f.close()}
})

test('future linked credit entry deletion and restoration change liability only after each owner approval',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId,receipt}=await seedFuturePaid(f)
  const request=await f.apply('delete',resourceId,1,null)
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1000)
  const deleted=await f.target('execute',request)
  assert.equal(deleted.status,200,JSON.stringify(deleted))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,0)
  assert.equal(f.sql.prepare('SELECT state FROM family_shared_entry_registry').get().state,'deleted')
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,0)
  assert.equal(f.sql.prepare('SELECT amount_jpy FROM family_card_purchase_applied WHERE homeflow_request_id=?').get(receipt).amount_jpy,1000)
  const again=await f.target('execute',request)
  assert.equal(again.status,200,JSON.stringify(again))
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_approved_account_corrections').get().n,1)
  const restore=await f.apply('restore',resourceId,2,null)
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,0)
  const restored=await f.target('execute',restore)
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1000)
  assert.equal(f.sql.prepare('SELECT state FROM family_shared_entry_registry').get().state,'active')
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,1000)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_approved_account_corrections').get().n,2)
  assert.equal(f.sql.prepare('SELECT COALESCE(SUM(delta_jpy),0) n FROM family_approved_account_effects').get().n,0)
 }finally{f.close()}
})
test('future linked prepaid deletion refunds balance and restore debits again atomically',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId}=await seedFuturePaid(f,'prepaid',500)
  const deleted=await f.target('execute',await f.apply('delete',resourceId,1,null))
  assert.equal(deleted.status,200,JSON.stringify(deleted))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,0)
  assert.equal((await memberPrepaidBalances(f.env.DB,hh)).total_jpy,1500)
  const restored=await f.target('execute',await f.apply('restore',resourceId,2,null))
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1000)
  assert.equal((await memberPrepaidBalances(f.env.DB,hh)).total_jpy,500)
 }finally{f.close()}
})

test('future personal credit card moves to cash and back only after HomeFlow approvals',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId,accountId,receipt}=await seedFuturePaid(f)
  const cash={...sample,date:'2026-11-18',time:'',amount:1200,merchant:'新交易',payment_source:''}
  const p=await f.apply('update',resourceId,1,cash)
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=?').get(entryId).family_account_id,accountId)
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,1000)
  const approved=await f.target('execute',p)
  assert.equal(approved.status,200,JSON.stringify(approved))
  assert.deepEqual({...f.sql.prepare('SELECT amount,payment_source,family_account_id FROM entries WHERE id=?').get(entryId)},
   {amount:1200,payment_source:'',family_account_id:null})
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,0)
  assert.equal(f.sql.prepare('SELECT amount_jpy FROM family_card_purchase_applied WHERE homeflow_request_id=?').get(receipt).amount_jpy,1000)
  assert.equal((await f.target('execute',p)).data.already_applied,true)
  const back=await f.apply('update',resourceId,2,{...cash,amount:1300,payment_source:'cc:'+accountId})
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1200)
  const ok=await f.target('execute',back)
  assert.equal(ok.status,200,JSON.stringify(ok))
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=?').get(entryId).family_account_id,accountId)
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,1300)
  assert.equal(f.sql.prepare('SELECT count(*) n FROM family_approved_account_corrections').get().n,2)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) v FROM family_approved_account_effects').get().v,300)
 }finally{f.close()}
})
test('future prepaid card to cash refunds and later recharges without changing original evidence',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId,accountId}=await seedFuturePaid(f,'prepaid',300)
  const cash={...sample,date:'2026-11-18',time:'',amount:800,merchant:'新交易',payment_source:''}
  const p=await f.apply('update',resourceId,1,cash)
  const toCash=await f.target('execute',p)
  assert.equal(toCash.status,200,JSON.stringify(toCash))
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=?').get(entryId).family_account_id,null)
  assert.equal((await memberPrepaidBalances(f.env.DB,hh)).total_jpy,1300)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) v FROM family_prepaid_balance_journal').get().v,300)
  const back=await f.apply('update',resourceId,2,{...cash,amount:1100,payment_source:'prepaid:'+accountId})
  assert.equal((await f.target('execute',back)).status,200)
  assert.equal((await memberPrepaidBalances(f.env.DB,hh)).total_jpy,200)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) v FROM family_approved_account_effects').get().v,-100)
 }finally{f.close()}
})


test('administrator edits spouse private card household expense without changing card ownership',async()=>{
 const f=fixture({accountCorrections:true})
 try{
  const {resourceId,entryId,accountId}=await seedFuturePaid(f)
  const url=new URL('https://kakeibo.example.test/api/family-finance/shared-entries/'+resourceId)
  const send=async (method,body,suffix='')=>{
   const target=new URL(url.href+suffix)
   const res=await familySharedEntries(new Request(target,{method,
    headers:{origin:target.origin,'content-type':'application/json'},
    body:JSON.stringify({expected_user_id:owner,...body})}),f.env,target,f.ownerUser,
     ['shared-entries',resourceId,...(suffix?['restore']:[])])
   return {status:res.status,data:await res.json()}
  }
  const corrected={date:'2026-11-19',time:'',amount:1350,type:'expense',
   category:'日用品',merchant:'新交易',note:'管理员核验'}
  const response=await send('PUT',{expected_version:1,entry:corrected})
  assert.equal(response.status,200,JSON.stringify(response))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1350)
  assert.equal(f.sql.prepare('SELECT family_account_id FROM entries WHERE id=?').get(entryId).family_account_id,accountId)
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,1350)
  assert.equal(f.count('family_owner_account_corrections'),1)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) n FROM family_owner_account_effects').get().n,350)
  const denied=await send('PUT',{expected_version:2,entry:{...corrected,payment_source:''}})
  assert.equal(denied.status,409)
  assert.equal(f.count('family_owner_account_corrections'),1)
  const deleted=await send('DELETE',{expected_version:2})
  assert.equal(deleted.status,200,JSON.stringify(deleted))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,0)
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,0)
  const restored=await send('POST',{expected_version:3},'/restore')
  assert.equal(restored.status,200,JSON.stringify(restored))
  assert.equal(f.sql.prepare('SELECT amount FROM entries WHERE id=?').get(entryId).amount,1350)
  assert.equal((await memberCardLiabilities(f.env.DB,hh,false)).total,1350)
  assert.equal(f.count('family_owner_account_corrections'),3)
  assert.equal(f.sql.prepare('SELECT SUM(delta_jpy) n FROM family_owner_account_effects').get().n,350)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_card_purchase_applied').get().n,1)
 }finally{f.close()}
})
