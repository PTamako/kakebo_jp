import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import {onRequest,ssoReady} from '../functions/api/homeflow-sso/[[path]].js';
import {onRequest as legacyApi} from '../functions/api/[[path]].js';
import {onRequest as familyFinance} from '../functions/api/family-finance/[[path]].js';
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
 sqlite.exec("CREATE TABLE entries (id INTEGER PRIMARY KEY,date TEXT,time TEXT,type TEXT,merchant TEXT,amount INTEGER,category TEXT,note TEXT,payment_source TEXT,transfer_target TEXT,transfer_applied INTEGER,transfer_date TEXT);"+
   "INSERT INTO entries VALUES(1,'2026-11-10','','expense','既存の個人明細',1234,'生活','旧账保留','PayPay Visa',NULL,0,NULL);"+
   "INSERT INTO entries VALUES(2,'2026-11-10','','income','工资到账',100000,'工资','工资保留','银行',NULL,0,NULL);"+
   "CREATE TABLE payment_sources(name TEXT PRIMARY KEY,sort_order INTEGER,is_default INTEGER,closing_day INTEGER,source_type TEXT,stat_group TEXT,is_archived INTEGER,opening_balance INTEGER,opening_date TEXT);"+
   "INSERT INTO payment_sources VALUES('PayPay Visa',0,1,15,'standard','card',0,15000,'2026-11-01');"+
   "INSERT INTO payment_sources VALUES('nanaco',1,0,NULL,'prepaid','card',0,2400,'2026-11-01')");
 sqlite.exec("ALTER TABLE payment_sources ADD COLUMN opening_entry_id INTEGER NOT NULL DEFAULT 0;"+
  "ALTER TABLE entries ADD COLUMN client_request_id TEXT;"+
  "CREATE TABLE investment_plans(fund_code TEXT,account_type TEXT,fund_name TEXT,monthly_amount INTEGER,order_day INTEGER,enabled INTEGER);"+
  "CREATE TABLE investment_plan_history(fund_code TEXT,account_type TEXT,fund_name TEXT,monthly_amount INTEGER,order_day INTEGER,enabled INTEGER,effective_month TEXT,updated_at TEXT);"+
  "CREATE TABLE investment_holdings(fund_code TEXT,account_type TEXT,fund_name TEXT,units INTEGER,acquisition_cost INTEGER,reported_value INTEGER,reported_at TEXT,updated_at TEXT);"+
  "CREATE TABLE fund_prices(fund_code TEXT,nav_per_10000 INTEGER,price_date TEXT,source TEXT,updated_at TEXT);"+
  "CREATE TABLE sbi_transfer_links(entry_id INTEGER,purchase_month TEXT,purpose TEXT);"+
  "CREATE TABLE card_bills(payment_source TEXT,bill_month TEXT,period_start TEXT,period_end TEXT,total_amount INTEGER,transaction_count INTEGER);"+
  "INSERT INTO investment_holdings VALUES('ABC12345','tsumitate','SBI 投資信託',10000,18000,NULL,NULL,CURRENT_TIMESTAMP);"+
  "INSERT INTO fund_prices VALUES('ABC12345',20000,'2026-11-12','official',CURRENT_TIMESTAMP);"+
  "INSERT INTO card_bills VALUES('PayPay Visa','2026-11','2026-11-01','2026-11-30',1234,1)");
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
 return res.headers.get('set-cookie').match(/__Host-kakeibo_hf=([a-f0-9]{64})/)[1];
}
async function loginMember(f){
 f.state.user=member;f.state.role='member';f.state.nickname='鸡毛';
 const flow=await f.start(false);
 assert.equal((await f.callback(flow)).status,200);
 const res=await f.complete(flow);
 assert.equal(res.status,200);
 return res.headers.get('set-cookie').match(/__Host-kakeibo_hf=([a-f0-9]{64})/)[1];
}
function finance(f,path,method='GET',body,secret='',origin=app){
 const headers={};
 if(secret)headers.Cookie='__Host-kakeibo_hf='+secret;
 if(!['GET','HEAD'].includes(method)){headers.Origin=origin;headers['content-type']='application/json';}
 return familyFinance({env:f.env,
  request:new Request(app+'/api/family-finance/'+path,{method,headers,
   body:method==='GET'?undefined:JSON.stringify(body??{})}),
  params:{path:path.split('/')}});
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
