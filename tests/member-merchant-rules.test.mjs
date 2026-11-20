import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {familyMemberMerchantRules} from '../functions/api/family-finance/member-merchant-rules.js'

const migration=readFileSync(new URL('../migrations/0064_member_merchant_rules.sql',import.meta.url),'utf8')
const owner={user_id:'owner',household_id:'family',role:'owner'}
const member={user_id:'member',household_id:'family',role:'member'}
const other={user_id:'other',household_id:'family',role:'member'}
const outsider={user_id:'external',household_id:'external',role:'member'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec([
  'PRAGMA foreign_keys=ON',
  'CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)',
  'CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)',
  'CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,origin TEXT,account_kind TEXT,is_archived INTEGER)',
  'CREATE TABLE payment_sources(name TEXT PRIMARY KEY,is_archived INTEGER,stat_group TEXT)',
  'CREATE TABLE family_legacy_card_shares(card_name TEXT,household_id TEXT,owner_user_id TEXT,grantee_user_id TEXT,is_active INTEGER)',
  "INSERT INTO homeflow_identity_links VALUES('owner','family','owner','active'),('member','family','member','active'),('other','family','member','active'),('external','external','member','active')",
  "INSERT INTO family_financial_accounts VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','family','member','member_created','credit_card',0)",
  "INSERT INTO family_financial_accounts VALUES('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','family','other','member_created','credit_card',0)",
  "INSERT INTO payment_sources VALUES('楽天カード',0,'card')",
  "INSERT INTO family_legacy_card_shares VALUES('楽天カード','family','owner','member',1)"
 ].join(';')+';')
 sqlite.exec(migration)
 const db={prepare(sql){
  const statement=sqlite.prepare(sql)
  const bind=(args=[])=>({
   first:async()=>statement.get(...args)||null,
   all:async()=>({results:statement.all(...args)}),
   run:async()=>({meta:{changes:statement.run(...args).changes}})
  })
  return {...bind(),bind:(...args)=>bind(args)}
 }}
 async function send(user,method='GET',payload=null){
  const url=new URL('https://kakeibo.example/api/family-finance/member-merchant-rules')
  const req=new Request(url,{method,
   ...(method==='GET'?{}:{headers:{origin:url.origin,'content-type':'application/json'},body:JSON.stringify(payload)})})
  const res=await familyMemberMerchantRules(req,{DB:db},url,user,['member-merchant-rules'])
  return {status:res.status,data:await res.json()}
 }
 const rule=(user=member,keyword='スーパー',category='食費',source='cash',version=0)=>send(user,'POST',{
   expected_user_id:user.user_id,expected_version:version,keyword,category,payment_source:source
 })
 return {sqlite,send,rule}
}
test('each member only reads their own rules; owner cannot read member rules',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.rule()).status,200)
  assert.deepEqual((await f.send(member)).data.items.map(x=>x.keyword),['スーパー'])
  assert.deepEqual((await f.send(other)).data.items,[])
  assert.equal((await f.send(owner)).status,403)
  assert.deepEqual((await f.send(outsider)).data.items,[])
 }finally{f.sqlite.close()}
})
test('optimistic version prevents stale overwrite; own rule can be deleted',async()=>{
 const f=fixture()
 try{
  const created=await f.rule();assert.equal(created.data.version,1)
  assert.equal((await f.rule()).status,409)
  const updated=await f.rule(member,'スーパー','日用品','cash',1)
  assert.equal(updated.status,200)
  assert.equal(updated.data.version,2)
  assert.equal((await f.send(other,'DELETE',{
   expected_user_id:other.user_id,expected_version:2,keyword:'スーパー'
  })).status,409)
  assert.equal((await f.send(member,'DELETE',{
   expected_user_id:member.user_id,expected_version:2,keyword:'スーパー'
  })).status,200)
  assert.deepEqual((await f.send(member)).data.items,[])
 }finally{f.sqlite.close()}
})
test('member payment preferences never reference private accounts of others',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.rule(member,'A','食費','personal:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).status,403)
  assert.equal((await f.rule(member,'B','食費','personal:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).status,200)
  assert.equal((await f.rule(member,'C','食費','shared:楽天カード')).status,200)
  assert.equal((await f.rule(other,'C','食費','shared:楽天カード')).status,403)
  f.sqlite.exec("UPDATE family_legacy_card_shares SET is_active=0 WHERE grantee_user_id='member'")
  assert.equal((await f.rule(member,'D','食費','shared:楽天カード')).status,403)
 }finally{f.sqlite.close()}
})
test('keyword rename is atomic, versioned, and scoped to the member',async()=>{
 const f=fixture()
 try{
  const created=await f.rule(member,'まいばすけっと南小岩8丁目','食費','cash')
  assert.equal(created.status,200)
  const renamed=await f.send(member,'POST',{
   expected_user_id:member.user_id,expected_version:1,
   previous_keyword:'まいばすけっと南小岩8丁目',
   keyword:'まいばすけっと',category:'食費',payment_source:'cash'
  })
  assert.equal(renamed.status,200)
  assert.equal(renamed.data.version,2)
  assert.deepEqual((await f.send(member)).data.items.map(x=>x.keyword),['まいばすけっと'])
  assert.deepEqual((await f.send(other)).data.items,[])
  assert.equal((await f.send(member,'POST',{
   expected_user_id:member.user_id,expected_version:1,
   previous_keyword:'まいばすけっと南小岩8丁目',
   keyword:'残ってはいけない',category:'食費',payment_source:'cash'
  })).status,409)
  assert.deepEqual((await f.send(member)).data.items.map(x=>x.keyword),['まいばすけっと'])
 }finally{f.sqlite.close()}
})
test('renaming onto an existing rule rejects collision without losing either rule',async()=>{
 const f=fixture()
 try{
  await f.rule(member,'まいばすけっと','食費','cash')
  await f.rule(member,'まいばすけっと南小岩8丁目','日用品','cash')
  const result=await f.send(member,'POST',{
   expected_user_id:member.user_id,expected_version:1,
   previous_keyword:'まいばすけっと南小岩8丁目',
   keyword:'まいばすけっと',category:'日用品',payment_source:'cash'
  })
  assert.equal(result.status,409)
  assert.deepEqual((await f.send(member)).data.items.map(x=>x.keyword),
   ['まいばすけっと','まいばすけっと南小岩8丁目'])
 }finally{f.sqlite.close()}
})
test('invalid origin/actor and deactivated sessions reject writes',async()=>{
 const f=fixture()
 try{
  const bad={expected_user_id:'other',expected_version:0,keyword:'A店',category:'食費',payment_source:'cash'}
  assert.equal((await f.send(member,'POST',bad)).status,403)
  f.sqlite.exec("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id='member'")
  assert.equal((await f.rule()).status,403)
 }finally{f.sqlite.close()}
})
