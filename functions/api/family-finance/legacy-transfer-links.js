// Stage C: dual-account stable-ID linkage of original owner TRANSFERS.
// Disabled by default, no transfer execution and no balance calculation.
// Only the already-authorized legacy owner can explicitly attach BOTH IDs.
const json=(x,status=200)=>Response.json(x,{status,headers:{
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'
}})
const id=/^[a-f0-9]{32}$/
const digestRe=/^[a-f0-9]{64}$/
const enc=new TextEncoder()
async function sha(raw){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(raw))),
  x=>x.toString(16).padStart(2,'0')).join('')
}
function enabled(env){
 return env.APP_ENV==='production'&&env.KAKEIBO_LEGACY_TRANSFER_LINKS_ENABLED==='true'&&
  typeof env.DB?.prepare==='function'
}
async function originalOwner(env,user){
 if(user?.role!=='owner'||!user.user_id||!user.household_id)return false
 return !!await env.DB.prepare(
  "SELECT 1 FROM homeflow_identity_links WHERE user_id=? AND household_id=? "+
  "AND role='owner' AND state='active'"
 ).bind(user.user_id,user.household_id).first()
}
// Both text names must still exist as legacy sources, be individually
// adopted by the SAME proven original owner, and be distinct. A similarly
// named member-created account is never eligible.
const from=" FROM entries e "+
 "JOIN payment_sources ps ON ps.name=e.payment_source "+
 "JOIN payment_sources pt ON pt.name=e.transfer_target "+
 "JOIN family_financial_accounts sa ON sa.legacy_source_name=e.payment_source "+
 "AND sa.origin='legacy' AND sa.household_id=? AND sa.owner_user_id=? "+
 "JOIN family_financial_accounts ta ON ta.legacy_source_name=e.transfer_target "+
 "AND ta.origin='legacy' AND ta.household_id=? AND ta.owner_user_id=? "+
 "WHERE e.type='transfer' AND e.family_account_id IS NULL "+
 "AND e.family_transfer_target_account_id IS NULL "+
 "AND e.payment_source<>e.transfer_target "+
 "AND trim(e.payment_source)<>'' AND trim(e.transfer_target)<>'' "
const selection="SELECT e.*,sa.account_id AS _source_id,ta.account_id AS _target_id,"+
 "sa.label AS _source_label,ta.label AS _target_label "
const queryArgs=user=>[user.household_id,user.user_id,user.household_id,user.user_id]
function snapshot(row){
 const keys=Object.keys(row).filter(k=>!k.startsWith('_')).sort()
 if(keys.length>72||!keys.includes('id')||
  !keys.includes('family_account_id')||
  !keys.includes('family_transfer_target_account_id')||
  !keys.includes('transfer_target')||!keys.includes('payment_source')||
  keys.some(k=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)))return null
 const pairs=keys.map(k=>[k,row[k]])
 if(pairs.some(([_,v])=>v!==null&&typeof v!=='string'&&
  !(typeof v==='number'&&Number.isFinite(v))))return null
 return {keys,raw:JSON.stringify([pairs,row._source_id,row._target_id])}
}
async function preview(row){
 const snap=snapshot(row)
 if(!snap||!Number.isSafeInteger(Number(row.id))||Number(row.id)<1||
  !id.test(row._source_id)||!id.test(row._target_id)||
  row._source_id===row._target_id||row.type!=='transfer'||
  row.payment_source===row.transfer_target||
  !Number.isSafeInteger(Number(row.amount))||Number(row.amount)<0)return null
 return {entry_id:Number(row.id),
  source_account_id:row._source_id,target_account_id:row._target_id,
  original_source:row.payment_source,original_target:row.transfer_target,
  source_label:row._source_label,target_label:row._target_label,
  amount_jpy:Number(row.amount),date:row.date,
  transfer_applied:Number(row.transfer_applied||0),
  source_digest:await sha(snap.raw)}
}
async function parse(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
  return null
 try{
  const raw=await req.text(),v=raw.length<=768?JSON.parse(raw):null
  return v&&typeof v==='object'&&!Array.isArray(v)?v:null
 }catch{return null}
}
export async function legacyTransferLinks(req,env,url,user){
 if(!enabled(env))return json({code:'LEGACY_TRANSFER_LINKS_DISABLED'},503)
 if(!await originalOwner(env,user))return json({code:'OWNER_REQUIRED'},403)
 const db=env.DB
 if(req.method==='GET'){
  const cursor=url.searchParams.get('after_id')||'0'
  if(!/^(0|[1-9]\d{0,11})$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))
   return json({code:'INVALID_CURSOR'},400)
  const rows=(await db.prepare(selection+from+
   'AND e.id>? ORDER BY e.id LIMIT 6')
   .bind(...queryArgs(user),Number(cursor)).all()).results||[]
  const items=[]
  for(const row of rows.slice(0,5)){
   const planned=await preview(row)
   if(!planned)return json({code:'LEGACY_TRANSFER_REVIEW_REQUIRED'},409)
   items.push(planned)
  }
  return json({ok:true,household_id:user.household_id,
   read_only:true,financial_values_changed:false,
   requires_explicit_confirmation:true,
   next_after_id:rows.length>5?items.at(-1).entry_id:null,items})
 }
 if(req.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405)
 const body=await parse(req,url)
 if(!body)return json({code:'BAD_ORIGIN_OR_BODY'},403)
 if(body.expected_user_id!==user.user_id)return json({code:'ACTOR_CHANGED'},403)
 if(Object.keys(body).length!==6||body.confirm!==true||
  !Number.isSafeInteger(body.entry_id)||body.entry_id<1||
  !id.test(body.source_account_id)||!id.test(body.target_account_id)||
  body.source_account_id===body.target_account_id||
  !digestRe.test(body.source_digest))
  return json({code:'INVALID_LINK_CONFIRMATION'},400)
 const old=await db.prepare('SELECT * FROM family_finance_legacy_transfer_links '+
  'WHERE entry_id=?').bind(body.entry_id).first()
 if(old){
  const linked=await db.prepare('SELECT family_account_id,family_transfer_target_account_id '+
   'FROM entries WHERE id=?').bind(body.entry_id).first()
  return old.actor_user_id===user.user_id&&old.household_id===user.household_id&&
   old.source_account_id===body.source_account_id&&
   old.target_account_id===body.target_account_id&&
   old.source_digest===body.source_digest&&
   linked?.family_account_id===body.source_account_id&&
   linked?.family_transfer_target_account_id===body.target_account_id
   ?json({ok:true,linked:true,already_linked:true,entry_id:body.entry_id,
     source_account_id:body.source_account_id,
     target_account_id:body.target_account_id,financial_values_changed:false})
   :json({code:'LEGACY_TRANSFER_LINK_CONFLICT'},409)
 }
 const row=await db.prepare(selection+from+'AND e.id=? LIMIT 1')
  .bind(...queryArgs(user),body.entry_id).first()
 if(!row)return json({code:'LEGACY_TRANSFER_NOT_ELIGIBLE'},409)
 const planned=await preview(row)
 if(!planned||planned.source_account_id!==body.source_account_id||
  planned.target_account_id!==body.target_account_id||
  planned.source_digest!==body.source_digest)
  return json({code:'LEGACY_TRANSFER_CHANGED_REVIEW_AGAIN'},409)
 const snap=snapshot(row)
 if(!snap)return json({code:'LEGACY_TRANSFER_REVIEW_REQUIRED'},409)
 const columns=snap.keys.filter(k=>!['id','family_account_id',
  'family_transfer_target_account_id'].includes(k))
 const conditions=columns.map(k=>'"'+k+'" IS ?').join(' AND ')
 const ownership="EXISTS(SELECT 1 FROM family_financial_accounts a "+
  "JOIN family_financial_accounts b ON b.legacy_source_name=? "+
  "AND b.account_id=? AND b.origin='legacy' "+
  "AND b.household_id=? AND b.owner_user_id=? "+
  "JOIN homeflow_identity_links l ON l.user_id=a.owner_user_id "+
  "AND l.household_id=a.household_id AND l.role='owner' AND l.state='active' "+
  "WHERE a.account_id=? AND a.legacy_source_name=? AND a.origin='legacy' "+
  "AND a.household_id=? AND a.owner_user_id=?)"
 const update='UPDATE entries SET family_account_id=?,'+
  'family_transfer_target_account_id=? WHERE id=? '+
  'AND family_account_id IS NULL AND family_transfer_target_account_id IS NULL '+
  'AND type=\'transfer\' AND '+conditions+' AND '+ownership
 const now=Date.now()
 try{
  const changed=await db.batch([
   db.prepare(update).bind(
    body.source_account_id,body.target_account_id,body.entry_id,
    ...columns.map(k=>row[k]),
    row.transfer_target,body.target_account_id,user.household_id,user.user_id,
    body.source_account_id,row.payment_source,user.household_id,user.user_id),
   db.prepare('INSERT INTO family_finance_legacy_transfer_links '+
    '(entry_id,household_id,actor_user_id,source_account_id,target_account_id,'+
    'source_name,target_name,source_digest,linked_at) '+
    'SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1').bind(
     body.entry_id,user.household_id,user.user_id,body.source_account_id,
     body.target_account_id,row.payment_source,row.transfer_target,
     body.source_digest,now)
  ])
  if(changed.length!==2||changed.some(x=>x.meta?.changes!==1))
   return json({code:'LEGACY_TRANSFER_CHANGED_REVIEW_AGAIN'},409)
  return json({ok:true,linked:true,already_linked:false,entry_id:body.entry_id,
   source_account_id:body.source_account_id,
   target_account_id:body.target_account_id,financial_values_changed:false})
 }catch{
  // Races and audit failures must not create a half-linked transfer.
  const receipt=await db.prepare('SELECT * FROM family_finance_legacy_transfer_links '+
   'WHERE entry_id=?').bind(body.entry_id).first().catch(()=>null)
  const linked=await db.prepare('SELECT family_account_id,family_transfer_target_account_id '+
   'FROM entries WHERE id=?').bind(body.entry_id).first().catch(()=>null)
  if(receipt?.household_id===user.household_id&&receipt?.actor_user_id===user.user_id&&
   receipt?.source_account_id===body.source_account_id&&
   receipt?.target_account_id===body.target_account_id&&
   receipt?.source_digest===body.source_digest&&
   linked?.family_account_id===body.source_account_id&&
   linked?.family_transfer_target_account_id===body.target_account_id)
   return json({ok:true,linked:true,already_linked:true,entry_id:body.entry_id,
    source_account_id:body.source_account_id,target_account_id:body.target_account_id,
    financial_values_changed:false})
  return json({code:'LEGACY_TRANSFER_TRANSACTION_RETRY'},503)
 }
}
