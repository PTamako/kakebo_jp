import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto,createHmac} from 'node:crypto';
import {onRequest,ssoReady} from '../functions/api/homeflow-sso/[[path]].js';
import {onRequest as legacyApi} from '../functions/api/[[path]].js';
import {onRequest as familyFinance} from '../functions/api/family-finance/[[path]].js';
import {approvedActionRoute} from '../functions/api/internal/approved-actions/[[path]].js';
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
 migration('0023_family_financial_account_identities.sql');
 migration('0024_family_finance_pending_actions.sql');
 migration('0025_family_financial_resource_owners.sql');
 sqlite.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY,date TEXT,time TEXT,type TEXT,merchant TEXT,amount INTEGER,category TEXT,note TEXT,payment_source TEXT,transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT);"+
   "INSERT INTO entries VALUES(1,'2026-11-10','','expense','既存の個人明細',1234,'生活','旧账保留','PayPay Visa',NULL,0,NULL);"+
   "INSERT INTO entries VALUES(2,'2026-11-10','','income','工资到账',100000,'工资','工资保留','银行',NULL,0,NULL);"+
   "CREATE TABLE payment_sources(name TEXT PRIMARY KEY,sort_order INTEGER,is_default INTEGER,closing_day INTEGER,source_type TEXT,stat_group TEXT,is_archived INTEGER,opening_balance INTEGER,opening_date TEXT);"+
   "INSERT INTO payment_sources VALUES('PayPay Visa',0,1,15,'standard','card',0,15000,'2026-11-01');"+
   "INSERT INTO payment_sources VALUES('nanaco',1,0,NULL,'prepaid','card',0,2400,'2026-11-01')");
 sqlite.exec("ALTER TABLE payment_sources ADD COLUMN opening_entry_id INTEGER NOT NULL DEFAULT 0;"+
  "ALTER TABLE entries ADD COLUMN client_request_id TEXT;"+
  "ALTER TABLE entries ADD COLUMN raw TEXT NOT NULL DEFAULT '';"+
  "CREATE TABLE investment_plans(fund_code TEXT,account_type TEXT,fund_name TEXT,monthly_amount INTEGER,order_day INTEGER,enabled INTEGER);"+
  "CREATE TABLE investment_plan_history(fund_code TEXT,account_type TEXT,fund_name TEXT,monthly_amount INTEGER,order_day INTEGER,enabled INTEGER,effective_month TEXT,updated_at TEXT);"+
  "CREATE TABLE investment_holdings(fund_code TEXT,account_type TEXT,fund_name TEXT,units INTEGER,acquisition_cost INTEGER,reported_value INTEGER,reported_at TEXT,updated_at TEXT);"+
  "CREATE TABLE fund_prices(fund_code TEXT,nav_per_10000 INTEGER,price_date TEXT,source TEXT,updated_at TEXT);"+
  "CREATE TABLE sbi_transfer_links(entry_id INTEGER,purchase_month TEXT,purpose TEXT);"+
  "CREATE TABLE card_bills(payment_source TEXT,bill_month TEXT,period_start TEXT,period_end TEXT,total_amount INTEGER,transaction_count INTEGER);"+
  "INSERT INTO investment_holdings VALUES('ABC12345','tsumitate','SBI 投資信託',10000,18000,NULL,NULL,CURRENT_TIMESTAMP);"+
  "INSERT INTO fund_prices VALUES('ABC12345',20000,'2026-11-12','official',CURRENT_TIMESTAMP);"+
  "INSERT INTO card_bills VALUES('PayPay Visa','2026-11','2026-11-01','2026-11-30',1234,1)");
 sqlite.exec("CREATE TABLE recurring_plans(id TEXT PRIMARY KEY,name TEXT);"+
  "INSERT INTO recurring_plans VALUES('rent-legacy','家賃');"+
  "INSERT INTO investment_plans VALUES('ABC12345','tsumitate','SBI 投資信託',15000,15,1);"+
  "INSERT INTO investment_plan_history VALUES('ABC12345','tsumitate','SBI 投資信託',15000,15,1,'2026-11',CURRENT_TIMESTAMP)");
 migration('0026_family_finance_execution.sql');
 const wrap=sql=>{
  const statement=(values=[])=>({
    first:async()=>sqlite.prepare(sql).get(...values)||null,
    all:async()=>({results:sqlite.prepare(sql).all(...values)}),
    run:async()=>({meta:{changes:sqlite.prepare(sql).run(...values).changes}}),
    runSync:()=>({meta:{changes:sqlite.prepare(sql).run(...values).changes}})
  });
  return {...statement(),bind:(...values)=>statement(values)};
 };
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
  audience:'kakeibo',serviceCalls:0,homeflowActive:true};
 const env={DB,AUTH_TOKEN:'legacy-code',KAKEIBO_HOMEFLOW_SSO_ENABLED:'true',
  KAKEIBO_PUBLIC_ORIGIN:app,HOMEFLOW_OAUTH_ORIGIN:home,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_FAMILY_HOUSEHOLD_ID:'primary',
  KAKEIBO_FAMILY_PENDING_KEY:'f'.repeat(64),
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
   return Response.json({access_token:'e'.repeat(64),token_type:'Bearer',expires_in:180,
    session_assertion:state.user===owner?'d'.repeat(64):'c'.repeat(64),
    session_assertion_expires_in:900});
  }
  if(u.pathname==='/api/oauth/userinfo'){
   assert.equal(request.headers.get('Authorization'),'Bearer '+'e'.repeat(64));
   return Response.json({user_id:state.user,sub:state.user,household_id:state.household,
    role:state.role,nickname:state.nickname,audience:state.audience});
  }
  if(u.pathname==='/api/oauth/session-introspect'){
   const body=new URLSearchParams(await request.text());
   assert.equal(body.get('client_id'),'kakeibo');
   const assertion=body.get('session_assertion');
   const who=assertion==='d'.repeat(64)?owner:
     assertion==='c'.repeat(64)?member:null;
   if(!who||!state.homeflowActive)
    return Response.json({error:'invalid_assertion'},{status:401});
   // Two simultaneous HomeFlow logins keep distinct source sessions.
   // Changing our currently selected mock account does not revoke the other
   // person's assertion; real HomeFlow resolves identity from its token hash.
   const selected=who===state.user;
   const role=selected?state.role:(who===owner?'owner':'member');
   const nickname=selected?state.nickname:(who===owner?'小白':'鸡毛');
   return Response.json({active:true,user_id:who,sub:who,
    household_id:state.household,role,nickname,audience:state.audience});
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
  f.state.homeflowActive=false;
  assert.equal((await f.call('me','GET',null,{hfCookie})).status,401,
    'HomeFlow logout must revoke the next identity request');
  f.state.homeflowActive=true;f.state.role='owner';
  assert.equal((await f.call('me','GET',null,{hfCookie})).status,401,
    'role mismatch cannot keep member session');
  f.state.role='member';
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


async function loginOwner(f){
 const flow=await f.start(true);
 assert.equal((await f.callback(flow)).status,200);
 const res=await f.complete(flow,{legacy:true});
 assert.equal(res.status,200);
 const cookie=res.headers.get('set-cookie').match(/__Host-kakeibo_hf=([a-f0-9]{64})/)[1];
 (f.accountActors??=new Map()).set(cookie,owner);
 return cookie;
}
async function loginMember(f){
 f.state.user=member;f.state.role='member';f.state.nickname='鸡毛';
 const flow=await f.start(false);
 assert.equal((await f.callback(flow)).status,200);
 const res=await f.complete(flow);
 assert.equal(res.status,200);
 const cookie=res.headers.get('set-cookie').match(/__Host-kakeibo_hf=([a-f0-9]{64})/)[1];
 (f.accountActors??=new Map()).set(cookie,member);
 return cookie;
}
function finance(f,path,method='GET',body,secret='',origin=app){
 const headers={};
 if(secret)headers.Cookie='__Host-kakeibo_hf='+secret;
 if(!['GET','HEAD'].includes(method)){headers.Origin=origin;headers['content-type']='application/json';}
 // Mirror the initiating PWA identity for account and proposal writes.
 // Explicit overrides in tests still simulate old-cookie/wrong-member attempts.
 const scoped=['POST','PATCH'].includes(method)&&
  /^(?:accounts|proposals|legacy)(?:\/|$)/.test(path)&&body&&f.accountActors?.has(secret)
   ?{expected_user_id:f.accountActors.get(secret),...body}:body;
 return familyFinance({env:f.env,
  request:new Request(app+'/api/family-finance/'+path,{method,headers,
   body:method==='GET'?undefined:JSON.stringify(scoped??{})}),
  params:{path:path.split('?')[0].split('/')}});
}
test('family-finance stays off without explicit flag and family-bound audience',async()=>{
 const f=await setup();
 try{
  assert.equal((await finance(f,'status')).status,200);
  assert.equal((await finance(f,'shared/entries')).status,401);
  f.env.KAKEIBO_FAMILY_FINANCE_ENABLED='false';
  assert.equal((await finance(f,'shared/entries')).status,503);
  f.env.KAKEIBO_FAMILY_FINANCE_ENABLED='true';
  const ownerCookie=await loginOwner(f);
  f.env.KAKEIBO_FAMILY_HOUSEHOLD_ID='different-family';
  assert.equal((await finance(f,'shared/entries','GET',null,ownerCookie)).status,401);
  f.env.KAKEIBO_FAMILY_HOUSEHOLD_ID='primary';
  assert.equal((await finance(f,'shared/entries','GET',null,ownerCookie)).status,200);
 }finally{f.DB.sqlite.close();}
});
test('legacy card and prepaid settings adopt to owner only, ledger untouched and idempotent',async()=>{
 const f=await setup();
 try{
  const original=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const source=f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all();
  const ownerCookie=await loginOwner(f);
  const denied=await finance(f,'legacy/adopt','POST',{confirm:false},ownerCookie);
  assert.equal(denied.status,403);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,0);
  const adoption=await finance(f,'legacy/adopt','POST',{confirm:true},ownerCookie);
  assert.equal(adoption.status,200,await adoption.clone().text());
  assert.equal((await adoption.json()).adopted,2);
  const replay=await finance(f,'legacy/adopt','POST',{confirm:true},ownerCookie);
  assert.equal((await replay.json()).already_adopted,true);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,2);
  const kinds=f.DB.sqlite.prepare('SELECT label,owner_user_id,origin,opening_balance FROM family_financial_accounts ORDER BY label').all();
  assert.deepEqual(kinds.map(x=>x.owner_user_id),[owner,owner]);
  assert.ok(kinds.every(x=>x.origin==='legacy'));
  assert.equal(kinds.find(x=>x.label==='PayPay Visa').opening_balance,15000);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),original);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all(),source);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n,1);
  const memberCookie=await loginMember(f);
  assert.equal((await finance(f,'legacy/adopt','POST',{confirm:true},memberCookie)).status,403);
  assert.equal((await finance(f,'accounts','GET',null,memberCookie)).status,200,
    'member can view all household account summaries');
  const oldAccount=f.DB.sqlite.prepare("SELECT account_id FROM family_financial_accounts WHERE label='nanaco'").get().account_id;
  assert.equal((await finance(f,'accounts/'+oldAccount,'PATCH',
    {label:'owner card hijack',version:1},memberCookie)).status,403);
  assert.equal((await finance(f,'accounts/'+oldAccount,'PATCH',
    {label:'legacy old-name mutation',version:1},ownerCookie)).status,409);
 }finally{f.DB.sqlite.close();}
});
test('both members see identical family ledger/statistics, no member direct ledger mutation',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const fetch=async(secret,path)=>await (await finance(f,path,'GET',null,secret)).json();
  assert.deepEqual((await fetch(ownerCookie,'shared/entries')).items,
   (await fetch(memberCookie,'shared/entries')).items);
  const path='shared/ledger-totals?month=2026-11';
  const familyRoute=async(secret)=>familyFinance({env:f.env,
    request:new Request(app+'/api/family-finance/'+path,{headers:{
      Cookie:'__Host-kakeibo_hf='+secret}}),
    params:{path:['shared','ledger-totals']}});
  const a=(await (await familyRoute(ownerCookie)).json());
  const b=(await (await familyRoute(memberCookie)).json());
  assert.deepEqual(a,b);
  assert.equal(a.net_income_expense,100000-1234);
  assert.equal(a.totals.expense,1234);
  assert.equal((await finance(f,'shared/entries','POST',{amount:999},memberCookie)).status,404);
  const r=await legacyApi({request:new Request(app+'/api/entries',{
    method:'POST',headers:{Cookie:'__Host-kakeibo_hf='+memberCookie,
     Origin:app,'Content-Type':'application/json'},body:JSON.stringify({amount:999})}),
    env:f.env,params:{path:['entries']}});
  assert.equal(r.status,401);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,2);
 }finally{f.DB.sqlite.close();}
});
test('member can configure own identically named card, cannot edit spouse, owner can manage all',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  await finance(f,'legacy/adopt','POST',{confirm:true},ownerCookie);
  const memberCookie=await loginMember(f);
  const created=await finance(f,'accounts','POST',{
    label:'PayPay Visa',account_kind:'credit_card',closing_day:10,opening_balance:2000
  },memberCookie);
  assert.equal(created.status,201,await created.clone().text());
  const accountId=(await created.json()).account_id;
  const accounts=await (await finance(f,'accounts','GET',null,memberCookie)).json();
  assert.equal(accounts.items.filter(a=>a.label==='PayPay Visa').length,2);
  const owned=accounts.items.find(a=>a.account_id===accountId);
  assert.equal(owned.owner_user_id,member);
  const updated=await finance(f,'accounts/'+accountId,'PATCH',{
    label:'我的信用卡',version:1,opening_balance:3000
  },memberCookie);
  assert.equal(updated.status,200,await updated.clone().text());
  assert.equal((await finance(f,'accounts/'+accountId,'PATCH',{
    label:'stale',version:1},memberCookie)).status,409);
  const ownerUpdated=await finance(f,'accounts/'+accountId,'PATCH',{
    label:'管理员协助修改',version:2},ownerCookie);
  assert.equal(ownerUpdated.status,200);
  const audit=f.DB.sqlite.prepare("SELECT actor_user_id,action FROM family_finance_events WHERE resource_id=? ORDER BY created_at,action").all(accountId);
  assert.equal(audit.length,3);
  assert.ok(audit.some(v=>v.actor_user_id===owner));
  assert.ok(audit.some(v=>v.actor_user_id===member));
  assert.equal(f.DB.sqlite.prepare('SELECT amount FROM entries WHERE id=1').get().amount,1234);
  assert.equal(f.DB.sqlite.prepare('SELECT name FROM payment_sources WHERE name=?').get('PayPay Visa').name,'PayPay Visa');
  f.state.homeflowActive=false;
  assert.equal((await finance(f,'accounts','GET',null,memberCookie)).status,401,
    'HomeFlow logout invalidates private financial settings immediately');
 }finally{f.DB.sqlite.close();}
});


test('member prepares AES-GCM encrypted finance intent, not an entry or HomeFlow approval',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const created=await finance(f,'accounts','POST',{
   label:'nanaco',account_kind:'prepaid',opening_balance:1000
  },memberCookie);
  assert.equal(created.status,201);
  const accountId=(await created.json()).account_id;
  const oldLedger=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const oldCards=f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all();
  const payload={idempotency_key:'member-first-nanaco-001',
   account_id:accountId,type:'expense',amount_jpy:1520,date:'2026-11-13',
   merchant:'マクドナルド',category:'食費',note:'需要管理员审批'};
  const prepared=await finance(f,'proposals','POST',payload,memberCookie);
  assert.equal(prepared.status,201,await prepared.clone().text());
  const body=await prepared.json();
  assert.equal(body.prepared.status,'prepared_not_submitted');
  assert.equal(body.prepared.homeflow_approval_id,null);
  assert.equal(body.prepared.ledger_changed,false);
  assert.match(body.prepared.payload_sha256,/^[0-9a-f]{64}$/);
  const id=body.prepared.request_id;
  const saved=f.DB.sqlite.prepare('SELECT * FROM family_finance_pending_actions WHERE request_id=?').get(id);
  assert.ok(saved.payload_cipher&&saved.payload_iv);
  assert.equal(saved.payload_cipher.includes('マクドナルド'),false);
  assert.equal(saved.payload_cipher.includes('1520'),false);
  assert.equal(saved.state,'prepared');
  assert.equal(saved.requester_user_id,member);
  assert.equal(saved.account_id,accountId);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_pending_actions').get().n,1);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),oldLedger);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all(),oldCards);
  assert.equal((await finance(f,'proposals','GET',null,ownerCookie)).status,403,
    'owner must not implicitly get the member private pending details via this endpoint');
  const listing=await (await finance(f,'proposals','GET',null,memberCookie)).json();
  assert.equal(listing.items.length,1);
  assert.equal(listing.items[0].request_id,id);
  assert.equal(JSON.stringify(listing).includes('マクドナルド'),false,
    'private payload is not exposed in proposal list');
  const repeated=await finance(f,'proposals','POST',payload,memberCookie);
  assert.equal(repeated.status,200,await repeated.clone().text());
  assert.equal((await repeated.json()).replayed,true);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_pending_actions').get().n,1);
  const modified=await finance(f,'proposals','POST',{...payload,amount_jpy:5000},memberCookie);
  assert.equal(modified.status,409);
  const rejected=await finance(f,'proposals','POST',{...payload,
   idempotency_key:'member-first-nanaco-002',type:'transfer',amount_jpy:1000},memberCookie);
  assert.equal(rejected.status,400,'SBI and transfer should not silently use the normal expense workflow');
  const cancel=await finance(f,'proposals/'+id+'/cancel','POST',{},memberCookie);
  assert.equal(cancel.status,200,await cancel.clone().text());
  const replayCancel=await finance(f,'proposals/'+id+'/cancel','POST',{},memberCookie);
  assert.equal(replayCancel.status,200);
  assert.equal(f.DB.sqlite.prepare("SELECT state FROM family_finance_pending_actions WHERE request_id=?").get(id).state,'cancelled');
  const audit=f.DB.sqlite.prepare("SELECT actor_user_id,action FROM family_finance_events WHERE resource_id=? ORDER BY created_at").all(id);
  assert.equal(audit.length,2);
  assert.ok(audit.every(x=>x.actor_user_id===member));
  assert.deepEqual(audit.map(x=>x.action).sort(),['finance_entry_cancelled','finance_entry_prepared']);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),oldLedger);
 }finally{f.DB.sqlite.close();}
});
test('financial pending encryption and account identity fail closed on CSRF, cross-member and missing key',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const made=await (await finance(f,'accounts','POST',{
   label:'成员信用卡',account_kind:'credit_card'
  },memberCookie)).json();
  const payload={idempotency_key:'test-fail-closed-prepare',
   account_id:made.account_id,type:'expense',
   amount_jpy:2000,date:'2026-11-13',merchant:'店铺',category:'食費'};
  assert.equal((await finance(f,'proposals','POST',payload,memberCookie,'https://attacker.invalid')).status,403);
  assert.equal((await finance(f,'proposals','POST',payload,ownerCookie)).status,403);
  const bad=f.env.KAKEIBO_FAMILY_PENDING_KEY;
  f.env.KAKEIBO_FAMILY_PENDING_KEY=undefined;
  assert.equal((await finance(f,'proposals','POST',payload,memberCookie)).status,503);
  f.env.KAKEIBO_FAMILY_PENDING_KEY=bad;
  const prepared=await finance(f,'proposals','POST',payload,memberCookie);
  assert.equal(prepared.status,201,await prepared.clone().text());
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_pending_actions').get().n,1);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,2);
 }finally{f.DB.sqlite.close();}
});


test('both members see identical read-only actual prepaid/SBI assets and card bill snapshots',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const beforeEntries=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const beforeSources=f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all();
  const beforeHoldings=f.DB.sqlite.prepare('SELECT * FROM investment_holdings').all();
  const beforeBills=f.DB.sqlite.prepare('SELECT * FROM card_bills').all();
  const read=async secret=>{
   const response=await finance(f,'shared/asset-summary','GET',null,secret);
   assert.equal(response.status,200,await response.clone().text());
   return response.json();
  };
  const admin=await read(ownerCookie),spouse=await read(memberCookie);
  assert.deepEqual(admin,spouse,'all tracked assets/bills are household visible without an owner filter');
  assert.equal(admin.household_id,'primary');
  assert.equal(admin.scope,'household');
  assert.equal(admin.prepaid.cards.length,1);
  assert.equal(admin.prepaid.cards[0].name,'nanaco');
  assert.equal(admin.prepaid.total_jpy,2400);
  assert.equal(admin.securities.holdings.length,1);
  assert.equal(admin.securities.holdings[0].fund_name,'SBI 投資信託');
  assert.equal(admin.securities.total_market_value_jpy,20000);
  assert.equal(admin.tracked_assets_jpy,22400);
  assert.equal(admin.tracked_assets_complete,true);
  assert.equal(admin.credit_card_bills.length,1);
  assert.equal(admin.credit_card_bills[0].current_total_jpy,1234);
  assert.ok(admin.excluded_from_assets.includes('untracked_bank_cash_balances'));
  assert.equal(admin.ledger_changed,false);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),beforeEntries);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all(),beforeSources);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM investment_holdings').all(),beforeHoldings);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM card_bills').all(),beforeBills);
 }finally{f.DB.sqlite.close();}
});
test('an unvalued SBI position never masquerades as complete household assets',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  f.DB.sqlite.prepare('DELETE FROM fund_prices').run();
  const response=await finance(f,'shared/asset-summary','GET',null,ownerCookie);
  assert.equal(response.status,200,await response.clone().text());
  const data=await response.json();
  assert.equal(data.tracked_assets_jpy,2400,'known prepaid balance remains visible');
  assert.equal(data.tracked_assets_complete,false);
  assert.equal(data.securities.total_market_value_jpy,null);
  assert.equal(data.securities.missing_valuations,1);
  const malformed=await finance(f,'shared/asset-summary?month=2026-13','GET',null,ownerCookie);
  assert.equal(malformed.status,400);
  f.state.homeflowActive=false;
  assert.equal((await finance(f,'shared/asset-summary','GET',null,ownerCookie)).status,401);
 }finally{f.DB.sqlite.close();}
});


test('verified HomeFlow owner alone can attach old fixed expenses, SBI and bills without altering source rows',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const tables=['recurring_plans','investment_plans','investment_plan_history',
   'investment_holdings','card_bills'];
  const source=Object.fromEntries(tables.map(t=>[t,
   f.DB.sqlite.prepare('SELECT * FROM '+t+' ORDER BY 1').all()]));
  assert.equal((await finance(f,'legacy/resource-owners','POST',{
   confirm:true,resource_kind:'recurring_plan'
  },memberCookie)).status,403);
  assert.equal((await finance(f,'legacy/resource-owners','POST',{
   confirm:false,resource_kind:'recurring_plan'
  },ownerCookie)).status,403);
  assert.equal((await finance(f,'legacy/resource-owners','POST',{
   confirm:true,resource_kind:'__proto__'
  },ownerCookie)).status,403);
  for(const kind of ['recurring_plan','investment_plan','investment_plan_history',
   'investment_holding','card_bill']){
   const outcome=await finance(f,'legacy/resource-owners','POST',{
    confirm:true,resource_kind:kind
   },ownerCookie);
   assert.equal(outcome.status,200,await outcome.clone().text());
   assert.equal((await outcome.json()).mapped,1);
   const replay=await finance(f,'legacy/resource-owners','POST',{
    confirm:true,resource_kind:kind
   },ownerCookie);
   assert.equal(replay.status,200);
   assert.equal((await replay.json()).mapped,0);
  }
  const current=await (await finance(f,'legacy/resource-owners','GET',null,memberCookie)).json();
  assert.equal(current.items.length,5);
  assert.ok(current.items.every(x=>x.owner_user_id===owner&&x.mapped_count===1));
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_financial_resource_owners').get().n,5);
  for(const t of tables)
   assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM '+t+' ORDER BY 1').all(),source[t],
    'legacy table '+t+' must remain byte-for-byte equivalent in every row');
  const audited=f.DB.sqlite.prepare("SELECT actor_user_id,action FROM family_finance_events WHERE action='legacy_resource_owners_adopted'").all();
  assert.equal(audited.length,5);
  assert.ok(audited.every(x=>x.actor_user_id===owner));
  const saved=f.DB.sqlite.prepare('SELECT * FROM family_financial_resource_owners LIMIT 1').get();
  assert.throws(()=>f.DB.sqlite.prepare('UPDATE family_financial_resource_owners SET owner_user_id=? WHERE resource_kind=? AND legacy_key=?')
   .run(member,saved.resource_kind,saved.legacy_key),/RESOURCE_OWNER_IMMUTABLE/);
  assert.throws(()=>f.DB.sqlite.prepare('DELETE FROM family_financial_resource_owners WHERE resource_kind=? AND legacy_key=?')
   .run(saved.resource_kind,saved.legacy_key),/RESOURCE_OWNER_IMMUTABLE/);
  assert.throws(()=>f.DB.sqlite.prepare('INSERT INTO family_financial_resource_owners(resource_kind,legacy_key,household_id,owner_user_id,assigned_by_user_id) VALUES(?,?,?,?,?)')
   .run('recurring_plan','malicious-member','primary',member,member),/LEGACY_RESOURCE_OWNER_PROOF_REQUIRED/);
  f.state.homeflowActive=false;
  assert.equal((await finance(f,'legacy/resource-owners','GET',null,memberCookie)).status,401);
 }finally{f.DB.sqlite.close()}
});
test('legacy mapping paginates bounded batches and retry does not create fake actor events',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const statement=f.DB.sqlite.prepare('INSERT INTO recurring_plans(id,name) VALUES(?,?)');
  for(let i=0;i<52;i++)statement.run('fixed-'+String(i).padStart(3,'0'),'旧固定费');
  const initial=f.DB.sqlite.prepare('SELECT * FROM recurring_plans ORDER BY id').all();
  const call=async cursor=>{
   const res=await finance(f,'legacy/resource-owners','POST',{
    confirm:true,resource_kind:'recurring_plan',...(cursor?{cursor}:{})
   },ownerCookie);
   assert.equal(res.status,200,await res.clone().text());
   return res.json();
  };
  const first=await call();
  assert.equal(first.mapped,50);
  assert.equal(first.has_more,true);
  assert.ok(typeof first.next_cursor==='string');
  const next=await call(first.next_cursor);
  assert.equal(next.mapped,3);
  assert.equal(next.next_cursor,null);
  assert.equal(next.has_more,false);
  const again=await call();
  assert.equal(again.mapped,0);
  assert.equal(again.already_mapped,50);
  assert.equal(again.next_cursor,first.next_cursor);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_financial_resource_owners WHERE resource_kind=?').get('recurring_plan').n,53);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM family_finance_events WHERE action='legacy_resource_owners_adopted'").get().n,2);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM recurring_plans ORDER BY id').all(),initial);
 }finally{f.DB.sqlite.close()}
});

async function loginMemberAfterOwner(f){
  await loginOwner(f);
  return loginMember(f);
}


test('signed HomeFlow decision proof can be checked for an encrypted member proposal but cannot post ledger',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const created=await (await finance(f,'accounts','POST',{
   label:'我的 PayPay Visa',account_kind:'credit_card'
  },memberCookie)).json();
  const preparedResponse=await finance(f,'proposals','POST',{
   idempotency_key:'finance-homeflow-proof-test-0001',account_id:created.account_id,
   type:'expense',amount_jpy:1520,date:'2026-11-13',
   merchant:'マクドナルド',category:'食費'
  },memberCookie);
  assert.equal(preparedResponse.status,201);
  const prepared=(await preparedResponse.json()).prepared;
  const approvedId='33333333-3333-4333-8333-333333333333';
  const firstLedger=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  let originalEvents=f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all();
  const stub=f.env.HOMEFLOW_IDENTITY_SERVICE.fetch;
  const secret='c'.repeat(64);
  f.env.APP_ENV='production';
  f.env.KAKEIBO_APPROVAL_VERIFICATION_SECRET=secret;
  let replyMode='approved',checked=0;
  f.env.HOMEFLOW_IDENTITY_SERVICE.fetch=async request=>{
   const path=new URL(request.url).pathname;
   if(path==='/api/internal/approvals/submit'){
    const raw=await request.text(),stamp=request.headers.get('x-approval-timestamp');
    const mac=createHmac('sha256',Buffer.from(secret,'hex'))
     .update('kakeibo\n'+stamp+'\n'+raw).digest('hex');
    assert.equal(request.headers.get('x-approval-signature'),mac);
    const submitted=JSON.parse(raw);
    assert.equal(submitted.resource_id,prepared.request_id);
    assert.equal(submitted.payload_sha256,prepared.payload_sha256);
    assert.equal(submitted.requester_user_id,member);
    assert.equal(Object.keys(submitted).length,4);
    return Response.json({ok:true,approval_id:approvedId,status:'pending',
     resource_id:submitted.resource_id,payload_sha256:submitted.payload_sha256,
     requester_user_id:member,household_id:'primary',
     idempotency_key:'kakeibo:finance:'+prepared.request_id,
     replayed:false,applied:false,ledger_changed:false},{status:201});
   }
   if(path!=='/api/internal/approvals/verify')return stub(request);
   checked++;
   assert.equal(request.method,'POST');
   assert.equal(request.redirect,'manual');
   assert.equal(request.headers.get('origin'),null);
   assert.equal(request.headers.get('cookie'),null);
   assert.equal(request.headers.get('x-approval-client'),'kakeibo');
   const raw=await request.text(),stamp=request.headers.get('x-approval-timestamp');
   const mac=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('kakeibo\n'+stamp+'\n'+raw).digest('hex');
   assert.equal(request.headers.get('x-approval-signature'),mac);
   const query=JSON.parse(raw);
   assert.equal(query.resource_id,prepared.request_id);
   assert.equal(query.payload_sha256,prepared.payload_sha256);
   assert.equal(query.household_id,'primary');
   assert.equal(query.requester_user_id,member);
   assert.equal(query.idempotency_key,'kakeibo:finance:'+prepared.request_id);
   assert.equal(query.expected_version,null);
   if(query.request_id!==approvedId||replyMode==='pending')
    return Response.json({code:'approval_not_executable'},{status:409});
   const response={ok:true,verified:true,...query,approved_at:Date.now()-1000,
    expires_at:Date.now()+100000,applied:false,ledger_changed:false};
   if(replyMode==='wrong_digest')response.payload_sha256='b'.repeat(64);
   return Response.json(response);
  };
  f.env.KAKEIBO_APPROVAL_SUBMISSION_ENABLED='true';
  const sent=await finance(f,'proposals/'+prepared.request_id+'/submit',
   'POST',{},memberCookie);
  assert.equal(sent.status,201,await sent.clone().text());
  const receipt=await sent.json();
  assert.equal(receipt.homeflow_approval_id,approvedId);
  assert.equal(receipt.status,'submitted_status_unknown');
  assert.equal(receipt.applied,false);
  assert.equal((await finance(f,'proposals/'+prepared.request_id+'/submit',
   'POST',{},memberCookie)).status,200,'local retry is idempotent');
  originalEvents=f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all();
  const ask=(homeflow_request_id=approvedId)=>finance(f,
   'proposals/'+prepared.request_id+'/approval-proof','POST',
   {homeflow_request_id},memberCookie);
  assert.equal((await ask()).status,503,'explicit proof flag required');
  f.env.KAKEIBO_APPROVAL_PROOF_ENABLED='true';
  let verified=await ask();
  assert.equal(verified.status,200,await verified.clone().text());
  let result=await verified.json();
  assert.equal(result.status,'approved_not_applied');
  assert.equal(result.approval_confirmed,true);
  assert.equal(result.applied,false);
  assert.equal(result.ledger_changed,false);
  assert.equal(checked,1);
  replyMode='pending';
  assert.equal((await ask()).status,409);
  replyMode='wrong_digest';
  assert.equal((await ask()).status,503);
  replyMode='approved';
  assert.equal((await ask('44444444-4444-4444-8444-444444444444')).status,409);
  assert.equal((await finance(f,'proposals/'+prepared.request_id+'/approval-proof',
   'POST',{homeflow_request_id:approvedId},memberCookie,'https://attacker.invalid')).status,403);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),firstLedger,
   'even a successful approval proof never writes entries');
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all(),
   originalEvents,'the verify call never writes per-read audit events');
  f.state.homeflowActive=false;
  assert.equal((await ask()).status,401,'a revoked HomeFlow session cannot poll verification');
 }finally{f.DB.sqlite.close()}
});
test('cancelled or archived member proposal cannot obtain executable approval proof',async()=>{
 const f=await setup();
 try{
  const memberCookie=await loginMemberAfterOwner(f);
  const created=(await (await finance(f,'accounts','POST',{
   label:'我的 nanaco',account_kind:'prepaid'
  },memberCookie)).json()).account_id;
  const pending=(await (await finance(f,'proposals','POST',{
   idempotency_key:'finance-homeflow-proof-test-0002',account_id:created,
   type:'expense',amount_jpy:100,date:'2026-11-13',
   merchant:'コンビニ',category:'食費'
  },memberCookie)).json()).prepared;
  f.env.APP_ENV='production';
  f.env.KAKEIBO_APPROVAL_PROOF_ENABLED='true';
  f.env.KAKEIBO_APPROVAL_VERIFICATION_SECRET='c'.repeat(64);
  const proof=()=>finance(f,'proposals/'+pending.request_id+'/approval-proof',
   'POST',{homeflow_request_id:'33333333-3333-4333-8333-333333333333'},memberCookie);
  assert.equal((await finance(f,'proposals/'+pending.request_id+'/cancel','POST',{},memberCookie)).status,200);
  assert.equal((await proof()).status,409);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,2);
 }finally{f.DB.sqlite.close()}
});


test('lost HomeFlow acknowledgement retries the same pending approval without double-write',async()=>{
 const f=await setup();
 try{
  const memberCookie=await loginMemberAfterOwner(f);
  const accountId=(await (await finance(f,'accounts','POST',{
   label:'家族支出用の私有カード',account_kind:'credit_card'
  },memberCookie)).json()).account_id;
  const proposal=(await (await finance(f,'proposals','POST',{
   idempotency_key:'retrying-remote-approval-00001',account_id:accountId,
   type:'expense',amount_jpy:2500,date:'2026-11-13',
   merchant:'テスト購入',category:'生活'
  },memberCookie)).json()).prepared;
  const ledgerBefore=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  f.env.APP_ENV='production';
  f.env.KAKEIBO_APPROVAL_SUBMISSION_ENABLED='true';
  f.env.KAKEIBO_APPROVAL_VERIFICATION_SECRET='c'.repeat(64);
  const original=f.env.HOMEFLOW_IDENTITY_SERVICE.fetch;
  let accepted=0;
  const remoteId='55555555-5555-4555-8555-555555555555';
  f.env.HOMEFLOW_IDENTITY_SERVICE.fetch=async req=>{
   if(new URL(req.url).pathname!=='/api/internal/approvals/submit')
    return original(req);
   accepted++;
   const body=JSON.parse(await req.text());
   assert.equal(Object.keys(body).length,4);
   assert.equal(body.resource_id,proposal.request_id);
   assert.equal(body.payload_sha256,proposal.payload_sha256);
   assert.equal(body.requester_user_id,member);
   assert.equal(JSON.stringify(body).includes('テスト購入'),false);
   if(accepted===1)throw Error('HomeFlow committed, connection broke before reply');
   return Response.json({ok:true,approval_id:remoteId,status:'pending',
    resource_id:body.resource_id,payload_sha256:body.payload_sha256,
    household_id:body.household_id,requester_user_id:body.requester_user_id,
    idempotency_key:'kakeibo:finance:'+proposal.request_id,
    replayed:true,applied:false,ledger_changed:false},{status:200});
  };
  const submit=()=>finance(f,'proposals/'+proposal.request_id+'/submit',
   'POST',{},memberCookie);
  const broken=await submit();
  assert.equal(broken.status,503);
  assert.equal((await broken.json()).safe_to_retry,true);
  let state=f.DB.sqlite.prepare(
   'SELECT state,homeflow_approval_id FROM family_finance_pending_actions WHERE request_id=?')
   .get(proposal.request_id);
  assert.equal(state.state,'prepared');
  assert.equal(state.homeflow_approval_id,null);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM family_finance_events WHERE action='finance_entry_submitted'").get().n,0);
  const restored=await submit();
  assert.equal(restored.status,201,await restored.clone().text());
  assert.equal((await restored.json()).homeflow_approval_id,remoteId);
  assert.equal((await submit()).status,200);
  assert.equal(accepted,2,'local replay never sends a duplicate backend request');
  state=f.DB.sqlite.prepare(
   'SELECT state,homeflow_approval_id FROM family_finance_pending_actions WHERE request_id=?')
   .get(proposal.request_id);
  assert.equal(state.state,'submitted');
  assert.equal(state.homeflow_approval_id,remoteId);
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM family_finance_events WHERE action='finance_entry_submitted'").get().n,1);
  assert.equal((await finance(f,'proposals/'+proposal.request_id+'/cancel','POST',{},memberCookie)).status,409,
   'an already submitted approval must be cancelled in HomeFlow, not just hidden locally');
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),ledgerBefore);
 }finally{f.DB.sqlite.close()}
});


test('approved CASH draft posts once through signed executor and persists immutable real actors',async()=>{
 const f=await setup()
 try{
  const memberCookie=await loginMemberAfterOwner(f)
  const accountResponse=await finance(f,'accounts','POST',{
   label:'本人現金',account_kind:'cash',opening_balance:5000
  },memberCookie)
  assert.equal(accountResponse.status,201)
  const accountId=(await accountResponse.json()).account_id
  const pending=(await (await finance(f,'proposals','POST',{
   idempotency_key:'approved-cash-once-test-001',account_id:accountId,
   type:'expense',amount_jpy:1520,date:'2026-11-13',
   merchant:'マクドナルド',category:'食費',note:'合法记账'
  },memberCookie)).json()).prepared
  const approval='55555555-5555-4555-8555-555555555555'
  const stmt=f.DB.sqlite.prepare("UPDATE family_finance_pending_actions SET state='submitted',homeflow_approval_id=?,submitted_at=? WHERE request_id=?")
  stmt.run(approval,Date.now(),pending.request_id)
  const ledgerBefore=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all()
  const secret='c'.repeat(64)
  f.env.APP_ENV='production'
  f.env.KAKEIBO_FAMILY_EXECUTION_ENABLED='true'
  f.env.KAKEIBO_APPROVAL_PROOF_ENABLED='true'
  f.env.KAKEIBO_APPROVAL_VERIFICATION_SECRET=secret
  let homeflowProofCalls=0
  const original=f.env.HOMEFLOW_IDENTITY_SERVICE.fetch
  f.env.HOMEFLOW_IDENTITY_SERVICE.fetch=async request=>{
   if(new URL(request.url).pathname!=='/api/internal/approvals/verify')
    return original(request)
   homeflowProofCalls++
   const stamp=request.headers.get('x-approval-timestamp'),raw=await request.text()
   const sig=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('kakeibo\n'+stamp+'\n'+raw).digest('hex')
   assert.equal(request.headers.get('x-approval-signature'),sig)
   const body=JSON.parse(raw)
   assert.equal(body.purpose,'execute')
   assert.equal(body.request_id,approval)
   assert.equal(body.resource_id,pending.request_id)
   assert.equal(body.payload_sha256,pending.payload_sha256)
   assert.equal(body.idempotency_key,'kakeibo:finance:'+pending.request_id)
   assert.equal(body.expected_version,null)
   assert.equal(body.execution_nonce,'d'.repeat(64))
   return Response.json({ok:true,verified:true,request_id:approval,
    resource_id:pending.request_id,household_id:'primary',
    requester_user_id:member,approver_user_id:owner,
    payload_sha256:pending.payload_sha256,
    idempotency_key:'kakeibo:finance:'+pending.request_id,
    expected_version:null,execution_status:'executing',
    execution_authorized:true,applied:false,
    approved_at:Date.now()-1000,expires_at:Date.now()+3600000})
  }
  const call=async (overrides={},headers={})=>{
   const body={request_id:approval,resource_id:pending.request_id,
    requester_user_id:member,household_id:'primary',
    payload_sha256:pending.payload_sha256,execution_nonce:'d'.repeat(64),
    ...overrides}
   const raw=JSON.stringify(body),timestamp=String(Date.now())
   const mac=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('homeflow\n'+timestamp+'\n'+raw).digest('hex')
   return approvedActionRoute(new Request(app+'/api/internal/approved-actions/execute',{
    method:'POST',headers:{'content-type':'application/json',
     'x-approval-client':'homeflow','x-approval-timestamp':timestamp,
     'x-approval-signature':mac,...headers},body:raw
   }),f.env,['execute'])
  }
  assert.equal((await call({}, {cookie:'__Host-hf_session=bad'})).status,403)
  assert.equal((await call({}, {origin:app})).status,403)
  const forged=await call({payload_sha256:'b'.repeat(64)})
  assert.equal(forged.status,409)
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_applied_actions').get().n,0)
  const result=await call()
  assert.equal(result.status,200,await result.clone().text())
  const posted=await result.json()
  assert.equal(posted.applied,true)
  assert.equal(posted.already_applied,false)
  assert.equal(posted.approval_id,approval)
  assert.equal(posted.payload_sha256,pending.payload_sha256)
  assert.equal(homeflowProofCalls,1)
  const ledger=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all()
  assert.equal(ledger.length,ledgerBefore.length+1)
  assert.deepEqual(ledger.slice(0,ledgerBefore.length).map(x=>({...x,family_account_id:null})),
   ledgerBefore.map(x=>({...x,family_account_id:null})),
   'historic entries must remain exactly unchanged')
  const created=ledger.at(-1)
  assert.equal(created.amount,1520)
  assert.equal(created.type,'expense')
  assert.equal(created.category,'食費')
  assert.equal(created.merchant,'マクドナルド')
  assert.equal(created.family_account_id,accountId)
  assert.equal(created.payment_source,'','duplicate labels never imply a legacy credit card')
  assert.equal(created.client_request_id,'hf:'+approval)
  assert.equal(created.raw,'','private source text is not disclosed')
  assert.equal(posted.entry_id,created.id)
  const status=await finance(f,'proposals/'+pending.request_id+'/status','GET',null,memberCookie)
  assert.equal(status.status,200)
  const saved=(await status.json()).prepared
  assert.equal(saved.status,'applied')
  assert.equal(saved.entry_id,created.id)
  assert.equal(saved.homeflow_approval_id,approval)
  assert.equal(saved.ledger_changed,true)
  const proposalList=await (await finance(f,'proposals','GET',null,memberCookie)).json()
  assert.equal(proposalList.items[0].status,'applied')
  assert.equal(proposalList.items[0].homeflow_approval_id,approval)
  const household=await (await finance(f,'shared/entries','GET',null,memberCookie)).json()
  const cashRow=household.items.find(item=>item.id===created.id)
  assert.equal(cashRow.family_account_id,accountId)
  assert.equal(cashRow.payment_source_display,'本人現金')
  assert.equal(cashRow.payment_account_owner_user_id,member)
  const repeated=await call()
  assert.equal(repeated.status,200)
  assert.equal((await repeated.json()).already_applied,true)
  assert.equal(homeflowProofCalls,1,'once applied no further remote proof lookups')
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,ledger.length)
  const audit=f.DB.sqlite.prepare("SELECT * FROM family_finance_events WHERE action='finance_entry_applied'").all()
  assert.equal(audit.length,1)
  assert.equal(audit[0].actor_user_id,member)
  const sidecar=f.DB.sqlite.prepare('SELECT * FROM family_finance_applied_actions').get()
  assert.equal(sidecar.approver_user_id,owner)
  assert.equal(sidecar.actor_type,'integration')
  assert.equal(sidecar.requester_user_id,member)
  assert.equal(sidecar.entry_id,created.id)
  assert.throws(()=>f.DB.sqlite.prepare('DELETE FROM family_finance_applied_actions').run(),/APPLIED_RESULT_IMMUTABLE/)
 }finally{f.DB.sqlite.close()}
})
test('ledger + receipt + actor audit roll back together on failed result journaling',async()=>{
 const f=await setup()
 try{
  const memberCookie=await loginMemberAfterOwner(f)
  const accountId=(await (await finance(f,'accounts','POST',{
   label:'新现金',account_kind:'cash'
  },memberCookie)).json()).account_id
  const pending=(await (await finance(f,'proposals','POST',{
   idempotency_key:'rollback-cash-posting-00001',account_id:accountId,
   type:'income',amount_jpy:8000,date:'2026-11-13',
   merchant:'家族补贴',category:'生活'
  },memberCookie)).json()).prepared
  const approval='66666666-6666-4666-8666-666666666666'
  f.DB.sqlite.prepare("UPDATE family_finance_pending_actions SET state='submitted',homeflow_approval_id=?,submitted_at=? WHERE request_id=?")
   .run(approval,Date.now(),pending.request_id)
  f.env.APP_ENV='production'
  f.env.KAKEIBO_FAMILY_EXECUTION_ENABLED='true'
  f.env.KAKEIBO_APPROVAL_PROOF_ENABLED='true'
  const secret='c'.repeat(64)
  f.env.KAKEIBO_APPROVAL_VERIFICATION_SECRET=secret
  const orig=f.env.HOMEFLOW_IDENTITY_SERVICE.fetch
  f.env.HOMEFLOW_IDENTITY_SERVICE.fetch=async req=>{
   if(new URL(req.url).pathname!=='/api/internal/approvals/verify')
    return orig(req)
   return Response.json({ok:true,verified:true,request_id:approval,
    resource_id:pending.request_id,household_id:'primary',
    requester_user_id:member,approver_user_id:owner,
    payload_sha256:pending.payload_sha256,idempotency_key:'kakeibo:finance:'+pending.request_id,
    expected_version:null,execution_status:'executing',execution_authorized:true,
    applied:false,approved_at:Date.now()-1000,expires_at:Date.now()+3600000})
  }
  const submit=()=>{const body=JSON.stringify({
   request_id:approval,resource_id:pending.request_id,household_id:'primary',
   requester_user_id:member,payload_sha256:pending.payload_sha256,
   execution_nonce:'e'.repeat(64)})
   const timestamp=String(Date.now())
   const signature=createHmac('sha256',Buffer.from(secret,'hex'))
    .update('homeflow\n'+timestamp+'\n'+body).digest('hex')
   return approvedActionRoute(new Request(app+'/api/internal/approved-actions/execute',{
    method:'POST',headers:{'content-type':'application/json','x-approval-client':'homeflow',
     'x-approval-timestamp':timestamp,'x-approval-signature':signature},body
   }),f.env,['execute'])}
  const before=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all()
  f.DB.sqlite.exec("CREATE TRIGGER inject_audit_fail BEFORE INSERT ON family_finance_applied_actions BEGIN SELECT RAISE(ABORT,'FAULT_INJECTED'); END")
  assert.equal((await submit()).status,503)
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),before,
   'failed result journal must never strand a financial entry')
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_applied_actions').get().n,0)
  f.DB.sqlite.exec('DROP TRIGGER inject_audit_fail')
  const fixed=await submit()
  assert.equal(fixed.status,200,await fixed.clone().text())
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM entries').get().n,before.length+1)
  assert.equal((await submit()).status,200)
  assert.equal(f.DB.sqlite.prepare("SELECT COUNT(*) n FROM family_finance_events WHERE action='finance_entry_applied'").get().n,1)
 }finally{f.DB.sqlite.close()}
})


test('yearly family statistics are identical for spouses and exclude asset transfers from net spending',async()=>{
 const f=await setup();
 try{
  f.DB.sqlite.exec(`INSERT INTO entries(id,date,time,type,merchant,amount,category,note,payment_source,transfer_applied)
    VALUES
     (3,'2026-01-15','','expense','便利店',400,'食品','','nanaco',0),
     (4,'2026-12-15','','transfer','资产转移',5000,'资产转移','','银行',1),
     (5,'2026-12-20','','income','奖励',50,'奖励','','银行',0),
     (6,'2025-12-30','','income','过去的收入',999,'工资','','银行',0),
     (7,'2027-01-01','','expense','明年的消费',2000,'食品','','nanaco',0);`);
  const before=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const read=async(token,year='2026')=>{
   const r=await finance(f,'shared/year-summary?year='+year,'GET',null,token);
   return {status:r.status,body:await r.json()};
  };
  const a=await read(ownerCookie),b=await read(memberCookie);
  assert.equal(a.status,200,JSON.stringify(a.body));
  assert.deepEqual(a,b,'household statistics must not vary by account ownership');
  assert.equal(a.body.ledger_scope,'household');
  assert.equal(a.body.complete,true);
  assert.equal(a.body.ledger_changed,false);
  assert.equal(a.body.totals.income,100050);
  assert.equal(a.body.totals.expense,1634);
  assert.equal(a.body.totals.transfer,5000);
  assert.equal(a.body.net_income_expense,98416);
  assert.equal(a.body.counts.transfer,1);
  assert.equal(a.body.months.length,12);
  assert.equal(a.body.months[0].month,'2026-01');
  assert.equal(a.body.months[0].totals.expense,400);
  assert.equal(a.body.months[10].totals.expense,1234);
  assert.equal(a.body.months[10].totals.income,100000);
  assert.equal(a.body.months[11].totals.transfer,5000);
  assert.deepEqual(a.body.categories.filter(x=>x.type==='expense')
   .map(x=>[x.category,x.amount]),[['生活',1234],['食品',400]]);
  assert.deepEqual(a.body.payment_sources.filter(x=>x.type==='expense')
   .map(x=>[x.payment_source,x.amount]),[['PayPay Visa',1234],['nanaco',400]]);
  assert.equal((await read(memberCookie,'2025')).body.totals.income,999);
  assert.equal((await read(memberCookie,'2027')).body.totals.expense,2000);
  assert.equal((await read(memberCookie,'2026-11')).status,400);
  assert.equal((await read(memberCookie,'1999')).status,400);
  assert.equal((await read(memberCookie,'abc')).status,400);
  assert.equal((await read('')).status,401);
  // A legacy row with a new/unknown type must trigger review, not vanish
  // from the household statement while complete=true is being claimed.
  f.DB.sqlite.prepare('INSERT INTO entries(id,date,type,amount,category) VALUES(?,?,?,?,?)')
   .run(8,'2026-03-01','adjustment',42,'待核验');
  const unexpected=await read(memberCookie);
  assert.equal(unexpected.status,409);
  assert.equal(unexpected.body.code,'LEDGER_TYPE_UNSUPPORTED');
  f.DB.sqlite.prepare('DELETE FROM entries WHERE id=?').run(8);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),before,
   'yearly statistics must not modify ledger or source records');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n,0,
   'ordinary family statistics GET must not write actor audit');
 }finally{f.DB.sqlite.close();}
});

test('Stage C account writes reject an old HomeFlow actor after PWA cookie switch',async()=>{
 const f=await setup();
 try{
  const oldEntries=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const beforeAccounts=f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n;
  const beforeEvents=f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n;
  const draft={label:'我的备用现金',account_kind:'cash'};
  const crossed=await finance(f,'accounts','POST',
   {...draft,expected_user_id:owner},memberCookie);
  assert.equal(crossed.status,403,await crossed.clone().text());
  assert.equal((await crossed.json()).code,'ACTOR_CHANGED');
  assert.equal((await finance(f,'accounts','POST',
   {...draft,expected_user_id:undefined},memberCookie)).status,403);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_financial_accounts').get().n,
   beforeAccounts);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n,
   beforeEvents);
  const created=await finance(f,'accounts','POST',draft,memberCookie);
  assert.equal(created.status,201,await created.clone().text());
  const id=(await created.json()).account_id;
  const ownerBefore=f.DB.sqlite.prepare('SELECT version,label,owner_user_id FROM family_financial_accounts WHERE account_id=?').get(id);
  assert.equal(ownerBefore.owner_user_id,member);
  assert.equal(ownerBefore.version,1);
  const failed=await finance(f,'accounts/'+id,'PATCH',
   {label:'错号更新',version:1,expected_user_id:owner},memberCookie);
  assert.equal(failed.status,403);
  assert.equal((await failed.json()).code,'ACTOR_CHANGED');
  assert.equal((await finance(f,'accounts/'+id,'PATCH',
   {label:'无原始用户',version:1,expected_user_id:undefined},memberCookie)).status,403);
  assert.equal(f.DB.sqlite.prepare('SELECT version,label FROM family_financial_accounts WHERE account_id=?').get(id).label,
   draft.label);
  const changed=await finance(f,'accounts/'+id,'PATCH',{label:'本人现金',version:1},memberCookie);
  assert.equal(changed.status,200,await changed.clone().text());
  assert.equal(f.DB.sqlite.prepare('SELECT label,version FROM family_financial_accounts WHERE account_id=?').get(id).label,'本人现金');
  const staleCookie=await finance(f,'accounts/'+id,'PATCH',
   {label:'切号后保存',version:2,expected_user_id:member},ownerCookie);
  assert.equal(staleCookie.status,403);
  assert.equal(f.DB.sqlite.prepare('SELECT label,version FROM family_financial_accounts WHERE account_id=?').get(id).version,2);
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_events').get().n,
   beforeEvents+2,'only the valid create and edit receive actor audit rows');
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),oldEntries,
   'account setup never edits household ledger');
 }finally{f.DB.sqlite.close();}
});


test('member finance prepare/submit/cancel/proof rejects a stale originating HomeFlow actor before D1 effects',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  const created=await finance(f,'accounts','POST',{
   label:'本人の現金',account_kind:'cash'
  },memberCookie);
  assert.equal(created.status,201,await created.clone().text());
  const accountId=(await created.json()).account_id;
  const record={idempotency_key:'original-member-epoch-test-0001',
   account_id:accountId,type:'expense',amount_jpy:1520,
   date:'2026-11-14',merchant:'マクドナルド',category:'食費'};
  const untouchedLedger=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const oldAudit=f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all();
  const badPrepare=await finance(f,'proposals','POST',
   {...record,expected_user_id:owner},memberCookie);
  assert.equal(badPrepare.status,403);
  assert.equal((await badPrepare.json()).code,'ACTOR_CHANGED');
  const missingPrepare=await finance(f,'proposals','POST',
   {...record,expected_user_id:undefined},memberCookie);
  assert.equal(missingPrepare.status,403);
  assert.equal((await missingPrepare.json()).code,'ACTOR_CHANGED');
  assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) n FROM family_finance_pending_actions').get().n,0);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all(),oldAudit);

  const prepared=await finance(f,'proposals','POST',record,memberCookie);
  assert.equal(prepared.status,201,await prepared.clone().text());
  const proposalId=(await prepared.json()).prepared.request_id;
  const receipt=f.DB.sqlite.prepare(
   'SELECT state,homeflow_approval_id FROM family_finance_pending_actions WHERE request_id=?'
  ).get(proposalId);
  const auditNow=f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all();

  f.env.APP_ENV='production';
  f.env.KAKEIBO_APPROVAL_SUBMISSION_ENABLED='true';
  f.env.KAKEIBO_APPROVAL_PROOF_ENABLED='true';
  f.env.KAKEIBO_APPROVAL_VERIFICATION_SECRET='c'.repeat(64);
  const badSubmit=await finance(f,'proposals/'+proposalId+'/submit','POST',
   {expected_user_id:owner},memberCookie);
  assert.equal(badSubmit.status,403);
  assert.equal((await badSubmit.json()).code,'ACTOR_CHANGED');
  const missingSubmit=await finance(f,'proposals/'+proposalId+'/submit','POST',
   {expected_user_id:undefined},memberCookie);
  assert.equal(missingSubmit.status,403);
  const badProof=await finance(f,'proposals/'+proposalId+'/approval-proof','POST',
   {homeflow_request_id:'33333333-3333-4333-8333-333333333333',
    expected_user_id:owner},memberCookie);
  assert.equal(badProof.status,403);
  assert.equal((await badProof.json()).code,'ACTOR_CHANGED');
  const badCancel=await finance(f,'proposals/'+proposalId+'/cancel','POST',
   {expected_user_id:owner},memberCookie);
  assert.equal(badCancel.status,403);
  assert.equal((await badCancel.json()).code,'ACTOR_CHANGED');
  const missingCancel=await finance(f,'proposals/'+proposalId+'/cancel','POST',
   {expected_user_id:undefined},memberCookie);
  assert.equal(missingCancel.status,403);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT state,homeflow_approval_id FROM family_finance_pending_actions WHERE request_id=?').get(proposalId),receipt);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all(),auditNow);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),untouchedLedger);
  // Original member can still withdraw the exact same prepared request.
  const cancelled=await finance(f,'proposals/'+proposalId+'/cancel','POST',{},memberCookie);
  assert.equal(cancelled.status,200,await cancelled.clone().text());
  assert.equal((await finance(f,'proposals','GET',null,ownerCookie)).status,403);
 }finally{f.DB.sqlite.close()}
});


test('legacy stable-account coverage audits old payment and transfer names without altering original ledger',async()=>{
 const f=await setup();
 try{
  const ownerCookie=await loginOwner(f);
  const memberCookie=await loginMember(f);
  // Display labels need not be unique between members. Never infer a
  // legacy financial owner from a same-named member-created account.
  const memberAccount=await finance(f,'accounts','POST',
   {label:'PayPay Visa',account_kind:'credit_card'},memberCookie);
  assert.equal(memberAccount.status,201,await memberAccount.clone().text());
  const wrongAccountId=(await memberAccount.json()).account_id;
  f.DB.sqlite.prepare(
   "INSERT INTO entries(date,type,merchant,amount,category,note,payment_source,transfer_target,transfer_applied) "+
   "VALUES('2026-11-14','transfer','内部资金移动',800,'转移','原业务保留','PayPay Visa','nanaco',0)"
  ).run();
  const entriesBefore=f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all();
  const sourcesBefore=f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all();
  const auditBefore=f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all();
  assert.equal((await finance(f,'legacy/mapping-audit','GET',null,memberCookie)).status,403,
   'only the verified original HomeFlow owner may inspect old payment identity');
  const first=await finance(f,'legacy/mapping-audit','GET',null,ownerCookie);
  assert.equal(first.status,200,await first.clone().text());
  const before=await first.json();
  assert.equal(before.read_only,true);
  assert.equal(before.ledger_changed,false);
  assert.equal(before.requires_manual_review,true);
  const card=before.items.find(x=>x.legacy_name==='PayPay Visa');
  assert.equal(card.status,'legacy_account_not_adopted');
  assert.equal(card.entry_source_count,2);
  assert.equal(card.stable_account_id,null);
  const prepaid=before.items.find(x=>x.legacy_name==='nanaco');
  assert.equal(prepaid.transfer_target_count,1);
  const unmatched=before.items.find(x=>x.legacy_name==='银行');
  assert.equal(unmatched.status,'historical_source_missing');
  assert.equal(unmatched.stable_account_id,null);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM family_finance_events ORDER BY event_id').all(),auditBefore,
   'audit reads must not append a fake financial actor event');

  const adopt=await finance(f,'legacy/adopt','POST',{confirm:true},ownerCookie);
  assert.equal(adopt.status,200,await adopt.clone().text());
  const after=(await (await finance(f,'legacy/mapping-audit','GET',null,ownerCookie)).json());
  assert.equal(after.mapped_source_count,2);
  const mapped=after.items.find(x=>x.legacy_name==='PayPay Visa');
  assert.equal(mapped.status,'adopted_to_original_owner');
  assert.notEqual(mapped.stable_account_id,wrongAccountId,
   'a member account with identical label must never inherit the original owner ledger');
  const ownerStable=f.DB.sqlite.prepare(
   "SELECT account_id FROM family_financial_accounts WHERE origin='legacy' AND legacy_source_name='PayPay Visa'"
  ).get();
  assert.equal(mapped.stable_account_id,ownerStable.account_id);
  assert.equal(after.items.find(x=>x.legacy_name==='银行').status,'historical_source_missing');
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM entries ORDER BY id').all(),entriesBefore);
  assert.deepEqual(f.DB.sqlite.prepare('SELECT * FROM payment_sources ORDER BY name').all(),sourcesBefore);
  assert.equal((await finance(f,'legacy/mapping-audit','POST',{},ownerCookie)).status,405,
   'mapping audit is not an implicit write action');
 }finally{f.DB.sqlite.close()}
});
