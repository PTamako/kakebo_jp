import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto,createHmac} from 'node:crypto';
import {verifyDocumentFinanceAccount} from '../functions/api/internal/document-accounts/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const member='22222222-2222-4222-8222-222222222222';
const owner='11111111-1111-4111-8111-111111111111';
const secret='b'.repeat(64);
function fixture(){
  const sql=new DatabaseSync(':memory:');
  for(const file of ['0001_support_tables.sql','0002_versioned_migration_tracking.sql',
    '0022_homeflow_identity_foundation.sql','0023_family_financial_account_identities.sql'])
    sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  sql.prepare('INSERT INTO homeflow_identity_links (user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
    .run(member,'primary','member','member','active',Date.now());
  sql.prepare('INSERT INTO homeflow_identity_links (user_id,household_id,role,display_name,state,linked_at) VALUES(?,?,?,?,?,?)')
    .run(owner,'primary','owner','owner','active',Date.now());
  const add=(id,who,kind='cash',name='同名账户',origin='member_created')=>
    sql.prepare('INSERT INTO family_financial_accounts '+
      '(account_id,household_id,owner_user_id,label,account_kind,origin,legacy_source_name,created_by_user_id,updated_by_user_id) '+
      'VALUES(?,?,?,?,?,?,?,?,?)').run(id,'primary',who,name,kind,origin,
      origin==='legacy'?name:null,who,who);
  add('a'.repeat(32),member);
  add('b'.repeat(32),owner);
  add('c'.repeat(32),member,'credit_card');
  add('d'.repeat(32),member,'cash','同名账户');
  const env={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
    KAKEIBO_DOCUMENT_ACCOUNT_VERIFY_ENABLED:'true',
    KAKEIBO_DOCUMENT_ACCOUNT_VERIFICATION_SECRET:secret,
    DB:{prepare(statement){return{bind(...args){return{
      first:async()=>sql.prepare(statement).get(...args)||null
    }}}}}
  };
  return {sql,env};
}
async function request(env,data,opts={}){
  const raw=JSON.stringify(data),stamp=String(opts.stamp??Date.now());
  const signature=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('jpda:finance-account\n'+stamp+'\n'+raw).digest('hex');
  const req=new Request('https://kakeibo.internal/api/internal/document-accounts/verify',{
    method:'POST',headers:{'content-type':'application/json',
      'x-approval-client':'jp-document-assistant',
      'x-approval-timestamp':stamp,'x-approval-signature':opts.signature||signature,
      ...(opts.origin?{origin:'https://evil.invalid'}:{})},body:raw});
  const res=await verifyDocumentFinanceAccount(req,env);
  return {status:res.status,body:await res.json()};
}
const intent=(id='a'.repeat(32))=>({
  account_id:id,household_id:'primary',requester_user_id:member,entry_type:'expense'
});
test('document finance proof binds the member stable account ID, not its label',async()=>{
  const {sql,env}=fixture();
  try{
    const a=await request(env,intent());
    assert.equal(a.status,200);
    assert.deepEqual([a.body.account_id,a.body.owner_user_id,a.body.account_version],
      ['a'.repeat(32),member,1]);
    assert.equal(a.body.applied,false);
    const sameLabel=await request(env,intent('d'.repeat(32)));
    assert.equal(sameLabel.status,200);
    assert.notEqual(a.body.account_id,sameLabel.body.account_id);
    assert.equal((await request(env,intent('b'.repeat(32)))).status,409,
      'same-name owner account cannot be selected by member');
    assert.equal((await request(env,intent('c'.repeat(32)))).body.code,
      'ACCOUNT_KIND_NOT_EXECUTABLE');
    sql.prepare("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?").run(member);
    assert.equal((await request(env,intent())).status,409,'revoked member is rejected');
  }finally{sql.close();}
});
test('document account proof refuses browser, forge, expired timestamp, unknown account and disabled flag',async()=>{
  const {sql,env}=fixture();
  try{
    assert.equal((await request(env,intent(),{origin:true})).status,403);
    assert.equal((await request(env,intent(),{signature:'f'.repeat(64)})).status,403);
    assert.equal((await request(env,intent(),{stamp:Date.now()-300001})).status,403);
    assert.equal((await request(env,intent('f'.repeat(32)))).status,409);
    assert.equal((await request(env,{...intent(),payment_source:'same name'})).status,400);
    sql.prepare("UPDATE family_financial_accounts SET is_archived=1 WHERE account_id=?").run('a'.repeat(32));
    assert.equal((await request(env,intent())).status,409);
    env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFY_ENABLED='false';
    assert.equal((await request(env,intent())).status,503);
  }finally{sql.close();}
});

test('signed list returns only current member cash account IDs, including duplicate display labels',async()=>{
 const {sql,env}=fixture();
 try{
  const body={household_id:'primary',requester_user_id:member},raw=JSON.stringify(body);
  const stamp=String(Date.now());
  const sig=createHmac('sha256',Buffer.from(secret,'hex'))
   .update('jpda:finance-account\n'+stamp+'\n'+raw).digest('hex');
  const request=new Request('https://internal.invalid/api/internal/document-accounts/list',{
   method:'POST',headers:{'content-type':'application/json',
    'x-approval-client':'jp-document-assistant','x-approval-timestamp':stamp,
    'x-approval-signature':sig},body:raw});
  const res=await verifyDocumentFinanceAccount(request,env,['list']);
  assert.equal(res.status,200);
  const data=await res.json();
  assert.deepEqual(data.accounts.map(a=>a.account_id).sort(),['a'.repeat(32),'d'.repeat(32)]);
  assert.equal(data.accounts[0].label,'同名账户');
  assert.equal(data.applied,false);
 }finally{sql.close()}
});
