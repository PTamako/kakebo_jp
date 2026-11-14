// Stage C, default OFF: original-owner explicit link of ONE historical
// income/expense row to its already verified legacy stable account ID.
// Do NOT migrate transfer rows: a transfer has two financial directions and
// requires a separate accounting contract. No amount/category/source editing.
const json=(v,status=200)=>Response.json(v,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff'
}})
const digestPattern=/^[a-f0-9]{64}$/
const accountPattern=/^[a-f0-9]{32}$/
const encoder=new TextEncoder()
async function digest(input){
 const bytes=await crypto.subtle.digest('SHA-256',encoder.encode(input))
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')
}
function enabled(env){
 return env.APP_ENV==='production'&&env.KAKEIBO_LEGACY_ENTRY_LINKS_ENABLED==='true'&&
  typeof env.DB?.prepare==='function'
}
async function verifiedOwner(db,user){
 if(user?.role!=='owner'||!user.user_id||!user.household_id)return false
 return !!await db.prepare(
  "SELECT user_id FROM homeflow_identity_links WHERE user_id=? "+
  "AND household_id=? AND role='owner' AND state='active'"
 ).bind(user.user_id,user.household_id).first()
}
// No guessed label ownership. Account origin and current owner must be
// proven BEFORE the first legacy entry is eligible for a link.
const eligibleRow=" FROM entries e JOIN payment_sources s ON s.name=e.payment_source "+
 "JOIN family_financial_accounts a ON a.legacy_source_name=e.payment_source "+
 "AND a.origin='legacy' AND a.household_id=? AND a.owner_user_id=? "+
 "WHERE e.family_account_id IS NULL AND e.type IN ('income','expense') "+
 "AND e.payment_source IS NOT NULL AND trim(e.payment_source)<>'' "
function snapshot(row){
 const columns=Object.keys(row).filter(k=>!k.startsWith('_')).sort()
 // Schema drift, unexpected column identifiers and binary payloads fail
 // closed rather than produce a guessed ownership/partial update.
 if(!columns.includes('id')||!columns.includes('family_account_id')||
  !columns.includes('payment_source')||columns.length>64||
  columns.some(k=>!/^[a-z][a-z0-9_]*$/i.test(k)))return null
 const values=columns.map(k=>{
  const v=row[k]
  return [k,(typeof v==='string'||typeof v==='number'||v===null)?v:null]
 })
 if(values.some(([k,v])=>v===null&&row[k]!==null))return null
 return {columns,raw:JSON.stringify([values,row._account_id,row._source_name])}
}
async function planRow(row){
 const data=snapshot(row)
 if(!data||!Number.isSafeInteger(Number(row.id))||Number(row.id)<1||
  !accountPattern.test(row._account_id)||row.payment_source!==row._source_name)
  return null
 return {
  entry_id:Number(row.id),account_id:row._account_id,account_label:row._label,
  original_source:row.payment_source,type:row.type,date:row.date,
  amount_jpy:Number(row.amount),category:row.category,
  source_digest:await digest(data.raw)
 }
}
async function bodyOf(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return null
 try{
  const raw=await req.text()
  const body=raw.length<=640?JSON.parse(raw):null
  return body&&typeof body==='object'&&!Array.isArray(body)?body:null
 }catch{return null}
}
export async function legacyEntryLinks(req,env,url,user){
 if(!enabled(env))return json({code:'LEGACY_ENTRY_LINKS_DISABLED'},503)
 if(!await verifiedOwner(env.DB,user))return json({code:'OWNER_REQUIRED'},403)
 const db=env.DB
 if(req.method==='GET'){
  const raw=url.searchParams.get('after_id')||'0'
  if(!/^(0|[1-9]\d{0,11})$/.test(raw)||Number(raw)>Number.MAX_SAFE_INTEGER)
   return json({code:'INVALID_CURSOR'},400)
  const after=Number(raw)
  const result=await db.prepare(
   'SELECT e.*,a.account_id AS _account_id,a.legacy_source_name AS _source_name,'+
   'a.label AS _label'+eligibleRow+'AND e.id>? ORDER BY e.id LIMIT 6'
  ).bind(user.household_id,user.user_id,after).all()
  const rows=result.results||[]
  const items=[]
  for(const row of rows.slice(0,5)){
   const item=await planRow(row)
   if(!item)return json({code:'LEGACY_ROW_REVIEW_REQUIRED'},409)
   items.push(item)
  }
  return json({ok:true,read_only:true,financial_values_changed:false,
   items,next_after_id:rows.length>5?items.at(-1).entry_id:null,
   household_id:user.household_id,
   requires_explicit_confirmation:true})
 }
 if(req.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405)
 const body=await bodyOf(req,url)
 if(!body)return json({code:'BAD_ORIGIN_OR_BODY'},403)
 if(body.expected_user_id!==user.user_id)return json({code:'ACTOR_CHANGED'},403)
 if(Object.keys(body).length!==5||body.confirm!==true||
  !Number.isSafeInteger(body.entry_id)||body.entry_id<1||
  !accountPattern.test(body.account_id)||!digestPattern.test(body.source_digest))
  return json({code:'INVALID_LINK_CONFIRMATION'},400)
 const previous=await db.prepare('SELECT * FROM family_finance_legacy_entry_links '+
  'WHERE entry_id=?').bind(body.entry_id).first()
 if(previous){
  const current=await db.prepare('SELECT family_account_id FROM entries WHERE id=?')
   .bind(body.entry_id).first()
  if(previous.household_id===user.household_id&&
    previous.actor_user_id===user.user_id&&
    previous.account_id===body.account_id&&
    previous.source_digest===body.source_digest&&
    current?.family_account_id===body.account_id)
   return json({ok:true,entry_id:body.entry_id,account_id:body.account_id,
    already_linked:true,linked:true,financial_values_changed:false})
  return json({code:'LEGACY_LINK_CONFLICT'},409)
 }
 const row=await db.prepare(
  'SELECT e.*,a.account_id AS _account_id,a.legacy_source_name AS _source_name,'+
  'a.label AS _label'+eligibleRow+'AND e.id=? LIMIT 1'
 ).bind(user.household_id,user.user_id,body.entry_id).first()
 if(!row)return json({code:'LEGACY_ENTRY_NOT_ELIGIBLE'},409)
 const planned=await planRow(row)
 if(!planned||planned.account_id!==body.account_id||
  planned.source_digest!==body.source_digest)
  return json({code:'LEGACY_ENTRY_CHANGED_REVIEW_AGAIN'},409)
 const original=snapshot(row)
 if(!original)return json({code:'LEGACY_ROW_REVIEW_REQUIRED'},409)
 const fields=original.columns.filter(k=>k!=='id'&&k!=='family_account_id')
 // Compare ALL original entry columns at the SQL write point. An edit made
 // after the preflight must cause zero changed rows, not a stale link.
 const conditions=fields.map(k=>'"'+k+'" IS ?').join(' AND ')
 const update='UPDATE entries SET family_account_id=? WHERE id=? '+
  'AND family_account_id IS NULL AND '+conditions+
  ' AND EXISTS(SELECT 1 FROM family_financial_accounts a '+
  'JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id '+
  "AND l.household_id=a.household_id AND l.role='owner' AND l.state='active' "+
  "WHERE a.account_id=? AND a.origin='legacy' AND a.legacy_source_name=? "+
  'AND a.household_id=? AND a.owner_user_id=?)'
 const updatedAt=Date.now()
 try{
  const results=await db.batch([
   db.prepare(update).bind(body.account_id,body.entry_id,
    ...fields.map(k=>row[k]),body.account_id,row.payment_source,
    user.household_id,user.user_id),
   db.prepare('INSERT INTO family_finance_legacy_entry_links '+
    '(entry_id,household_id,actor_user_id,account_id,original_source,source_digest,linked_at) '+
    'SELECT ?,?,?,?,?,?,? WHERE changes()=1')
    .bind(body.entry_id,user.household_id,user.user_id,body.account_id,
     row.payment_source,body.source_digest,updatedAt)
  ])
  if(results.length!==2||results.some(x=>x.meta?.changes!==1))
   return json({code:'LEGACY_ENTRY_CHANGED_REVIEW_AGAIN'},409)
  return json({ok:true,entry_id:body.entry_id,account_id:body.account_id,
   linked:true,already_linked:false,financial_values_changed:false})
 }catch{
  // Batch is atomic; an audit collision must NOT leave an unjournaled link.
  const raced=await db.prepare('SELECT * FROM family_finance_legacy_entry_links '+
   'WHERE entry_id=?').bind(body.entry_id).first().catch(()=>null)
  const linked=await db.prepare('SELECT family_account_id FROM entries WHERE id=?')
   .bind(body.entry_id).first().catch(()=>null)
  return raced&&raced.actor_user_id===user.user_id&&
   raced.household_id===user.household_id&&
   raced.account_id===body.account_id&&raced.source_digest===body.source_digest&&
   linked?.family_account_id===body.account_id
   ?json({ok:true,entry_id:body.entry_id,account_id:body.account_id,
     linked:true,already_linked:true,financial_values_changed:false})
   :json({code:'LEGACY_LINK_TRANSACTION_FAILED'},503)
 }
}
