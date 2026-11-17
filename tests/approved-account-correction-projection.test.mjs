import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {memberCardLiabilities} from '../functions/api/family-finance/card-settlement-summary.js'
import {memberPrepaidBalances} from '../functions/api/family-finance/prepaid-balance-projection.js'

function fixture(effects){
 const sql=new DatabaseSync(':memory:')
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,label TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER,version INTEGER,created_at INTEGER)')
 sql.exec('CREATE TABLE family_card_purchase_applied(account_id TEXT,bill_month TEXT,amount_jpy INTEGER,household_id TEXT)')
 sql.exec('CREATE TABLE family_prepaid_balance_journal(prepaid_account_id TEXT,household_id TEXT,delta_jpy INTEGER)')
 sql.exec('CREATE TABLE family_member_prepaid_topups(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)')
 sql.exec('CREATE TABLE family_points_prepaid_credits(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)')
 sql.exec('CREATE TABLE family_points_prepaid_refunds(prepaid_account_id TEXT,household_id TEXT,debited_prepaid_jpy INTEGER)')
 if(effects)sql.exec('CREATE TABLE family_approved_account_effects(homeflow_request_id TEXT,household_id TEXT,account_id TEXT,account_kind TEXT,bill_month TEXT,delta_jpy INTEGER,purchase_count_delta INTEGER)')
 const ids={a:'a'.repeat(32),b:'b'.repeat(32),p:'c'.repeat(32)}
 for(const [label,kind,id] of [['A','credit_card',ids.a],['B','credit_card',ids.b],['P','prepaid',ids.p]])
  sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,'primary','member',label,kind,'member_created',0,1,Date.now())
 const db={prepare(q){return {
  bind(...args){return {
   first:async()=>sql.prepare(q).get(...args)||null,
   all:async()=>({results:sql.prepare(q).all(...args)})
  }},
  first:async()=>sql.prepare(q).get()||null
 }}}
 return {sql,db,ids,close:()=>sql.close()}
}
test('future approved card revision moves amount and count across cards exactly once',async()=>{
 const f=fixture(true)
 try{
  f.sql.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?,?)')
   .run(f.ids.a,'2026-11',1000,'primary')
  f.sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?,?,?,?)')
   .run('correction','primary',f.ids.a,'credit_card','2026-11',-1000,-1)
  f.sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?,?,?,?)')
   .run('correction','primary',f.ids.b,'credit_card','2026-12',1250,1)
  const r=await memberCardLiabilities(f.db,'primary',false)
  assert.equal(r.total,1250)
  assert.equal(r.items.length,1)
  assert.equal(r.items[0].account_id,f.ids.b)
  assert.equal(r.items[0].closing_month,'2026-12')
  assert.equal(r.items[0].purchases,1)
  assert.equal(r.items[0].liability_jpy,1250)
 }finally{f.close()}
})
test('future approved prepaid correction adds only delta and preserves existing journals',async()=>{
 const f=fixture(true)
 try{
  f.sql.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?)')
   .run(f.ids.p,'primary',3000)
  f.sql.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?)')
   .run(f.ids.p,'primary',-1500)
  f.sql.prepare('INSERT INTO family_approved_account_effects VALUES(?,?,?,?,?,?,?)')
   .run('correction','primary',f.ids.p,'prepaid','',250,0)
  const r=await memberPrepaidBalances(f.db,'primary')
  assert.equal(r.total_jpy,1750)
  assert.equal(r.accounts.length,1)
  assert.equal(r.accounts[0].balance_jpy,1750)
 }finally{f.close()}
})
test('without any corrections table both original read models stay compatible',async()=>{
 const f=fixture(false)
 try{
  f.sql.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?,?)')
   .run(f.ids.a,'2026-11',1000,'primary')
  f.sql.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?)')
   .run(f.ids.p,'primary',2000)
  const a=await memberCardLiabilities(f.db,'primary',false)
  const b=await memberPrepaidBalances(f.db,'primary')
  assert.equal(a.total,1000)
  assert.equal(b.total_jpy,2000)
 }finally{f.close()}
})
