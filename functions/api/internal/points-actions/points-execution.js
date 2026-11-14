// Draft P0-4 signed points target. Does NOT debit bank/prepaid/card/SBI.
// Only non-counterparty earn/linked-discount/expiration are permitted.
// No HomeFlow "approved" claim can itself change the ledger.
const enc=new TextEncoder(),hash64=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const supported=new Set(['earn_campaign','earn_purchase','redeem_discount','redeem_purchase','expire','transfer_prepaid','offset_card','transfer_out','exchange_out']);
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const sha=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function hmac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
}
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&
 [...a].reduce((n,c,i)=>n|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_POINTS_ACTIONS_ENABLED==='true'&&e.DB?.prepare&&
 hash64.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hash64.test(e.KAKEIBO_POINTS_EXECUTION_SECRET||'')&&
 hash64.test(e.KAKEIBO_POINTS_PROOF_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
const core=['request_id','resource_id','household_id','requester_user_id','payload_sha256'];
async function signed(req,e,mode){
 if(req.method!=='POST'||req.headers.has('origin')||req.headers.has('cookie')||
  req.headers.has('authorization')||req.headers.get('x-approval-client')!=='homeflow'||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 const stamp=req.headers.get('x-approval-timestamp')||'',tag=req.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||
  !hash64.test(tag))return null;
 let raw,b;try{raw=await req.text();if(raw.length>1600)return null;b=JSON.parse(raw)}catch{return null}
 if(!exact(b,mode==='execute'?[...core,'execution_nonce']:core)||
  !uuid.test(b.request_id)||!id.test(b.resource_id)||!hash64.test(b.payload_sha256)||
  mode==='execute'&&!hash64.test(b.execution_nonce)||!b.household_id||
  typeof b.household_id!=='string'||b.household_id.length>128||
  typeof b.requester_user_id!=='string'||!b.requester_user_id||
  b.requester_user_id.length>128)return null;
 const expected=await hmac(e.KAKEIBO_POINTS_EXECUTION_SECRET,'homeflow:points-'+mode,stamp,raw);
 return eq(tag,expected)?b:null;
}
const receipt=(r,replayed,credit=null,card=null,move=null)=>({ok:true,applied:true,approval_id:r.homeflow_request_id,
 proposal_id:r.proposal_id,household_id:r.household_id,requester_user_id:r.requester_user_id,
 payload_sha256:r.payload_sha256,approver_user_id:r.approver_user_id,
 actor_user_id:r.actor_user_id,points_account_id:r.points_account_id,
 points_version:r.account_version,operation:r.operation,delta_units:r.delta_units,
 balance_after_units:r.balance_after_units,yen_value:r.yen_value,
 linked_entry_id:r.linked_entry_id,applied_at:r.applied_at,already_applied:replayed,
 target_account_id:r.target_account_id,prepaid_version:credit?.prepaid_version??null,
 prepaid_credit_jpy:credit?.amount_jpy??null,
 prepaid_balance_after_jpy:credit?.balance_after_jpy??null,
 card_version:card?.card_version??null,card_offset_jpy:card?.amount_jpy??null,
 card_remaining_after_jpy:card?.remaining_after_jpy??null,
 card_purchase_request_id:card?.purchase_request_id??null,
 transfer_target_units:move?.target_units??null,
 transfer_target_balance_after_units:move?.target_balance_after_units??null,
 transfer_target_version:move?.target_version??null,
 transfer_target_rate_numerator:move?.target_rate_numerator??null,
 transfer_target_rate_denominator:move?.target_rate_denominator??null});
async function receiptFor(db,r,replayed){
 if(r.operation==='transfer_out'||r.operation==='exchange_out'){
  const c=await db.prepare('SELECT * FROM family_points_transfer_credits WHERE homeflow_request_id=?')
   .bind(r.homeflow_request_id).first();
  if(!c||c.target_account_id!==r.target_account_id||c.source_account_id!==r.points_account_id||
   c.operation!==r.operation||c.yen_value!==r.yen_value||
   c.household_id!==r.household_id||c.requester_user_id!==r.requester_user_id)
   return fail('POINTS_TRANSFER_COUNTERPART_UNCONFIRMED',503);
  return json(receipt(r,replayed,null,null,c));
 }
 if(r.operation==='offset_card'){
  const c=await db.prepare('SELECT * FROM family_points_card_offsets WHERE homeflow_request_id=?')
   .bind(r.homeflow_request_id).first();
  if(!c||c.card_account_id!==r.target_account_id||c.amount_jpy!==r.yen_value||
   c.household_id!==r.household_id||c.requester_user_id!==r.requester_user_id)
   return fail('POINTS_COUNTERPART_UNCONFIRMED',503);
  return json(receipt(r,replayed,null,c));
 }
 if(r.operation!=='transfer_prepaid')return json(receipt(r,replayed));
 const c=await db.prepare('SELECT * FROM family_points_prepaid_credits WHERE homeflow_request_id=?')
  .bind(r.homeflow_request_id).first();
 if(!c||c.prepaid_account_id!==r.target_account_id||c.amount_jpy!==r.yen_value||
  c.household_id!==r.household_id||c.requester_user_id!==r.requester_user_id)
  return fail('POINTS_COUNTERPART_UNCONFIRMED',503);
 return json(receipt(r,replayed,c));
}
const match=(r,b)=>r&&r.homeflow_request_id===b.request_id&&r.proposal_id===b.resource_id&&
 r.household_id===b.household_id&&r.requester_user_id===b.requester_user_id&&
 r.payload_sha256===b.payload_sha256;
async function decode(e,p){
 try{
  const iv=Uint8Array.from(atob(p.payload_iv),x=>x.charCodeAt(0)),
   cipher=Uint8Array.from(atob(p.payload_cipher),x=>x.charCodeAt(0));
  if(iv.length!==12||cipher.length<16||cipher.length>4000)return null;
  const key=await crypto.subtle.importKey('raw',
   Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
   'AES-GCM',false,['decrypt']);
  const b=await crypto.subtle.decrypt({name:'AES-GCM',iv,
   additionalData:enc.encode('kakeibo-points:'+p.request_id)},key,cipher);
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(b);
  if(!eq(await sha(raw),p.payload_sha256))return null;
  const x=JSON.parse(raw);
  if(!exact(x,['operation','points_account_id','points_version','units','effective_date',
    'yen_value','rate_numerator','rate_denominator','reference_hash','linked_entry_id',
    'expense_net_confirmed',...(['transfer_prepaid','offset_card','transfer_out','exchange_out'].includes(x.operation)?['target_account_id','target_version']:[]),
    ...(x.operation==='offset_card'?['target_purchase_request_id']:[]),
    ...(['transfer_out','exchange_out'].includes(x.operation)?
     ['target_units','target_rate_numerator','target_rate_denominator']:[])])||!supported.has(x.operation)||x.operation!==p.operation||
    x.points_account_id!==p.points_account_id||x.points_version!==p.expected_version||
    !Number.isSafeInteger(x.units)||x.units<1||x.units>1000000000||
    !hash64.test(x.reference_hash)||typeof x.effective_date!=='string'||
    !/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(x.effective_date)||
    new Date(x.effective_date+'T00:00:00Z').toISOString().slice(0,10)!==x.effective_date||
    x.effective_date>new Date(Date.now()+9*3600000).toISOString().slice(0,10))return null;
  if(['earn_purchase','redeem_discount','redeem_purchase'].includes(x.operation)?
    (!Number.isSafeInteger(x.linked_entry_id)||x.linked_entry_id<=0):
    x.linked_entry_id!==null)return null;
  if(x.expense_net_confirmed!==(x.operation==='redeem_discount'))return null;
  if(['transfer_prepaid','offset_card','transfer_out','exchange_out'].includes(x.operation)&&(!id.test(x.target_account_id)||
   x.target_account_id===x.points_account_id||!Number.isSafeInteger(x.target_version)||
   x.target_version<1||!Number.isSafeInteger(x.yen_value)||
   x.yen_value<1||x.yen_value>10000000))return null;
  if(x.operation==='offset_card'&&!uuid.test(x.target_purchase_request_id))return null;
  if(['transfer_out','exchange_out'].includes(x.operation)&&(
   !Number.isSafeInteger(x.target_units)||x.target_units<1||x.target_units>1000000000||
   !Number.isSafeInteger(x.target_rate_numerator)||x.target_rate_numerator<1||x.target_rate_numerator>1000000000||
   !Number.isSafeInteger(x.target_rate_denominator)||x.target_rate_denominator<1||x.target_rate_denominator>1000000000||
   BigInt(x.target_units)*BigInt(x.target_rate_numerator)!==
    BigInt(x.yen_value)*BigInt(x.target_rate_denominator)||
   (x.operation==='transfer_out'&&(x.target_units!==x.units||
    x.target_rate_numerator!==x.rate_numerator||
    x.target_rate_denominator!==x.rate_denominator))))return null;
  if(x.yen_value!==null||x.rate_numerator!==null||x.rate_denominator!==null){
   if(!Number.isSafeInteger(x.yen_value)||x.yen_value<0||x.yen_value>1000000000||
    !Number.isSafeInteger(x.rate_numerator)||x.rate_numerator<1||x.rate_numerator>1000000000||
    !Number.isSafeInteger(x.rate_denominator)||x.rate_denominator<1||x.rate_denominator>1000000000||
    BigInt(x.yen_value)*BigInt(x.rate_denominator)!==
     BigInt(x.units)*BigInt(x.rate_numerator))return null;
  }
  return x;
 }catch{return null}
}
async function proof(e,b,p){
 const x={...Object.fromEntries(core.map(k=>[k,b[k]])),
  idempotency_key:'kakeibo:points:'+b.resource_id,expected_version:p.expected_version,
  purpose:'execute',execution_nonce:b.execution_nonce};
 const raw=JSON.stringify(x),stamp=String(Date.now());
 try{
  const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/verify',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-points','x-approval-timestamp':stamp,
    'x-approval-signature':await hmac(e.KAKEIBO_POINTS_PROOF_SECRET,
      'kakeibo-points:execution-proof',stamp,raw)},body:raw}));
  if(response.status!==200||response.headers.has('location'))return null;
  const rawResponse=await response.text();if(rawResponse.length>2000)return null;
  const a=JSON.parse(rawResponse);
  return a?.ok===true&&a.verified===true&&a.execution_authorized===true&&
   a.execution_status==='executing'&&a.source_app==='kakebo'&&a.target_app==='kakebo'&&
   a.operation==='finance.points.'+p.operation&&a.resource_type==='points_action'&&
   a.request_id===b.request_id&&a.resource_id===b.resource_id&&
   a.household_id===b.household_id&&a.requester_user_id===b.requester_user_id&&
   a.payload_sha256===b.payload_sha256&&a.idempotency_key===x.idempotency_key&&
   a.expected_version===p.expected_version&&a.approver_user_id&&
   a.approver_user_id!==b.requester_user_id&&a.expires_at>Date.now()&&
   a.applied===false?a:null;
 }catch{return null}
}
async function permittedPurchase(db,row,x){
 if(!x.linked_entry_id)return x.operation!=='earn_purchase'&&x.operation!=='redeem_discount'&&
  x.operation!=='redeem_purchase';
 const entry=await db.prepare('SELECT type,family_account_id,payment_source FROM entries WHERE id=?')
  .bind(x.linked_entry_id).first();
 if(entry?.type!=='expense'||(x.operation==='redeem_purchase'&&
  (entry.family_account_id!==row.points_account_id||
   entry.payment_source!=='points:'+row.points_account_id)))return false;
 if(entry.family_account_id){
  const account=await db.prepare('SELECT owner_user_id,household_id FROM family_financial_accounts WHERE account_id=?')
   .bind(entry.family_account_id).first();
  return account?.owner_user_id===row.requester_user_id&&account.household_id===row.household_id;
 }
 const legacy=await db.prepare('SELECT a.owner_user_id,l.household_id FROM family_finance_legacy_entry_links l '+
  'JOIN family_financial_accounts a ON a.account_id=l.account_id AND a.household_id=l.household_id '+
  'WHERE l.entry_id=?')
  .bind(x.linked_entry_id).first();
 return legacy?.owner_user_id===row.requester_user_id&&legacy.household_id===row.household_id;
}
export async function approvedPointsRoute(request,e,parts){
 if(!ready(e))return fail('POINTS_EXECUTION_DISABLED',503);
 if(parts.length!==1||!['execute','receipt'].includes(parts[0]))return fail('NOT_FOUND',404);
 const mode=parts[0],b=await signed(request,e,mode);
 if(!b)return fail('POINTS_UNAUTHORIZED',403);
 const db=e.DB;
 const prior=await db.prepare('SELECT * FROM family_points_journal '+
  'WHERE homeflow_request_id=? OR proposal_id=? LIMIT 1').bind(b.request_id,b.resource_id).first();
 if(prior)return match(prior,b)?receiptFor(db,prior,true):fail('POINTS_RECEIPT_CONFLICT');
 if(mode==='receipt')return fail('POINTS_RECEIPT_UNKNOWN',404);
 const row=await db.prepare('SELECT p.*,a.account_kind,a.origin,a.version,a.is_archived,'+
  'a.opening_balance,a.owner_user_id,a.household_id AS account_household,'+
  'u.role AS requester_role,u.state AS requester_state FROM family_points_intents p '+
  'JOIN family_financial_accounts a ON a.account_id=p.points_account_id '+
  'JOIN homeflow_identity_links u ON u.user_id=p.requester_user_id '+
  'WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
  .bind(b.resource_id,b.request_id).first();
 if(!row||row.status!=='submitted'||row.requester_user_id!==b.requester_user_id||
  row.household_id!==b.household_id||row.payload_sha256!==b.payload_sha256||
  row.expires_at<=Date.now()||row.account_kind!=='points'||row.origin!=='member_created'||
  row.version!==row.expected_version||row.is_archived!==0||row.opening_balance!==0||
  row.owner_user_id!==b.requester_user_id||row.account_household!==b.household_id||
  row.requester_state!=='active'||row.requester_role!=='member')
  return fail('POINTS_ACCOUNT_OR_IDENTITY_CHANGED');
 const x=await decode(e,row);if(!x||!await permittedPurchase(db,row,x))
  return fail('POINTS_SOURCE_INVALID');
 if(['transfer_prepaid','offset_card','transfer_out','exchange_out'].includes(row.operation)){
  if(row.target_account_id!==x.target_account_id||row.target_version!==x.target_version||
   (row.operation==='offset_card'&&row.target_purchase_request_id!==x.target_purchase_request_id)||
   (['transfer_out','exchange_out'].includes(row.operation)&&(
    row.target_units!==x.target_units||
    row.target_rate_numerator!==x.target_rate_numerator||
    row.target_rate_denominator!==x.target_rate_denominator)))
   return fail('POINTS_PREPAID_TARGET_CHANGED');
  const target=await db.prepare('SELECT account_kind,origin,version,is_archived,owner_user_id,'+
   'household_id,opening_balance FROM family_financial_accounts WHERE account_id=?')
   .bind(x.target_account_id).first();
  if(!target||target.account_kind!==(row.operation==='offset_card'?'credit_card':row.operation==='transfer_prepaid'?'prepaid':'points')||
   target.origin!=='member_created'||
   target.version!==x.target_version||target.is_archived!==0||
   target.owner_user_id!==row.requester_user_id||target.household_id!==row.household_id||
   target.opening_balance!==0)return fail('POINTS_TARGET_CHANGED');
  if(row.operation==='offset_card'){
   const purchased=await db.prepare('SELECT p.account_id,p.household_id,p.requester_user_id,'+
    'p.purchase_date,p.amount_jpy,'+
    'COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a '+
     'WHERE a.purchase_request_id=p.homeflow_request_id),0) paid_jpy,'+
    'COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o '+
     'WHERE o.purchase_request_id=p.homeflow_request_id),0) offset_jpy '+
    'FROM family_card_purchase_applied p WHERE p.homeflow_request_id=?')
    .bind(x.target_purchase_request_id).first();
   if(!purchased||purchased.account_id!==x.target_account_id||
    purchased.household_id!==b.household_id||
    purchased.requester_user_id!==b.requester_user_id||
    purchased.purchase_date>x.effective_date||
    !Number.isSafeInteger(purchased.amount_jpy)||!Number.isSafeInteger(purchased.paid_jpy)||
    !Number.isSafeInteger(purchased.offset_jpy)||
    purchased.amount_jpy-purchased.paid_jpy-purchased.offset_jpy<x.yen_value)
    return fail('POINTS_CARD_LIABILITY_CHANGED');
  }
 }
 const approved=await proof(e,b,row);
 if(!approved)return fail('POINTS_APPROVAL_OR_LEASE_INVALID');
 const priorBalance=await db.prepare('SELECT (COALESCE((SELECT SUM(delta_units) FROM family_points_journal WHERE points_account_id=?),0) '+
  '+COALESCE((SELECT SUM(target_units) FROM family_points_transfer_credits WHERE target_account_id=?),0)) AS units')
  .bind(row.points_account_id,row.points_account_id).first();
 if(!Number.isSafeInteger(priorBalance?.units)||priorBalance.units<0)
  return fail('POINTS_BALANCE_CORRUPT');
 const positive=x.operation==='earn_campaign'||x.operation==='earn_purchase';
 const delta=positive?x.units:-x.units,after=priorBalance.units+delta;
 if(!Number.isSafeInteger(after)||after<0||after>1000000000000)
  return fail('POINTS_INSUFFICIENT_BALANCE');
 const at=Date.now();
 try{
  // Single SQLite INSERT triggers atomically create the immutable actor audit.
  // Never create a second expense or another bank transfer here.
  const result=await db.prepare('INSERT INTO family_points_journal '+
   '(homeflow_request_id,proposal_id,household_id,requester_user_id,approver_user_id,'+
   'actor_user_id,points_account_id,account_version,operation,delta_units,'+
   'balance_after_units,yen_value,yen_per_unit_numerator,yen_per_unit_denominator,'+
   'target_account_id,linked_entry_id,legacy_entry_id,source_reference_hash,'+
   'reversed_request_id,payload_sha256,effective_date,applied_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(b.request_id,b.resource_id,row.household_id,row.requester_user_id,
    approved.approver_user_id,approved.approver_user_id,row.points_account_id,
    row.expected_version,row.operation,delta,after,x.yen_value,x.rate_numerator,
    x.rate_denominator,['transfer_prepaid','offset_card','transfer_out','exchange_out'].includes(x.operation)?x.target_account_id:null,
    x.linked_entry_id,null,x.reference_hash,null,
    row.payload_sha256,x.effective_date,at).run();
  if(result.meta?.changes!==1)return fail('POINTS_WRITE_UNCONFIRMED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_points_journal WHERE homeflow_request_id=?')
   .bind(b.request_id).first().catch(()=>null);
  return match(raced,b)?receiptFor(db,raced,true):fail('POINTS_WRITE_RETRY',503);
 }
 const applied=await db.prepare('SELECT * FROM family_points_journal WHERE homeflow_request_id=?')
  .bind(b.request_id).first();
 return match(applied,b)?receiptFor(db,applied,false):fail('POINTS_RECEIPT_UNCONFIRMED',503);
}
