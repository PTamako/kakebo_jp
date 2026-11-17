import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const uuid='00000000-0000-4000-8000-000000000001'
const actor='22222222-2222-4222-8222-222222222222'
const owner='11111111-1111-4111-8111-111111111111'
const original='33333333-3333-4333-8333-333333333333'

test('future correction journal requires submitted owner-review provenance and is immutable',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
  db.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)');
  db.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER)');
  db.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,type TEXT,amount INTEGER,family_account_id TEXT)');
  db.exec('CREATE TABLE family_shared_entry_registry(resource_id TEXT PRIMARY KEY,household_id TEXT,entry_id INTEGER,state TEXT,version INTEGER)');
  db.exec('CREATE TABLE family_shared_mutation_intents(proposal_id TEXT PRIMARY KEY,resource_id TEXT,household_id TEXT,requester_user_id TEXT,operation TEXT,status TEXT,homeflow_approval_id TEXT,expected_version INTEGER)');
  db.exec('CREATE TABLE family_card_purchase_applied(entry_id INTEGER PRIMARY KEY,requester_user_id TEXT,household_id TEXT)');
  db.exec('CREATE TABLE family_prepaid_actions_applied(entry_id INTEGER PRIMARY KEY,requester_user_id TEXT,household_id TEXT,action TEXT)');
  db.exec(readFileSync(new URL('../migrations/0100_approved_account_corrections.sql',import.meta.url),'utf8'));
  db.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(actor,'primary','member','active');
  db.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(owner,'primary','owner','active');
  db.prepare('INSERT INTO entries VALUES(?,?,?,?,?)').run(1,'2026-11-18','expense',1000,original);
  db.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?)').run(original,'primary',actor,'credit_card','member_created',0);
  db.prepare('INSERT INTO family_shared_entry_registry VALUES(?,?,?,?,?)').run('a'.repeat(32),'primary',1,'active',1);
  db.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?)').run(1,actor,'primary');
  db.prepare('INSERT INTO family_shared_mutation_intents VALUES(?,?,?,?,?,?,?,?)')
   .run('b'.repeat(32),'a'.repeat(32),'primary',actor,'update','submitted',uuid,1);
  const columns='(homeflow_request_id,proposal_id,household_id,entry_id,spender_user_id,requester_user_id,approver_user_id,version_before,version_after,before_json,after_json,created_at)';
  const values=[uuid,'b'.repeat(32),'primary',1,actor,actor,owner,1,2,
   JSON.stringify({type:'expense',amount:1000,date:'2026-11-18',accountId:original}),
   JSON.stringify({type:'expense',amount:1500,date:'2026-11-18',accountId:original}),
   1795010000000];
  assert.throws(()=>db.prepare('INSERT INTO family_approved_account_corrections '+columns+
   ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...values.slice(0,7),2,3,...values.slice(9)),
  /ACCOUNT_CORRECTION_APPROVAL_OR_SNAPSHOT_INVALID/);
  db.prepare('INSERT INTO family_approved_account_corrections '+columns+
   ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...values);
  db.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?,?,?,?,?)')
   .run(uuid,'primary',original,'credit_card','2026-11',500,0,1795010000000);
  assert.throws(()=>db.prepare('UPDATE family_approved_account_effects SET delta_jpy=999').run(),
   /ACCOUNT_EFFECT_IMMUTABLE/);
  assert.throws(()=>db.prepare('DELETE FROM family_approved_account_effects').run(),
   /ACCOUNT_EFFECT_IMMUTABLE/);
  assert.throws(()=>db.prepare('DELETE FROM family_approved_account_corrections').run(),
   /ACCOUNT_CORRECTION_IMMUTABLE/);
  assert.equal(db.prepare('SELECT SUM(delta_jpy) total FROM family_approved_account_effects').get().total,500);
 }finally{db.close()}
});
