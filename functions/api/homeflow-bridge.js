// Read-only, explicitly authorized HomeFlow bridge. Does not share kakeibo sessions.
// No D1 schema changes, no writes, no raw OCR or private notes are returned.
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
  'x-content-type-options':'nosniff','x-robots-tag':'noindex'}
const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers})
const validDate=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
  const x=new Date(value+'T00:00:00Z')
  return !Number.isNaN(x.getTime()) && x.toISOString().slice(0,10)===value
}
async function secretMatches(given,expected){
  if(typeof given!=='string'||typeof expected!=='string'||given.length<32||expected.length<32||
    given.length>256||expected.length>256)return false
  const enc=new TextEncoder()
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(given)),
    crypto.subtle.digest('SHA-256',enc.encode(expected))])
  const aa=new Uint8Array(a),bb=new Uint8Array(b)
  let diff=0
  for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i]
  return diff===0
}
export async function onRequestGet({request,env}){
  const uri=new URL(request.url)
  // Preview is always locked out, regardless of the API secret.
  const hostname=uri.hostname.toLowerCase()
  if(env.APP_ENV==='preview'||(typeof env.CF_PAGES_BRANCH==='string'&&env.CF_PAGES_BRANCH&&env.CF_PAGES_BRANCH!=='main')||
    hostname!=='kakeibo-f17.pages.dev')
      return reply({error:'preview_disabled'},403)
  const secret=env.HOMEFLOW_BRIDGE_TOKEN
  if(typeof secret!=='string'||secret.length<32)return reply({error:'integration_not_configured'},503)
  const supplied=request.headers.get('x-homeflow-bridge-token')
  if(!await secretMatches(supplied,secret))return reply({error:'not_authorized'},401)
  const from=uri.searchParams.get('from'),to=uri.searchParams.get('to')
  if(!validDate(from)||!validDate(to)||from>to)return reply({error:'invalid_date_range'},400)
  const days=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000
  if(days>31)return reply({error:'date_range_too_large'},400)
  if(!env.DB?.prepare)return reply({error:'database_unavailable'},503)
  try{
    const {results=[]}=await env.DB.prepare(`SELECT id,date,amount,category,merchant
      FROM entries WHERE date>=?1 AND date<=?2 AND type='expense'
      ORDER BY date,id LIMIT 200`).bind(from,to).all()
    return reply({from,to,items:results.map(x=>({id:x.id,date:x.date,amount:x.amount,
      category:x.category,merchant:x.merchant})),truncated:results.length===200})
  }catch{return reply({error:'database_unavailable'},503)}
}
