import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHmac,createHash,webcrypto} from 'node:crypto'
import {familySharedMutationRequests} from '../functions/api/family-finance/shared-mutation-requests.js'
import {familySharedEntries} from '../functions/api/family-finance/shared-entries.js'
import {approvedSharedMutationRoute} from '../functions/api/internal/shared-entries/[[path]].js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const hh='primary'
const secrets={pending:'1'.repeat(64),submit:'2'.repeat(64),execution:'3'.repeat(64),proof:'4'.repeat(64)}
const makeMac=(domain,secret,stamp,raw)=>createHmac('sha256',Buffer.from(secret,'hex'))
 .update(domain+'\n'+stamp+'\n'+raw).digest('hex')
const sample={date:'2026-11-14',time:'12:00',amount:1100,type:'expense',
 category:'食費',merchant:'スーパー',note:'普通の家庭費用'}
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('PRAGMA foreign_keys=ON')
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)')
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)')
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,is_archived INTEGER)')
 sql.exec('CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT)')
 sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER,size_bytes INTEGER)')
 sql.exec("CREATE TABLE payment_sources(name TEXT PRIMARY KEY,is_archived INTEGER DEFAULT 0,stat_group TEXT DEFAULT 'card',source_type TEXT DEFAULT 'standard')")
 sql.exec('CREATE TABLE family_legacy_card_shares(card_name TEXT,household_id TEXT,owner_user_id TEXT,grantee_user_id TEXT,is_active INTEGER)')
 sql.exec("INSERT INTO payment_sources(name) VALUES('楽天カード')")
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,category TEXT,'+
  'merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,'+
  'family_account_id TEXT,family_transfer_target_account_id TEXT,transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER DEFAULT 0)')
 for(const version of ['0051_shared_entry_lifecycle.sql','0052_shared_mutation_approved_execution.sql','0055_legacy_shared_entry_adoption.sql','0058_adopted_shared_mutation_approval.sql','0068_neutral_spouse_transfer.sql','0069_member_neutral_spouse_transfer.sql'])
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
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_SHARED_ENTRY_ENABLED:'true',KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED:'true',
  KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED:'true',
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


test('member posts one neutral spouse transfer without approval; later ledger changes still require owner review',async()=>{
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
  assert.equal(first.status,201,await first.text());
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
  // Modifying/deleting/restoring an already posted household detail is a
  // separate approved mutation, not a new asset transfer.
  const intent=await f.apply('update',id,1,{...spouse,amount:19000});
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,18000);
  const changed=await f.target('execute',intent);
  assert.equal(changed.status,200,JSON.stringify(changed));
  assert.equal(f.sql.prepare('SELECT amount FROM entries').get().amount,19000);
  const removed=await f.target('execute',await f.apply('delete',id,2,null));
  assert.equal(removed.status,200);assert.equal(f.count('entries'),0);
  const restored=await f.target('execute',await f.apply('restore',id,3,null));
  assert.equal(restored.status,200,JSON.stringify(restored));
  assert.equal(f.count('entries'),1);assert.equal(f.count('family_shared_entry_audit'),4);
  assert.equal(f.count('family_shared_mutation_applied'),3);
  const fraud=await f.source(['shared-mutation-requests'],{expected_user_id:member,
   idempotency_key:'spouse-fake-bank-transfer',operation:'create',resource_id:null,
   expected_version:0,entry:{...spouse,transfer_target:'bank:other'}});
  assert.equal(fraud.status,400);
 }finally{f.close()}
});
