// Stage C: safely attach legacy resource ownership to the VERIFIED
// original HomeFlow owner without moving or rewriting old business rows.
// Recurring fixed fees, SBI plans/history/holdings and saved card-bill
// snapshots remain in their original tables, unchanged.
const json=(v,status=200)=>Response.json(v,{status,headers:{
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'
}});
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),
 b=>b.toString(16).padStart(2,'0')).join('');
const kinds=Object.freeze({
 recurring_plan:"SELECT legacy_key FROM (SELECT id AS legacy_key FROM recurring_plans) WHERE legacy_key>? ORDER BY legacy_key LIMIT 51",
 investment_plan:"SELECT legacy_key FROM (SELECT fund_code||':'||account_type AS legacy_key FROM investment_plans) WHERE legacy_key>? ORDER BY legacy_key LIMIT 51",
 investment_plan_history:"SELECT legacy_key FROM (SELECT fund_code||':'||account_type||':'||effective_month AS legacy_key FROM investment_plan_history) WHERE legacy_key>? ORDER BY legacy_key LIMIT 51",
 investment_holding:"SELECT legacy_key FROM (SELECT fund_code||':'||account_type AS legacy_key FROM investment_holdings) WHERE legacy_key>? ORDER BY legacy_key LIMIT 51",
 card_bill:"SELECT legacy_key FROM (SELECT payment_source||':'||bill_month AS legacy_key FROM card_bills) WHERE legacy_key>? ORDER BY legacy_key LIMIT 51"
});
function validCursor(value){
 return typeof value==='string'&&value.length<=240&&
  !/[\u0000-\u001f]/.test(value);
}
async function inputBody(req,url){
 if(req.headers.get('origin')!==url.origin||
  !(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
  return null;
 try{
  const raw=await req.text();
  const value=raw.length<=2000?JSON.parse(raw):null;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
 }catch{return null;}
}
export async function familyLegacyResourceOwners(request,env,url,user){
 const db=env.DB;
 if(request.method==='GET'){
  const rows=(await db.prepare('SELECT resource_kind,owner_user_id,COUNT(*) AS mapped_count FROM family_financial_resource_owners WHERE household_id=? GROUP BY resource_kind,owner_user_id ORDER BY resource_kind,owner_user_id')
   .bind(user.household_id).all()).results||[];
  return json({ok:true,household_id:user.household_id,
   items:rows,ledger_changed:false});
 }
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 if(user.role!=='owner')return json({code:'OWNER_REQUIRED'},403);
 const body=await inputBody(request,url);
 if(!body)return json({code:'BAD_ORIGIN_OR_BODY'},403);
 if(body.expected_user_id!==user.user_id)return json({code:'ACTOR_CHANGED'},403);
 if(body.confirm!==true||!Object.hasOwn(kinds,body.resource_kind)||
  Object.keys(body).some(k=>!['expected_user_id','confirm','resource_kind','cursor'].includes(k))||
  (body.cursor!==undefined&&body.cursor!==null&&!validCursor(body.cursor)))
  return json({code:'EXPLICIT_OWNER_CONFIRMATION_REQUIRED'},403);
 const kind=body.resource_kind,cursor=body.cursor||'';
 const linked=await db.prepare("SELECT user_id FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='owner' AND state='active'")
   .bind(user.user_id,user.household_id).first();
 if(!linked)return json({code:'OWNER_LINK_NOT_VERIFIED'},403);
 try{
  // A bounded 50-row page prevents unbounded D1 write batches or concurrent
  // worker timeouts. No client-supplied SQL, resource IDs or owners.
  const source=(await db.prepare(kinds[kind]).bind(cursor).all()).results||[];
  if(source.length===0)return json({ok:true,resource_kind:kind,owner_user_id:user.user_id,
   mapped:0,already_mapped:0,next_cursor:null,has_more:false,
   ledger_changed:false});
  const selected=source.slice(0,50);
  const names=selected.map(x=>x.legacy_key);
  if(names.some(k=>typeof k!=='string'||k.length<1||k.length>240)||
   new Set(names).size!==names.length)
   return json({code:'LEGACY_RESOURCE_KEY_REVIEW_REQUIRED'},409);
  const existing=(await db.prepare(
   'SELECT legacy_key,household_id,owner_user_id FROM family_financial_resource_owners '+
   'WHERE resource_kind=? AND legacy_key IN ('+names.map(()=>'?').join(',')+')')
   .bind(kind,...names).all()).results||[];
  if(existing.some(x=>x.household_id!==user.household_id||
   x.owner_user_id!==user.user_id))
   return json({code:'LEGACY_RESOURCE_OWNER_CONFLICT'},409);
  const known=new Set(existing.map(x=>x.legacy_key));
  const fresh=names.filter(x=>!known.has(x));
  if(fresh.length){
   const stamp=new Date().toISOString();
   const ops=fresh.map(key=>db.prepare(
    'INSERT INTO family_financial_resource_owners '+
    '(resource_kind,legacy_key,household_id,owner_user_id,assigned_by_user_id,assigned_at) '+
    'VALUES(?,?,?,?,?,?)')
    .bind(kind,key,user.household_id,user.user_id,user.user_id,stamp));
   ops.push(db.prepare('INSERT INTO family_finance_events '+
     '(event_id,household_id,actor_user_id,resource_id,action,created_at) '+
     "VALUES(?,?,?,?,'legacy_resource_owners_adopted',?)")
     .bind(id(),user.household_id,user.user_id,'legacy:'+kind,stamp));
   // A concurrent adopter must not leave half an assignment or a fake audit
   // event; SQLite batch transactions roll back on any unique-key conflict.
   const output=await db.batch(ops);
   if(output.some(x=>x.meta?.changes!==1))
    return json({code:'LEGACY_RESOURCE_RETRY_REQUIRED'},409);
  }
  const hasMore=source.length>50;
  return json({ok:true,resource_kind:kind,
   owner_user_id:user.user_id,mapped:fresh.length,
   already_mapped:known.size,next_cursor:hasMore?names.at(-1):null,
   has_more:hasMore,ledger_changed:false});
 }catch{return json({code:'LEGACY_RESOURCE_RETRY_REQUIRED'},409)}
}
