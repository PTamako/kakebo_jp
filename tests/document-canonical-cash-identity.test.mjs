import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac,webcrypto} from 'node:crypto';
import {verifyDocumentFinanceAccount} from '../functions/api/internal/document-accounts/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const member2='33333333-3333-4333-8333-333333333333';
const secret='d'.repeat(64);
function fixture(){
 const db=new DatabaseSync(':memory:');
 for(const file of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
   '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql']){
   db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 }
 db.exec('CREATE TABLE payment_sources(name TEXT PRIMARY KEY,source_type TEXT NOT NULL,is_archived INTEGER NOT NULL DEFAULT 0)');
 db.prepare('INSERT INTO payment_sources(name,source_type) VALUES(?,?)').run('現金','standard');
 for(const [id,role] of [[owner,'owner'],[member,'member'],[member2,'member']]){
  db.prepare('INSERT INTO homeflow_identity_links(user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
   .run(id,'primary',role,role,'active',Date.now());
 }
 const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_DOCUMENT_ACCOUNT_VERIFY_ENABLED:'true',
  KAKEIBO_DOCUMENT_FINANCE_SECRET:secret,DB:{
   prepare(sql){return{bind(...args){return{
    first:async()=>db.prepare(sql).get(...args)||null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:db.prepare(sql).run(...args).changes}})
   }}}}
  }};
 async function call(mode,user=member,account='',badSignature=false){
  const body=mode==='list'
   ?{household_id:'primary',requester_user_id:user}
   :{account_id:account,household_id:'primary',requester_user_id:user,entry_type:'expense'};
  const raw=JSON.stringify(body),stamp=String(Date.now());
  const sign=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('jpda:finance-account\n'+stamp+'\n'+raw).digest('hex');
  const req=new Request('https://kakeibo.internal/api/internal/document-accounts/'+mode,{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'jp-document-assistant',
    'x-approval-timestamp':stamp,
    'x-approval-signature':badSignature?'0'.repeat(64):sign},body:raw});
  const res=await verifyDocumentFinanceAccount(req,env,[mode]);
  return {status:res.status,data:await res.json()};
 }
 return {db,env,call};
}
test('member sees Japanese D1 cash option without creating any assets on read',async()=>{
 const f=fixture();
 try{
  const r=await f.call('list');
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.accounts.length,1);
  assert.equal(r.data.accounts[0].label,'現金');
  assert.equal(r.data.accounts[0].account_kind,'cash');
  assert.match(r.data.accounts[0].account_id,/^[a-f0-9]{32}$/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,0);
  const other=await f.call('list',member2);
  assert.notEqual(r.data.accounts[0].account_id,other.data.accounts[0].account_id);
 }finally{f.db.close()}
});
test('signed, explicit verify materializes only internal account identity once',async()=>{
 const f=fixture();
 try{
  const picked=(await f.call('list')).data.accounts[0];
  const first=await f.call('verify',member,picked.account_id);
  assert.equal(first.status,200,JSON.stringify(first.data));
  assert.equal(first.data.account_version,1);
  assert.equal(first.data.owner_user_id,member);
  assert.equal(first.data.label,'現金');
  const repeat=await f.call('verify',member,picked.account_id);
  assert.equal(repeat.status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payment_sources').get().n,1);
  const a=f.db.prepare('SELECT opening_balance,account_kind,origin FROM family_financial_accounts').get();
  assert.equal(a.opening_balance,0);
  assert.equal(a.account_kind,'cash');
  assert.equal(a.origin,'member_created');
 }finally{f.db.close()}
});
test('cross member, owner and unsigned attempts cannot bind another member cash',async()=>{
 const f=fixture();
 try{
  const id=(await f.call('list')).data.accounts[0].account_id;
  assert.equal((await f.call('verify',member2,id)).status,409);
  assert.equal((await f.call('verify',owner,id)).status,409);
  assert.equal((await f.call('verify',member,id,true)).status,403);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,0);
  f.db.prepare("UPDATE payment_sources SET is_archived=1 WHERE name='現金'").run();
  assert.equal((await f.call('verify',member,id)).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,0);
 }finally{f.db.close()}
});
