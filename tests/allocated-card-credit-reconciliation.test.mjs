import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {memberCardLiabilities} from '../functions/api/family-finance/card-settlement-summary.js';
const hh='primary',a='a'.repeat(32),b='b'.repeat(32);
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)');
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,label TEXT)');
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,amount INTEGER,type TEXT,payment_source TEXT,family_account_id TEXT,client_request_id TEXT)');
 sql.exec('CREATE TABLE family_card_purchase_applied(homeflow_request_id TEXT,entry_id INTEGER,household_id TEXT,account_id TEXT,bill_month TEXT,amount_jpy INTEGER,purchase_date TEXT)');
 sql.exec('CREATE TABLE family_approved_account_effects(household_id TEXT,account_id TEXT,account_kind TEXT,bill_month TEXT,delta_jpy INTEGER,purchase_count_delta INTEGER)');
 sql.exec('CREATE TABLE family_owner_account_effects(household_id TEXT,account_id TEXT,account_kind TEXT,bill_month TEXT,delta_jpy INTEGER,purchase_count_delta INTEGER)');
 sql.exec('CREATE TABLE family_card_settlements_applied(homeflow_request_id TEXT,household_id TEXT,card_account_id TEXT,debit_date TEXT)');
 sql.exec('CREATE TABLE family_card_settlement_allocations(homeflow_request_id TEXT,purchase_request_id TEXT,amount_jpy INTEGER)');
 sql.exec('CREATE TABLE family_points_card_offsets(homeflow_request_id TEXT,purchase_request_id TEXT,household_id TEXT,card_account_id TEXT,amount_jpy INTEGER,effective_date TEXT)');
 sql.exec('CREATE TABLE family_points_card_offset_refunds(original_request_id TEXT,restored_jpy INTEGER)');
 for(const id of [a,b])sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?)')
  .run(id,hh,'member',id===a?'原来的卡':'新卡');
 sql.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?,?,?,?,?)')
  .run('receipt-1',1,hh,a,'2026-11',1000,'2026-11-15');
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?)')
  .run(1,'2026-11-15',1000,'expense','cc:'+a,a,'hfcard:receipt-1');
 sql.prepare('INSERT INTO family_card_settlements_applied VALUES(?,?,?,?)')
  .run('bank-1',hh,a,'2026-11-20');
 sql.prepare('INSERT INTO family_card_settlement_allocations VALUES(?,?,?)').run('bank-1','receipt-1',500);
 sql.prepare('INSERT INTO family_points_card_offsets VALUES(?,?,?,?,?,?)')
  .run('offset-1','receipt-1',hh,a,300,'2026-11-20');
 return sql;
}
const wrap=sql=>({prepare(q){return {bind(...args){return {
 first:async()=>sql.prepare(q).get(...args)||null,
 all:async()=>({results:sql.prepare(q).all(...args)})
}}}}});
test('cross-card approved invoice revision keeps bank and redeemed points as original-card unapplied credit',async()=>{
 const sql=fixture();
 try{
  sql.exec(readFileSync(new URL('../migrations/0108_allocated_cards_unapplied_credit.sql',import.meta.url),'utf8'));
  const initial=await memberCardLiabilities(wrap(sql),hh,true);
  assert.equal(initial.total,200);
  assert.equal(initial.total_unapplied_card_credit_jpy,0);
  sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?,?,?)')
   .run(hh,a,'credit_card','2026-11',-1000,-1);
  sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?,?,?)')
   .run(hh,b,'credit_card','2026-11',1000,1);
  sql.prepare('UPDATE entries SET family_account_id=?,payment_source=? WHERE id=1').run(b,'cc:'+b);
  const after=await memberCardLiabilities(wrap(sql),hh,true);
  assert.equal(after.total,1000);
  assert.equal(after.total_unapplied_card_credit_jpy,800);
  assert.equal(after.net_card_position_jpy,200,'one household charge, bank and points unchanged');
  assert.equal(after.items.find(x=>x.account_id===a).unapplied_card_credit_jpy,800);
  assert.equal(after.items.find(x=>x.account_id===b).liability_jpy,1000);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM family_card_settlement_allocations').get().n,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM family_points_card_offsets').get().n,1);
  assert.throws(()=>sql.prepare('INSERT INTO family_card_settlement_allocations VALUES(?,?,?)')
   .run('bank-1','receipt-1',1),/CARD_SETTLEMENT_CURRENT_BALANCE_OR_SOURCE_INVALID/);
  assert.throws(()=>sql.prepare('INSERT INTO family_points_card_offsets VALUES(?,?,?,?,?,?)')
   .run('offset-2','receipt-1',hh,a,1,'2026-11-21'),/POINTS_OFFSET_CURRENT_BALANCE_OR_SOURCE_INVALID/);
 }finally{sql.close()}
});
test('amount reduction below already paid charge becomes card credit, not lost money',async()=>{
 const sql=fixture();
 try{
  sql.prepare('INSERT INTO family_owner_account_effects VALUES(?,?,?,?,?,?)')
   .run(hh,a,'credit_card','2026-11',-700,0);
  sql.prepare('UPDATE entries SET amount=300 WHERE id=1').run();
  const after=await memberCardLiabilities(wrap(sql),hh,true);
  assert.equal(after.total,0);
  assert.equal(after.total_unapplied_card_credit_jpy,500);
  assert.equal(after.net_card_position_jpy,-500);
 }finally{sql.close()}
});
