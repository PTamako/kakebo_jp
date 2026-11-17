import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('0107 owner effects and member effects jointly protect the prepaid balance',()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
  sql.exec('CREATE TABLE family_approved_account_effects(account_id TEXT,household_id TEXT,account_kind TEXT,delta_jpy INTEGER)');
  sql.exec('CREATE TABLE family_owner_account_effects(account_id TEXT,household_id TEXT,account_kind TEXT,delta_jpy INTEGER)');
  sql.exec('CREATE TABLE family_prepaid_balance_journal(prepaid_account_id TEXT,household_id TEXT,homeflow_request_id TEXT,effective_date TEXT,balance_after_jpy INTEGER,delta_jpy INTEGER)');
  sql.exec('CREATE TABLE family_prepaid_actions_applied(homeflow_request_id TEXT,household_id TEXT,prepaid_account_id TEXT,date TEXT,balance_after_jpy INTEGER,action TEXT,amount_jpy INTEGER)');
  sql.exec('CREATE TABLE family_member_prepaid_topups(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER,request_id TEXT,owner_user_id TEXT,effective_date TEXT)');
  sql.exec('CREATE TABLE family_member_prepaid_topup_corrections(household_id TEXT,before_account_id TEXT,after_account_id TEXT,before_amount_jpy INTEGER,after_amount_jpy INTEGER,topup_request_id TEXT,owner_user_id TEXT,revision INTEGER,after_account_version INTEGER,before_effective_date TEXT,after_effective_date TEXT)');
  sql.exec('CREATE TABLE family_points_prepaid_credits(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)');
  sql.exec('CREATE TABLE family_points_prepaid_refunds(prepaid_account_id TEXT,household_id TEXT,debited_prepaid_jpy INTEGER)');
  sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER,version INTEGER,opening_balance INTEGER)');
  sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT)');
  sql.exec(readFileSync(new URL('../migrations/0107_owner_prepaid_all_writers.sql',import.meta.url),'utf8'));
  const id='a'.repeat(32),hh='primary';
  sql.prepare('INSERT INTO family_member_prepaid_topups VALUES(?,?,?,?,?,?)')
   .run(id,hh,5000,'receipt-1','member','2026-11-17');
  sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?)')
   .run(id,hh,'prepaid',-2000);
  const owner=sql.prepare('INSERT INTO family_owner_account_effects VALUES(?,?,?,?)');
  owner.run(id,hh,'prepaid',-2500);
  assert.throws(()=>owner.run(id,hh,'prepaid',-600),/OWNER_CORRECTION_PREPAID_OVERDRAFT/);
  owner.run(id,hh,'prepaid',-400);
  const member=sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?)');
  assert.throws(()=>member.run(id,hh,'prepaid',-200),/APPROVED_CORRECTION_PREPAID_OVERDRAFT/);
  assert.equal(sql.prepare("SELECT 5000+COALESCE((SELECT SUM(delta_jpy) FROM family_owner_account_effects),0)+COALESCE((SELECT SUM(delta_jpy) FROM family_approved_account_effects),0) AS balance").get().balance,100);
 }finally{sql.close()}
});
