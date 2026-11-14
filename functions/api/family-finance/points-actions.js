// Draft: source-side independent point intent. NEVER writes legacy entries.
// Only the atomically self-contained actions are enabled in this increment.
// Prepaid/card/exchange/SBI counterparts are verified by same-D1 immutable triggers.
import {pointAccountingPlan} from './point-accounting.js';
const te=new TextEncoder(), id=/^[a-f0-9]{32}$/i, hex=/^[a-f0-9]{64}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const supported=new Set(['earn_campaign','earn_purchase','redeem_discount','redeem_purchase','expire','transfer_prepaid','offset_card','transfer_out','exchange_out','reversal','redeem_asset']);
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>json({ok:false,code,applied:false},status);
const unique=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(s)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const validDate=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s&&
 s<=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const enabled=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_POINTS_ACTIONS_ENABLED==='true'&&e.DB?.prepare&&
 hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&hex.test(e.KAKEIBO_POINTS_SUBMISSION_SECRET||'')&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function hmac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,te.encode(domain+'\n'+stamp+'\n'+raw)))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=5000?JSON.parse(raw):null}catch{return null}
}
const visible=p=>({request_id:p.request_id,points_account_id:p.points_account_id,
 expected_version:p.expected_version,operation:p.operation,status:p.status,
 approval_id:p.homeflow_approval_id||null,created_at:p.created_at,
 applied:p.homeflow_request_id!=null,delta_units:p.delta_units??null,
 balance_after_units:p.balance_after_units??null});
const one=(db,id,user)=>db.prepare('SELECT p.*,j.homeflow_request_id,j.delta_units,j.balance_after_units '+
 'FROM family_points_intents p LEFT JOIN family_points_journal j ON j.proposal_id=p.request_id '+
 'WHERE p.request_id=? AND p.household_id=? AND p.requester_user_id=?')
 .bind(id,user.household_id,user.user_id).first();
async function account(db,user,accountId,version){
 const a=await db.prepare('SELECT a.account_id,a.account_kind,a.version,a.opening_balance FROM family_financial_accounts a '+
  "WHERE a.account_id=? AND a.household_id=? AND a.owner_user_id=? AND a.origin='member_created' AND a.is_archived=0")
  .bind(accountId,user.household_id,user.user_id).first();
 return a?.account_kind==='points'&&a.version===version&&a.opening_balance===0;
}
async function financialTarget(db,user,accountId,version,kind){
 const a=await db.prepare('SELECT account_kind,version,opening_balance FROM family_financial_accounts '+
  "WHERE account_id=? AND household_id=? AND owner_user_id=? AND origin='member_created' AND is_archived=0")
  .bind(accountId,user.household_id,user.user_id).first();
 return a?.account_kind===kind&&a.version===version&&a.opening_balance===0;
}
async function prepaidTarget(db,user,accountId,version){
 return financialTarget(db,user,accountId,version,'prepaid');
}
async function cardPurchase(db,user,cardAccountId,purchaseId,effectiveDate,amount){
 const p=await db.prepare('SELECT p.amount_jpy,p.purchase_date,p.requester_user_id,'+
  'COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a '+
   'WHERE a.purchase_request_id=p.homeflow_request_id),0) paid_jpy,'+
  'COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o '+
   'WHERE o.purchase_request_id=p.homeflow_request_id),0) points_offset_jpy '+
  'FROM family_card_purchase_applied p WHERE p.homeflow_request_id=? AND '+
  'p.household_id=? AND p.account_id=?')
  .bind(purchaseId,user.household_id,cardAccountId).first();
 return p?.requester_user_id===user.user_id&&p.purchase_date<=effectiveDate&&
  Number.isSafeInteger(p.amount_jpy)&&Number.isSafeInteger(p.paid_jpy)&&
  Number.isSafeInteger(p.points_offset_jpy)&&
  p.amount_jpy-p.paid_jpy-p.points_offset_jpy>=amount;
}
async function linkedPurchase(db,user,entryId,pointFundedId=null){
 if(entryId===null)return true;
 // Do not authorize another member's expense merely because the ledger is household-shared.
 const e=await db.prepare('SELECT id,type,family_account_id,payment_source FROM entries WHERE id=?').bind(entryId).first();
 if(!e||e.type!=='expense'||(pointFundedId!==null&&
   (e.family_account_id!==pointFundedId||e.payment_source!=='points:'+pointFundedId)))return false;
 if(e.family_account_id){
  const a=await db.prepare('SELECT owner_user_id,household_id FROM family_financial_accounts WHERE account_id=?')
   .bind(e.family_account_id).first();
  return a?.owner_user_id===user.user_id&&a.household_id===user.household_id;
 }
 const l=await db.prepare('SELECT a.owner_user_id,l.household_id FROM family_finance_legacy_entry_links l '+
  'JOIN family_financial_accounts a ON a.account_id=l.account_id AND a.household_id=l.household_id '+
  'WHERE l.entry_id=?')
  .bind(entryId).first();
 return l?.owner_user_id===user.user_id&&l.household_id===user.household_id;
}
const moveCheck=operation=>operation==='transfer_out'||operation==='exchange_out';
async function reversibleOriginal(db,user,x){
 const originalId=x.original_request_id;
 if(!uuid.test(originalId))return false;
 const old=await db.prepare('SELECT old.operation,old.delta_units,old.yen_value,'+
  'old.yen_per_unit_numerator AS numerator,old.yen_per_unit_denominator AS denominator,'+
  'old.effective_date,old.points_account_id,old.linked_entry_id,old.target_account_id,'+
  'credit.target_units,credit.target_version,prepaid.amount_jpy AS prepaid_refund_amount,'+
  'prepaid.prepaid_version FROM family_points_journal old '+
  'LEFT JOIN family_points_transfer_credits credit ON credit.homeflow_request_id=old.homeflow_request_id '+
  'LEFT JOIN family_points_prepaid_credits prepaid ON prepaid.homeflow_request_id=old.homeflow_request_id ' +
  'WHERE old.homeflow_request_id=? AND old.household_id=? AND old.requester_user_id=? '+
  "AND old.points_account_id=? AND old.operation IN ('earn_campaign','earn_purchase','expire','transfer_out','exchange_out','transfer_prepaid') "+
  'AND (old.target_account_id IS NULL OR credit.target_account_id=old.target_account_id '+
  'OR prepaid.prepaid_account_id=old.target_account_id) '+
  'AND NOT EXISTS('+
   'SELECT 1 FROM family_points_journal previous WHERE previous.reversed_request_id=old.homeflow_request_id)')
  .bind(originalId,user.household_id,user.user_id,x.points_account_id).first();
 if(!old||x.effective_date<old.effective_date||
  x.units!==Math.abs(old.delta_units)||x.yen_value!==old.yen_value||
  x.rate_numerator!==old.numerator||x.rate_denominator!==old.denominator)return false;
 if(old.operation==='transfer_prepaid'){
  if(!id.test(old.target_account_id)||!Number.isSafeInteger(old.prepaid_refund_amount)||
   old.prepaid_refund_amount<1||!Number.isSafeInteger(old.prepaid_version))return false;
  const target=await db.prepare('SELECT account_id FROM family_financial_accounts '+
   "WHERE account_id=? AND household_id=? AND owner_user_id=? AND account_kind='prepaid' "+
   "AND origin='member_created' AND opening_balance=0 AND is_archived=0 AND version=?")
   .bind(old.target_account_id,user.household_id,user.user_id,old.prepaid_version).first();
  if(!target)return false;
  const balance=await db.prepare('SELECT COALESCE((SELECT SUM(delta_jpy) FROM family_prepaid_balance_journal '+
   'WHERE prepaid_account_id=?),0)+COALESCE((SELECT SUM(amount_jpy) '+
   'FROM family_points_prepaid_credits WHERE prepaid_account_id=?),0)'+
   '-COALESCE((SELECT SUM(debited_prepaid_jpy) FROM family_points_prepaid_refunds '+
   'WHERE prepaid_account_id=?),0) AS jpy')
   .bind(old.target_account_id,old.target_account_id,old.target_account_id).first();
  return Number.isSafeInteger(balance?.jpy)&&balance.jpy>=old.prepaid_refund_amount;
 }
 if(!['transfer_out','exchange_out'].includes(old.operation))return true;
 if(!id.test(old.target_account_id)||!Number.isSafeInteger(old.target_units)||
  old.target_units<1||!Number.isSafeInteger(old.target_version))return false;
 const target=await db.prepare('SELECT account_id FROM family_financial_accounts '+
  "WHERE account_id=? AND household_id=? AND owner_user_id=? AND account_kind='points' "+
  "AND origin='member_created' AND opening_balance=0 AND is_archived=0 AND version=?")
  .bind(old.target_account_id,user.household_id,user.user_id,old.target_version).first();
 if(!target)return false;
 const balance=await db.prepare('SELECT COALESCE((SELECT SUM(delta_units) FROM family_points_journal '+
  'WHERE points_account_id=?),0)+COALESCE((SELECT SUM(target_units) '+
  'FROM family_points_transfer_credits WHERE target_account_id=?),0)'+
  '-COALESCE((SELECT SUM(debited_target_units) FROM family_points_transfer_refunds '+
  'WHERE target_account_id=?),0) AS units')
  .bind(old.target_account_id,old.target_account_id,old.target_account_id).first();
 return Number.isSafeInteger(balance?.units)&&balance.units>=old.target_units;
}
function valid(x,user){
 const transfer=x?.operation==='transfer_prepaid';
 const offset=x?.operation==='offset_card';
 const move=x?.operation==='transfer_out'||x?.operation==='exchange_out';
 const reversal=x?.operation==='reversal';
 const asset=x?.operation==='redeem_asset';
 const keys=['expected_user_id','idempotency_key','points_account_id','points_version','operation',
  'effective_date','units','yen_value','rate_numerator','rate_denominator',
  'source_reference','linked_entry_id','expense_net_confirmed', ...(transfer||offset||move||asset?['target_account_id','target_version']:[]),
  ...(offset?['target_purchase_request_id']:[]),
  ...(move?['target_units','target_rate_numerator','target_rate_denominator']:[]),
  ...(reversal?['original_request_id']:[]),
  ...(asset?['sbi_fund_code','sbi_account_type','sbi_confirmed_units',
   'broker_trade_reference','broker_execution_confirmed']:[])];
 if(!exact(x,keys)||x.expected_user_id!==user.user_id||!supported.has(x.operation)||
  !id.test(x.points_account_id)||!Number.isSafeInteger(x.points_version)||x.points_version<1||
  typeof x.idempotency_key!=='string'||!/^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)||
  !Number.isSafeInteger(x.units)||x.units<1||x.units>1000000000||
  !validDate(x.effective_date)||typeof x.source_reference!=='string'||
  x.source_reference.trim().length<4||x.source_reference.length>160||
  ![true,false].includes(x.expense_net_confirmed))return false;
 const withEntry=x.operation==='earn_purchase'||x.operation==='redeem_discount'||x.operation==='redeem_purchase';
 if((withEntry&&(!Number.isSafeInteger(x.linked_entry_id)||x.linked_entry_id<=0))||
    (!withEntry&&x.linked_entry_id!==null)||
    (x.operation==='redeem_discount'&&x.expense_net_confirmed!==true)||
    (x.operation!=='redeem_discount'&&x.expense_net_confirmed!==false))return false;
 if((transfer||offset||move||asset)&&(!id.test(x.target_account_id)||x.target_account_id===x.points_account_id||
   !Number.isSafeInteger(x.target_version)||x.target_version<1||
   !Number.isSafeInteger(x.yen_value)||x.yen_value<1||x.yen_value>10000000))return false;
 const none=x.yen_value===null&&x.rate_numerator===null&&x.rate_denominator===null;
 if((transfer||offset||move||asset)&&none)return false;
 if(move&&(!Number.isSafeInteger(x.target_units)||x.target_units<1||x.target_units>1000000000||
  !Number.isSafeInteger(x.target_rate_numerator)||x.target_rate_numerator<1||x.target_rate_numerator>1000000000||
  !Number.isSafeInteger(x.target_rate_denominator)||x.target_rate_denominator<1||x.target_rate_denominator>1000000000||
  BigInt(x.target_units)*BigInt(x.target_rate_numerator)!==
   BigInt(x.yen_value)*BigInt(x.target_rate_denominator)||
  (x.operation==='transfer_out'&&(x.target_units!==x.units||
   x.target_rate_numerator!==x.rate_numerator||
   x.target_rate_denominator!==x.rate_denominator))))return false;
 if(offset&&!uuid.test(x.target_purchase_request_id))return false;
 if(asset&&(!/^[A-Z0-9]{8}$/.test(x.sbi_fund_code||'')||
  !['growth','tsumitate'].includes(x.sbi_account_type)||
  !Number.isSafeInteger(x.sbi_confirmed_units)||x.sbi_confirmed_units<1||
  x.sbi_confirmed_units>1000000000000||
  typeof x.broker_trade_reference!=='string'||
  !/^[A-Za-z0-9._:-]{8,128}$/.test(x.broker_trade_reference)||
  x.broker_execution_confirmed!==true))return false;
 if(reversal){
  if(!uuid.test(x.original_request_id))return false;
  return none||(
   Number.isSafeInteger(x.yen_value)&&x.yen_value>=0&&x.yen_value<=1000000000&&
   Number.isSafeInteger(x.rate_numerator)&&x.rate_numerator>=1&&x.rate_numerator<=1000000000&&
   Number.isSafeInteger(x.rate_denominator)&&x.rate_denominator>=1&&x.rate_denominator<=1000000000&&
   BigInt(x.units)*BigInt(x.rate_numerator)===
    BigInt(x.yen_value)*BigInt(x.rate_denominator));
 }
 return none||pointAccountingPlan({operation:x.operation,units:x.units,yen_value:x.yen_value,
  rate_numerator:x.rate_numerator,rate_denominator:x.rate_denominator,
  linked_entry_id:x.linked_entry_id,source_reference_hash:'a'.repeat(64),
  ...(transfer||offset||move||asset?{points_account_id:x.points_account_id,target_account_id:x.target_account_id,
   target_account_kind:transfer?'prepaid':offset?'credit_card':asset?'securities':'points'}:{})}).ok===true;
}
async function seal(e,requestId,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(e.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:te.encode('kakeibo-points:'+requestId)},key,te.encode(raw));
 const b64=arr=>btoa(String.fromCharCode(...arr));
 return {payload_cipher:b64(new Uint8Array(bytes)),payload_iv:b64(iv)};
}
async function prepare(req,e,url,user){
 const x=await read(req,url);
 if(!valid(x,user))return fail('POINTS_INVALID_INTENT',400);
 if(!await account(e.DB,user,x.points_account_id,x.points_version))return fail('POINTS_ACCOUNT_CHANGED');
 if(x.operation==='reversal'&&!await reversibleOriginal(e.DB,user,x))
  return fail('POINTS_REVERSAL_ORIGINAL_CHANGED');
 if(x.operation==='transfer_prepaid'&&
  !await prepaidTarget(e.DB,user,x.target_account_id,x.target_version))return fail('POINTS_PREPAID_TARGET_CHANGED');
 if(x.operation==='redeem_asset'&&
  !await financialTarget(e.DB,user,x.target_account_id,x.target_version,'securities'))
  return fail('POINTS_SBI_ACCOUNT_CHANGED');
 if(moveCheck(x.operation)&&!await financialTarget(e.DB,user,x.target_account_id,x.target_version,'points'))
  return fail('POINTS_TRANSFER_TARGET_CHANGED');
 if(x.operation==='offset_card'&&(
  !await financialTarget(e.DB,user,x.target_account_id,x.target_version,'credit_card')||
  !await cardPurchase(e.DB,user,x.target_account_id,x.target_purchase_request_id,
   x.effective_date,x.yen_value)))return fail('POINTS_CARD_TARGET_OR_LIABILITY_CHANGED');
 if(x.linked_entry_id&&!await linkedPurchase(e.DB,user,x.linked_entry_id,
   x.operation==='redeem_purchase'?x.points_account_id:null))return fail('POINTS_ENTRY_OWNER_UNVERIFIED');
 const reference_hash=await hash(user.household_id+'\0'+x.points_account_id+'\0'+x.source_reference.trim());
 const brokerReferenceHash=x.operation==='redeem_asset'?
  await hash(user.household_id+'\0sbi-confirmed-trade\0'+x.broker_trade_reference):null;
 const raw=JSON.stringify({operation:x.operation,points_account_id:x.points_account_id,
  points_version:x.points_version,units:x.units,effective_date:x.effective_date,
  yen_value:x.yen_value,rate_numerator:x.rate_numerator,rate_denominator:x.rate_denominator,
  reference_hash,linked_entry_id:x.linked_entry_id,expense_net_confirmed:x.expense_net_confirmed,
  ...(['transfer_prepaid','offset_card','transfer_out','exchange_out','redeem_asset'].includes(x.operation)?{
   target_account_id:x.target_account_id,target_version:x.target_version,
   ...(x.operation==='offset_card'?{target_purchase_request_id:x.target_purchase_request_id}:{}),
   ...(moveCheck(x.operation)?{target_units:x.target_units,
    target_rate_numerator:x.target_rate_numerator,
    target_rate_denominator:x.target_rate_denominator}:{})}:{}),
  ...(x.operation==='reversal'?{original_request_id:x.original_request_id}:{}),
  ...(x.operation==='redeem_asset'?{
   sbi_fund_code:x.sbi_fund_code,sbi_account_type:x.sbi_account_type,
   sbi_confirmed_units:x.sbi_confirmed_units,
   sbi_broker_reference_hash:brokerReferenceHash,
   sbi_broker_execution_attested:true}:{})});
 const digest=await hash(raw);
 const idem=await hash(user.household_id+'\0'+user.user_id+'\0points\0'+x.idempotency_key);
 const prior=await e.DB.prepare('SELECT request_id,payload_sha256 FROM family_points_intents WHERE idempotency_hash=?')
  .bind(idem).first();
 if(prior)return prior.payload_sha256===digest?
  json({ok:true,replayed:true,prepared:visible(await one(e.DB,prior.request_id,user))}):
  fail('POINTS_IDEMPOTENCY_CONFLICT');
 const requestId=unique(),now=Date.now(),secret=await seal(e,requestId,raw);
 try{
  const result=await e.DB.prepare('INSERT OR IGNORE INTO family_points_intents '+
   '(request_id,household_id,requester_user_id,points_account_id,expected_version,operation,'+
   'payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,created_at,expires_at,'+
   'target_account_id,target_version,target_purchase_request_id,'+
   'target_units,target_rate_numerator,target_rate_denominator,original_request_id,'+
   'sbi_fund_code,sbi_account_type,sbi_confirmed_units,sbi_broker_reference_hash) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,'prepared',?,?,?,?,?,?,?,?,?,?,?,?,?)")
   .bind(requestId,user.household_id,user.user_id,x.points_account_id,x.points_version,
    x.operation,digest,secret.payload_cipher,secret.payload_iv,idem,now,now+14*86400000,
    ['transfer_prepaid','offset_card','transfer_out','exchange_out','redeem_asset'].includes(x.operation)?x.target_account_id:null,
    ['transfer_prepaid','offset_card','transfer_out','exchange_out','redeem_asset'].includes(x.operation)?x.target_version:null,
    x.operation==='offset_card'?x.target_purchase_request_id:null,
    moveCheck(x.operation)?x.target_units:null,
    moveCheck(x.operation)?x.target_rate_numerator:null,
    moveCheck(x.operation)?x.target_rate_denominator:null,
    x.operation==='reversal'?x.original_request_id:null,
    x.operation==='redeem_asset'?x.sbi_fund_code:null,
    x.operation==='redeem_asset'?x.sbi_account_type:null,
    x.operation==='redeem_asset'?x.sbi_confirmed_units:null,
    brokerReferenceHash).run();
  if(result.meta?.changes!==1)return fail('POINTS_PREPARE_CONFLICT');
  return json({ok:true,replayed:false,prepared:visible(await one(e.DB,requestId,user))},201);
 }catch{return fail('POINTS_PREPARE_FAILED',503)}
}
async function submit(req,e,url,user,requestId){
 const body=await read(req,url);
 if(!exact(body,['expected_user_id'])||body.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await one(e.DB,requestId,user);
 if(!p)return fail('NOT_FOUND',404);
 if(p.status==='submitted')return json({ok:true,approval_id:p.homeflow_approval_id,
  status:'submitted_status_unknown',applied:!!p.homeflow_request_id,replayed:true});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('POINTS_NOT_SUBMITTABLE');
 if(!await account(e.DB,user,p.points_account_id,p.expected_version))return fail('POINTS_ACCOUNT_CHANGED');
 if(p.operation==='reversal'){
  const old=await e.DB.prepare('SELECT homeflow_request_id FROM family_points_journal '+
   'WHERE homeflow_request_id=? AND points_account_id=? AND household_id=? '+
   'AND requester_user_id=? AND operation IN (\'earn_campaign\',\'earn_purchase\',\'expire\',\'transfer_out\',\'exchange_out\',\'transfer_prepaid\') '+
   'AND NOT EXISTS(SELECT 1 FROM family_points_journal r '+
    'WHERE r.reversed_request_id=family_points_journal.homeflow_request_id)')
   .bind(p.original_request_id,p.points_account_id,user.household_id,user.user_id).first();
  if(!old)return fail('POINTS_REVERSAL_ORIGINAL_CHANGED');
 }
 if(p.operation==='transfer_prepaid'&&
  !await prepaidTarget(e.DB,user,p.target_account_id,p.target_version))return fail('POINTS_PREPAID_TARGET_CHANGED');
 if(p.operation==='redeem_asset'&&
  !await financialTarget(e.DB,user,p.target_account_id,p.target_version,'securities'))
  return fail('POINTS_SBI_ACCOUNT_CHANGED');
 if(moveCheck(p.operation)&&!await financialTarget(e.DB,user,p.target_account_id,p.target_version,'points'))
  return fail('POINTS_TRANSFER_TARGET_CHANGED');
 if(p.operation==='offset_card'&&
  !await financialTarget(e.DB,user,p.target_account_id,p.target_version,'credit_card'))
  return fail('POINTS_CARD_TARGET_OR_LIABILITY_CHANGED');
 const wire={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,
  expected_version:p.expected_version,action:p.operation};
 const raw=JSON.stringify(wire),stamp=String(Date.now());
 let ack;try{
  const response=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/points-submit',e.HOMEFLOW_OAUTH_ORIGIN),{
   method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-points','x-approval-timestamp':stamp,
    'x-approval-signature':await hmac(e.KAKEIBO_POINTS_SUBMISSION_SECRET,
     'kakeibo-points:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(response.status)||response.headers.has('location'))throw Error('http');
  const text=await response.text();if(text.length>2000)throw Error('body');ack=JSON.parse(text);
 }catch{return fail('POINTS_HOMEFLOW_RETRY',503)}
 if(ack?.ok!==true||typeof ack.approval_id!=='string'||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ack.approval_id)||
  ack.resource_id!==p.request_id||ack.household_id!==p.household_id||
  ack.requester_user_id!==p.requester_user_id||ack.payload_sha256!==p.payload_sha256||
  ack.expected_version!==p.expected_version||ack.operation!=='finance.points.'+p.operation||
  ack.applied!==false)return fail('POINTS_SUBMIT_UNCONFIRMED',503);
 try{
  const r=await e.DB.prepare("UPDATE family_points_intents SET status='submitted',"+
   "homeflow_approval_id=?,submitted_at=? WHERE request_id=? AND household_id=? "+
   "AND requester_user_id=? AND status='prepared' AND expires_at>?")
   .bind(ack.approval_id,Date.now(),requestId,user.household_id,user.user_id,Date.now()).run();
  if(r.meta?.changes!==1){
   const latest=await one(e.DB,requestId,user);
   if(latest?.homeflow_approval_id!==ack.approval_id||latest.status!=='submitted')
    return fail('POINTS_SUBMIT_RECONCILE',503);
  }
  return json({ok:true,approval_id:ack.approval_id,status:'submitted_status_unknown',applied:false});
 }catch{return fail('POINTS_SUBMIT_RECONCILE',503)}
}
async function cancel(req,e,url,user,id){
 const body=await read(req,url);
 if(!exact(body,['expected_user_id'])||body.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await one(e.DB,id,user);
 if(!p)return fail('NOT_FOUND',404);
 if(p.status==='cancelled')return json({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('POINTS_ALREADY_SUBMITTED');
 const r=await e.DB.prepare("UPDATE family_points_intents SET status='cancelled' "+
  "WHERE request_id=? AND household_id=? AND requester_user_id=? AND status='prepared'")
  .bind(id,user.household_id,user.user_id).run();
 return r.meta?.changes===1?json({ok:true,status:'cancelled'}):fail('POINTS_CANCEL_CONFLICT');
}
export async function familyPointsActions(req,e,url,user,parts){
 if(!enabled(e))return fail('POINTS_ACTIONS_DISABLED',503);
 if(user.role!=='member')return fail('ONLY_MEMBER_CAN_PROPOSE',403);
 if(req.method==='GET'&&parts.length===1){
  const rows=(await e.DB.prepare('SELECT p.*,j.homeflow_request_id,j.delta_units,j.balance_after_units '+
   'FROM family_points_intents p LEFT JOIN family_points_journal j ON j.proposal_id=p.request_id '+
   'WHERE p.household_id=? AND p.requester_user_id=? ORDER BY p.created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return json({ok:true,items:rows.map(visible)});
 }
 if(req.method==='POST'&&parts.length===1)return prepare(req,e,url,user);
 if(req.method==='POST'&&parts.length===3&&id.test(parts[1])){
  if(parts[2]==='submit')return submit(req,e,url,user,parts[1]);
  if(parts[2]==='cancel')return cancel(req,e,url,user,parts[1]);
 }
 if(req.method==='GET'&&parts.length===2&&id.test(parts[1])){
  const p=await one(e.DB,parts[1],user);
  return p?json({ok:true,item:visible(p)}):fail('NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
