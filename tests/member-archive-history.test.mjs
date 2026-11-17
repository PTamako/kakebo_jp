import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {familyMemberArchiveHistory} from '../functions/api/family-finance/member-archive-history.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT);"+
  "INSERT INTO homeflow_identity_links VALUES('m1','h','member','active'),('m2','h','member','active'),('o1','h','owner','active');"+
  "CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,type TEXT,amount INTEGER,category TEXT,merchant TEXT,note TEXT);"+
  "INSERT INTO entries VALUES(1,'2026-11-17','','expense',100,'食費','店A','本人'),(2,'2026-11-16','','expense',900,'買物','店B','別人');"+
  "CREATE TABLE family_points_journal(homeflow_request_id TEXT,household_id TEXT,requester_user_id TEXT,applied_at INTEGER,linked_entry_id INTEGER,operation TEXT,delta_units INTEGER);"+
  "INSERT INTO family_points_journal VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','h','m1',1794900000000,1,'earn_campaign',5),"+
  "('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','h','m2',1794900000001,2,'expire',-3);");
 const db={prepare(q){return {bind(...args){const s=sql.prepare(q);return {
  first:async()=>s.get(...args)||null,all:async()=>({results:s.all(...args)})
 }}}}};
 async function send(user={role:'member',household_id:'h',user_id:'m1'},kind='points',before=''){
  const url=new URL('https://kakeibo.example/api/family-finance/member-archive-history');
  url.searchParams.set('kind',kind);if(before)url.searchParams.set('before',before);
  const res=await familyMemberArchiveHistory(new Request(url),{DB:db},url,user,['member-archive-history']);
  return {status:res.status,body:await res.json()};
 }
 return {sql,send};
}
test('archive history exports only own transactions, never spouse private ledger',async()=>{
 const f=fixture();
 try{
  const m=await f.send();assert.equal(m.status,200);assert.equal(m.body.read_only,true);
  assert.deepEqual(m.body.items.map(x=>x.archived_entry_id),[1]);
  assert.equal(m.body.viewer_user_id,'m1');
  assert.deepEqual((await f.send({role:'member',user_id:'m2',household_id:'h'})).body.items.map(x=>x.archived_entry_id),[2]);
  assert.equal((await f.send({role:'owner',user_id:'o1',household_id:'h'})).status,403);
 }finally{f.sql.close()}
})
test('archive rejects SQL-like kind, bad cursor and revoked member session',async()=>{
 const f=fixture();
 try{
  assert.equal((await f.send(undefined,'points;DELETE FROM entries')).status,400);
  assert.equal((await f.send(undefined,'points','000.abc')).status,400);
  f.sql.exec("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id='m1'");
  assert.equal((await f.send()).status,403);
 }finally{f.sql.close()}
})
