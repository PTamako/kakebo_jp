// Separate, fail-closed server-to-server read-only projection for HomeFlow.
// Uses a dedicated secret, NEVER the kakeibo user login code or session.
// NO mutation, NO raw OCR/notes/payment credentials, NO CORS.
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Authorization'
}})
const enc=new TextEncoder()
const validDate=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&
  !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
export const validLedgerToken=(authorization,secret)=> {
  if(typeof secret!=='string'||secret.length<32||typeof authorization!=='string')return null
  const match=/^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(authorization)
  return match?match[1]:null
}
async function secureEqual(a,b){
  const [left,right]=await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(a)),crypto.subtle.digest('SHA-256',enc.encode(b))])
  const x=new Uint8Array(left),y=new Uint8Array(right)
  let diff=0
  for(let i=0;i<x.length;i++)diff|=x[i]^y[i]
  return diff===0
}
const serialize=e=>({id:e.id,date:e.date,amount:e.amount,
  category:e.category,merchant:e.merchant||'',type:e.type})
export async function onRequestGet({request,env}){
  const token=env.HOMEFLOW_LEDGER_READ_TOKEN
  if(typeof token!=='string'||token.length<32)return json({error:'integration_disabled'},503)
  const submitted=validLedgerToken(request.headers.get('authorization'),token)
  if(!submitted||!await secureEqual(submitted,token))return json({error:'not_authorized'},401)
  const params=new URL(request.url).searchParams
  const ids=params.get('ids')
  if(ids!==null){
    if(!/^[1-9]\d{0,11}(,[1-9]\d{0,11}){0,49}$/.test(ids))
      return json({error:'invalid_ids'},400)
    const unique=[...new Set(ids.split(',').map(Number))]
    if(unique.length>50)return json({error:'invalid_ids'},400)
    const placeholders=unique.map((_,i)=>'?'+(i+1)).join(',')
    try{
      const {results}=await env.DB.prepare('SELECT id,date,amount,category,merchant,type FROM entries '+
        "WHERE type='expense' AND id IN ("+placeholders+") ORDER BY date DESC,id DESC")
        .bind(...unique).all()
      return json({entries:(results||[]).map(serialize)})
    }catch{return json({error:'ledger_read_unavailable'},503)}
  }
  const start=params.get('start'),end=params.get('end')
  const limit=Number(params.get('limit')||'50')
  if(!validDate(start)||!validDate(end)||end<start||
    (Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))>90*86400000||
    !Number.isInteger(limit)||limit<1||limit>100)return json({error:'invalid_range'},400)
  const cursor=params.get('cursor')
  let cursorDate=end,cursorId=9007199254740991
  if(cursor){
    const match=/^(\d{4}-\d\d-\d\d):([1-9]\d{0,11})$/.exec(cursor)
    if(!match||!validDate(match[1])||match[1]<start||match[1]>end)return json({error:'invalid_cursor'},400)
    cursorDate=match[1];cursorId=Number(match[2])
  }
  try{
    const {results}=await env.DB.prepare('SELECT id,date,amount,category,merchant,type FROM entries '+
      "WHERE type='expense' AND date>=?1 AND date<=?2 AND "+
      "(date<?3 OR (date=?3 AND id<?4)) ORDER BY date DESC,id DESC LIMIT ?5")
      .bind(start,end,cursorDate,cursorId,limit+1).all()
    const batch=(results||[]).slice(0,limit)
    const more=(results||[]).length>limit
    return json({entries:batch.map(serialize),nextCursor:more&&batch.length?
      batch[batch.length-1].date+':'+batch[batch.length-1].id:null})
  }catch{return json({error:'ledger_read_unavailable'},503)}
}
export async function onRequest(ctx){return ctx.request.method==='GET'?onRequestGet(ctx):json({error:'method_not_allowed'},405)}
