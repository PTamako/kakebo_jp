import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {familyPointsLegacyLinks} from '../functions/api/family-finance/points-legacy-links.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const hh='primary',owner='11111111-1111-4111-8111-111111111111',
 member='22222222-2222-4222-8222-222222222222',
 legacy='a'.repeat(32),target='b'.repeat(32),foreign='c'.repeat(32);
const now=Date.now();
const write=(s,q,...args)=>s.prepare(q).run(...args);
const one=(s,q,...args)=>s.prepare(q).get(...args);
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const name of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
  '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql',
  '0027_family_legacy_entry_link_audit.sql']){
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 }
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,'+
  'category TEXT,merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,'+
  'payment_source TEXT,family_account_id TEXT);');
 sql.exec(readFileSync(new URL('../migrations/0034_family_points_foundation.sql',import.meta.url),'utf8'));
 sql.exec(readFileSync(new URL('../migrations/0039_points_legacy_provenance.sql',import.meta.url),'utf8'));
 for(const [id,role] of [[owner,'owner'],[member,'member']])
  write(sql,'INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)',
   id,hh,role,role,'active',now);
 for(const [id,user,origin,name] of [[legacy,owner,'legacy','Old points'],
  [target,owner,'member_created',null],[foreign,member,'member_created',null]]){
  write(sql,'INSERT INTO family_financial_accounts(account_id,household_id,owner_user_id,label,'+
   'account_kind,origin,legacy_source_name,created_by_user_id,updated_by_user_id) '+
   'VALUES(?,?,?,?,?,?,?,?,?)',
   id,hh,user,'Points','points',origin,name,user,user);
 }
 for(const [id,amount,type] of [[1,130,'income'],[2,70,'expense'],[3,10,'income']]){
  write(sql,"INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,family_account_id) VALUES(?,'2025-05-01','',?,'ポイント','Old','note','','',?,?,?)".replace(",'',?,?,?",",?,?,?"),
   id,amount,type,'old-'+id,'Old points',legacy);
 }
 for(const id of [1,2]){
  write(sql,'INSERT INTO family_finance_legacy_entry_links '+
   '(entry_id,household_id,actor_user_id,account_id,original_source,source_digest,linked_at) '+
   'VALUES(?,?,?,?,?,?,?)',id,hh,owner,legacy,'Old points','f'.repeat(64),now);
 }
 const db={prepare(q){return{bind(...args){return{
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...args).changes}})
 }}}},async batch(commands){
  sql.exec('BEGIN IMMEDIATE');
  try{const out=commands.map(c=>c.sync());sql.exec('COMMIT');return out}
  catch(e){sql.exec('ROLLBACK');throw e}
 }};
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_POINTS_LEGACY_LINKS_ENABLED:'true',DB:db};
 const user={user_id:owner,household_id:hh,role:'owner'};
 const url=new URL('https://kakeibo.example.test/api/family-finance/legacy/points-links');
 const get=async(as=user,query='')=>{
  const r=await familyPointsLegacyLinks(new Request(url+query),env,new URL(url+query),as);
  return {status:r.status,data:await r.json()};
 };
 const post=async(body,as=user)=>{
  const r=await familyPointsLegacyLinks(new Request(url,{method:'POST',
   headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(body)}),env,url,as);
  return {status:r.status,data:await r.json()};
 };
 return {sql,db,env,user,get,post,close:()=>sql.close()};
}
test('verified historical points claim is snapshot-exact, immutable, idempotent and mints zero units',async()=>{
 const f=fixture();try{
  const read=await f.get();
  assert.equal(read.status,200,JSON.stringify(read));
  assert.equal(read.data.items.length,2);
  const item=read.data.items[0];
  assert.equal(item.entry_id,1);
  assert.equal(item.amount_jpy,130);
  const b={expected_user_id:owner,entry_id:item.entry_id,points_account_id:target,
   legacy_kind:'earn',source_digest:item.source_digest,confirm:true};
  const saved=await f.post(b);
  assert.equal(saved.status,201,JSON.stringify(saved));
  assert.equal(saved.data.points_minted,false);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_journal').n,0);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_legacy_links').n,1);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_legacy_provenance').n,1);
  assert.equal((await f.post(b)).data.already_linked,true);
  const replayDifferent=await f.post({...b,points_account_id:foreign});
  assert.equal(replayDifferent.status,409);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_legacy_links').n,1);
  assert.throws(()=>write(f.sql,'UPDATE entries SET amount=999 WHERE id=1'),/POINTS_LEGACY_ORIGINAL_IMMUTABLE/);
  assert.throws(()=>write(f.sql,'DELETE FROM entries WHERE id=1'),/POINTS_LEGACY_ORIGINAL_IMMUTABLE/);
  assert.throws(()=>write(f.sql,'DELETE FROM family_points_legacy_provenance'),/IMMUTABLE/);
  assert.equal(one(f.sql,'SELECT amount n FROM entries WHERE id=1').n,130);
  const next=await f.get();assert.equal(next.data.items.length,1);
  assert.equal(next.data.items[0].entry_id,2);
 }finally{f.close()}
});
test('stale digest, foreign owner, unproven source and account spoofing never associate history',async()=>{
 const f=fixture();try{
  const first=(await f.get()).data.items[0];
  const base={expected_user_id:owner,entry_id:1,points_account_id:target,
   legacy_kind:'earn',source_digest:first.source_digest,confirm:true};
  assert.equal((await f.post({...base,source_digest:'0'.repeat(64)})).status,409);
  assert.equal((await f.post({...base,points_account_id:foreign})).status,409);
  assert.equal((await f.post(base,{...f.user,role:'member'})).status,403);
  assert.equal((await f.post({...base,expected_user_id:member})).status,403);
  write(f.sql,'UPDATE entries SET amount=150 WHERE id=1');
  assert.equal((await f.post(base)).status,409);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_legacy_links').n,0);
  write(f.sql,'DELETE FROM family_finance_legacy_entry_links WHERE entry_id=2');
  const second=(await f.get()).data.items;
  assert.equal(second.some(x=>x.entry_id===2),false);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_legacy_provenance').n,0);
 }finally{f.close()}
});
test('no preview/no flag, invalid cursor, unsigned origin or changed HomeFlow actor fail closed',async()=>{
 const f=fixture();try{
  f.env.KAKEIBO_POINTS_LEGACY_LINKS_ENABLED='false';
  assert.equal((await f.get()).status,503);
  f.env.KAKEIBO_POINTS_LEGACY_LINKS_ENABLED='true';
  assert.equal((await f.get(f.user,'?after_id=-1')).status,400);
  const rows=(await f.get()).data.items;
  const x={expected_user_id:owner,entry_id:1,points_account_id:target,
   legacy_kind:'earn',source_digest:rows[0].source_digest,confirm:true};
  const r=await familyPointsLegacyLinks(new Request('https://kakeibo.example.test/api/family-finance/legacy/points-links',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(x)}),
   f.env,new URL('https://kakeibo.example.test/api/family-finance/legacy/points-links'),f.user);
  assert.equal(r.status,403);
  assert.equal(one(f.sql,'SELECT COUNT(*) n FROM family_points_legacy_links').n,0);
 }finally{f.close()}
});
