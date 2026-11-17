import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {familyMemberCategories} from '../functions/api/family-finance/member-categories.js'
const migration=readFileSync(new URL('../migrations/0066_member_categories.sql',import.meta.url),'utf8')
const member={role:'member',household_id:'h',user_id:'m1'}
const other={...member,user_id:'m2'},owner={...member,role:'owner',user_id:'o1'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec("CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT);"+
  "CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT);"+
  "INSERT INTO homeflow_identity_links VALUES('m1','h','member','active'),"+
  "('m2','h','member','active'),('o1','h','owner','active');")
 sqlite.exec(migration)
 const db={prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return{
  first:async()=>q.get(...args)||null,
  all:async()=>({results:q.all(...args)}),
  run:async()=>({meta:{changes:q.run(...args).changes}})
 }}}}}
 async function send(user=member,method='GET',data=null){
  const url=new URL('https://kakeibo.test/api/family-finance/member-categories')
  const r=await familyMemberCategories(new Request(url,{method,...(method==='GET'?{}:
   {headers:{origin:url.origin,'content-type':'application/json'},body:JSON.stringify(data)})}),
   {DB:db},url,user,['member-categories'])
  return {status:r.status,data:await r.json()}
 }
 const payload=(name='美容',type='expense',icon='daily')=>({expected_user_id:'m1',name,type,icon})
 return {sqlite,send,payload}
}
test('categories persist in D1 across devices and are scoped to HomeFlow account',async()=>{
 const f=fixture()
 try{
  const created=await f.send(member,'POST',f.payload())
  assert.equal(created.status,201)
  assert.equal(created.data.ledger_changed,false)
  assert.deepEqual((await f.send(member)).data.items,[{type:'expense',name:'美容',icon:'daily'}])
  assert.deepEqual((await f.send(other)).data.items,[])
  assert.equal((await f.send(owner)).status,403)
  assert.equal((await f.send(member,'POST',f.payload())).data.created,false)
 }finally{f.sqlite.close()}
})
test('actor forgery, invalid type and revoked SSO cannot write other member categories',async()=>{
 const f=fixture()
 try{
  assert.equal((await f.send(other,'POST',f.payload())).status,403)
  assert.equal((await f.send(member,'POST',f.payload('x','transfer'))).status,400)
  await f.send(member,'POST',f.payload())
  assert.equal((await f.send(other,'DELETE',{expected_user_id:'m2',type:'expense',name:'美容'})).data.removed,false)
  assert.equal((await f.send(member)).data.items.length,1)
  f.sqlite.exec("UPDATE homeflow_identity_links SET state='revoked' WHERE user_id='m1'")
  assert.equal((await f.send(member)).status,403)
 }finally{f.sqlite.close()}
})
