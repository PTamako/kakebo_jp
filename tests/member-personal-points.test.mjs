import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto} from 'node:crypto'
import {familyMemberPersonalPoints} from '../functions/api/family-finance/member-personal-points.js'
import {memberPointsBalances} from '../functions/api/family-finance/points-balance-projection.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',
 other='33333333-3333-4333-8333-333333333333',points='a'.repeat(32),otherPoints='b'.repeat(32)
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON')
 for(const n of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0025_family_financial_resource_owners.sql','0027_family_legacy_entry_link_audit.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'))
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,transfer_target TEXT,'+
  'transfer_applied INTEGER,transfer_date TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT);')
 sql.exec(readFileSync(new URL('../migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8'))
 for(const n of ['0031_family_card_purchase_execution.sql','0032_family_card_settlement_foundation.sql',
  '0033_member_prepaid_actions.sql','0034_family_points_foundation.sql','0035_points_prepaid_atomic.sql',
  '0036_points_card_offset.sql','0037_points_transfer_exchange.sql',
  '0038_points_earn_expiry_reversals.sql','0040_points_sbi_lots.sql',
  '0041_points_transfer_atomic_refund.sql','0042_points_prepaid_refund.sql',
  '0043_points_card_offset_refund.sql','0044_sbi_cash_purchases.sql',
  '0045_sbi_cash_reversals.sql','0046_sbi_legacy_holding_review.sql',
  '0047_sbi_point_full_refund.sql','0067_member_personal_points.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'))
 // Re-running the same migration must not erase immutable recorded data.
 sql.exec(readFileSync(new URL('../migrations/0067_member_personal_points.sql',import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member'],[other,'member']])
  sql.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
  .run(u,hh,role,role,'active',Date.now())
 for(const [aid,u] of [[points,member],[otherPoints,other]])
  sql.prepare("INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,account_kind,origin,created_by_user_id,updated_by_user_id) "+
   "VALUES(?,?,?,'ポイント','points','member_created',?,?)").run(aid,hh,u,u,u)
 const db={prepare(q){return{bind(...args){const stmt=sql.prepare(q);return {
  first:async()=>stmt.get(...args)||null,
  all:async()=>({results:stmt.all(...args)}),
  run:async()=>({meta:{changes:stmt.run(...args).changes}}),
  sync:()=>({meta:{changes:stmt.run(...args).changes}})
 }}}},async batch(commands){
  sql.exec('BEGIN IMMEDIATE')
  try{const results=commands.map(c=>c.sync());sql.exec('COMMIT');return results}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_POINTS_ACTIONS_ENABLED:'true',KAKEIBO_FAMILY_PENDING_KEY:'1'.repeat(64),DB:db}
 const me={role:'member',user_id:member,household_id:hh}
 const payload=(op='earn_campaign',units=100,ref='issuer-ref-001',original=null)=>({
  expected_user_id:member,idempotency_key:'personal:'+ref,
  points_account_id:points,points_version:1,operation:op,units,
  effective_date:today(),issuer_reference:ref,issuer_confirmed:true,
  original_request_id:original})
 async function send(input=null,user=me,method='POST'){
  const url=new URL('https://kakeibo.test/api/family-finance/member-personal-points')
  const r=await familyMemberPersonalPoints(new Request(url,{method,
   ...(method==='GET'?{}:{headers:{origin:url.origin,'content-type':'application/json'},
    body:JSON.stringify(input)})}),env,url,user,['member-personal-points'])
  return {status:r.status,data:await r.json()}
 }
 return {sql,db,env,me,payload,send,close:()=>sql.close()}
}
test('personal points issuer earning is atomic, audited, idempotent and does not write entries',async()=>{
 const f=fixture()
 try{
  const p=f.payload()
  const first=await f.send(p);assert.equal(first.status,201,JSON.stringify(first))
  assert.equal(first.data.ledger_changed,false)
  assert.equal(first.data.balance_after_units,100)
  const replay=await f.send(p);assert.equal(replay.status,200);assert.equal(replay.data.replayed,true)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_points_journal').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_points_actor_audit').get().n,1)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0)
  const row=f.sql.prepare('SELECT approver_user_id,actor_user_id,operation FROM family_points_journal').get()
  assert.equal(row.approver_user_id,member)
  assert.equal(row.actor_user_id,member)
  assert.equal(row.operation,'earn_campaign')
  assert.equal((await f.send({...p,units:200})).status,409)
  assert.equal((await memberPointsBalances(f.db,hh)).accounts.find(x=>x.account_id===points).balance_units,100)
 }finally{f.close()}
})
test('expiry cannot go below zero; immutable reversal restores exact prior balance once',async()=>{
 const f=fixture()
 try{
  const earn=await f.send(f.payload('earn_campaign',80,'earn-ref-00001'))
  assert.equal(earn.status,201,JSON.stringify(earn))
  assert.equal((await f.send(f.payload('expire',81,'expire-ref-0001'))).status,409)
  const expiry=await f.send(f.payload('expire',30,'expire-ref-0002'))
  assert.equal(expiry.status,201,JSON.stringify(expiry))
  assert.equal(expiry.data.balance_after_units,50)
  const r=await f.send(f.payload('reversal',30,'refund-ref-0001',expiry.data.journal_id))
  assert.equal(r.status,201,JSON.stringify(r))
  assert.equal(r.data.balance_after_units,80)
  assert.equal((await f.send(f.payload('reversal',30,'refund-ref-0002',expiry.data.journal_id))).status,409)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_points_journal').get().n,3)
 }finally{f.close()}
})
test('owner/other account spoof, forged actor and revoked member cannot issue points',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.send(f.payload(),{role:'owner',user_id:owner,household_id:hh})).status,403)
  assert.equal((await f.send(f.payload(),{role:'member',user_id:other,household_id:hh})).status,403)
  assert.equal((await f.send({...f.payload(),points_account_id:otherPoints})).status,409)
  f.sql.exec("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id='"+member+"'")
  assert.equal((await f.send(f.payload())).status,403)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_points_journal').get().n,0)
 }finally{f.close()}
})
test('journal guard rejects self-approved operations without immutable matching proof',()=>{
 const f=fixture()
 try{
  const id='f'.repeat(32),approval='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  f.sql.prepare("INSERT INTO family_points_intents(request_id,household_id,requester_user_id,points_account_id,expected_version,operation,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,homeflow_approval_id,created_at,expires_at,submitted_at) "+
   "VALUES(?,?,?,?,?,'earn_campaign',?,'c','i',?,'submitted',?,?,?,?)")
   .run(id,hh,member,points,1,'f'.repeat(64),'e'.repeat(64),approval,Date.now()-1000,Date.now()+86400000,Date.now())
  assert.throws(()=>f.sql.prepare('INSERT INTO family_points_journal '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,actor_user_id,points_account_id,account_version,operation,delta_units,balance_after_units,source_reference_hash,payload_sha256,effective_date,applied_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(approval,id,hh,member,member,member,points,1,'earn_campaign',50,50,'a'.repeat(64),'f'.repeat(64),today(),Date.now()),/POINTS_JOURNAL_INVARIANT/)
 }finally{f.close()}
})
