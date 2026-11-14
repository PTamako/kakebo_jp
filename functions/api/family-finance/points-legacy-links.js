// P0-4A: original-owner confirmed HISTORICAL points evidence, never mint units.
// An existing immutable 0027 source ID proof is mandatory before this endpoint
// can attach exactly one old entry to one new stable owner points account.
// Default OFF, no legacy entries UPDATE, no point journal or cash mutation.
const kinds=new Set(['earn','spend','topup','card_offset','sbi_point','other']);
const id=/^[a-f0-9]{32}$/i,hex=/^[a-f0-9]{64}$/i;
const json=(body,status=200)=>Response.json(body,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false,points_minted:false},status);
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&
 Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const encoder=new TextEncoder();
async function digest(v){
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(v)))]
  .map(b=>b.toString(16).padStart(2,'0')).join('');
}
const sourceFrom=' FROM entries e JOIN family_finance_legacy_entry_links l '+
 'ON l.entry_id=e.id AND l.household_id=? AND l.actor_user_id=? '+
 'JOIN family_financial_accounts legacy ON legacy.account_id=l.account_id '+
 'AND legacy.origin=\'legacy\' AND legacy.account_kind=\'points\' '+
 'AND legacy.household_id=l.household_id AND legacy.owner_user_id=l.actor_user_id '+
 'WHERE e.family_account_id=l.account_id AND e.type IN (\'income\',\'expense\') '+
 'AND e.payment_source=legacy.legacy_source_name '+
 'AND NOT EXISTS(SELECT 1 FROM family_points_legacy_links x WHERE x.legacy_entry_id=e.id) '+
 'AND NOT EXISTS(SELECT 1 FROM family_points_journal p '+
  'WHERE p.linked_entry_id=e.id OR p.legacy_entry_id=e.id) ';
const sourceSelect='SELECT e.*,l.account_id AS _legacy_account_id,'+
 'l.source_digest AS _legacy_source_digest,legacy.legacy_source_name AS _legacy_source_name'+sourceFrom;
function snapshot(row){
 if(!row||!Number.isSafeInteger(row.id)||row.id<=0||
  !id.test(row._legacy_account_id||'')||!hex.test(row._legacy_source_digest||'')||
  row.payment_source!==row._legacy_source_name||
  !['income','expense'].includes(row.type)||!Number.isSafeInteger(row.amount)||
  row.amount<0||row.amount>1000000000)return null;
 const cols=Object.keys(row).filter(k=>!k.startsWith('_')).sort();
 if(cols.length>64||!cols.includes('id')||!cols.includes('payment_source')||
  cols.some(k=>!/^[a-z_][a-z0-9_]*$/i.test(k)))return null;
 const values=cols.map(k=>row[k]);
 if(values.some(v=>v!==null&&!['string','number'].includes(typeof v)))return null;
 return {cols,values,raw:JSON.stringify([cols.map((k,i)=>[k,values[i]]),
  row._legacy_account_id,row._legacy_source_digest])};
}
async function eligible(db,user,entryId=null,after=0){
 const query=sourceSelect+(entryId===null?'AND e.id>? ORDER BY e.id LIMIT 6':'AND e.id=? LIMIT 1');
 const args=[user.household_id,user.user_id,entryId===null?after:entryId];
 return entryId===null?(await db.prepare(query).bind(...args).all()).results||[]:
  await db.prepare(query).bind(...args).first();
}
async function ownerVerified(db,user){
 if(user?.role!=='owner'||!user.user_id||!user.household_id)return false;
 return !!await db.prepare('SELECT user_id FROM homeflow_identity_links WHERE user_id=? '+
  "AND household_id=? AND role='owner' AND state='active'")
  .bind(user.user_id,user.household_id).first();
}
export async function familyPointsLegacyLinks(request,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_POINTS_LEGACY_LINKS_ENABLED!=='true'||!env.DB?.prepare)
  return fail('POINTS_LEGACY_LINKS_DISABLED',503);
 if(!await ownerVerified(env.DB,user))return fail('OWNER_PROOF_REQUIRED',403);
 const db=env.DB;
 if(request.method==='GET'){
  const cursor=url.searchParams.get('after_id')||'0';
  if(!/^(0|[1-9][0-9]{0,11})$/.test(cursor)||!Number.isSafeInteger(Number(cursor)))
   return fail('INVALID_CURSOR',400);
  const rows=await eligible(db,user,null,Number(cursor));
  const items=[];
  for(const row of rows.slice(0,5)){
   const ss=snapshot(row);if(!ss)return fail('POINTS_LEGACY_SNAPSHOT_REVIEW',409);
   items.push({entry_id:row.id,type:row.type,date:row.date,amount_jpy:row.amount,
    category:row.category,original_points_source_account_id:row._legacy_account_id,
    source_digest:await digest(ss.raw)});
  }
  return json({ok:true,read_only:true,ledger_changed:false,points_minted:false,
   items,next_after_id:rows.length>5?items.at(-1).entry_id:null,
   requires_explicit_confirmation:true});
 }
 if(request.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('origin')!==url.origin||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return fail('BAD_ORIGIN_OR_BODY',403);
 let body;try{const raw=await request.text();body=raw.length<=1024?JSON.parse(raw):null}
 catch{return fail('INVALID_BODY',400)}
 if(body?.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 if(!exact(body,['expected_user_id','entry_id','points_account_id','legacy_kind',
   'source_digest','confirm'])||body.confirm!==true||
  !Number.isSafeInteger(body.entry_id)||body.entry_id<=0||
  !id.test(body.points_account_id)||!hex.test(body.source_digest)||
  !kinds.has(body.legacy_kind))return fail('INVALID_CONFIRMATION',400);
 const existing=await db.prepare('SELECT p.points_account_id,p.legacy_kind,'+
  'v.source_digest,v.owner_user_id FROM family_points_legacy_links p '+
  'LEFT JOIN family_points_legacy_provenance v ON v.legacy_entry_id=p.legacy_entry_id '+
  'WHERE p.legacy_entry_id=?').bind(body.entry_id).first();
 if(existing)return existing.owner_user_id===user.user_id&&
   existing.points_account_id===body.points_account_id&&
   existing.legacy_kind===body.legacy_kind&&existing.source_digest===body.source_digest?
   json({ok:true,linked:true,already_linked:true,points_minted:false,ledger_changed:false}):
   fail('POINTS_LEGACY_ALREADY_LINKED');
 const account=await db.prepare('SELECT account_id FROM family_financial_accounts '+
  'WHERE account_id=? AND household_id=? AND owner_user_id=? '+
  "AND account_kind='points' AND origin='member_created' AND opening_balance=0 AND is_archived=0")
  .bind(body.points_account_id,user.household_id,user.user_id).first();
 if(!account)return fail('POINTS_LEGACY_TARGET_OWNER_INVALID');
 const row=await eligible(db,user,body.entry_id);
 const ss=snapshot(row);
 if(!ss||await digest(ss.raw)!==body.source_digest)
  return fail('POINTS_LEGACY_SOURCE_CHANGED');
 const at=Date.now();
 const immutableMatch=ss.cols.map(k=>'e."'+k+'" IS ?').join(' AND ');
 try{
  const result=await db.batch([
   db.prepare('INSERT INTO family_points_legacy_links '+
    '(legacy_entry_id,household_id,owner_user_id,points_account_id,legacy_kind,'+
    'reviewed_by_user_id,reviewed_at) SELECT ?,?,?,?,?,?,? FROM entries e '+
    'WHERE e.id=? AND '+immutableMatch+' AND EXISTS ('+
    'SELECT 1 FROM family_finance_legacy_entry_links proof '+
    'JOIN family_financial_accounts old ON old.account_id=proof.account_id '+
    'WHERE proof.entry_id=e.id AND proof.household_id=? AND proof.actor_user_id=? '+
    "AND old.origin='legacy' AND old.account_kind='points' "+ 
    'AND old.owner_user_id=? AND old.household_id=? '+
    'AND e.family_account_id=old.account_id AND e.payment_source=old.legacy_source_name)')
    .bind(body.entry_id,user.household_id,user.user_id,body.points_account_id,
     body.legacy_kind,user.user_id,at,body.entry_id,...ss.values,
     user.household_id,user.user_id,user.user_id,user.household_id),
   db.prepare('INSERT INTO family_points_legacy_provenance '+
    '(legacy_entry_id,household_id,owner_user_id,source_account_id,'+
    'points_account_id,source_digest,original_amount_jpy,original_type,legacy_kind,reviewed_at) '+
    'SELECT ?,?,?,?,?,?,?,?,?,? WHERE changes()=1')
    .bind(body.entry_id,user.household_id,user.user_id,row._legacy_account_id,
     body.points_account_id,body.source_digest,row.amount,row.type,body.legacy_kind,at)
  ]);
  if(result.length!==2||result.some(x=>x.meta?.changes!==1))
   return fail('POINTS_LEGACY_LINK_CONFLICT');
  return json({ok:true,linked:true,already_linked:false,points_minted:false,
   ledger_changed:false,entry_id:body.entry_id,points_account_id:body.points_account_id},201);
 }catch{
  const same=await db.prepare('SELECT p.points_account_id,p.legacy_kind,'+
   'v.source_digest,v.owner_user_id FROM family_points_legacy_links p '+
   'JOIN family_points_legacy_provenance v ON v.legacy_entry_id=p.legacy_entry_id '+
   'WHERE p.legacy_entry_id=?').bind(body.entry_id).first().catch(()=>null);
  if(same?.points_account_id===body.points_account_id&&
   same?.legacy_kind===body.legacy_kind&&same?.owner_user_id===user.user_id&&
   same?.source_digest===body.source_digest)
   return json({ok:true,linked:true,already_linked:true,points_minted:false,ledger_changed:false});
  return fail('POINTS_LEGACY_LINK_TRANSACTION_FAILED',503);
 }
}
