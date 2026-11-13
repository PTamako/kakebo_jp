import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {onRequest,ssoReady} from '../functions/api/homeflow-sso/[[path]].js';
import {onRequest as legacyApi} from '../functions/api/[[path]].js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const app='https://kakeibo-f17.pages.dev',home='https://homeflow.example.test';
const owner='11111111-1111-4111-8111-111111111111';
const member='22222222-2222-4222-8222-222222222222';
const oldCookie='a'.repeat(64);
const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
function d1(){
 const sqlite=new DatabaseSync(':memory:');
 const migration=p=>sqlite.exec(readFileSync(new URL('../migrations/'+p,import.meta.url),'utf8'));
 migration('0001_support_tables.sql');
 migration('0002_versioned_migration_tracking.sql');
 migration('0022_homeflow_identity_foundation.sql');
 sqlite.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY,merchant TEXT,amount INTEGER);"+
   "INSERT INTO entries VALUES(1,'既存の個人明細',1234)");
 const wrap=sql=>({bind(...values){const statement=()=>sqlite.prepare(sql);
  return {first:async()=>statement().get(...values)||null,
   all:async()=>({results:statement().all(...values)}),
   run:async()=>({meta:{changes:statement().run(...values).changes}}),
   runSync:()=>({meta:{changes:statement().run(...values).changes}})};}});
 return {sqlite,prepare:wrap,async batch(items){
  sqlite.exec('BEGIN');
  try{const out=items.map(v=>v.runSync());sqlite.exec('COMMIT');return out;}
  catch(e){sqlite.exec('ROLLBACK');throw e;}
 }};
}
async function setup(){
 const DB=d1();
 const oldHash=await sha(oldCookie);
 DB.sqlite.prepare('INSERT INTO device_sessions(token_hash,expires_at) VALUES(?,?)')
  .run(oldHash,Date.now()+3600000);
 const state={user:owner,role:'owner',household:'primary',nickname:'小白',
  audience:'kakeibo',serviceCalls:0};
 const env={DB,AUTH_TOKEN:'legacy-code',KAKEIBO_HOMEFLOW_SSO_ENABLED:'true',
  KAKEIBO_PUBLIC_ORIGIN:app,HOMEFLOW_OAUTH_ORIGIN:home,
  KAKEIBO_SSO_ENCRYPTION_KEY:'a'.repeat(64)};
 env.HOMEFLOW_IDENTITY_SERVICE={async fetch(request){
  state.serviceCalls++;
  assert.equal(request.redirect,'manual');
  assert.equal(request.headers.get('Origin'),null);
  const u=new URL(request.url);
  if(u.pathname==='/api/oauth/token'){
   const data=new URLSearchParams(await request.text());
   assert.equal(data.get('client_id'),'kakeibo');
   assert.equal(data.get('redirect_uri'),app+'/api/homeflow-sso/callback');
   assert.equal(data.get('code'),'f'.repeat(64));
   return Response.json({access_token:'e'.repeat(64),token_type:'Bearer',expires_in:180});
  }
  if(u.pathname==='/api/oauth/userinfo'){
   assert.equal(request.headers.get('Authorization'),'Bearer '+'e'.repeat(64));
   return Response.json({user_id:state.user,sub:state.user,household_id:state.household,
    role:state.role,nickname:state.nickname,audience:state.audience});
  }
  throw Error('wrong service endpoint');
 }};
 const call=(action,method='GET',data=null,{legacy=false,origin=app,hfCookie=''}={})=>{
  const url=app+'/api/homeflow-sso/'+action;
  const headers={};
  if(method==='POST'){headers.Origin=origin;headers['Content-Type']='application/json';}
  if(legacy)headers.Cookie='kakeibo_session='+oldCookie;
  if(hfCookie)headers.Cookie='__Host-kakeibo_hf='+hfCookie;
  const request=new Request(url,{method,headers,body:method==='POST'?JSON.stringify(data||{}):undefined});
  return onRequest({request,env,params:{path:[action]}});
 };
 const start=async(legacy=false)=>{
  const response=await call('start','POST',{}, {legacy});
  const body=await response.json();
  return {response,body};
 };
 const callback=async(flow,code='f'.repeat(64))=>{
  const u=new URL(app+'/api/homeflow-sso/callback');
  u.searchParams.set('code',code);
  u.searchParams.set('state',flow.body.state);
  return onRequest({request:new Request(u),env,params:{path:['callback']}});
 };
 const complete=(flow,{legacy=false,secret=flow.body.resume_secret,origin=app}={})=>
  call('complete','POST',{state:flow.body.state,resume_secret:secret},{legacy,origin});
 return {DB,env,state,call,start,callback,complete};
}
test('new SSO routes fail closed by default or on any preview hostname',async()=>{
 const f=await setup();
 try{
  f.env.KAKEIBO_HOMEFLOW_SSO_ENABLED=undefined;
  assert.equal(ssoReady(f.env,new URL(app)),false);
  assert.equal((await f.call('start','POST')).status,503);
  assert.equal((await f.call('status')).status,200);
  assert.equal((await (await f.call('status')).json()).enabled,false);
  f.env.KAKEIBO_HOMEFLOW_SSO_ENABLED='true';
  f.env.APP_ENV='preview';
  assert.equal((await f.call('start','POST')).status,503);
  f.env.APP_ENV='production';
  assert.equal(ssoReady(f.env,new URL(app)),true);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM homeflow_sso_pending').get().c,0);
 }finally{f.DB.sqlite.close();}
});
test('first owner needs live legacy device proof; no guess from nickname or role',async()=>{
 const f=await setup();
 try{
  const s=await f.start(false);
  assert.equal(s.response.status,200);
  assert.equal((await f.callback(s)).status,200);
  const denied=await f.complete(s);
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).code,'SSO_OWNER_PROOF_REQUIRED');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM homeflow_identity_links').get().c,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM device_sessions').get().c,1);
 }finally{f.DB.sqlite.close();}
});
test('Safari cannot login; only original PWA uses independent one-time proof',async()=>{
 const f=await setup();
 try{
  const s=await f.start(true);
  assert.equal(s.response.status,200);
  const url=new URL(s.body.authorization_url);
  assert.equal(url.origin,home);
  assert.equal(url.searchParams.get('client_id'),'kakeibo');
  assert.equal(url.searchParams.has('resume_secret'),false);
  assert.equal(url.searchParams.get('state'),s.body.state);
  const row=f.DB.sqlite.prepare('SELECT * FROM homeflow_sso_pending').get();
  assert.notEqual(row.state_hash,s.body.state);
  assert.notEqual(row.resume_hash,s.body.resume_secret);
  assert.ok(row.verifier_cipher.length>100);
  const browser=await f.callback(s);
  assert.equal(browser.status,200);
  assert.equal(browser.headers.get('set-cookie'),null);
  assert.match(await browser.text(),/返回家計簿 App/);
  assert.equal((await f.callback(s)).status,403);
  const denied=await f.complete(s,{legacy:true,secret:'0'.repeat(64)});
  assert.equal(denied.status,403);
  assert.equal(f.state.serviceCalls,0);
  const response=await f.complete(s,{legacy:true});
  assert.equal(response.status,200);
  const user=await response.json();
  assert.equal(user.user_id,owner);
  assert.equal(user.role,'owner');
  assert.equal(user.ledger_access,false);
  assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM homeflow_identity_links').get().c,1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM homeflow_identity_events').get().c,1);
  assert.equal(f.DB.sqlite.prepare('SELECT merchant FROM entries WHERE id=1').get().merchant,'既存の個人明細');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM device_sessions').get().c,1);
  assert.equal((await f.complete(s,{legacy:true})).status,403);
  assert.equal(f.state.serviceCalls,2);
  assert.equal(f.DB.sqlite.prepare('SELECT code_cipher FROM homeflow_sso_pending').get().code_cipher,null);
 }finally{f.DB.sqlite.close();}
});
test('member starts empty in independent identity; never receives legacy ledger access',async()=>{
 const f=await setup();
 try{
  const ownerFlow=await f.start(true);
  assert.equal((await f.callback(ownerFlow)).status,200);
  assert.equal((await f.complete(ownerFlow,{legacy:true})).status,200);
  f.state.user=member;f.state.role='member';f.state.nickname='鸡毛';
  const s=await f.start(false);
  assert.equal((await f.callback(s)).status,200);
  const resp=await f.complete(s);
  assert.equal(resp.status,200);
  const body=await resp.json();
  assert.equal(body.display_name,'鸡毛');
  assert.equal(body.role,'member');
  assert.equal(body.ledger_access,false);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM homeflow_identity_links').get().c,2);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM device_sessions').get().c,1);
  const hfCookie=resp.headers.get('set-cookie').match(/__Host-kakeibo_hf=([0-9a-f]{64})/)[1];
  assert.equal((await f.call('me','GET',null,{hfCookie})).status,200);
  const r=await legacyApi({request:new Request(app+'/api/entries',{
   headers:{Cookie:'__Host-kakeibo_hf='+hfCookie}}),env:f.env,params:{path:['entries']}});
  assert.equal(r.status,401,'member SSO token may never authenticate legacy finance API');
  assert.equal((await f.call('logout','POST',{}, {hfCookie})).status,200);
  assert.equal((await f.call('me','GET',null,{hfCookie})).status,401);
 }finally{f.DB.sqlite.close();}
});
test('unlinked member, account swap, wrong audience and origin all fail closed',async()=>{
 const f=await setup();
 try{
  f.state.user=member;f.state.role='member';
  const first=await f.start();
  assert.equal((await f.callback(first)).status,200);
  assert.equal((await f.complete(first)).status,403);
  f.state.user=owner;f.state.role='owner';
  const o=await f.start(true);
  assert.equal((await f.callback(o)).status,200);
  assert.equal((await f.complete(o,{legacy:true})).status,200);
  f.state.user=member;f.state.role='member';f.state.audience='unrelated-service';
  const u=await f.start();
  assert.equal((await f.callback(u)).status,200);
  assert.equal((await f.complete(u)).status,403);
  f.state.audience='kakeibo';
  const p=await f.start();
  assert.equal((await f.callback(p)).status,200);
  assert.equal((await f.complete(p,{origin:'https://attacker.invalid'})).status,403);
  assert.equal((await f.complete(p)).status,200);
  f.state.role='owner';
  const switched=await f.start();
  assert.equal((await f.callback(switched)).status,200);
  assert.equal((await f.complete(switched)).status,403);
  assert.equal(f.DB.sqlite.prepare("SELECT role FROM homeflow_identity_links WHERE user_id=?").get(member).role,'member');
 }finally{f.DB.sqlite.close();}
});
test('logged-out original legacy owner cannot bind with stale Safari callback',async()=>{
 const f=await setup();
 try{
  const s=await f.start(true);
  assert.equal((await f.callback(s)).status,200);
  f.DB.sqlite.prepare('DELETE FROM device_sessions').run();
  const r=await f.complete(s,{legacy:true});
  assert.equal(r.status,403);
  assert.equal(f.state.serviceCalls,0);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) c FROM homeflow_identity_links').get().c,0);
 }finally{f.DB.sqlite.close();}
});
