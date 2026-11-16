// Fail-closed PWA handoff: OAuth code/PKCE stays in the trusted original app.
// No OAuth secret or cookie is placed in Safari's navigation URL.
export function validateKakeiboHomeflowAuthorizationUrl(raw,state,appOrigin){
 const fail=()=>{throw Error('HomeFlow 授权链接验证失败')}
 if(typeof raw!=='string'||typeof appOrigin!=='string'||!/^https:\/\//.test(raw)||
   !/^[a-f0-9]{64}$/.test(state||''))fail()
 let target,callback,app
 try{
  target=new URL(raw);app=new URL(appOrigin);
  callback=new URL(target.searchParams.get('redirect_uri')||'')
 }catch{fail()}
 if(app.origin!==appOrigin||app.protocol!=='https:'||
  target.protocol!=='https:'||target.username||target.password||
  target.hash||target.pathname!=='/authorize'||
  target.searchParams.get('response_type')!=='code'||
  target.searchParams.get('client_id')!=='kakeibo'||
  target.searchParams.get('redirect_uri')!==appOrigin+'/api/homeflow-sso/callback'||
  callback.href!==appOrigin+'/api/homeflow-sso/callback'||
  target.searchParams.get('state')!==state||
  target.searchParams.get('code_challenge_method')!=='S256'||
  !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('code_challenge')||'')||
  !/^[a-f0-9]{64}$/.test(target.searchParams.get('nonce')||'')||
  target.searchParams.size!==7)fail()
 return target
}
