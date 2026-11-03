// Optional authenticated, read-only smoke check against a deployed Pages preview.
// Never run against production, never print the access token or a session key.
// Usage: PREVIEW_BASE_URL=https://<preview>.kakeibo-f17.pages.dev
//        PREVIEW_AUTH_TOKEN=<dedicated preview code> npm run test:preview
const origin=process.env.PREVIEW_BASE_URL
const token=process.env.PREVIEW_AUTH_TOKEN
if(!origin || !token){console.error('Set PREVIEW_BASE_URL and PREVIEW_AUTH_TOKEN (preview-only)');process.exit(2)}
const u=new URL(origin)
if(u.protocol!=='https:' || !u.hostname.endsWith('.kakeibo-f17.pages.dev') ||
  u.hostname==='kakeibo-f17.pages.dev' || u.username || u.password || u.pathname!=='/' ||
  u.search || u.hash) throw Error('Refusing non-preview URL')
async function api(path,options={}){
  return fetch(new URL(path,u.origin),{...options,redirect:'error',signal:AbortSignal.timeout(12000),headers:{
    'Content-Type':'application/json',...(options.headers||{})
  }})
}
let session=''
try{
  const protectedWrite=await api('/api/entries',{method:'POST',body:'{}'})
  if(protectedWrite.status!==403)throw Error('Preview write guard should deny unauthenticated POST (HTTP '+protectedWrite.status+')')
  const login=await api('/api/auth/login',{method:'POST',body:JSON.stringify({code:token,remember:false})})
  if(!login.ok)throw Error('Preview login failed with HTTP '+login.status)
  const result=await login.json()
  session=result.session
  if(!/^[a-f0-9]{64}$/.test(session||''))throw Error('No valid preview session')
  const listing=await api('/api/recurring-plans',{headers:{'x-session':session}})
  if(!listing.ok)throw Error('Authenticated read-only preview GET returned '+listing.status)
  const denied=await api('/api/recurring-plans',{method:'POST',headers:{'x-session':session},body:'{}'})
  if(denied.status!==403)throw Error('Authenticated Preview financial write was not blocked: '+denied.status)
  console.log('Preview QA PASS: separate login, authorized GET, unauthenticated and authenticated writes denied')
}catch(error){console.error('Preview QA FAIL:',error?.message||String(error));process.exitCode=1}
finally{
  if(session)try{await api('/api/auth/logout',{method:'POST',headers:{'x-session':session},body:'{}'})}catch{}
}
