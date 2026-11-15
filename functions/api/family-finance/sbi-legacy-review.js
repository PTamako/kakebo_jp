// 0046 DRAFT: a reviewed legacy screenshot is evidence-only, NOT a verified trade duplicate.
// Never import into investment_holdings, change NAV, or add cash/points lot into total assets.
const id=/^[a-f0-9]{32}$/i,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hex=/^[a-f0-9]{64}$/i;
const dbtable={cash:'family_sbi_cash_lots',points:'family_sbi_point_lots'};
const json=(x,status=200)=>Response.json(x,{status,headers:{
 'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code,read_only:true,ledger_changed:false,
 broker_reconciled:false,valuation_changed:false},status);
const digest=async(x)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x))))]
 .map(a=>a.toString(16).padStart(2,'0')).join('');
const uid=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const lotSnap=r=>[
 r.homeflow_request_id,r.household_id,r.owner_user_id,r.securities_account_id,
 r.fund_code,r.account_type,r.confirmed_units,r.acquisition_cost_jpy,
 r.trade_date,r.broker_reference_hash];
const holdingSnap=r=>[
 r.fund_code,r.account_type,r.fund_name,r.units,r.acquisition_cost,
 r.reported_value,r.reported_at,r.updated_at];
async function ownerProof(db,u){
 if(u?.role!=='owner'||!u.user_id||!u.household_id)return false;
 return !!await db.prepare('SELECT user_id FROM homeflow_identity_links WHERE user_id=? '+
  "AND household_id=? AND role='owner' AND state='active'")
  .bind(u.user_id,u.household_id).first();
}
async function lot(db,u,kind,requestId){
 if(!Object.hasOwn(dbtable,kind)||!uuid.test(requestId||''))return null;
 const t=dbtable[kind];
 const row=await db.prepare('SELECT l.* FROM '+t+' l '+
  'JOIN family_financial_accounts s ON s.account_id=l.securities_account_id '+
  'WHERE l.homeflow_request_id=? AND l.household_id=? AND l.owner_user_id=? '+
  "AND s.household_id=? AND s.owner_user_id=? AND s.origin='member_created' "+
  "AND s.account_kind='securities' AND s.opening_balance=0 AND s.is_archived=0 LIMIT 1")
  .bind(requestId,u.household_id,u.user_id,u.household_id,u.user_id).first();
 if(kind==='cash'&&row){
  const revoked=await db.prepare('SELECT original_request_id FROM family_sbi_cash_reversals WHERE original_request_id=?')
   .bind(requestId).first();
  if(revoked)return null;
 }
 return row;
}
async function holding(db,u,source){
 if(!source||!id.test(source.securities_account_id||'')||
  !/^[A-Z0-9]{8}$/.test(source.fund_code||'')||
  !['growth','tsumitate'].includes(source.account_type))return null;
 return db.prepare('SELECT h.* FROM investment_holdings h '+
  'JOIN family_financial_resource_owners o ON o.resource_kind=? '+
  "AND o.legacy_key=(h.fund_code||':'||h.account_type) "+
  'AND o.household_id=? AND o.owner_user_id=? AND o.assigned_by_user_id=? '+
  'WHERE h.fund_code=? AND h.account_type=? LIMIT 1')
  .bind('investment_holding',u.household_id,u.user_id,u.user_id,
   source.fund_code,source.account_type).first();
}
async function originalReview(db,u,kind,requestId){
 return db.prepare('SELECT * FROM family_sbi_legacy_holding_candidates '+
  'WHERE household_id=? AND owner_user_id=? AND lot_type=? AND lot_homeflow_request_id=? LIMIT 1')
  .bind(u.household_id,u.user_id,kind,requestId).first();
}
async function candidate(db,u,kind,requestId){
 const s=await lot(db,u,kind,requestId);
 if(!s)return null;
 const h=await holding(db,u,s);
 const link=await originalReview(db,u,kind,requestId);
 return {lot:s,legacy:h,linked:link,
  lot_digest:await digest(lotSnap(s)),
  legacy_snapshot_digest:h?await digest(holdingSnap(h)):null};
}
export async function familySbiLegacyReview(request,env,url,user){
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  env.KAKEIBO_SBI_LEGACY_REVIEW_ENABLED!=='true'||!env.DB?.prepare)
  return fail('SBI_REVIEW_DISABLED',503);
 const db=env.DB;
 if(!await ownerProof(db,user))return fail('SBI_REVIEW_OWNER_REQUIRED',403);
 if(request.method==='GET'){
  const kind=url.searchParams.get('kind')||'cash';
  const after=url.searchParams.get('after')||'';
  if(!Object.hasOwn(dbtable,kind)||(after&&!uuid.test(after)))
   return fail('SBI_REVIEW_INVALID_CURSOR',400);
  const rows=(await db.prepare('SELECT l.homeflow_request_id FROM '+dbtable[kind]+' l '+
   'WHERE l.household_id=? AND l.owner_user_id=? AND l.homeflow_request_id>? '+
   'ORDER BY l.homeflow_request_id LIMIT 6').bind(user.household_id,user.user_id,after).all()).results||[];
  const result=[];
  for(const r of rows.slice(0,5)){
   const x=await candidate(db,user,kind,r.homeflow_request_id);
   if(!x){result.push({lot_homeflow_request_id:r.homeflow_request_id,
     reconciliation_state:'source_revoked_or_unverified'});continue;}
   const old=x.legacy;
   result.push({lot_homeflow_request_id:x.lot.homeflow_request_id,
    fund_code:x.lot.fund_code,account_type:x.lot.account_type,
    confirmed_units:x.lot.confirmed_units,acquisition_cost_jpy:x.lot.acquisition_cost_jpy,
    trade_date:x.lot.trade_date,securities_account_id:x.lot.securities_account_id,
    source_lot_digest:x.lot_digest,
    legacy_holding:old?{fund_code:old.fund_code,account_type:old.account_type,
     units:old.units,acquisition_cost:old.acquisition_cost,
     reported_at:old.reported_at,legacy_snapshot_digest:x.legacy_snapshot_digest}:null,
    review_candidate_id:x.linked?.candidate_id||null,
    reconciliation_state:x.linked?
      (x.linked.source_lot_digest===x.lot_digest&&
       x.linked.legacy_snapshot_digest===x.legacy_snapshot_digest?
       'candidate_pending_broker_reconciliation':'candidate_snapshot_stale'):
      old?'eligible_for_explicit_unverified_review':'legacy_owner_or_type_unverified',
    broker_reconciled:false,included_in_tracked_assets_jpy:false});
  }
  return json({ok:true,items:result,kind,
   next_cursor:rows.length>5?result.at(-1)?.lot_homeflow_request_id:null,
   read_only:true,requires_explicit_owner_review:true,
   historical_snapshot_combined_cannot_be_attributed:true,
   broker_reconciled:false,asset_value_complete:false,ledger_changed:false});
 }
 if(request.method!=='POST')return fail('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('origin')!==url.origin||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return fail('SBI_REVIEW_CSRF_OR_CONTENT_TYPE',403);
 let b;try{const s=await request.text();b=s.length<=1400?JSON.parse(s):null}catch{return fail('INVALID_BODY',400)}
 if(b?.expected_user_id!==user.user_id)return fail('SBI_REVIEW_ACTOR_CHANGED',403);
 if(!exact(b,['expected_user_id','lot_kind','lot_homeflow_request_id','securities_account_id',
   'source_lot_digest','legacy_snapshot_digest','confirm_candidate_only'])||
  b.confirm_candidate_only!==true||!Object.hasOwn(dbtable,b.lot_kind)||
  !uuid.test(b.lot_homeflow_request_id||'')||!id.test(b.securities_account_id||'')||
  !hex.test(b.source_lot_digest||'')||!hex.test(b.legacy_snapshot_digest||''))
  return fail('SBI_REVIEW_EXACT_EVIDENCE_REQUIRED',400);
 const x=await candidate(db,user,b.lot_kind,b.lot_homeflow_request_id);
 if(!x?.lot||!x.legacy||x.lot.securities_account_id!==b.securities_account_id||
  x.lot_digest!==b.source_lot_digest||
  x.legacy_snapshot_digest!==b.legacy_snapshot_digest)
  return fail('SBI_REVIEW_UNVERIFIED_OR_STALE_SNAPSHOT');
 if(x.linked){
  return x.linked.source_lot_digest===b.source_lot_digest&&
   x.linked.legacy_snapshot_digest===b.legacy_snapshot_digest?
   json({ok:true,already_reviewed:true,candidate_id:x.linked.candidate_id,
    broker_reconciled:false,valuation_changed:false,ledger_changed:false}):
   fail('SBI_REVIEW_CANDIDATE_CONFLICT');
 }
 const l=x.lot,h=x.legacy,at=Date.now(),candidateId=uid();
 try{
  const actions=[
   db.prepare('INSERT INTO family_sbi_legacy_holding_candidates '+
    '(candidate_id,household_id,owner_user_id,lot_type,lot_homeflow_request_id,'+
    'securities_account_id,lot_fund_code,lot_account_type,lot_confirmed_units,'+
    'lot_acquisition_cost_jpy,lot_trade_date,lot_broker_reference_hash,source_lot_digest,'+
    'legacy_fund_code,legacy_account_type,legacy_fund_name,legacy_units,'+
    'legacy_acquisition_cost,legacy_reported_value,legacy_reported_at,legacy_updated_at,'+
    'legacy_snapshot_digest,reviewer_user_id,reviewed_at) '+
    'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(candidateId,user.household_id,user.user_id,b.lot_kind,l.homeflow_request_id,
     l.securities_account_id,l.fund_code,l.account_type,l.confirmed_units,l.acquisition_cost_jpy,
     l.trade_date,l.broker_reference_hash,b.source_lot_digest,h.fund_code,h.account_type,
     h.fund_name,h.units,h.acquisition_cost,h.reported_value,h.reported_at,h.updated_at,
     b.legacy_snapshot_digest,user.user_id,at),
   db.prepare('INSERT INTO family_sbi_legacy_candidate_audit '+
    "(event_id,candidate_id,household_id,reviewer_user_id,action,created_at) "+
    "SELECT ?,?,?,?,'reviewed_but_unreconciled',? WHERE changes()=1")
    .bind(uid(),candidateId,user.household_id,user.user_id,at)
  ];
  const rows=await db.batch(actions);
  if(rows.length!==2||rows.some(z=>z.meta?.changes!==1))
   return fail('SBI_REVIEW_AUDIT_MISSING',503);
  return json({ok:true,candidate_id:candidateId,review_state:'pending_broker_reconciliation',
   broker_reconciled:false,valuation_changed:false,ledger_changed:false,
   original_lot_immutable:true,already_reviewed:false},201);
 }catch{
  const raced=await originalReview(db,user,b.lot_kind,b.lot_homeflow_request_id).catch(()=>null);
  if(raced&&raced.source_lot_digest===b.source_lot_digest&&
   raced.legacy_snapshot_digest===b.legacy_snapshot_digest)
   return json({ok:true,candidate_id:raced.candidate_id,already_reviewed:true,
    broker_reconciled:false,valuation_changed:false,ledger_changed:false});
  return fail('SBI_REVIEW_COMMIT_OR_PROVENANCE_CONFLICT',503);
 }
}
