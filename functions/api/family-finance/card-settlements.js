// P0-4: bank-statement-confirmed credit-card settlement proposal, NOT a purchase.
// Never infer a debit from a closing/due date; never post the household ledger here.
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const reply=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
const fail=(code,status=409)=>reply({ok:false,code,applied:false},status);
const newid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const exact=(o,k)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===k.slice().sort().join(',');
const validDate=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const amount=v=>Number.isSafeInteger(v)&&v>=1&&v<=10000000;
const enabled=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_CARD_SETTLEMENTS_ENABLED==='true'&&hex.test(e.KAKEIBO_FAMILY_PENDING_KEY||'')&&
 hex.test(e.KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET||'')&&e.DB?.prepare&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&/^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'');
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),b=>parseInt(b,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
}
async function seal(env,id,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.KAKEIBO_FAMILY_PENDING_KEY.match(/.{2}/g),b=>parseInt(b,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('kakeibo-card-settlement:'+id)},key,enc.encode(raw));
 const b64=x=>btoa(String.fromCharCode(...x));
 return {cipher:b64(new Uint8Array(ciphertext)),iv:b64(iv)};
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
 req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return null;
 try{const raw=await req.text();return raw.length<=6000?JSON.parse(raw):null}catch{return null}
}
function valid(x,user){
 return exact(x,['expected_user_id','idempotency_key','card_account_id','card_version','bank_account_id',
 'bank_version','debit_date','amount_jpy','bank_reference','allocations','statement_confirmed'])&&
 x.expected_user_id===user.user_id&&id32.test(x.card_account_id)&&id32.test(x.bank_account_id)&&
 x.card_account_id!==x.bank_account_id&&Number.isSafeInteger(x.card_version)&&x.card_version>=1&&
 Number.isSafeInteger(x.bank_version)&&x.bank_version>=1&&validDate(x.debit_date)&&amount(x.amount_jpy)&&
 x.statement_confirmed===true&&x.debit_date<=new Date(Date.now()+9*3600000).toISOString().slice(0,10)&&
 typeof x.idempotency_key==='string'&&
 /^[a-z0-9._:-]{12,128}$/i.test(x.idempotency_key)&&
 typeof x.bank_reference==='string'&&x.bank_reference.trim().length>=4&&x.bank_reference.length<=160&&
 Array.isArray(x.allocations)&&x.allocations.length>=1&&x.allocations.length<=30&&
 x.allocations.every(a=>exact(a,['purchase_request_id','amount_jpy'])&&uuid.test(a.purchase_request_id)&&amount(a.amount_jpy))&&
 new Set(x.allocations.map(a=>a.purchase_request_id)).size===x.allocations.length&&
 x.allocations.reduce((v,a)=>v+a.amount_jpy,0)===x.amount_jpy;
}
async function accountVersions(db,user,x){
 const rows=(await db.prepare('SELECT account_id,account_kind,version FROM family_financial_accounts '+
  "WHERE household_id=? AND owner_user_id=? AND origin='member_created' AND is_archived=0 "+
  'AND account_id IN (?,?)').bind(user.household_id,user.user_id,x.card_account_id,x.bank_account_id).all()).results||[];
 return rows.length===2&&rows.some(a=>a.account_id===x.card_account_id&&a.account_kind==='credit_card'&&a.version===x.card_version)&&
 rows.some(a=>a.account_id===x.bank_account_id&&a.account_kind==='bank'&&a.version===x.bank_version);
}
async function outstanding(db,household,card,allocations,debitDate){
 const ids=allocations.map(a=>a.purchase_request_id);
 const rows=(await db.prepare('SELECT p.homeflow_request_id,p.amount_jpy,p.purchase_date,'+
  'COALESCE((SELECT SUM(x.amount_jpy) FROM family_card_settlement_allocations x '+
  'WHERE x.purchase_request_id=p.homeflow_request_id),0) paid_jpy,'+
  'COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o '+
  'WHERE o.purchase_request_id=p.homeflow_request_id),0) points_offset_jpy '+
  'FROM family_card_purchase_applied p WHERE p.household_id=? AND p.account_id=? '+
  'AND p.homeflow_request_id IN ('+ids.map(()=>'?').join(',')+')')
  .bind(household,card,...ids).all()).results||[];
 return rows.length===ids.length&&allocations.every(a=>{
  const r=rows.find(x=>x.homeflow_request_id===a.purchase_request_id);
  return !!r&&r.purchase_date<=debitDate&&Number.isSafeInteger(r.amount_jpy)&&Number.isSafeInteger(r.paid_jpy)&&Number.isSafeInteger(r.points_offset_jpy)&&
   r.amount_jpy-r.paid_jpy-r.points_offset_jpy>=a.amount_jpy;
 });
}
const publicRow=r=>({
 request_id:r.request_id,operation:'finance.credit_card.settlement',
 card_account_id:r.card_account_id,bank_account_id:r.bank_account_id,
 card_version:r.card_version,bank_version:r.bank_version,
 payload_sha256:r.payload_sha256,
 status:r.transfer_entry_id?'applied':r.status==='submitted'?'submitted_status_unknown':r.status,
 approval_id:r.homeflow_approval_id||null,transfer_entry_id:r.transfer_entry_id||null,
 debit_date:r.debit_date||null,expires_at:r.expires_at,applied:!!r.transfer_entry_id
});
async function row(db,id,user){
 return db.prepare('SELECT p.*,a.transfer_entry_id,a.debit_date FROM family_card_settlement_intents p '+
  'LEFT JOIN family_card_settlements_applied a ON a.proposal_id=p.request_id '+
  'WHERE p.request_id=? AND p.requester_user_id=? AND p.household_id=? LIMIT 1')
  .bind(id,user.user_id,user.household_id).first();
}
async function prepare(req,env,url,user){
 const x=await read(req,url);
 if(x?.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 if(!valid(x,user))return fail('INVALID_CARD_SETTLEMENT',400);
 if(!await accountVersions(env.DB,user,x))return fail('SETTLEMENT_ACCOUNT_VERSION_CONFLICT');
 if(!await outstanding(env.DB,user.household_id,x.card_account_id,x.allocations,x.debit_date))
  return fail('SETTLEMENT_PURCHASES_OR_BALANCE_CHANGED');
 const bankRefHash=await hash('bank-statement:'+x.bank_account_id+'\u0000'+x.bank_reference.trim());
 const payload={card_account_id:x.card_account_id,card_version:x.card_version,
  bank_account_id:x.bank_account_id,bank_version:x.bank_version,
  debit_date:x.debit_date,amount_jpy:x.amount_jpy,reference_hash:bankRefHash,
  evidence_kind:'owner_confirmed_statement',allocations:x.allocations};
 const raw=JSON.stringify(payload),digest=await hash(raw),
  scope=await hash(user.household_id+'\u0000'+user.user_id+'\u0000card-settlement\u0000'+x.idempotency_key);
 const prior=await env.DB.prepare('SELECT * FROM family_card_settlement_intents WHERE idempotency_hash=?').bind(scope).first();
 if(prior){if(prior.payload_sha256!==digest||prior.requester_user_id!==user.user_id||
  prior.household_id!==user.household_id)return fail('SETTLEMENT_IDEMPOTENCY_CONFLICT');
  return reply({ok:true,prepared:publicRow(await row(env.DB,prior.request_id,user)),replayed:true});}
 const id=newid(),at=Date.now(),sealed=await seal(env,id,raw);
 try{
  const r=await env.DB.prepare('INSERT OR IGNORE INTO family_card_settlement_intents '+
   '(request_id,household_id,requester_user_id,card_account_id,card_version,bank_account_id,'+
   'bank_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,status,created_at,expires_at) '+
   "VALUES(?,?,?,?,?,?,?,?,?,?,?,'prepared',?,?)")
   .bind(id,user.household_id,user.user_id,x.card_account_id,x.card_version,x.bank_account_id,
    x.bank_version,digest,sealed.cipher,sealed.iv,scope,at,at+14*86400000).run();
  if(r.meta?.changes!==1)return fail('SETTLEMENT_PREPARE_CONFLICT');
  return reply({ok:true,prepared:publicRow(await row(env.DB,id,user)),replayed:false},201);
 }catch{return fail('SETTLEMENT_PREPARE_UNAVAILABLE',503)}
}
async function submit(req,env,url,user,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await row(env.DB,id,user);
 if(!p)return fail('SETTLEMENT_NOT_FOUND',404);
 if(p.status==='submitted'&&uuid.test(p.homeflow_approval_id))
  return reply({ok:true,status:'submitted_status_unknown',approval_id:p.homeflow_approval_id,replayed:true,applied:false});
 if(p.status!=='prepared'||p.expires_at<=Date.now())return fail('SETTLEMENT_NOT_SUBMITTABLE');
 if(!await accountVersions(env.DB,user,p))return fail('SETTLEMENT_ACCOUNT_VERSION_CONFLICT');
 const wire={household_id:p.household_id,requester_user_id:p.requester_user_id,
  resource_id:p.request_id,payload_sha256:p.payload_sha256,expected_version:p.card_version};
 const raw=JSON.stringify(wire),stamp=String(Date.now());let confirmed;
 try{
  const response=await env.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
   new URL('/api/internal/approvals/card-settlement-submit',env.HOMEFLOW_OAUTH_ORIGIN),{
    method:'POST',redirect:'manual',headers:{'content-type':'application/json',
    'x-approval-client':'kakeibo-card-settlement','x-approval-timestamp':stamp,
    'x-approval-signature':await mac(env.KAKEIBO_CARD_SETTLEMENT_SUBMISSION_SECRET,
     'kakeibo-card-settlement:submit',stamp,raw)},body:raw}));
  if(![200,201].includes(response.status)||response.headers.has('location'))return fail('SETTLEMENT_HOMEFLOW_RETRY',503);
  const text=await response.text();if(text.length>1900)return fail('SETTLEMENT_HOMEFLOW_RETRY',503);
  confirmed=JSON.parse(text);
 }catch{return fail('SETTLEMENT_HOMEFLOW_RETRY',503)}
 if(confirmed?.ok!==true||!uuid.test(confirmed.approval_id)||
  confirmed.resource_id!==p.request_id||confirmed.payload_sha256!==p.payload_sha256||
  confirmed.household_id!==p.household_id||confirmed.requester_user_id!==p.requester_user_id||
  confirmed.expected_version!==p.card_version||confirmed.applied!==false)
  return fail('SETTLEMENT_SUBMISSION_UNCONFIRMED',503);
 try{
  const r=await env.DB.prepare('UPDATE family_card_settlement_intents '+
   "SET status='submitted',homeflow_approval_id=?,submitted_at=? "+
   "WHERE request_id=? AND requester_user_id=? AND household_id=? AND status='prepared' "+
   'AND expires_at>? AND card_version=?')
   .bind(confirmed.approval_id,Date.now(),id,user.user_id,user.household_id,Date.now(),p.card_version).run();
  if(r.meta?.changes!==1){
   const prior=await row(env.DB,id,user);
   if(prior?.status==='submitted'&&prior.homeflow_approval_id===confirmed.approval_id)
    return reply({ok:true,status:'submitted_status_unknown',approval_id:confirmed.approval_id,replayed:true,applied:false});
   return fail('SETTLEMENT_SUBMISSION_RECONCILE',503);
  }
  return reply({ok:true,status:'submitted_status_unknown',approval_id:confirmed.approval_id,replayed:false,applied:false});
 }catch{return fail('SETTLEMENT_SUBMISSION_RECONCILE',503)}
}
async function cancel(req,env,url,user,id){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id'])||x.expected_user_id!==user.user_id)return fail('ACTOR_CHANGED',403);
 const p=await row(env.DB,id,user);if(!p)return fail('SETTLEMENT_NOT_FOUND',404);
 if(p.status==='cancelled')return reply({ok:true,status:'cancelled',replayed:true});
 if(p.status!=='prepared')return fail('SETTLEMENT_CANCEL_IN_HOMEFLOW');
 const r=await env.DB.prepare("UPDATE family_card_settlement_intents SET status='cancelled' "+
  "WHERE request_id=? AND requester_user_id=? AND household_id=? AND status='prepared'")
  .bind(id,user.user_id,user.household_id).run();
 return r.meta?.changes===1?reply({ok:true,status:'cancelled'}):fail('SETTLEMENT_CANCEL_CONFLICT');
}
export async function familyCardSettlements(req,env,url,user,parts){
 if(!enabled(env))return fail('CARD_SETTLEMENTS_DISABLED',503);
 if(user.role!=='member')return fail('ONLY_MEMBER_CAN_PROPOSE',403);
 if(parts.length===2&&parts[1]==='outstanding'&&req.method==='GET'){
  const rows=(await env.DB.prepare('SELECT p.homeflow_request_id AS purchase_request_id,p.account_id,'+
   'p.amount_jpy,p.purchase_date,p.bill_month,'+
   'COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a '+
   'WHERE a.purchase_request_id=p.homeflow_request_id),0) settled_jpy,'+
   'COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o '+
   'WHERE o.purchase_request_id=p.homeflow_request_id),0) points_offset_jpy '+
   'FROM family_card_purchase_applied p '+
   'JOIN family_financial_accounts c ON c.account_id=p.account_id '+
   'WHERE p.household_id=? AND c.household_id=? AND c.owner_user_id=? '+
   "AND c.account_kind='credit_card' AND c.origin='member_created' "+
   'ORDER BY p.purchase_date DESC,p.homeflow_request_id LIMIT 150')
   .bind(user.household_id,user.household_id,user.user_id).all()).results||[];
  const items=rows.map(r=>({...r,remaining_jpy:Number(r.amount_jpy)-Number(r.settled_jpy)-Number(r.points_offset_jpy)}));
  if(items.some(r=>!Number.isSafeInteger(r.remaining_jpy)||r.remaining_jpy<0))
   return fail('CARD_LIABILITY_UNBALANCED');
  return reply({ok:true,items:items.filter(r=>r.remaining_jpy>0)});
 }
 if(parts.length===1&&req.method==='POST')return prepare(req,env,url,user);
 if(parts.length===1&&req.method==='GET'){
  const rows=(await env.DB.prepare('SELECT p.*,a.transfer_entry_id,a.debit_date '+
   'FROM family_card_settlement_intents p LEFT JOIN family_card_settlements_applied a ON a.proposal_id=p.request_id '+
   'WHERE p.household_id=? AND p.requester_user_id=? ORDER BY p.created_at DESC LIMIT 50')
   .bind(user.household_id,user.user_id).all()).results||[];
  return reply({ok:true,items:rows.map(publicRow)});
 }
 if(parts.length===3&&id32.test(parts[1])&&req.method==='POST'){
  if(parts[2]==='submit')return submit(req,env,url,user,parts[1]);
  if(parts[2]==='cancel')return cancel(req,env,url,user,parts[1]);
 }
 if(parts.length===2&&id32.test(parts[1])&&req.method==='GET'){
  const p=await row(env.DB,parts[1],user);
  return p?reply({ok:true,settlement:publicRow(p)}):fail('SETTLEMENT_NOT_FOUND',404);
 }
 return fail('NOT_FOUND',404);
}
