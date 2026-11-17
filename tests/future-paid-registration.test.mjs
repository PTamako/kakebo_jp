import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {futurePaidRegistrationCommands} from '../functions/api/internal/future-paid-registration.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const account='a'.repeat(32);
const receipt='55555555-5555-4555-8555-555555555555';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)');
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER)');
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT,time TEXT,amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,family_account_id TEXT,family_transfer_target_account_id TEXT,transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER DEFAULT 0)');
 sql.exec('CREATE TABLE family_card_purchase_applied(entry_id INTEGER PRIMARY KEY,household_id TEXT,requester_user_id TEXT,homeflow_request_id TEXT,account_id TEXT)');
 sql.exec('CREATE TABLE family_prepaid_actions_applied(entry_id INTEGER PRIMARY KEY,household_id TEXT,requester_user_id TEXT,homeflow_request_id TEXT,action TEXT,prepaid_account_id TEXT)');
 sql.exec('CREATE TABLE family_legacy_shared_adoptions(resource_id TEXT,entry_id INTEGER,household_id TEXT,original_owner_user_id TEXT,original_client_request_id TEXT,account_id TEXT)');
 for(const file of ['0051_shared_entry_lifecycle.sql','0052_shared_mutation_approved_execution.sql','0068_neutral_spouse_transfer.sql','0069_member_neutral_spouse_transfer.sql','0100_approved_account_corrections.sql','0101_future_paid_entry_registration.sql']){
  sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 }
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(member,'primary','member','active');
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(owner,'primary','owner','active');
 sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?)').run(account,'primary',member,'credit_card','member_created',0);
 const db={prepare(q){return {bind(...args){return {run:async()=>sql.prepare(q).run(...args)}}}}};
 return {sql,db,close:()=>sql.close()}
}
async function register(f,{kind='credit_card',withProof=true,actor=member}={}){
 const prefix=kind==='credit_card'?'hfcard:':'hfprepaid:';
 const source=kind==='credit_card'?'cc:':'prepaid:';
 const id=f.sql.prepare('INSERT INTO entries(date,time,amount,category,merchant,note,type,client_request_id,payment_source,family_account_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
 .run('2026-11-18','',1100,'食費','店','','expense',prefix+receipt,source+account,account).lastInsertRowid;
 if(withProof){
  if(kind==='credit_card')f.sql.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?,?,?)').run(id,'primary',member,receipt,account);
  else f.sql.prepare('INSERT INTO family_prepaid_actions_applied VALUES(?,?,?,?,?,?)').run(id,'primary',member,receipt,'spend',account);
 }
 const planned=await futurePaidRegistrationCommands(f.db,{householdId:'primary',memberUserId:actor,requestId:receipt,kind,accountId:account,date:'2026-11-18',amount:1100,category:'食費',merchant:'店',note:'',at:Date.now()});
 f.sql.exec('BEGIN');
 try{for(const stmt of planned.statements)await stmt.run();f.sql.exec('COMMIT')}
 catch(e){f.sql.exec('ROLLBACK');throw e}
 return {id,planned};
}
test('new approved credit purchase registers actual member as immutable author',async()=>{
 const f=fixture();
 try{
  const {id,planned}=await register(f);
  const row=f.sql.prepare('SELECT * FROM family_shared_entry_registry WHERE entry_id=?').get(id);
  assert.equal(row.resource_id,planned.resourceId);
  assert.equal(row.creator_user_id,member);
  assert.equal(row.version,1);assert.equal(row.state,'active');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM family_shared_entry_audit').get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM family_shared_entry_write_context').get().n,0);
 }finally{f.close()}
});
test('a fake new purchase cannot register without real immutable applied receipt',async()=>{
 const f=fixture();
 try{
  await assert.rejects(()=>register(f,{withProof:false}),/SHARED_ENTRY_CREATE_OWNER_OR_CONTEXT_INVALID/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM family_shared_entry_registry').get().n,0);
 }finally{f.close()}
});
test('new prepaid spend must be backed by its own submitted immutable journal',async()=>{
 const f=fixture();
 try{
  const {id}=await register(f,{kind:'prepaid'});
  assert.equal(f.sql.prepare('SELECT creator_user_id FROM family_shared_entry_registry WHERE entry_id=?').get(id).creator_user_id,member);
 }finally{f.close()}
});
test('foreign actor cannot claim member-owned receipt',async()=>{
 const f=fixture();
 try{
  await assert.rejects(()=>register(f,{actor:owner}),/SHARED_ENTRY_CREATE_OWNER_OR_CONTEXT_INVALID/);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM family_shared_entry_registry').get().n,0);
 }finally{f.close()}
});
