// Read-only, signed stable-ID proof for a document finance approval.
// Independent of legacy display names and the legacy JPDA bridge.
const enc=new TextEncoder();
const hex64=/^[a-f0-9]{64}$/i;
const hex32=/^[a-f0-9]{32}$/i;
const reply=(data,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store','Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff'
}});
const deny=(code,status=403)=>reply({ok:false,code,verified:false,applied:false},status);
async function mac(secret,stamp,raw){
  const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16));
  const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode('jpda:finance-account\n'+stamp+'\n'+raw));
  return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
}
function same(a,b){
  if(!hex64.test(a||'')||!hex64.test(b||''))return false;
  let diff=0;
  for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export async function verifyDocumentFinanceAccount(request,env,parts=['verify']){
  if(env.APP_ENV!=='production'||env.KAKEIBO_FAMILY_FINANCE_ENABLED!=='true'||
    env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFY_ENABLED!=='true'||
    !hex64.test(env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFICATION_SECRET||'')||
    typeof env.DB?.prepare!=='function')
    return deny('ACCOUNT_PROOF_DISABLED',503);
  if(request.method!=='POST'||parts.length!==1||parts[0]!=='verify')
    return deny('NOT_FOUND',404);
  if(request.headers.has('cookie')||request.headers.has('origin')||
    request.headers.has('authorization')||
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    return deny('BACKEND_ONLY');
  const stamp=request.headers.get('x-approval-timestamp');
  const signature=request.headers.get('x-approval-signature');
  if(request.headers.get('x-approval-client')!=='jp-document-assistant'||
    !/^\d{13}$/.test(stamp||'')||Math.abs(Date.now()-Number(stamp))>300000||
    !hex64.test(signature||''))
    return deny('INVALID_SIGNATURE');
  let body,raw;
  try{
    raw=await request.text();
    if(raw.length>600)throw Error('too large');
    body=JSON.parse(raw);
  }catch{return deny('INVALID_INPUT',400);}
  if(!same(await mac(env.KAKEIBO_DOCUMENT_ACCOUNT_VERIFICATION_SECRET,stamp,raw),signature))
    return deny('INVALID_SIGNATURE');
  if(!body||typeof body!=='object'||Array.isArray(body)||
    Object.keys(body).sort().join(',')!==
    ['account_id','household_id','requester_user_id','entry_type'].sort().join(',')||
    !hex32.test(body.account_id)||
    typeof body.household_id!=='string'||!body.household_id||body.household_id.length>128||
    typeof body.requester_user_id!=='string'||!body.requester_user_id||
    body.requester_user_id.length>128||
    !['expense','income'].includes(body.entry_type))
    return deny('INVALID_INPUT',400);
  // The mapping must exist in the TARGET database and belong to the
  // exact currently linked member. Duplicate labels carry no authority.
  const account=await env.DB.prepare(
    'SELECT a.account_id,a.household_id,a.owner_user_id,a.label,'+
    'a.account_kind,a.origin,a.is_archived,a.version,l.role,l.state '+
    'FROM family_financial_accounts a JOIN homeflow_identity_links l '+
    'ON l.user_id=a.owner_user_id AND l.household_id=a.household_id '+
    'WHERE a.account_id=? AND a.household_id=? AND a.owner_user_id=? LIMIT 1'
  ).bind(body.account_id,body.household_id,body.requester_user_id).first();
  if(!account||account.role!=='member'||account.state!=='active'||
    account.is_archived!==0||account.origin!=='member_created')
    return deny('ACCOUNT_OWNER_NOT_VERIFIED',409);
  // Only true cash entry semantics are executable by the existing Stage D
  // finance kernel. Credit/prepaid/points/SBI require their own journals.
  if(account.account_kind!=='cash')return deny('ACCOUNT_KIND_NOT_EXECUTABLE',409);
  return reply({ok:true,verified:true,applied:false,
    account_id:account.account_id,household_id:account.household_id,
    owner_user_id:account.owner_user_id,account_kind:account.account_kind,
    account_version:account.version,label:account.label,origin:account.origin});
}
export async function onRequest({request,env,params}){
  return verifyDocumentFinanceAccount(request,env,params.path||[]);
}
