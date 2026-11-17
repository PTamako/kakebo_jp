import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('0103 serializes prepaid spend and personal top-up amendments against approved cash/card effects',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
  db.exec('CREATE TABLE family_prepaid_actions_applied(homeflow_request_id TEXT,household_id TEXT,prepaid_account_id TEXT,date TEXT,balance_after_jpy INTEGER,action TEXT,amount_jpy INTEGER)');
  db.exec('CREATE TABLE family_prepaid_balance_journal(homeflow_request_id TEXT,household_id TEXT,prepaid_account_id TEXT,effective_date TEXT,balance_after_jpy INTEGER,delta_jpy INTEGER)');
  db.exec('CREATE TABLE family_member_prepaid_topups(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)');
  db.exec('CREATE TABLE family_member_prepaid_topup_corrections(household_id TEXT,before_account_id TEXT,after_account_id TEXT,before_amount_jpy INTEGER,after_amount_jpy INTEGER)');
  db.exec('CREATE TABLE family_points_prepaid_credits(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)');
  db.exec('CREATE TABLE family_points_prepaid_refunds(prepaid_account_id TEXT,household_id TEXT,debited_prepaid_jpy INTEGER)');
  db.exec('CREATE TABLE family_approved_account_effects(account_id TEXT,household_id TEXT,account_kind TEXT,delta_jpy INTEGER)');
  db.exec(readFileSync(new URL('../migrations/0103_future_prepaid_writer_serial_guards.sql',import.meta.url),'utf8'));
  const a='a'.repeat(32),b='b'.repeat(32),house='primary';
  db.prepare('INSERT INTO family_member_prepaid_topups VALUES(?,?,?)').run(a,house,5000);
  db.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?)').run(a,house,'prepaid',-2000);
  const amend=db.prepare('INSERT INTO family_member_prepaid_topup_corrections VALUES(?,?,?,?,?)');
  assert.throws(()=>amend.run(house,a,b,4000,3500),/FUTURE_TOPUP_CORRECTION_ACCOUNT_OVERDRAFT/);
  amend.run(house,a,b,1000,900);
  db.prepare('INSERT INTO family_prepaid_actions_applied VALUES(?,?,?,?,?,?,?)')
    .run('approval-1',house,a,'2026-11-18',1500,'spend',500);
  const journal=db.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?,?,?,?)');
  assert.throws(()=>journal.run('approval-1',house,a,'2026-11-18',3500,-500),
    /PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE/);
  journal.run('approval-1',house,a,'2026-11-18',1500,-500);
  assert.equal(db.prepare('SELECT SUM(delta_jpy) v FROM family_prepaid_balance_journal').get().v,-500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM family_member_prepaid_topup_corrections').get().n,1);
 }finally{db.close()}
});

test('0104 top-up correction CAS accounts for already-approved prepaid expense adjustments',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
  db.exec('CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT)');
  db.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,owner_user_id TEXT,household_id TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER,version INTEGER,opening_balance INTEGER)');
  db.exec('CREATE TABLE family_member_prepaid_topups(request_id TEXT,household_id TEXT,owner_user_id TEXT,prepaid_account_id TEXT,amount_jpy INTEGER,effective_date TEXT)');
  db.exec('CREATE TABLE family_prepaid_balance_journal(prepaid_account_id TEXT,delta_jpy INTEGER)');
  db.exec('CREATE TABLE family_points_prepaid_credits(prepaid_account_id TEXT,amount_jpy INTEGER)');
  db.exec('CREATE TABLE family_points_prepaid_refunds(prepaid_account_id TEXT,debited_prepaid_jpy INTEGER)');
  db.exec('CREATE TABLE family_approved_account_effects(account_id TEXT,account_kind TEXT,household_id TEXT,delta_jpy INTEGER)');
  db.exec('CREATE TABLE family_member_prepaid_topup_corrections(topup_request_id TEXT,household_id TEXT,owner_user_id TEXT,revision INTEGER,before_account_id TEXT,after_account_id TEXT,after_account_version INTEGER,before_amount_jpy INTEGER,after_amount_jpy INTEGER,before_effective_date TEXT,after_effective_date TEXT)');
  db.exec(readFileSync(new URL('../migrations/0104_prepaid_topup_guard_approved_effects.sql',import.meta.url),'utf8'));
  const owner='member',house='primary',a='a'.repeat(32),b='b'.repeat(32);
  db.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)').run(owner,house,'member','active');
  for(const id of [a,b])db.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?,?,?)')
   .run(id,owner,house,'prepaid','member_created',0,1,0);
  db.prepare('INSERT INTO family_member_prepaid_topups VALUES(?,?,?,?,?,?)')
   .run('receipt-1',house,owner,a,5000,'2026-11-15');
  db.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?)')
   .run(a,'prepaid',house,-4500);
  const stmt=db.prepare('INSERT INTO family_member_prepaid_topup_corrections VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  assert.throws(()=>stmt.run('receipt-1',house,owner,1,a,b,1,5000,4000,'2026-11-15','2026-11-16'),
   /PERSONAL_TOPUP_CORRECTION_STALE_OR_OVERDRAW/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM family_member_prepaid_topup_corrections').get().n,0);
  stmt.run('receipt-1',house,owner,1,a,b,1,5000,4600,'2026-11-15','2026-11-16');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM family_member_prepaid_topup_corrections').get().n,1);
 }finally{db.close()}
});
