import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { onRequestPost } from '../functions/api/bridge/document-assistant.js'
if (!globalThis.crypto) globalThis.crypto=webcrypto

const secret='fixture_kakebo_bridge_secret_with_entropy_1234567'
const actor='approved_kakebo_owner'
const id='jda:kakebo:1234567890abcdef'
const url='https://kakebo.example.test/api/bridge/document-assistant'
const body=(changes={})=>({
  source:'jp-document-assistant', actor_user_id:actor,idempotency_key:id,
  payload:{operation:'entry', type:'expense', date:'2026-11-12',
    amount:1200, category:'税金',paymentSource:'現金',note:'测试', ...changes}
})
const env=(overrides={})=>({JPDA_BRIDGE_ENABLED:'true',JPDA_BRIDGE_SECRET:secret,
 JPDA_BRIDGE_ALLOWED_USER:actor,...overrides})
async function signed(payload=body(),time=Date.now(),requestId=id){
 const raw=JSON.stringify(payload),stamp=String(time)
 const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
  {name:'HMAC',hash:'SHA-256'},false,['sign'])
 const digest=new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(stamp+'\n'+raw)))
 const hex=Array.from(digest,x=>x.toString(16).padStart(2,'0')).join('')
 return new Request(url,{method:'POST',headers:{'Content-Type':'application/json',
   'X-DA-Timestamp':stamp,'X-DA-Signature':hex,'Idempotency-Key':requestId},body:raw})
}
test('financial bridge is disabled by default',async()=>{
 const r=await onRequestPost({request:new Request(url,{method:'POST'}),env:env({JPDA_BRIDGE_ENABLED:'false'})})
 assert.equal(r.status,404)
})
test('signature freshness, HMAC integrity and explicit source actor are mandatory',async()=>{
 const old=await onRequestPost({request:await signed(body(),Date.now()-600000),env:env()})
 assert.equal(old.status,401)
 const request=await signed()
 const changed=new Request(url,{method:'POST',headers:request.headers,body:JSON.stringify(body({amount:50000}))})
 assert.equal((await onRequestPost({request:changed,env:env()})).status,401)
 assert.equal((await onRequestPost({request:await signed(),env:env({JPDA_BRIDGE_ALLOWED_USER:'another_account'})})).status,403)
})
test('signed request with invalid financial values never reaches D1',async()=>{
 const environment=env({DB:{prepare(){throw Error('unauthorized D1 access')}}})
 const r=await onRequestPost({request:await signed(body({amount:0})),env:environment})
 assert.equal(r.status,400)
 assert.equal((await r.json()).error,'invalid_entry')
})

test('signed read-only ledger options list real categories and active payment sources',async()=>{
 let calls=0,queries=[];
 const database={
  prepare(sql){queries.push(sql);return {bind(){return this}}},
  async batch(){calls++;return [
   {results:[{category:'饮食料品',display_name:'飲食料品',is_default:0},{category:'餐饮',display_name:'外食',is_default:0},{category:'日用品',display_name:'日用品',is_default:1}]},
   {results:[{name:'三井住友カード',is_default:0},{name:'楽天カード',is_default:1}]},
   {results:[{keyword:'セブン-イレブン',category:'饮食料品'}]},
   {results:[]},
   {results:[{keyword:'セブン',payment_source:'三井住友カード'}]}
  ]}
 };
 const options={
  source:'jp-document-assistant',actor_user_id:actor,
  payload:{operation:'options',entryType:'expense',merchant:'セブン-イレブン',recognizedPayment:'Olive'}
 };
 const response=await onRequestPost({request:await signed(options),env:env({DB:database})});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.ok,true);
 assert.deepEqual(result.categories.map(x=>x.value),['饮食料品','餐饮','日用品']);
 assert.equal(result.suggested.category,'饮食料品');
 assert.equal(result.suggested.payment_source,'三井住友カード');
 assert.equal(result.suggested.category_origin,'merchant_rule');
 assert.equal(result.suggested.payment_origin,'merchant_rule');
 assert.deepEqual(result.categories.map(x=>x.label),['飲食料品','外食','日用品']);
 assert.deepEqual(result.payment_sources.map(x=>x.value),['現金','三井住友カード','楽天カード']);
 assert.equal(calls,1);
 assert.equal(queries.length,5);
 assert.ok(queries.every(sql=>/^\s*SELECT/i.test(sql)));
 const bad=await onRequestPost({request:await signed({...options,payload:{operation:'options',entryType:'transfer'}}),env:env({DB:database})});
 assert.equal(bad.status,400);
 assert.equal(calls,1);
});

test('signed recovery lookup is read-only and returns idempotent transaction state',async()=>{
 const priorRequestId=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id));
 const expected='jda_'+Array.from(new Uint8Array(priorRequestId),x=>x.toString(16).padStart(2,'0')).join('').slice(0,60);
 const lookups=[];
 const d1={prepare(sql){
  assert.match(sql,/^SELECT id FROM entries WHERE client_request_id=\?1$/);
  return {bind(value){lookups.push(value);return {async first(){return lookups.length===1?{id:42}:null}}}}
 }};
 const payload={source:'jp-document-assistant',actor_user_id:actor,idempotency_key:id,payload:{operation:'lookup'}};
 const found=await onRequestPost({request:await signed(payload),env:env({DB:d1})});
 assert.equal(found.status,200);
 assert.deepEqual(await found.json(),{ok:true,exists:true,remote_id:'42'});
 const missing=await onRequestPost({request:await signed(payload),env:env({DB:d1})});
 assert.deepEqual(await missing.json(),{ok:true,exists:false,remote_id:null});
 assert.deepEqual(lookups,[expected,expected]);
 const forged=await onRequestPost({request:await signed({...payload,idempotency_key:'arbitrary-1234'}),env:env({DB:d1})});
 assert.equal(forged.status,400);
 assert.equal(lookups.length,2);
});

test('signed card purchase stores verified 7-Eleven merchant rather than document assistant',async()=>{
 const binds=[]
 let changes=0
 const db={prepare(sql){
  return {bind(...args){
    binds.push({sql,args})
    return {
      async run(){changes++;return {meta:{changes:1}}},
      async first(){return {id:417}}
    }
  }}
 }}
 const payload=body({merchant:'セブン-イレブン',date:'2026-05-28',
   amount:151,category:'饮食料品',paymentSource:'現金',note:''})
 const response=await onRequestPost({request:await signed(payload),env:env({DB:db})})
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()))
 assert.equal((await response.json()).remote_id,'417')
 assert.equal(changes,1)
 const insertion=binds.find(x=>x.sql.includes('INSERT INTO entries'))
 assert.ok(insertion)
 assert.equal(insertion.args[3],'セブン-イレブン')
 assert.equal(insertion.args[4],'')
 const unsafe=body({merchant:{unexpected:'object'}})
 const rejected=await onRequestPost({request:await signed(unsafe),env:env({DB:db})})
 assert.equal(rejected.status,400)
 assert.equal((await rejected.json()).error,'invalid_entry')
 assert.equal(changes,1)
});

test('finance picker matches Kakebo merchant rules and configured defaults without any writes',async()=>{
 const batches=[],mock={
  prepare(sql){batches.push(sql);return {bind(){return this}}},
  async batch(){return [
   {results:[{category:'日用品',display_name:'日用品',is_default:1},{category:'饮食料品',display_name:'飲食料品',is_default:0},{category:'餐饮',display_name:'外食',is_default:0}]},
   {results:[{name:'三井住友カード',is_default:0},{name:'セゾンカード',is_default:1}]},
   {results:[{keyword:'セブン',category:'餐饮'},{keyword:'セブン-イレブン',category:'饮食料品'}]},
   {results:[]},
   {results:[{keyword:'セブン-イレブン',payment_source:'三井住友カード'}]}
  ]}
 };
 const payload={source:'jp-document-assistant',actor_user_id:actor,payload:{
  operation:'options',entryType:'expense',merchant:'セブン－イレブン',recognizedPayment:'Olive'
 }};
 const result=await onRequestPost({request:await signed(payload),env:env({DB:mock})});
 assert.equal(result.status,200);
 const suggested=(await result.json()).suggested;
 assert.equal(suggested.category,'饮食料品');
 assert.equal(suggested.payment_source,'三井住友カード');
 assert.equal(suggested.category_origin,'merchant_rule');
 const unknown=await onRequestPost({request:await signed({...payload,payload:{
  operation:'options',entryType:'expense',merchant:'未知新商店',recognizedPayment:''
 }}),env:env({DB:mock})});
 assert.equal(unknown.status,200);
 assert.deepEqual((await unknown.json()).suggested,{
  category:'日用品',payment_source:'セゾンカード',category_origin:'default',payment_origin:'default'
 });
 const recognized=await onRequestPost({request:await signed({...payload,payload:{
  operation:'options',entryType:'expense',merchant:'未知新商店',recognizedPayment:'Olive'
 }}),env:env({DB:mock})});
 assert.equal((await recognized.json()).suggested.payment_source,'三井住友カード');
 assert.ok(batches.every(sql=>/^\s*SELECT/i.test(sql)));
});
test('merchant suggestions use user category override before Kakebo built-in merchant rule',async()=>{
 const mock={prepare(sql){return {bind(){return this}}},
  async batch(){return [
   {results:[{category:'日用品',is_default:1},{category:'饮食料品',is_default:0},{category:'餐饮',is_default:0}]},
   {results:[{name:'セゾンカード',is_default:1}]},
   {results:[{keyword:'セブン-イレブン',category:'饮食料品'}]},
   {results:[{keyword:'セブン',category:'餐饮'}]},
   {results:[]}
  ]}
 };
 const result=await onRequestPost({request:await signed({
  source:'jp-document-assistant',actor_user_id:actor,
  payload:{operation:'options',entryType:'expense',merchant:'セブン-イレブン'}
 }),env:env({DB:mock})});
 assert.equal(result.status,200);
 assert.equal((await result.json()).suggested.category,'餐饮');
});
test('signed finance bridge writes exact reviewed clock and rejects invalid time without DB operations',async()=>{
 const writes=[]
 const db={prepare(sql){return {bind(...args){
  return {async run(){writes.push({sql,args});return {meta:{changes:1}}},
   async first(){return {id:921}}}
 }}}}
 const payload=body({merchant:'セブン-イレブン',date:'2026-05-28',time:'19:06',
  amount:151,category:'饮食料品',paymentSource:'現金',note:''});
 const accepted=await onRequestPost({request:await signed(payload),env:env({DB:db})});
 assert.equal(accepted.status,200,JSON.stringify(await accepted.clone().json()));
 assert.equal(writes.length,1);
 assert.equal(writes[0].args[8],'19:06');
 assert.match(writes[0].sql,/SELECT \?1,\?9,\?2/);
 for(const invalid of ['25:06','19:75','19:06:03','9:06',null,{},'19:06abc']){
  const response=await onRequestPost({request:await signed(body({time:invalid})),env:env({DB:db})});
  assert.equal(response.status,400,JSON.stringify(invalid));
 }
 assert.equal(writes.length,1);
});

// Real SQLite regression: the SQL duplicate predicate must distinguish merchants
// and independently confirmed transaction times, even for equal amounts.
test('signed bridge rejects only true duplicate candidates and validates category and merchant',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  sqlite.prepare("INSERT INTO category_source(category,entry_type) VALUES('日用品','expense')").run();
  const db={prepare(sql){return {
    args:[],bind(...args){this.args=args;return this},
    async first(){return sqlite.prepare(sql).get(...this.args)||null},
    async run(){const r=sqlite.prepare(sql).run(...this.args);
      return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}
    }
  }}};
  async function save(key,merchant,clock='12:00',category='日用品'){
    const requestId='jda:kakebo:'+key.padStart(16,'0');
    const record=body({merchant,time:clock,category,amount:1000,date:'2026-11-12'});
    record.idempotency_key=requestId;
    const response=await onRequestPost({request:await signed(record,Date.now(),requestId),env:env({DB:db})});
    return {status:response.status,body:await response.json()};
  }
  try{
    const first=await save('a1','セブン-イレブン');
    assert.equal(first.status,200,JSON.stringify(first.body));
    const retry=await save('a1','セブン-イレブン');
    assert.equal(retry.status,200);assert.equal(retry.body.remote_id,first.body.remote_id);
    assert.equal((await save('b2','ファミリーマート')).status,200);
    assert.equal((await save('c3','セブン-イレブン','12:03')).status,409);
    assert.equal((await save('d4','セブン-イレブン','12:35')).status,200);
    const invalid=await save('e5','セブン-イレブン','13:00','未登録');
    assert.equal(invalid.status,400);assert.equal(invalid.body.error,'category_not_registered');
    const missing=await save('f6','');
    assert.equal(missing.status,400);assert.equal(missing.body.error,'merchant_confirmation_required');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,3);
  }finally{sqlite.close()}
});
