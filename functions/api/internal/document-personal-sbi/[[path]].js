// Private Service Binding only: signed personal SBI transfer from this member's
// verified document. This is NOT an SBI broker trade or an income/expense entry.
const enc=new TextEncoder(),hex=/^[0-9a-f]{64}$/i,id=/^[0-9a-f]{32}$/i;
const reply=(b,status=200)=>Response.json(b,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const deny=(code,status=403)=>reply({ok:false,code,applied:false},status);
const hash=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(raw))),
 x=>x.toString(16).padStart(2,'0')).join('');
const exact=(b,keys)=>!!b&&typeof b==='object'&&!Array.isArray(b)&&
 Object.keys(b).sort().join(',')===keys.slice().sort().join(',');
const date=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
async function mac(secret,domain,stamp,raw){
 const key=await crypto.subtle.importKey('raw',
  Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,enc.encode(domain+'\n'+stamp+'\n'+raw));
 return Array.from(new Uint8Array(signature),x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){if(!hex.test(a||'')||!hex.test(b||''))return false;
 let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const receipt=r=>({ok:true,applied:true,transfer_id:r.transfer_id,
 remote_id:'personal-sbi:'+r.transfer_id,owner_user_id:r.owner_user_id,
 household_id:r.household_id,source_candidate_id:r.source_candidate_id,
 state:r.state,version:r.version,source_sha256:r.source_sha256,
 recorded_type:'transfer',asset_target:'sbi',fund_units_created:0});
export async function documentPersonalSbiRoute(request,env,mode){
 if(!['execute','receipt'].includes(mode)||request.method!=='POST')return deny('NOT_FOUND',404);
 if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
  !hex.test(env.KAKEIBO_DOCUMENT_FINANCE_SECRET||'')||!env.DB?.prepare)
  return deny('PERSONAL_SBI_EXECUTOR_DISABLED',503);
 if(request.headers.has('cookie')||request.headers.has('origin')||
  request.headers.has('authorization')||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('BACKEND_ONLY');
 const stamp=request.headers.get('x-approval-timestamp');
 const signature=request.headers.get('x-approval-signature');
 if(request.headers.get('x-approval-client')!=='jp-document-assistant'||
  !/^\d{13}$/.test(stamp||'')||Math.abs(Date.now()-Number(stamp))>300000||
  !hex.test(signature||''))return deny('INVALID_SIGNATURE');
 let body,raw;
 try{raw=await request.text();if(raw.length>1500)throw Error('oversized');body=JSON.parse(raw);}
 catch{return deny('INVALID_BODY',400);}
 const domain=mode==='execute'?'jpda:personal-sbi-execute':'jpda:personal-sbi-receipt';
 if(!equal(signature,await mac(env.KAKEIBO_DOCUMENT_FINANCE_SECRET,domain,stamp,raw)))
  return deny('INVALID_SIGNATURE');
 const common=['source','source_candidate_id','household_id','owner_user_id','idempotency_key'];
 const extra=['source_document_id','date','effective_date','amount_jpy','purpose','merchant','note','confirmed'];
 if(!exact(body,mode==='execute'?[...common,...extra]:common)||
   body.source!=='jp-document-assistant'||
   !id.test(body.source_candidate_id)||!id.test(body.source_document_id||'')&&mode==='execute'||
   typeof body.household_id!=='string'||!body.household_id||body.household_id.length>128||
   typeof body.owner_user_id!=='string'||!body.owner_user_id||body.owner_user_id.length>128||
   body.idempotency_key!=='jda:personal-sbi:'+body.source_candidate_id)
  return deny('INVALID_IDENTITY',400);
 const db=env.DB;
 const prior=await db.prepare('SELECT * FROM family_document_personal_sbi_transfers WHERE source_candidate_id=?')
  .bind(body.source_candidate_id).first();
 if(mode==='receipt'){
  return prior&&prior.owner_user_id===body.owner_user_id&&prior.household_id===body.household_id
    ?reply(receipt(prior)):deny('RECEIPT_NOT_FOUND',404);
 }
 if(!date(body.date)||!date(body.effective_date)||!Number.isSafeInteger(body.amount_jpy)||
  body.amount_jpy<1||body.amount_jpy>10000000||
  !['monthly','purchase'].includes(body.purpose)||
  typeof body.merchant!=='string'||!body.merchant.trim()||body.merchant.length>100||
  typeof body.note!=='string'||body.note.length>180||body.confirmed!==true)
  return deny('INVALID_TRANSFER',400);
 // In-household member identity is verified against the authoritative target D1,
 // never a browser-provided account name. No card/bank/securities account is required.
 const member=await db.prepare("SELECT 1 AS yes FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='member' AND state='active'")
  .bind(body.owner_user_id,body.household_id).first();
 if(!member)return deny('MEMBER_IDENTITY_REVOKED',403);
 const source_sha256=await hash(raw);
 const same=r=>r?.source_sha256===source_sha256&&
  r.owner_user_id===body.owner_user_id&&r.household_id===body.household_id&&
  r.source_document_id===body.source_document_id;
 if(prior)return same(prior)?reply({...receipt(prior),already_applied:true}):deny('PERSONAL_SBI_SOURCE_CONFLICT',409);
 const transferId=body.source_candidate_id,at=Date.now();
 try{
  await db.batch([
   db.prepare('INSERT INTO family_document_personal_sbi_transfers '+
    '(transfer_id,household_id,owner_user_id,source_document_id,source_candidate_id,source_sha256,'+
    'date,effective_date,amount_jpy,purpose,merchant,note,created_at,updated_at) '+
    'SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM homeflow_identity_links '+
    "WHERE user_id=? AND household_id=? AND role='member' AND state='active') ON CONFLICT(source_candidate_id) DO NOTHING")
    .bind(transferId,body.household_id,body.owner_user_id,body.source_document_id,body.source_candidate_id,
     source_sha256,body.date,body.effective_date,body.amount_jpy,body.purpose,
     body.merchant.trim(),body.note,at,at,body.owner_user_id,body.household_id),
   db.prepare('INSERT OR IGNORE INTO family_document_personal_sbi_audit '+
    '(audit_id,transfer_id,actor_user_id,action,before_version,after_version,created_at) '+
    "SELECT ?,transfer_id,owner_user_id,'create',0,1,? FROM family_document_personal_sbi_transfers "+
    'WHERE transfer_id=? AND source_sha256=?')
    .bind(transferId,at,transferId,source_sha256)
  ]);
 }catch{
  const after=await db.prepare('SELECT * FROM family_document_personal_sbi_transfers WHERE source_candidate_id=?')
   .bind(body.source_candidate_id).first().catch(()=>null);
  return same(after)?reply({...receipt(after),already_applied:true}):deny('PERSONAL_SBI_TRANSACTION_UNCONFIRMED',503);
 }
 const saved=await db.prepare('SELECT * FROM family_document_personal_sbi_transfers WHERE source_candidate_id=?')
  .bind(body.source_candidate_id).first();
 return same(saved)?reply(receipt(saved)):deny('PERSONAL_SBI_RECEIPT_UNCONFIRMED',503);
}
export async function onRequest({request,env,params}){
 return documentPersonalSbiRoute(request,env,(params.path||[])[0]);
}
