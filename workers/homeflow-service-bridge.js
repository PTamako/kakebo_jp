// Internal-only, read-only D1 projection for HomeFlow via Cloudflare Service Binding.
// SECURITY: deploy with workers_dev=false, preview_urls=false and no public routes.
// Only HomeFlow's owner-authenticated Worker may bind this service.
// No INSERT/UPDATE/DELETE, no full ledger export, no OCR/raw notes or credentials.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
}})
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
  !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&
  new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
const project=e=>({id:e.id,date:e.date,amount:e.amount,
  category:e.category,merchant:e.merchant||'',type:e.type})

async function envSafeSum(db,start,end){
  const row=await db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expense
    FROM entries WHERE date>=?1 AND date<=?2 AND type IN ('income','expense')`)
    .bind(start,end).first()
  const income=Number(row?.income||0),expense=Number(row?.expense||0)
  if(!Number.isSafeInteger(income)||!Number.isSafeInteger(expense))
    throw Error('invalid_sum')
  return {income,expense}
}

export async function readLedger(request,db){
  const params=new URL(request.url).searchParams
  // One aggregate query, not one query per day/entry; transfers never count
  // toward the same income-minus-expense metric displayed in kakeibo statistics.
  if(params.get('summary')==='net'){
    const start=params.get('start'),end=params.get('end')
    if(!validDate(start)||!validDate(end)||end<start||
      Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>3660*86400000)
      return json({error:'invalid_range'},400)
    try{
      const row=await envSafeSum(db,start,end)
      return json({start,end,income:row.income,expense:row.expense,net:row.income-row.expense})
    }catch{return json({error:'ledger_read_unavailable'},503)}
  }
  const ids=params.get('ids')
  if(ids!==null){
    if(!/^[1-9]\d{0,11}(,[1-9]\d{0,11}){0,49}$/.test(ids))
      return json({error:'invalid_ids'},400)
    const unique=[...new Set(ids.split(',').map(Number))]
    if(unique.length>50)return json({error:'invalid_ids'},400)
    const placeholders=unique.map((_,i)=>'?'+(i+1)).join(',')
    try{
      const {results}=await db.prepare('SELECT id,date,amount,category,merchant,type FROM entries '+
        "WHERE type='expense' AND id IN ("+placeholders+") ORDER BY date DESC,id DESC")
        .bind(...unique).all()
      return json({entries:(results||[]).map(project)})
    }catch{return json({error:'ledger_read_unavailable'},503)}
  }
  const start=params.get('start'),end=params.get('end')
  const limit=Number(params.get('limit')||'50')
  if(!validDate(start)||!validDate(end)||end<start||
    Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>90*86400000||
    !Number.isInteger(limit)||limit<1||limit>100)return json({error:'invalid_range'},400)
  const cursor=params.get('cursor')
  let cursorDate=end,cursorId=Number.MAX_SAFE_INTEGER
  if(cursor){
    const match=/^(\d{4}-\d{2}-\d{2}):([1-9]\d{0,11})$/.exec(cursor)
    if(!match||!validDate(match[1])||match[1]<start||match[1]>end)
      return json({error:'invalid_cursor'},400)
    cursorDate=match[1];cursorId=Number(match[2])
  }
  try{
    const {results}=await db.prepare('SELECT id,date,amount,category,merchant,type FROM entries '+
      "WHERE type='expense' AND date>=?1 AND date<=?2 AND "+
      "(date<?3 OR (date=?3 AND id<?4)) ORDER BY date DESC,id DESC LIMIT ?5")
      .bind(start,end,cursorDate,cursorId,limit+1).all()
    const batch=(results||[]).slice(0,limit)
    const more=(results||[]).length>limit
    return json({entries:batch.map(project),nextCursor:more&&batch.length?
      batch[batch.length-1].date+':'+batch[batch.length-1].id:null})
  }catch{return json({error:'ledger_read_unavailable'},503)}
}

export default {
  async fetch(request,env){
    if(request.method!=='GET'||new URL(request.url).pathname!=='/api/homeflow-ledger')
      return json({error:'not_found'},404)
    if(!env.DB)return json({error:'ledger_read_unavailable'},503)
    return readLedger(request,env.DB)
  }
}
