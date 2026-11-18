import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {planAccountLinkedExpenseCorrection,closingMonth} from '../src/approved-account-correction-plan.js'
import {memberCardLiabilities} from '../functions/api/family-finance/card-settlement-summary.js'
import {memberPrepaidBalances} from '../functions/api/family-finance/prepaid-balance-projection.js'

const hh='family',member='member-a',owner='owner'
const ids={a:'a'.repeat(32),b:'b'.repeat(32),p:'c'.repeat(32),other:'d'.repeat(32)}
const accounts=[
 {account_id:ids.a,owner_user_id:member,account_kind:'credit_card',origin:'member_created',is_archived:0,closing_day:10},
 {account_id:ids.b,owner_user_id:member,account_kind:'credit_card',origin:'member_created',is_archived:0,closing_day:20},
 {account_id:ids.p,owner_user_id:member,account_kind:'prepaid',origin:'member_created',is_archived:0,closing_day:null},
 {account_id:ids.other,owner_user_id:'other-member',account_kind:'credit_card',origin:'member_created',is_archived:0,closing_day:10}
]
function fixture({source=ids.a,originalAmount=1000}={}){
 const sql=new DatabaseSync(':memory:')
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,label TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER,version INTEGER,created_at INTEGER)')
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,amount INTEGER,type TEXT,family_account_id TEXT,payment_source TEXT)')
 sql.exec('CREATE TABLE family_card_purchase_applied(account_id TEXT,bill_month TEXT,amount_jpy INTEGER,household_id TEXT)')
 sql.exec('CREATE TABLE family_approved_account_effects(correction_id TEXT,household_id TEXT,account_id TEXT,account_kind TEXT,bill_month TEXT,delta_jpy INTEGER,purchase_count_delta INTEGER)')
 sql.exec('CREATE TABLE family_owner_account_effects(correction_id TEXT,household_id TEXT,account_id TEXT,account_kind TEXT,bill_month TEXT,delta_jpy INTEGER,purchase_count_delta INTEGER)')
 sql.exec('CREATE TABLE family_prepaid_balance_journal(prepaid_account_id TEXT,household_id TEXT,delta_jpy INTEGER)')
 sql.exec('CREATE TABLE family_member_prepaid_topups(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)')
 sql.exec('CREATE TABLE family_points_prepaid_credits(prepaid_account_id TEXT,household_id TEXT,amount_jpy INTEGER)')
 sql.exec('CREATE TABLE family_points_prepaid_refunds(prepaid_account_id TEXT,household_id TEXT,debited_prepaid_jpy INTEGER)')
 const insert=sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?,?,?,?)')
 accounts.forEach((a,i)=>insert.run(a.account_id,hh,a.owner_user_id,'Card '+i,a.account_kind,
  a.origin,a.is_archived,1,Date.now()+i))
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?)')
  .run(1,'2026-11-09',originalAmount,'expense',source,
   (source===ids.p?'prepaid:':'cc:')+source)
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?)').run(2,'2026-11-15',300,'transfer',null,'')
 sql.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?)').run(ids.p,hh,5000)
 if(source===ids.a||source===ids.b){
  sql.prepare('INSERT INTO family_card_purchase_applied VALUES(?,?,?,?)')
   .run(source,closingMonth('2026-11-09',accounts.find(a=>a.account_id===source).closing_day),originalAmount,hh)
 }else if(source===ids.p){
  sql.prepare('INSERT INTO family_prepaid_balance_journal VALUES(?,?,?)')
   .run(ids.p,hh,-originalAmount)
 }
 const db={prepare(q){return {
  bind(...args){return {
   first:async()=>sql.prepare(q).get(...args)||null,
   all:async()=>({results:sql.prepare(q).all(...args)})
  }}
 }}}
 let applied=0
 const read=()=>sql.prepare('SELECT date,amount,type,family_account_id accountId FROM entries WHERE id=1').get()
 const month=m=>sql.prepare("SELECT COALESCE(SUM(CASE WHEN type='expense' AND amount>0 THEN amount ELSE 0 END),0) expense,COALESCE(SUM(CASE WHEN type='transfer' THEN amount ELSE 0 END),0) transfer FROM entries WHERE substr(date,1,7)=?").get(m)
 async function snapshot(){
  return {cards:await memberCardLiabilities(db,hh,false),prepaid:await memberPrepaidBalances(db,hh)}
 }
 function apply(after,{editor=member,journal='member'}={}){
  const before=read()
  const plan=planAccountLinkedExpenseCorrection({
   before,after,accounts,spenderUserId:member,editorUserId:editor,
   prepaidBalances:{[ids.p]:sql.prepare('SELECT COALESCE(SUM(delta_jpy),0) n FROM family_prepaid_balance_journal').get().n+
    sql.prepare("SELECT COALESCE(SUM(delta_jpy),0) n FROM family_approved_account_effects WHERE account_kind='prepaid'").get().n+
    sql.prepare("SELECT COALESCE(SUM(delta_jpy),0) n FROM family_owner_account_effects WHERE account_kind='prepaid'").get().n},
   operation:before.amount===0?'restore':after.amount===0?'delete':'update'
  })
  const account=a=>accounts.find(x=>x.account_id===a)
  const count=(eff,bef,aft)=>{
   if(eff.kind!=='credit_card')return 0
   const is=(x)=>x.accountId===eff.accountId&&x.amount>0&&
    closingMonth(x.date,account(x.accountId).closing_day)===eff.billMonth
   return Number(is(aft))-Number(is(bef))
  }
  const table=journal==='owner'?'family_owner_account_effects':'family_approved_account_effects'
  sql.exec('BEGIN IMMEDIATE')
  try{
   const cmd=sql.prepare('INSERT INTO '+table+' VALUES(?,?,?,?,?,?,?)')
   for(const e of plan.effects)cmd.run('correction-'+applied,hh,e.accountId,e.kind,
    e.billMonth||'',e.deltaJpy,count(e,before,after))
   sql.prepare('UPDATE entries SET date=?,amount=?,family_account_id=?,payment_source=? WHERE id=1')
    .run(after.date,after.amount,after.accountId,
     after.accountId?(after.accountId===ids.p?'prepaid:':'cc:')+after.accountId:'')
   sql.exec('COMMIT')
   applied++
  }catch(e){sql.exec('ROLLBACK');throw e}
  return plan
 }
 return {sql,read,month,snapshot,apply,close:()=>sql.close()}
}
test('approved cross-card and cross-billing-month revision updates card position and monthly spending once',async()=>{
 const f=fixture()
 try{
  const before=await f.snapshot()
  assert.equal(before.cards.total,1000)
  assert.equal(f.month('2026-11').expense,1000)
  assert.equal(f.month('2026-11').transfer,300)
  f.apply({date:'2026-11-21',amount:1250,type:'expense',accountId:ids.b})
  const after=await f.snapshot()
  assert.equal(after.cards.total,1250)
  assert.equal(after.cards.items.length,1)
  assert.equal(after.cards.items[0].account_id,ids.b)
  assert.equal(after.cards.items[0].closing_month,'2026-12')
  assert.equal(after.cards.items[0].purchases,1)
  assert.equal(f.month('2026-11').expense,0)
  assert.equal(f.month('2026-11').transfer,300)
  assert.equal(f.month('2026-12').expense,1250)
  assert.equal(after.prepaid.total_jpy,5000)
 }finally{f.close()}
})
test('approved card-to-prepaid revision moves charge once and debits available balance',async()=>{
 const f=fixture()
 try{
  f.apply({date:'2026-11-09',amount:1100,type:'expense',accountId:ids.p})
  const s=await f.snapshot()
  assert.equal(s.cards.total,0)
  assert.equal(s.prepaid.accounts.find(a=>a.account_id===ids.p).balance_jpy,3900)
  assert.equal(f.month('2026-11').expense,1100)
 }finally{f.close()}
})
test('prepaid amount change, approved deletion and restoration recalculate balance and spending',async()=>{
 const f=fixture({source:ids.p})
 try{
  assert.equal((await f.snapshot()).prepaid.total_jpy,4000)
  f.apply({date:'2026-11-09',amount:400,type:'expense',accountId:ids.p})
  assert.equal((await f.snapshot()).prepaid.total_jpy,4600)
  assert.equal(f.month('2026-11').expense,400)
  f.apply({date:'2026-11-09',amount:0,type:'expense',accountId:ids.p})
  assert.equal((await f.snapshot()).prepaid.total_jpy,5000)
  assert.equal(f.month('2026-11').expense,0)
  f.apply({date:'2026-11-09',amount:400,type:'expense',accountId:ids.p})
  assert.equal((await f.snapshot()).prepaid.total_jpy,4600)
  assert.equal(f.month('2026-11').expense,400)
 }finally{f.close()}
})
test('owner can correct amount on a member card but cannot reassign another member personal account',async()=>{
 const f=fixture()
 try{
  f.apply({date:'2026-11-09',amount:700,type:'expense',accountId:ids.a},{editor:owner,journal:'owner'})
  assert.equal((await f.snapshot()).cards.total,700)
  assert.equal(f.month('2026-11').expense,700)
  assert.throws(()=>f.apply({date:'2026-11-09',amount:800,type:'expense',accountId:ids.b},
   {editor:owner,journal:'owner'}),/CORRECTION_OTHER_PERSON_ACCOUNT_READ_ONLY/)
  assert.equal((await f.snapshot()).cards.total,700)
 }finally{f.close()}
})
test('insufficient prepaid funds and foreign card are denied without changing any family statistic',async()=>{
 const f=fixture()
 try{
  assert.throws(()=>f.apply({date:'2026-11-09',amount:6000,type:'expense',accountId:ids.p}),
   /CORRECTION_PREPAID_INSUFFICIENT_BALANCE/)
  assert.throws(()=>f.apply({date:'2026-11-09',amount:1000,type:'expense',accountId:ids.other}),
   /CORRECTION_ACCOUNT_NOT_OWNED_OR_ACTIVE/)
  assert.equal((await f.snapshot()).cards.total,1000)
  assert.equal((await f.snapshot()).prepaid.total_jpy,5000)
  assert.equal(f.month('2026-11').expense,1000)
 }finally{f.close()}
})
