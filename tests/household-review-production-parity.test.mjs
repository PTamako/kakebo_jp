import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto,createHmac} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {familySharedMutationRequests} from '../functions/api/family-finance/shared-mutation-requests.js'

if(!globalThis.crypto)globalThis.crypto=webcrypto
const member='22222222-2222-4222-8222-222222222222'
const household='primary'
const secret='a'.repeat(64)
const validStatuses=['applied','cancelled','pending','approved','rejected','executing','conflict']
const proposal=i=>i.toString(16).padStart(32,'0')
const approval=i=>'00000000-0000-4000-8000-'+i.toString(16).padStart(12,'0')
function harness(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('CREATE TABLE homeflow_identity_links (user_id TEXT,household_id TEXT,role TEXT,state TEXT)')
 sql.exec('CREATE TABLE family_shared_mutation_intents ('+
  'proposal_id TEXT PRIMARY KEY,household_id TEXT,requester_user_id TEXT,operation TEXT,'+
  'resource_id TEXT,expected_version INTEGER,payload_sha256 TEXT,payload_cipher TEXT,'+
  'payload_iv TEXT,idempotency_hash TEXT,status TEXT,homeflow_approval_id TEXT,'+
  'created_at INTEGER,expires_at INTEGER,submitted_at INTEGER)')
 sql.prepare('INSERT INTO homeflow_identity_links VALUES(?,?,?,?)')
  .run(member,household,'member','active')
 for(let i=1;i<=validStatuses.length;i++){
  sql.prepare('INSERT INTO family_shared_mutation_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(proposal(i),household,member,i===7?'update':'create',null,0,'a'.repeat(64),
    '', '', 'b'.repeat(64),'submitted',approval(i),Date.now(),Date.now()+900000,Date.now())
 }
 sql.prepare('INSERT INTO family_shared_mutation_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(proposal(8),household,member,'create',null,0,'a'.repeat(64),
   '', '', 'b'.repeat(64),'prepared',null,Date.now(),Date.now()+900000,null)
 const db={prepare(q){return {bind(...args){return {
  first:async()=>sql.prepare(q).get(...args)||null,
  all:async()=>({results:sql.prepare(q).all(...args)})
 }}}}}
 let offline=false
 let signedCalls=0
 const env={DB:db,APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_SHARED_ENTRY_ENABLED:'true',
  KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED:'true',
  KAKEIBO_FAMILY_PENDING_KEY:'1'.repeat(64),
  KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET:secret,
  HOMEFLOW_OAUTH_ORIGIN:'https://homeflow.example.test',
  HOMEFLOW_IDENTITY_SERVICE:{async fetch(req){
   if(offline)return Response.json({error:'unavailable'},{status:503})
   assert.equal(new URL(req.url).pathname,'/api/internal/approvals/shared-entry-status')
   const raw=await req.text(),stamp=req.headers.get('x-approval-timestamp')
   const expected=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('kakeibo-shared-entry:status\n'+stamp+'\n'+raw).digest('hex')
   assert.equal(req.headers.get('x-approval-signature'),expected)
   const body=JSON.parse(raw)
   assert.equal(body.requester_user_id,member)
   assert.equal(body.household_id,household)
   signedCalls++
   return Response.json({ok:true,items:body.approval_ids.map(id=>{
    const index=validStatuses.findIndex((_,i)=>approval(i+1)===id)
    assert.ok(index>=0)
    return {approval_id:id,resource_id:proposal(index+1),
     operation:'finance.entry.'+(index===6?'update':'create'),
     status:validStatuses[index]}
   })})
  }}
 }
 async function fetchHistory(path='shared-mutation-requests'){
  const url=new URL('https://kakeibo.example.test/api/family-finance/'+path)
  const result=await familySharedMutationRequests(
   new Request(url),env,url,{role:'member',user_id:member,household_id:household},
   path.split('/'))
  assert.equal(result.status,200)
  return result.json()
 }
 return {sql,fetchHistory,setOffline:x=>{offline=x},calls:()=>signedCalls}
}

test('recent history uses signed HomeFlow final status, never stale submitted',async()=>{
 const h=harness()
 try{
  const data=await h.fetchHistory()
  assert.equal(data.review_status_verified,true)
  assert.equal(h.calls(),1)
  assert.equal(data.items.length,8)
  for(let i=1;i<=7;i++){
   const row=data.items.find(x=>x.proposal_id===proposal(i))
   assert.equal(row.status,validStatuses[i-1])
   assert.equal(row.review_status_verified,true)
   assert.equal(row.applied,i===1)
  }
  assert.equal(data.items.find(x=>x.proposal_id===proposal(8)).status,'prepared')
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM family_shared_mutation_intents').get().n,8,
   'History reconciliation must be read-only')
 }finally{h.sql.close()}
})

test('signed status service outage is unknown, never falsely pending or applied',async()=>{
 const h=harness()
 try{
  h.setOffline(true)
  const data=await h.fetchHistory()
  assert.equal(data.review_status_verified,false)
  for(const row of data.items.filter(x=>x.homeflow_approval_id)){
   assert.equal(row.status,'submitted_status_unknown')
   assert.equal(row.review_status_verified,false)
   assert.equal(row.applied,false)
  }
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM family_shared_mutation_intents').get().n,8)
 }finally{h.sql.close()}
})

test('single approval GET mirrors HomeFlow final status',async()=>{
 const h=harness()
 try{
  const item=await h.fetchHistory('shared-mutation-requests/'+proposal(2))
  assert.equal(item.prepared.status,'cancelled')
  assert.equal(item.prepared.review_status_verified,true)
  assert.equal(item.prepared.applied,false)
 }finally{h.sql.close()}
})

test('original page shell is reused and old access-code button is absent',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const memberView=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 const shell=readFileSync(new URL('../src/OriginalKakeiboPages.vue',import.meta.url),'utf8')
 const approvalUI=readFileSync(new URL('../src/FamilySharedMutationRequests.vue',import.meta.url),'utf8')
 assert.match(app,/<OriginalKakeiboPages :identity="familyIdentity"/)
 assert.match(memberView,/<OriginalKakeiboPages :identity="user"/)
 assert.match(shell,/<LedgerPage/)
 assert.match(shell,/<StatisticsPage/)
 assert.match(shell,/<ManagementPage/)
 assert.doesNotMatch(app,/@click="unlock">旧账户登录/)
 assert.match(approvalUI,/submitted_status_unknown:'HomeFlow に提出済み・状態を確認中'/)
 assert.match(approvalUI,/reviewTimer=setInterval/)
 const privateConf=readFileSync(new URL('../wrangler.homeflow-bridge.toml',import.meta.url),'utf8')
 const pagesConf=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8')
 for(const name of ['KAKEIBO_BANK_TRANSFER_ENABLED','KAKEIBO_CARD_SETTLEMENTS_ENABLED']){
  assert.match(privateConf,new RegExp(name+' = "false"'))
  assert.match(pagesConf,new RegExp(name+' = "false"'))
 }
})
