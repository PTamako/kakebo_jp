import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {familyMemberCardUsage} from '../functions/api/family-finance/member-card-usage.js'

const user={user_id:'member-a',household_id:'family',role:'member'}
const id={active:'a'.repeat(32),archived:'b'.repeat(32),spouse:'c'.repeat(32),prepaid:'d'.repeat(32)}

function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,label TEXT,account_kind TEXT,origin TEXT,is_archived INTEGER,closing_day INTEGER,sort_order INTEGER)')
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,merchant TEXT,category TEXT,amount INTEGER,type TEXT,family_account_id TEXT)')
 const a=sql.prepare('INSERT INTO family_financial_accounts VALUES(?,?,?,?,?,?,?,?,?)')
 a.run(id.active,'family','member-a','Current card','credit_card','member_created',0,10,1)
 a.run(id.archived,'family','member-a','Historical card','credit_card','member_created',1,10,2)
 a.run(id.spouse,'family','member-b','Private spouse card','credit_card','member_created',0,10,3)
 a.run(id.prepaid,'family','member-a','Prepaid','prepaid','member_created',0,10,4)
 const entry=sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?)')
 entry.run(1,'2026-11-12','A','食費',300,'expense',id.active)
 entry.run(2,'2026-11-13','B','食費',700,'expense',id.archived)
 entry.run(3,'2026-11-14','X','食費',800,'expense',id.spouse)
 entry.run(4,'2026-11-15','Moved cash','食費',0,'expense',id.archived)
 entry.run(5,'2026-11-16','asset','投資・資産移動',400,'transfer',id.archived)
 entry.run(6,'2026-10-12','old','食費',1300,'expense',id.archived)
 entry.run(7,'2026-11-17','prepaid','食費',150,'expense',id.prepaid)
 const db={prepare(query){return {bind(...params){return {
  all:async()=>({results:sql.prepare(query).all(...params)}),
  first:async()=>sql.prepare(query).get(...params)||null
 }}}}}
 const call=async(month='2026-12',who=user,method='GET')=>{
  const url=new URL('https://kakeibo.test/api/family-finance/member-card-usage?month='+month)
  const response=await familyMemberCardUsage(new Request(url,{method}),{DB:db},url,who,['member-card-usage'])
  return {status:response.status,body:await response.json()}
 }
 return {sql,call}
}

test('member card usage retains archived own card history without leaking spouse cards or transfers',async()=>{
 const f=fixture()
 try{
  const {status,body}=await f.call()
  assert.equal(status,200)
  assert.equal(body.scope,'personal-card-usage')
  assert.equal(body.viewer_user_id,user.user_id)
  assert.equal(body.items.length,2)
  const active=body.items.find(x=>x.account_id===id.active)
  const archived=body.items.find(x=>x.account_id===id.archived)
  assert.equal(active.amount_jpy,300)
  assert.equal(active.count,1)
  assert.equal(archived.amount_jpy,700)
  assert.equal(archived.count,1)
  assert.equal(archived.is_archived,true)
  assert.equal(active.is_archived,false)
  assert.ok(body.items.every(x=>x.owner_user_id==='member-a'))
  assert.ok(body.items.every(x=>x.label!=='Private spouse card'))
  assert.ok(body.items.every(x=>x.account_id!==id.prepaid))
  const source=readFileSync(new URL('../src/MemberCardUsage.vue',import.meta.url),'utf8')
  assert.match(source,/item\.is_archived\?'（アーカイブ済み）':''/)
 }finally{f.sql.close()}
})

test('archived card history uses the actual corrected entry amount and closing window',async()=>{
 const f=fixture()
 try{
  f.sql.prepare('UPDATE entries SET amount=? WHERE id=?').run(950,2)
  const current=await f.call()
  assert.equal(current.body.items.find(x=>x.account_id===id.archived).amount_jpy,950)
  const prior=await f.call('2026-11')
  assert.equal(prior.body.items.find(x=>x.account_id===id.archived).amount_jpy,1300)
  assert.equal((await f.call('2026-00')).status,400)
  assert.equal((await f.call('2026-12',user,'POST')).status,405)
 }finally{f.sql.close()}
})
