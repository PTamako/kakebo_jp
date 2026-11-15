import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {legacySharedAdopt} from '../functions/api/family-finance/legacy-shared-adopt.js';
import {familySharedEntries} from '../functions/api/family-finance/shared-entries.js';
const owner='11111111-1111-4111-8111-111111111111',member='22222222-2222-4222-8222-222222222222',hh='house',account='a'.repeat(32);
const url=new URL('https://kakeibo.test/api/family-finance/legacy/shared-adopt');
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 sql.exec("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)");
 sql.exec("CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)");
 sql.exec("CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,owner_user_id TEXT,household_id TEXT,is_archived INTEGER)");
 sql.exec("CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT)");
 sql.exec("CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,type TEXT,category TEXT,merchant TEXT,note TEXT,raw TEXT,payment_source TEXT,client_request_id TEXT UNIQUE,family_account_id TEXT,family_transfer_target_account_id TEXT,created_at TEXT)");
 sql.exec("CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER)");
 sql.exec("CREATE TABLE family_finance_events(event_id TEXT PRIMARY KEY,household_id TEXT,actor_user_id TEXT,resource_id TEXT,action TEXT,created_at INTEGER)");
 for(const p of ['0051_shared_entry_lifecycle.sql','0055_legacy_shared_entry_adoption.sql'])
  sql.exec(readFileSync(new URL('../migrations/'+p,import.meta.url),'utf8'));
 sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,'owner','active')").run(owner,hh);
 sql.prepare("INSERT INTO homeflow_identity_links VALUES(?,?,'member','active')").run(member,hh);
 sql.prepare("INSERT INTO family_financial_accounts VALUES(?,?,?,0)").run(account,owner,hh);
 sql.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(1,'2026-10-01','',1000,'expense','食品','商家','旧备注','原始OCR','Bank',null,account,null,'2026-10-02');
 sql.prepare('INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?,?)').run(1,hh,owner,account,'Bank','f'.repeat(64));
 const db={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(statements){sql.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>s.sync());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
 let hasLegacyR2=false;
 const env={APP_ENV:'production',DB:db,KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_SHARED_ENTRY_ENABLED:'true',KAKEIBO_LEGACY_SHARED_ADOPTION_PREFLIGHT_ENABLED:'true',
  KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED:'true',KAKEIBO_LEGACY_R2_WRITES_FROZEN:'true',
  RECEIPTS_R2:{head:async()=>hasLegacyR2?{size:200}:null}};
 const person={user_id:owner,household_id:hh,role:'owner'},memberPerson={user_id:member,household_id:hh,role:'member'};
 const row=sql.prepare('SELECT e.*,l.actor_user_id,l.account_id,l.original_source,l.source_digest FROM entries e JOIN family_finance_legacy_entry_links l ON l.entry_id=e.id WHERE e.id=1').get();
 const data=[row.id,row.date,row.time,row.amount,row.type,row.category,row.merchant,row.note,row.raw,row.payment_source,row.client_request_id,row.family_account_id,row.family_transfer_target_account_id,row.created_at,row.actor_user_id,row.account_id,row.original_source,row.source_digest];
 const digest=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))].map(x=>x.toString(16).padStart(2,'0')).join('');
 async function call(actor=person,fields={}){const body={expected_user_id:actor.user_id,entry_id:1,account_id:account,source_snapshot_sha256:await digest(),confirm:true,...fields};
  const res=await legacySharedAdopt(new Request(url,{method:'POST',headers:{origin:url.origin,'content-type':'application/json'},body:JSON.stringify(body)}),env,url,actor);
  return {status:res.status,data:await res.json()};}
 async function mutate(method,resource,body,actor=person){const target=new URL('https://kakeibo.test/api/family-finance/shared-entries');
  const res=await familySharedEntries(new Request(target,{method,headers:{origin:target.origin,'content-type':'application/json'},body:JSON.stringify(body)}),env,target,actor,method==='POST'?['shared-entries',resource,'restore']:['shared-entries',resource]);
  return {status:res.status,data:await res.json()};}
 return{sql,env,call,mutate,person,memberPerson,setR2(v){hasLegacyR2=v},close(){sql.close()}};
}
test('owner explicit one-row adoption preserves original source and household totals; duplicate is read-only receipt',async()=>{
 const f=fixture();try{
  const old=f.sql.prepare('SELECT * FROM entries').get();const before=f.sql.prepare("SELECT SUM(amount) total FROM entries").get().total;
  const a=await f.call();assert.equal(a.status,201,JSON.stringify(a));
  assert.equal(a.data.ledger_changed,false);
  assert.deepEqual({...f.sql.prepare('SELECT * FROM entries').get()},{...old});
  assert.equal(f.sql.prepare('SELECT SUM(amount) total FROM entries').get().total,before);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_audit').get().n,1);
  const repeat=await f.call();assert.equal(repeat.status,200,JSON.stringify(repeat));assert.equal(repeat.data.replayed,true);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n,1);
  assert.throws(()=>f.sql.prepare('UPDATE entries SET amount=7').run(),/SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED/);
  assert.throws(()=>f.sql.prepare('DELETE FROM family_legacy_shared_adoptions').run(),/IMMUTABLE/);
  assert.throws(()=>f.sql.prepare('UPDATE family_legacy_shared_adoptions SET account_id=?').run('b'),/IMMUTABLE/);
 }finally{f.close()}
});
test('no adoption for member, drifted digest, existing receipt metadata or unknown legacy R2',async()=>{
 for(const mode of ['member','drift','receipt','object','inactive','disabled','unfrozen']){
  const f=fixture();try{
   if(mode==='drift')f.sql.prepare('UPDATE entries SET amount=1200').run();
   if(mode==='receipt')f.sql.prepare('INSERT INTO receipt_r2_state VALUES(1,1)').run();
   if(mode==='object')f.setR2(true);
   if(mode==='inactive')f.sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(owner);
   if(mode==='disabled')f.env.KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED='false';
   if(mode==='unfrozen')f.env.KAKEIBO_LEGACY_R2_WRITES_FROZEN='false';
   const a=await f.call(mode==='member'?f.memberPerson:f.person);
   assert.notEqual(a.status,201,mode+' '+JSON.stringify(a));
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_registry').get().n,0);
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_legacy_shared_adoptions').get().n,0);
  }finally{f.close()}
 }
});
test('adopted entry stays editable only by owner with CAS; delete+restore keep id and all legacy fields',async()=>{
 const f=fixture();try{
  const a=await f.call();assert.equal(a.status,201,JSON.stringify(a));
  const id=a.data.adoption.resource_id;
  let bad=await f.mutate('PUT',id,{expected_user_id:member,expected_version:1,entry:{date:'2026-10-01',time:'',amount:2,type:'expense',category:'食品',merchant:'商家',note:'变更'}},f.memberPerson);
  assert.equal(bad.status,403);
  const updated=await f.mutate('PUT',id,{expected_user_id:owner,expected_version:1,entry:{date:'2026-10-01',time:'',amount:2200,type:'expense',category:'食品',merchant:'商家',note:'变更'}});
  assert.equal(updated.status,200,JSON.stringify(updated));
  assert.equal(f.sql.prepare('SELECT raw FROM entries').get().raw,'原始OCR');
  const gone=await f.mutate('DELETE',id,{expected_user_id:owner,expected_version:2});
  assert.equal(gone.status,200,JSON.stringify(gone));
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM entries').get().n,0);
  const restored=await f.mutate('POST',id,{expected_user_id:owner,expected_version:3});
  assert.equal(restored.status,200,JSON.stringify(restored));
  const after=f.sql.prepare('SELECT * FROM entries').get();
  assert.equal(after.id,1);assert.equal(after.amount,2200);
  assert.equal(after.raw,'原始OCR');assert.equal(after.payment_source,'Bank');assert.equal(after.family_account_id,account);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM family_shared_entry_audit').get().n,4);
 }finally{f.close()}
});
