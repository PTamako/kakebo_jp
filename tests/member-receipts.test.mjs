import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {familyMemberReceipts} from '../functions/api/family-finance/member-receipts.js'

const migration=readFileSync(new URL('../migrations/0065_member_receipts.sql',import.meta.url),'utf8')
const member={user_id:'spouse',household_id:'family',role:'member'}
const another={user_id:'another',household_id:'family',role:'member'}
const foreign={user_id:'foreign',household_id:'other',role:'member'}
const owner={user_id:'owner',household_id:'family',role:'owner'}
const proposal='a'.repeat(32)
const hash=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))]
 .map(x=>x.toString(16).padStart(2,'0')).join('')
function fixture(){
 const db=new DatabaseSync(':memory:')
 db.exec([
  'PRAGMA foreign_keys=ON',
  'CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)',
  'CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)',
  'CREATE TABLE family_shared_mutation_intents(proposal_id TEXT PRIMARY KEY,requester_user_id TEXT,household_id TEXT,operation TEXT,status TEXT)',
  'CREATE TABLE family_shared_mutation_applied(proposal_id TEXT PRIMARY KEY,requester_user_id TEXT,household_id TEXT,action TEXT,entry_id INTEGER)',
  'CREATE TABLE family_legacy_card_spends(entry_id INTEGER PRIMARY KEY,actor_user_id TEXT,household_id TEXT)',
  'CREATE TABLE family_card_purchase_intents(request_id TEXT PRIMARY KEY,requester_user_id TEXT,household_id TEXT)',
  'CREATE TABLE family_card_purchase_applied(proposal_id TEXT PRIMARY KEY,entry_id INTEGER,requester_user_id TEXT,household_id TEXT)',
  'CREATE TABLE family_prepaid_action_intents(request_id TEXT PRIMARY KEY,requester_user_id TEXT,household_id TEXT,action TEXT)',
  'CREATE TABLE family_prepaid_actions_applied(proposal_id TEXT PRIMARY KEY,entry_id INTEGER,requester_user_id TEXT,household_id TEXT,action TEXT)',
  "INSERT INTO homeflow_identity_links VALUES ('spouse','family','member','active'),('another','family','member','active'),('foreign','other','member','active'),('owner','family','owner','active')",
  "INSERT INTO family_shared_mutation_intents VALUES ('"+proposal+"','spouse','family','create','submitted')",
  "INSERT INTO family_legacy_card_spends VALUES (123,'spouse','family')",
  "INSERT INTO family_card_purchase_intents VALUES ('"+'b'.repeat(32)+"','spouse','family')",
  "INSERT INTO family_prepaid_action_intents VALUES ('"+'c'.repeat(32)+"','spouse','family','spend')"
 ].join(';')+';')
 db.exec(migration)
 const data=new Map()
 const R2={
  async put(key,bytes,opts){
   if(data.has(key))return null
   const m={body:bytes,size:bytes.byteLength,httpMetadata:opts.httpMetadata,customMetadata:opts.customMetadata}
   data.set(key,m);return m
  },
  async get(key){
   const v=data.get(key);if(!v)return null
   return {...v,body:new Blob([v.body]).stream()}
  },
  async head(key){return data.get(key)||null},
  async delete(key){data.delete(key)}
 }
 const wrapper={prepare(sql){
  const stmt=db.prepare(sql)
  const bound=(args=[])=>({
   first:async()=>stmt.get(...args)||null,
   all:async()=>({results:stmt.all(...args)}),
   run:async()=>({meta:{changes:stmt.run(...args).changes}})
  })
  return {...bound(),bind:(...args)=>bound(args)}
 }}
 async function send(user=member,method='GET',id='',body=null,headers={},query=''){
  const url=new URL('https://kakeibo.test/api/family-finance/member-receipts'+(id?'/'+id:'')+(query?'?'+query:''))
  const init={method,headers,...(body!==null?{body}: {})}
  const response=await familyMemberReceipts(new Request(url,init),{DB:wrapper,RECEIPTS_R2:R2},url,user,
   ['member-receipts',...(id?[id]:[])])
  return {status:response.status,body:response.headers.get('content-type')?.startsWith('image/')
   ?new Uint8Array(await response.arrayBuffer()):await response.json()}
 }
 return {db,data,send}
}
async function prepare(f,who=member,ref='proposal:'+proposal,idempotency_key='member-receipt-test-id1'){
 const bytes=new TextEncoder().encode('private-photo')
 const body={expected_user_id:who.user_id,idempotency_key,receipt_ref:ref,
  receipt_date:'2026-11-17',merchant:'スーパー',content_type:'image/jpeg',
  size_bytes:bytes.byteLength,sha256:await hash(bytes)}
 const res=await f.send(who,'POST','',JSON.stringify(body),
  {'origin':'https://kakeibo.test','content-type':'application/json'})
 return {...res,bytes,request:body}
}
test('only verified member can prepare receipt for their own submitted record',async()=>{
 const f=fixture()
 try{
  assert.equal((await prepare(f,owner)).status,403)
  assert.equal((await prepare(f,another)).status,403)
  assert.equal((await prepare(f,foreign)).status,403)
  assert.equal((await prepare(f,member,'entry:123','member-receipt-entry-01')).status,201)
  assert.equal((await prepare(f,member,'request:'+'b'.repeat(32),'member-receipt-credit-01')).status,201)
  assert.equal((await prepare(f,member,'request:'+'c'.repeat(32),'member-receipt-prepaid-01')).status,201)
 }finally{f.db.close()}
})
test('R2 upload is private, replayable and revoked when account owner changes',async()=>{
 const f=fixture()
 try{
  const p=await prepare(f);assert.equal(p.status,201,JSON.stringify(p.body))
  const id=p.body.item.receipt_id;assert.match(id,/^[a-f0-9]{32}$/)
  assert.equal((await f.send(another,'GET',id)).status,404)
  assert.equal((await f.send(member,'PUT',id,p.bytes,
   {'origin':'https://kakeibo.test','content-type':'image/jpeg'})).status,200)
  assert.equal((await f.send(member,'GET',id)).status,200)
  assert.equal(f.data.size,1)
  assert.equal((await f.send(owner,'GET',id)).status,403)
  assert.equal((await f.send(another,'DELETE',id,null,
   {'origin':'https://kakeibo.test','x-confirm-receipt':id})).status,404)
  f.db.exec("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id='spouse'")
  assert.equal((await f.send(member,'GET',id)).status,403)
 }finally{f.db.close()}
})
test('delete tombstones before R2 removal and cannot destroy another user images',async()=>{
 const f=fixture()
 try{
  const p=await prepare(f),id=p.body.item.receipt_id
  await f.send(member,'PUT',id,p.bytes,{'origin':'https://kakeibo.test','content-type':'image/jpeg'})
  assert.equal((await f.send(member,'DELETE',id,null,{'origin':'https://evil.test','x-confirm-receipt':id})).status,428)
  assert.equal((await f.send(member,'DELETE',id,null,{'origin':'https://kakeibo.test','x-confirm-receipt':id})).status,200)
  assert.equal((await f.send(member,'GET',id)).status,404)
  assert.equal(f.data.size,0)
  assert.equal((await f.send(member,'DELETE',id,null,{'origin':'https://kakeibo.test','x-confirm-receipt':id})).status,200)
 }finally{f.db.close()}
})
test('approved shared posting exposes only the same member linked ledger ID',async()=>{
 const f=fixture()
 try{
  const p=await prepare(f),id=p.body.item.receipt_id
  await f.send(member,'PUT',id,p.bytes,{
   'origin':'https://kakeibo.test','content-type':'image/jpeg'
  })
  f.db.exec("INSERT INTO family_shared_mutation_applied VALUES ('"+proposal+"','spouse','family','create',777)")
  assert.equal((await prepare(f,member,'entry:777','member-receipt-approved-entry')).status,201)
  const list=await f.send(member)
  assert.equal(list.status,200)
  assert.equal(list.body.items[0].linked_entry_id,777)
  assert.deepEqual((await f.send(another)).body.items,[])
 }finally{f.db.close()}
})
test('invalid byte size or hash never promotes pending image',async()=>{
 const f=fixture()
 try{
  const p=await prepare(f),id=p.body.item.receipt_id
  assert.equal((await f.send(member,'PUT',id,new TextEncoder().encode('forgery'),{
   'origin':'https://kakeibo.test','content-type':'image/jpeg'})).status,409)
  assert.equal((await f.send(member,'GET',id)).status,404)
  assert.equal(f.data.size,0)
 }finally{f.db.close()}
})

test('receipt inventory paginates over 1000 rows without leaking another member records',async()=>{
 const f=fixture()
 try{
  const insert=f.db.prepare("INSERT INTO family_member_receipts "+
   "(receipt_id,household_id,owner_user_id,receipt_ref,receipt_date,merchant,idempotency_hash,"+
   "state,content_type,size_bytes,sha256,created_at,updated_at) "+
   "VALUES(?,?,?,?,?,?,?,'ready','image/jpeg',20,?,?,?)")
  for(let i=0;i<1005;i++){
   const id=(i+1).toString(16).padStart(32,'0')
   insert.run(id,'family','spouse','proposal:'+proposal,'2026-11-17','テスト',
    id.padStart(64,'a'),'b'.repeat(64),1794800000000+i,1794800000000+i)
  }
  const ids=new Set(),cursors=new Set()
  let before='',pages=0
  do{
   const r=await f.send(member,'GET','',null,{},before?'before='+encodeURIComponent(before):'')
   assert.equal(r.status,200,JSON.stringify(r.body))
   assert.ok(r.body.items.length<=200)
   r.body.items.forEach(x=>ids.add(x.receipt_id))
   before=r.body.next_cursor
   if(before){assert.ok(!cursors.has(before));cursors.add(before)}
   pages++
  }while(before)
  assert.equal(ids.size,1005)
  assert.equal(pages,6)
  assert.deepEqual((await f.send(another)).body.items,[])
  assert.equal((await f.send(member,'GET','',null,{},'before=bad')).status,400)
 }finally{f.db.close()}
})

test('editing an approved household entry stages the replacement image until HomeFlow applies revision',async()=>{
 const f=fixture()
 const updateProposal='d'.repeat(32),rejectedProposal='e'.repeat(32)
 try{
  f.db.prepare('INSERT INTO family_shared_mutation_intents VALUES (?,?,?,?,?)')
   .run(updateProposal,'spouse','family','update','submitted')
  f.db.prepare('INSERT INTO family_shared_mutation_intents VALUES (?,?,?,?,?)')
   .run(rejectedProposal,'spouse','family','update','rejected')
  const before=await prepare(f,member,'entry:123','original-receipt-of-entry')
  const originalId=before.body.item.receipt_id
  assert.equal((await f.send(member,'PUT',originalId,before.bytes,
   {'origin':'https://kakeibo.test','content-type':'image/jpeg'})).status,200)
  assert.equal((await prepare(f,member,'proposal:'+rejectedProposal,
   'rejected-receipt-should-not-upload')).status,403)
  const replacement=await prepare(f,member,'proposal:'+updateProposal,'approved-update-replacement')
  assert.equal(replacement.status,201,JSON.stringify(replacement.body))
  const newId=replacement.body.item.receipt_id
  assert.equal((await f.send(member,'PUT',newId,replacement.bytes,
   {'origin':'https://kakeibo.test','content-type':'image/jpeg'})).status,200)
  const pending=await f.send(member)
  assert.equal(pending.status,200)
  assert.equal(pending.body.items.find(x=>x.receipt_id===newId).linked_entry_id,null,
   'unapproved revision must not replace the entry receipt')
  assert.equal((await f.send(member,'GET',originalId)).status,200,
   'original receipt must remain available while revision is pending')
  assert.equal((await f.send(another,'GET',newId)).status,404)
  f.db.prepare('INSERT INTO family_shared_mutation_applied VALUES (?,?,?,?,?)')
   .run(updateProposal,'spouse','family','update',123)
  const approved=await f.send(member)
  assert.equal(approved.body.items.find(x=>x.receipt_id===newId).linked_entry_id,123)
  assert.equal((await f.send(member,'GET',originalId)).status,200,
   'do not destroy original audit evidence when revision is approved')
 }finally{f.db.close()}
})

test('member ledger image edits submit HomeFlow revision before storing any replacement',()=>{
 const src=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 const start=src.indexOf('async function saveMemberLedgerEdit()')
 const end=src.indexOf('memberLedger.selectEditReceipt=',start)
 assert.ok(start>0&&end>start)
 const flow=src.slice(start,end)
 assert.match(flow,/const submitted=await openApproval\('update',edited\)/)
 assert.match(flow,/const receiptRef='proposal:'\+submitted\.proposalId/)
 assert.match(flow,/await saveMemberReceipt\(edited,receiptRef\)/)
 assert.ok(flow.indexOf("await openApproval('update',edited)")<
  flow.indexOf('await saveMemberReceipt(edited,receiptRef)'))
 assert.doesNotMatch(flow,/deleteMemberReceipt\(current\.receipt_id\)[\s\S]*openApproval\('update'/)
})
