import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {familyLegacyCardSharing} from '../functions/api/family-finance/legacy-card-sharing.js'

const migration=readFileSync(new URL('../migrations/0061_family_legacy_card_sharing.sql',import.meta.url),'utf8')
const owner={user_id:'owner',household_id:'home',role:'owner'}
const spouse={user_id:'spouse',household_id:'home',role:'member'}
const outsider={user_id:'outsider',household_id:'other',role:'member'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec([
  'PRAGMA foreign_keys=ON',
  'CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)',
  'CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT,display_name TEXT)',
  'CREATE TABLE payment_sources(name TEXT PRIMARY KEY,is_archived INTEGER DEFAULT 0,stat_group TEXT DEFAULT \'card\',source_type TEXT DEFAULT \'standard\',sort_order INTEGER DEFAULT 0)',
  'CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT,time TEXT,amount INTEGER,category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT)',
  "INSERT INTO homeflow_identity_links VALUES ('owner','home','owner','active','白ちゃん'),('spouse','home','member','active','鸡毛大王'),('outsider','other','member','active','外部')",
  "INSERT INTO payment_sources(name) VALUES ('楽天カード'),('現金')",
  "INSERT INTO payment_sources(name,stat_group) VALUES('ポイント専用','points')",
  "INSERT INTO payment_sources(name,is_archived) VALUES('停止カード',1)"
 ].join(';')+';')
 sqlite.exec(migration)
 const db={
  prepare(sql){
   const stmt=sqlite.prepare(sql),bound=(args=[])=>({
    first:async()=>stmt.get(...args)??null,
    all:async()=>({results:stmt.all(...args)}),
    run:async()=>({meta:{changes:stmt.run(...args).changes}})
   })
   return {...bound(),bind:(...args)=>bound(args)}
  },
  async batch(stmts){
   sqlite.exec('BEGIN IMMEDIATE')
   try{
    const result=[]
    for(const stmt of stmts)result.push(await stmt.run())
    sqlite.exec('COMMIT')
    return result
   }catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 }
 const env={DB:db,KAKEIBO_LEGACY_CARD_DIRECT_SPEND_ENABLED:'true'};
 async function send(path,user,data){
  const url=new URL('https://kakeibo.example/api/family-finance/'+path)
  const request=new Request(url,{method:data?'POST':'GET',
   ...(data?{headers:{origin:url.origin,'content-type':'application/json'},
    body:JSON.stringify(data)}:{})})
  const res=await familyLegacyCardSharing(request,env,url,user,path.split('/'))
  return {status:res.status,data:await res.json()}
 }
 const share=(enabled=true,card='楽天カード',version=0,user=owner,target=spouse)=>
  send('legacy-card-shares',user,{expected_user_id:user.user_id,
   card_name:card,grantee_user_id:target.user_id,enabled,expected_version:version})
 const spend=(key='test:card:0000001',user=spouse,card='楽天カード')=>
  send('legacy-card-spends',user,{expected_user_id:user.user_id,
   idempotency_key:key,card_name:card,date:'2026-11-16',time:'17:35',
   amount_jpy:2000,merchant:'スーパー',category:'食費',note:''})
 return {sqlite,env,send,share,spend}
}
test('only verified owner can grant; spouse sees only the granted card',async()=>{
 const f=fixture()
 try{
  assert.deepEqual((await f.send('legacy-card-shares',spouse)).data.incoming,[])
  assert.equal((await f.share(true,'楽天カード',0,spouse)).status,403)
  assert.equal((await f.share(true,'楽天カード',0,owner,outsider)).status,403)
  const grant=await f.share()
  assert.equal(grant.status,200,JSON.stringify(grant))
  assert.equal(grant.data.version,1)
  const list=await f.send('legacy-card-shares',spouse)
  assert.deepEqual(list.data.incoming.map(x=>x.card_name),['楽天カード'])
  assert.equal(list.data.incoming[0].owner_display_name,'白ちゃん')
  assert.equal((await f.share(false,'楽天カード',0)).status,409)
 }finally{f.sqlite.close()}
})
test('delegated purchase appears exactly once in owner card and immutable nickname audit',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.spend()).status,403)
  assert.equal((await f.share()).status,200)
  const receipt=await f.spend()
  assert.equal(receipt.status,201,JSON.stringify(receipt))
  assert.equal((await f.spend()).data.replayed,true)
  const e=f.sqlite.prepare('SELECT type,amount,payment_source FROM entries').get()
  assert.deepEqual({...e},{type:'expense',amount:2000,payment_source:'楽天カード'})
  const a=f.sqlite.prepare('SELECT owner_user_id,actor_user_id FROM family_legacy_card_spends').get()
  assert.deepEqual({...a},{owner_user_id:'owner',actor_user_id:'spouse'})
  assert.throws(()=>f.sqlite.prepare('UPDATE entries SET amount=3000').run(),/SHARED_CARD_SPEND_IMMUTABLE/)
  assert.throws(()=>f.sqlite.prepare('DELETE FROM entries').run(),/SHARED_CARD_SPEND_IMMUTABLE/)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
 }finally{f.sqlite.close()}
})
test('revocation blocks new spending but retains expense and audit records',async()=>{
 const f=fixture()
 try{
  await f.share();await f.spend()
  assert.equal((await f.share(false,'楽天カード',1)).status,200)
  assert.deepEqual((await f.send('legacy-card-shares',spouse)).data.incoming,[])
  assert.equal((await f.spend('test:card:0000002')).status,403)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,1)
  assert.deepEqual(f.sqlite.prepare('SELECT action FROM family_legacy_card_share_audit ORDER BY version')
   .all().map(x=>x.action),['grant','revoke'])
 }finally{f.sqlite.close()}
})
test('renaming source retains grant, card bill key and spender attribution',async()=>{
 const f=fixture()
 try{
  await f.share();await f.spend()
  f.sqlite.prepare('UPDATE entries SET payment_source=?').run('楽天NEW')
  f.sqlite.prepare('UPDATE payment_sources SET name=? WHERE name=?').run('楽天NEW','楽天カード')
  assert.deepEqual((await f.send('legacy-card-shares',spouse)).data.incoming.map(x=>x.card_name),['楽天NEW'])
  assert.equal(f.sqlite.prepare('SELECT card_name FROM family_legacy_card_spends').get().card_name,'楽天NEW')
  assert.equal(f.sqlite.prepare('SELECT payment_source FROM entries').get().payment_source,'楽天NEW')
 }finally{f.sqlite.close()}
})
test('cash, points and archived cards cannot be shared; impersonation forbidden',async()=>{
 const f=fixture()
 try{
  for(const name of ['現金','ポイント専用','停止カード'])
   assert.notEqual((await f.share(true,name)).status,200)
  await f.share()
  assert.equal((await f.spend('test:card:0000003',outsider)).status,403)
  assert.equal((await f.spend('test:card:0000004',owner)).status,403)
  f.sqlite.exec("UPDATE payment_sources SET is_archived=1 WHERE name='楽天カード'")
  assert.deepEqual((await f.send('legacy-card-shares',spouse)).data.incoming,[])
  assert.equal((await f.spend('test:card:0000005')).status,403)
 }finally{f.sqlite.close()}
})

test('new delegated card spending cannot bypass HomeFlow ledger approval',async()=>{
 const f=fixture()
 try{
  await f.share()
  f.env.KAKEIBO_LEGACY_CARD_DIRECT_SPEND_ENABLED='false'
  const res=await f.spend('approval-required-20261117')
  assert.equal(res.status,409)
  assert.equal(res.data.code,'SHARED_CARD_LEDGER_APPROVAL_REQUIRED')
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0)
 }finally{f.sqlite.close()}
})
