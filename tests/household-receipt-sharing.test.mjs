import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {familyHouseholdReceipts} from '../functions/api/family-finance/household-receipts.js'
import {readFileSync} from 'node:fs'

const owner={user_id:'owner',household_id:'home',role:'owner'}
const uploader={user_id:'spouse',household_id:'home',role:'member'}
const sibling={user_id:'family2',household_id:'home',role:'member'}
const outsider={user_id:'stranger',household_id:'elsewhere',role:'member'}
const R='a'.repeat(32),RID='b'.repeat(32)
const payload=new TextEncoder().encode('receipt image, not public')
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(x=>x.toString(16).padStart(2,'0')).join('')
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`
  CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT);
  CREATE TABLE entries(id INTEGER PRIMARY KEY,type TEXT);
  CREATE TABLE family_shared_entry_registry(resource_id TEXT,entry_id INTEGER,household_id TEXT,state TEXT);
  CREATE TABLE family_shared_mutation_applied(proposal_id TEXT,entry_id INTEGER,household_id TEXT,requester_user_id TEXT,resource_id TEXT,action TEXT);
  CREATE TABLE family_card_purchase_applied(proposal_id TEXT,entry_id INTEGER,household_id TEXT,requester_user_id TEXT);
  CREATE TABLE family_prepaid_actions_applied(proposal_id TEXT,entry_id INTEGER,household_id TEXT,requester_user_id TEXT,action TEXT);
  CREATE TABLE family_member_receipts(receipt_id TEXT,owner_user_id TEXT,household_id TEXT,content_type TEXT,size_bytes INTEGER,sha256 TEXT,created_at INTEGER,receipt_ref TEXT,state TEXT);
  CREATE TABLE receipt_r2_state(entry_id INTEGER,deleted INTEGER,size_bytes INTEGER);
  INSERT INTO homeflow_identity_links VALUES
   ('owner','home','owner','active'),('spouse','home','member','active'),
   ('family2','home','member','active'),('stranger','elsewhere','member','active');
  INSERT INTO entries VALUES (540,'expense'),(541,'expense'),(542,'expense'),
   (543,'expense'),(544,'expense'),(545,'transfer');
  INSERT INTO family_shared_entry_registry VALUES ('${R}',540,'home','active'),
   ('${RID}',541,'home','deleted');
  INSERT INTO family_shared_mutation_applied VALUES
   ('${'c'.repeat(32)}',540,'home','spouse','${R}','create'),
   ('${'d'.repeat(32)}',541,'home','spouse','${RID}','create');
  INSERT INTO receipt_r2_state VALUES (542,0,23);
 `)
 const db={prepare(sql){const statement=sqlite.prepare(sql);const b=(values=[])=>({
  first:async()=>statement.get(...values)||null,
  all:async()=>({results:statement.all(...values)}),
  run:async()=>({meta:{changes:statement.run(...values).changes}})
 });return {...b(),bind:(...args)=>{
  if(args.length>100)throw Error('too many SQL variables: D1 max 100')
  return b(args)
 }}}}
 const objects=new Map()
 const bucket={
  async get(key){
   const x=objects.get(key)
   return x?{...x,body:new Blob([x.bytes]).stream()}:null
  }
 }
 async function addMemberImage({entry=540,receiptId='e'.repeat(32),receiptRef='proposal:'+'c'.repeat(32),
  state='ready',who='spouse',household='home'}={}){
  const sha=await hash(payload)
  sqlite.prepare('INSERT INTO family_member_receipts VALUES (?,?,?,?,?,?,?,?,?)')
   .run(receiptId,who,household,'image/jpeg',payload.byteLength,sha,
    1794973767376,receiptRef,state)
  const scope=(await hash(new TextEncoder().encode(household+'\0'+who))).slice(0,32)
  objects.set('member/v1/'+scope+'/'+receiptId,{
   bytes:payload,size:payload.byteLength,httpMetadata:{contentType:'image/jpeg'},
   customMetadata:{sha256:sha}
  })
 }
 async function call(user,method='GET',suffix='',query=''){
  const url=new URL('https://example.test/api/family-finance/household-receipts'+suffix+query)
  const res=await familyHouseholdReceipts(
   new Request(url,{method}),{DB:db,RECEIPTS_R2:bucket},url,user,
   ['household-receipts',...(suffix?[suffix.slice(1)]:[])])
  const type=res.headers.get('content-type')
  return {status:res.status,data:type?.startsWith('image/')?
   new Uint8Array(await res.arrayBuffer()):await res.json()}
 }
 return {sqlite,objects,addMemberImage,call}
}
test('approved personal receipt is viewable by every verified household member, but not deletable',async()=>{
 const f=fixture()
 try{
  await f.addMemberImage()
  for(const viewer of [owner,uploader,sibling]){
   const result=await f.call(viewer,'GET','','?ids=540')
   assert.equal(result.status,200)
   assert.deepEqual(result.data.items,[{entry_id:540,source:'member',
    can_delete:viewer.user_id==='spouse'}])
   const img=await f.call(viewer,'GET','/540')
   assert.equal(img.status,200)
   assert.deepEqual(img.data,payload)
   assert.equal((await f.call(viewer,'DELETE','/540')).status,405)
  }
  assert.deepEqual((await f.call(outsider,'GET','','?ids=540')).data.items,[])
  assert.equal((await f.call(outsider,'GET','/540')).status,404)
  assert.equal((await f.call({user_id:'spouse',household_id:'home',role:'owner'},'GET','/540')).status,403)
 }finally{f.sqlite.close()}
})
test('pending, deleted, foreign and non-expense references never expose personal images',async()=>{
 const f=fixture()
 try{
  await f.addMemberImage({receiptId:'1'.repeat(32),receiptRef:'proposal:'+'d'.repeat(32)})
  await f.addMemberImage({receiptId:'2'.repeat(32),receiptRef:'proposal:'+'f'.repeat(32)})
  await f.addMemberImage({receiptId:'3'.repeat(32),receiptRef:'entry:545'})
  await f.addMemberImage({receiptId:'4'.repeat(32),state:'pending'})
  const list=await f.call(owner,'GET','','?ids=541,543,544,545')
  assert.deepEqual(list.data.items,[])
  assert.equal((await f.call(sibling,'GET','/541')).status,404)
  assert.equal((await f.call(sibling,'GET','/545')).status,404)
  f.sqlite.exec("UPDATE homeflow_identity_links SET state='disabled' WHERE user_id='spouse'")
  assert.deepEqual((await f.call(owner,'GET','','?ids=540')).data.items,[])
 }finally{f.sqlite.close()}
})
test('original owner receipt may be viewed by members, but only owner sees can_delete',async()=>{
 const f=fixture()
 try{
  f.objects.set('receipts/v1/542',{
   bytes:payload,size:payload.byteLength,
   httpMetadata:{contentType:'image/jpeg'},customMetadata:{}
  })
  for(const viewer of [owner,uploader,sibling]){
   const list=await f.call(viewer,'GET','','?ids=542')
   assert.deepEqual(list.data.items,[{entry_id:542,source:'legacy',can_delete:viewer.role==='owner'}])
   assert.equal((await f.call(viewer,'GET','/542')).status,200)
  }
  f.sqlite.exec('UPDATE receipt_r2_state SET deleted=1 WHERE entry_id=542')
  assert.deepEqual((await f.call(sibling,'GET','','?ids=542')).data.items,[])
  assert.equal((await f.call(sibling,'GET','/542')).status,404)
 }finally{f.sqlite.close()}
})
test('receipt page buttons follow the image uploader, and the household path is read-only',()=>{
 const page=readFileSync(new URL('../src/pages/LedgerPage.vue',import.meta.url),'utf8')
 const ownerApp=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const memberApp=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 const router=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 assert.match(page,/v-if="canDeleteReceipt"[^>]*@click="removeReceiptImage"/)
 assert.match(ownerApp,/!householdReceiptIndex\.value\.has/)
 assert.match(memberApp,/memberLedger\.canDeleteReceipt=computed/)
 assert.match(memberApp,/own\?await fetchMemberReceipt\(own\.receipt_id\):await fetchHouseholdReceipt\(id\)/)
 assert.match(router,/if\(parts\[0\]==='household-receipts'\)return familyHouseholdReceipts/)
})


test('production D1 max 100 SQL bindings: 100 receipt IDs + household ID must be split server-side',async()=>{
 const f=fixture()
 try{
  await f.addMemberImage()
  const ids=[540,...Array.from({length:99},(_,i)=>1000+i)]
  const res=await f.call(owner,'GET','','?ids='+ids.join(','))
  assert.equal(res.status,200,'a request containing 100 IDs must not produce a 503')
  assert.deepEqual(res.data.items,[{entry_id:540,source:'member',can_delete:false}])
  const member=await f.call(uploader,'GET','','?ids='+ids.join(','))
  assert.equal(member.status,200)
  assert.deepEqual(member.data.items,[{entry_id:540,source:'member',can_delete:true}])
  const image=await f.call(owner,'GET','/540')
  assert.equal(image.status,200)
  assert.deepEqual(image.data,payload)
 }finally{f.sqlite.close()}
})

test('large household receipt listing keeps member and original R2 badges together',async()=>{
 const f=fixture()
 try{
  await f.addMemberImage()
  const ids=[540,542,...Array.from({length:98},(_,i)=>1200+i)]
  const result=await f.call(owner,'GET','','?ids='+ids.join(','))
  assert.equal(result.status,200)
  assert.deepEqual(result.data.items,[
   {entry_id:540,source:'member',can_delete:false},
   {entry_id:542,source:'legacy',can_delete:true}
  ])
 }finally{f.sqlite.close()}
})
