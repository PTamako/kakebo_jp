// B-stage HomeFlow Authorization Code + PKCE S256 for Cloudflare Pages.
// Deliberately separated from legacy /api/*: a new HomeFlow session grants
// ZERO ledger/asset/receipt permissions until the Stage C policy ships.
// All routes fail closed unless every production binding is explicitly enabled.
const CLIENT='kakeibo';
const MS=300_000;
const SESSION_MS=900_000;
const encoder=new TextEncoder();
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}});
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),
  x=>x.toString(16).padStart(2,'0')).join('');
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=text=>Uint8Array.from(atob(text),x=>x.charCodeAt(0));
const safeHex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const now=()=>Date.now();
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
function isOrigin(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&
   !u.username&&!u.password&&!u.hash&&!u.search;}catch{return false;}
}
function isPreview(url,env){
 const host=url.hostname.toLowerCase();
 return env.APP_ENV==='preview' ||
  (typeof env.CF_PAGES_BRANCH==='string'&&env.CF_PAGES_BRANCH!==''&&env.CF_PAGES_BRANCH!=='main')||
  (host.endsWith('.kakeibo-f17.pages.dev')&&host!=='kakeibo-f17.pages.dev');
}
export function ssoReady(env,url){
 return !isPreview(url,env) && env.KAKEIBO_HOMEFLOW_SSO_ENABLED==='true'&&
   isOrigin(env.KAKEIBO_PUBLIC_ORIGIN)&&env.KAKEIBO_PUBLIC_ORIGIN===url.origin&&
   isOrigin(env.HOMEFLOW_OAUTH_ORIGIN)&&
   typeof env.KAKEIBO_SSO_ENCRYPTION_KEY==='string'&&
   /^[0-9a-fA-F]{64}$/.test(env.KAKEIBO_SSO_ENCRYPTION_KEY)&&
   typeof env.DB?.prepare==='function'&&
   typeof env.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function';
}
async function key(env){
 const data=Uint8Array.from(env.KAKEIBO_SSO_ENCRYPTION_KEY.match(/.{2}/g),x=>parseInt(x,16));
 return crypto.subtle.importKey('raw',data,'AES-GCM',false,['encrypt','decrypt']);
}
async function seal(env,scope,value){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(scope)},
   await key(env),encoder.encode(value));
 return {cipher:b64(new Uint8Array(cipher)),iv:b64(iv)};
}
async function unseal(env,scope,cipher,iv){
 try{
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),
   additionalData:encoder.encode(scope)},await key(env),unb64(cipher));
  return new TextDecoder().decode(bytes);
 }catch{return null;}
}
function cookieValue(request,name){
 const s=request.headers.get('Cookie')||'';
 return s.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
}
async function legacySessionHash(request,db){
 const token=request.headers.get('x-session')||cookieValue(request,'kakeibo_session');
 if(!safeHex(token))return null;
 const digest=await sha(token);
 const row=await first(db,'SELECT token_hash FROM device_sessions WHERE token_hash=? AND expires_at>?',digest,now());
 return row?.token_hash===digest?digest:null;
}
function callbackUrl(env){return env.KAKEIBO_PUBLIC_ORIGIN+'/api/homeflow-sso/callback';}
async function csrfJson(request,url){
 if(request.headers.get('Origin')!==url.origin)return null;
 if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return null;
 try{const raw=await request.text();return raw.length<=2048?JSON.parse(raw):null;}catch{return null;}
}
async function begin(request,env,url){
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 if(request.headers.get('Origin')!==url.origin)return json({code:'BAD_ORIGIN'},403);
 const state=random(),resume=random(),verifier=random()+random().slice(0,24);
 const digest=await crypto.subtle.digest('SHA-256',encoder.encode(verifier));
 const challenge=b64(new Uint8Array(digest)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 const stateHash=await sha(state),sealed=await seal(env,stateHash,verifier);
 const legacy=await legacySessionHash(request,env.DB);
 await run(env.DB,'INSERT INTO homeflow_sso_pending '+
   '(state_hash,resume_hash,verifier_cipher,verifier_iv,origin,legacy_session_hash,status,expires_at,created_at) '+
   'VALUES(?,?,?,?,?,?,\'pending\',?,?)',
   stateHash,await sha(resume),sealed.cipher,sealed.iv,url.origin,legacy,now()+MS,now());
 const auth=new URL('/authorize',env.HOMEFLOW_OAUTH_ORIGIN);
 const values={response_type:'code',client_id:CLIENT,redirect_uri:callbackUrl(env),
   code_challenge:challenge,code_challenge_method:'S256',state,nonce:random()};
 for(const [k,v] of Object.entries(values))auth.searchParams.set(k,v);
 return json({ok:true,authorization_url:auth.toString(),state,
   resume_secret:resume,expires_in:300});
}
async function parkCallback(request,env,url){
 if(request.method!=='GET')return json({code:'METHOD_NOT_ALLOWED'},405);
 const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
 if(!safeHex(state)||!safeHex(code)||url.searchParams.has('error'))
   return json({code:'SSO_INVALID_CALLBACK'},403);
 const hash=await sha(state);
 const found=await first(env.DB,'SELECT state_hash FROM homeflow_sso_pending '+
   'WHERE state_hash=? AND origin=? AND status=\'pending\' AND code_cipher IS NULL AND expires_at>?',
   hash,url.origin,now());
 if(!found)return json({code:'SSO_REPLAY_OR_EXPIRED'},403);
 const sealed=await seal(env,hash,code);
 const r=await run(env.DB,'UPDATE homeflow_sso_pending SET code_cipher=?,code_iv=? '+
   'WHERE state_hash=? AND origin=? AND status=\'pending\' AND code_cipher IS NULL AND expires_at>?',
   sealed.cipher,sealed.iv,hash,url.origin,now());
 if(Number(r?.meta?.changes)!==1)return json({code:'SSO_REPLAY_OR_EXPIRED'},403);
 // Do not issue a login cookie in Safari. It is not the originating PWA.
 return new Response('<!doctype html><html lang="zh"><meta charset="utf-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>HomeFlow 授权</title><body><h1>授权已收到</h1>'+
  '<p>请返回家計簿 App，点击“完成登录”。</p></body></html>',{
   headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});
}
async function verifyHomeFlow(env,code,verifier){
 const auth=new Request(new URL('/api/oauth/token',env.HOMEFLOW_OAUTH_ORIGIN),{
  method:'POST',redirect:'manual',
  headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
  body:new URLSearchParams({grant_type:'authorization_code',client_id:CLIENT,
    redirect_uri:callbackUrl(env),code,code_verifier:verifier}).toString()});
 let tokenResponse;
 try{tokenResponse=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(auth);}catch{return null;}
 if(!tokenResponse?.ok||tokenResponse.status!==200||tokenResponse.headers.get('Location'))return null;
 const token=await tokenResponse.json().catch(()=>null);
 if(token?.token_type!=='Bearer'||!safeHex(token.access_token)||
   !Number.isInteger(token.expires_in)||token.expires_in<1||token.expires_in>180||
   !safeHex(token.session_assertion)||!Number.isInteger(token.session_assertion_expires_in)||
   token.session_assertion_expires_in<1||token.session_assertion_expires_in>900)return null;
 const userRequest=new Request(new URL('/api/oauth/userinfo',env.HOMEFLOW_OAUTH_ORIGIN),{
  method:'GET',redirect:'manual',
  headers:{Authorization:'Bearer '+token.access_token,Accept:'application/json'}});
 let userResponse;
 try{userResponse=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(userRequest);}catch{return null;}
 if(!userResponse?.ok||userResponse.status!==200||userResponse.headers.get('Location'))return null;
 const value=await userResponse.json().catch(()=>null);
 if(value?.audience!==CLIENT||value?.sub!==value?.user_id||
  typeof value?.user_id!=='string'||!/^[a-f0-9-]{32,64}$/i.test(value.user_id)||
  typeof value.household_id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.household_id)||
  !['owner','member'].includes(value.role)||
  typeof value.nickname!=='string'||!value.nickname.trim()||value.nickname.length>80)
   return null;
 return {userId:value.user_id,householdId:value.household_id,
  role:value.role,nickname:value.nickname.trim().slice(0,50),
  sessionAssertion:token.session_assertion,
  sessionAssertionSeconds:token.session_assertion_expires_in};
}
async function finish(request,env,url){
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 const data=await csrfJson(request,url);
 if(!safeHex(data?.state)||!safeHex(data?.resume_secret))
   return json({code:'SSO_INVALID_PROOF'},403);
 const stateHash=await sha(data.state);
 const pending=await first(env.DB,'SELECT * FROM homeflow_sso_pending WHERE '+
  'state_hash=? AND origin=? AND status=\'pending\' AND code_cipher IS NOT NULL AND expires_at>?',
  stateHash,url.origin,now());
 if(!pending||await sha(data.resume_secret)!==pending.resume_hash)
   return json({code:'SSO_INVALID_PROOF'},403);
 // Cross-origin callback cannot furnish the old account proof. Require the
 // exact original legacy session to be alive in this PWA at finalization.
 if(pending.legacy_session_hash!==null&&
    await legacySessionHash(request,env.DB)!==pending.legacy_session_hash)
   return json({code:'SSO_LEGACY_SESSION_EXPIRED'},403);
 const claimed=await run(env.DB,'UPDATE homeflow_sso_pending SET status=\'processing\' '+
   'WHERE state_hash=? AND status=\'pending\' AND code_cipher IS NOT NULL AND expires_at>?',
   stateHash,now());
 if(Number(claimed?.meta?.changes)!==1)return json({code:'SSO_REPLAY'},403);
 const fail=async code=>{
  await run(env.DB,'UPDATE homeflow_sso_pending SET status=\'failed\',code_cipher=NULL,code_iv=NULL,completed_at=? '+
    'WHERE state_hash=? AND status=\'processing\'',now(),stateHash).catch(()=>{});
  return json({code},403);
 };
 const verifier=await unseal(env,stateHash,pending.verifier_cipher,pending.verifier_iv);
 const code=await unseal(env,stateHash,pending.code_cipher,pending.code_iv);
 if(typeof verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||!safeHex(code))
   return fail('SSO_INVALID_STATE');
 const hf=await verifyHomeFlow(env,code,verifier);
 if(!hf)return fail('SSO_UNVERIFIED_IDENTITY');
 const db=env.DB;
 try{
  const own=await first(db,"SELECT user_id,household_id FROM homeflow_identity_links WHERE role='owner' LIMIT 1");
  const old=await first(db,'SELECT user_id,household_id,role,state FROM homeflow_identity_links WHERE user_id=?',hf.userId);
  if(own&&(own.household_id!==hf.householdId||
    (hf.role==='owner'&&own.user_id!==hf.userId)))return fail('SSO_HOUSEHOLD_CONFLICT');
  if(old&&(old.state!=='active'||old.household_id!==hf.householdId||old.role!==hf.role))
    return fail('SSO_LINK_CONFLICT');
  if(hf.role==='owner'&&!old){
   const current=await legacySessionHash(request,db);
   if(!pending.legacy_session_hash||!current||current!==pending.legacy_session_hash)
    return fail('SSO_OWNER_PROOF_REQUIRED');
  }
  if(hf.role==='member'&&!own)return fail('SSO_OWNER_FIRST');
  const stamp=now(),rawSession=random(),id=random();
  const proof=await seal(env,stateHash,hf.sessionAssertion);
  const expires=stamp+Math.min(SESSION_MS,hf.sessionAssertionSeconds*1000);
  const statements=[];
  if(!old)statements.push(db.prepare('INSERT INTO homeflow_identity_links '+
    '(user_id,household_id,role,display_name,linked_at) VALUES(?,?,?,?,?)')
    .bind(hf.userId,hf.householdId,hf.role,hf.nickname,stamp));
  else statements.push(db.prepare("UPDATE homeflow_identity_links SET display_name=? "+
    "WHERE user_id=? AND household_id=? AND role=? AND state='active'")
    .bind(hf.nickname,hf.userId,hf.householdId,hf.role));
  statements.push(db.prepare('INSERT INTO homeflow_sso_sessions '+
   '(token_hash,user_id,proof_cipher,proof_iv,proof_scope,expires_at,created_at) VALUES(?,?,?,?,?,?,?)')
   .bind(await sha(rawSession),hf.userId,proof.cipher,proof.iv,stateHash,expires,stamp));
  statements.push(db.prepare('INSERT INTO homeflow_identity_events '+
   '(id,actor_user_id,event,created_at) VALUES(?,?,?,?)')
   .bind(id,hf.userId,old?'sso_login':'account_linked',stamp));
  statements.push(db.prepare('UPDATE homeflow_sso_pending SET '+
   'status=\'consumed\',completed_at=?,code_cipher=NULL,code_iv=NULL '+
   'WHERE state_hash=? AND status=\'processing\'')
   .bind(stamp,stateHash));
  await db.batch(statements);
  return json({ok:true,user_id:hf.userId,household_id:hf.householdId,
    role:hf.role,display_name:hf.nickname,ledger_access:false},200,{
    'Set-Cookie':'__Host-kakeibo_hf='+rawSession+
      '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=900'});
 }catch{return fail('SSO_IDENTITY_WRITE_REJECTED');}
}
async function currentUser(request,env){
 const secret=cookieValue(request,'__Host-kakeibo_hf');
 if(!safeHex(secret))return json({code:'SSO_NOT_AUTHENTICATED'},401);
 const row=await first(env.DB,"SELECT l.user_id,l.household_id,l.role,l.display_name, "+
  "s.proof_cipher,s.proof_iv,s.proof_scope "+
  "FROM homeflow_sso_sessions s JOIN homeflow_identity_links l ON s.user_id=l.user_id "+
  "WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND l.state='active'",
  await sha(secret),now());
 if(!row)return json({code:'SSO_NOT_AUTHENTICATED'},401);
 const proof=await unseal(env,row.proof_scope,row.proof_cipher,row.proof_iv);
 if(!safeHex(proof))return json({code:'SSO_NOT_AUTHENTICATED'},401);
 const requestToHomeflow=new Request(new URL('/api/oauth/session-introspect',env.HOMEFLOW_OAUTH_ORIGIN),{
  method:'POST',redirect:'manual',
  headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},
  body:new URLSearchParams({client_id:CLIENT,session_assertion:proof}).toString()
 });
 let result;
 try{result=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(requestToHomeflow);}
 catch{return json({code:'SSO_NOT_AUTHENTICATED'},401);}
 if(result?.status!==200||!result.ok||result.headers.get('Location'))
  return json({code:'SSO_NOT_AUTHENTICATED'},401);
 const live=await result.json().catch(()=>null);
 if(live?.active!==true||live.audience!==CLIENT||live.sub!==live.user_id||
    live.user_id!==row.user_id||live.household_id!==row.household_id||
    live.role!==row.role||!['owner','member'].includes(live.role)||
    typeof live.nickname!=='string'||!live.nickname.trim()||live.nickname.length>80)
   return json({code:'SSO_NOT_AUTHENTICATED'},401);
 // An identity-only response cannot grant access to legacy ledger endpoints.
 const identity={user_id:row.user_id,household_id:row.household_id,
   role:row.role,display_name:live.nickname.trim().slice(0,50)};
 return json({ok:true,identity,ledger_access:false,requires_stage_c:true});
}
async function logout(request,env,url){
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 if(request.headers.get('Origin')!==url.origin)return json({code:'BAD_ORIGIN'},403);
 const secret=cookieValue(request,'__Host-kakeibo_hf');
 if(safeHex(secret)){
  const digest=await sha(secret),stamp=now();
  const row=await first(env.DB,'SELECT user_id FROM homeflow_sso_sessions WHERE token_hash=?',digest);
  if(row)await env.DB.batch([
   env.DB.prepare('UPDATE homeflow_sso_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(stamp,digest),
   env.DB.prepare('INSERT INTO homeflow_identity_events(id,actor_user_id,event,created_at) VALUES(?,?,\'sso_logout\',?)')
     .bind(random(),row.user_id,stamp)
  ]).catch(()=>{});
 }
 return json({ok:true},200,{'Set-Cookie':'__Host-kakeibo_hf=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'});
}
export async function onRequest({request,env,params}){
 const url=new URL(request.url),action=(params.path||[])[0];
 if(action==='status'&&request.method==='GET')
  return json({enabled:ssoReady(env,url),ledger_access:false});
 if(!ssoReady(env,url))return json({code:'SSO_DISABLED'},503);
 try{
  if(action==='start')return begin(request,env,url);
  if(action==='callback')return parkCallback(request,env,url);
  if(action==='complete')return finish(request,env,url);
  if(action==='me'&&request.method==='GET')return currentUser(request,env);
  if(action==='logout')return logout(request,env,url);
  return json({code:'NOT_FOUND'},404);
 }catch{return json({code:'SSO_INTERNAL_ERROR'},503);}
}
