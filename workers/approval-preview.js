// Read-only owner preview of a member's original encrypted household-ledger intent.
// Separate from the execution/receipt endpoints: no approval, financial write or
// private account ID is returned. Reachable only by the private Service Binding.
import {decodePayload,validCash} from '../functions/api/internal/approved-actions/[[path]].js';
import {sealed as openCard} from '../functions/api/internal/card-purchases/[[path]].js';
import {decode as openPrepaid} from '../functions/api/internal/prepaid-actions/[[path]].js';

const hex=/^[a-f0-9]{64}$/i;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const id32=/^[a-f0-9]{32}$/i;
const fields=['request_id','resource_id','household_id','requester_user_id',
 'payload_sha256','approver_user_id','operation','resource_type'];
const allowed=Object.freeze({
 finance_entry:'finance.entry.create',
 credit_card_purchase:'finance.credit_card.purchase',
 prepaid_action:'finance.prepaid.spend'
});
const reply=(v,status=200)=>Response.json(v,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
const deny=(code,status=403)=>reply({ok:false,code},status);
const exact=(x,k)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===k.slice().sort().join(',');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&
 hex.test(a)&&hex.test(b)&&a.length===b.length&&
 [...a].reduce((n,c,i)=>n|(c.charCodeAt(0)^b.charCodeAt(i)),0)===0;
async function hmac(secret,stamp,raw){
 const bytes=Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16));
 const key=await crypto.subtle.importKey('raw',bytes,
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(
  'homeflow:ledger-preview\n'+stamp+'\n'+raw));
 return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function sameSource(row,b,statusColumn='status'){
 return row&&row[statusColumn]==='submitted'&&row.homeflow_approval_id===b.request_id&&
  row.requester_user_id===b.requester_user_id&&row.household_id===b.household_id&&
  row.payload_sha256===b.payload_sha256&&Number(row.expires_at)>Date.now()&&
  row.requester_role==='member'&&row.requester_state==='active';
}
const present=(p,method)=>({
 date:p.date,type:p.type||'expense',amount:p.amount_jpy,
 category:p.category,merchant:p.merchant,note:p.note,
 payment_source:method
});
export async function approvalPreviewRoute(request,env){
 if(env.APP_ENV!=='production'||env.KAKEIBO_HOUSEHOLD_LEDGER_ONLY!=='true'||
    !env.DB?.prepare||!hex.test(env.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET||'')||
    !hex.test(env.KAKEIBO_FAMILY_PENDING_KEY||''))
  return deny('LEDGER_PREVIEW_DISABLED',503);
 const url=new URL(request.url);
 if(url.pathname!=='/api/internal/approval-preview'||url.search||url.hash||
    request.method!=='POST'||request.headers.has('cookie')||
    request.headers.has('authorization')||request.headers.has('origin')||
    request.headers.get('x-approval-client')!=='homeflow'||
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('BACKEND_ONLY');
 const stamp=request.headers.get('x-approval-timestamp')||'';
 const signature=request.headers.get('x-approval-signature')||'';
 if(!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>300000||
    !hex.test(signature))return deny('INVALID_SIGNATURE');
 let b,raw;
 try{raw=await request.text();b=raw.length<=1250?JSON.parse(raw):null}
 catch{return deny('INVALID_BODY',400)}
 if(!exact(b,fields)||!uuid.test(b.request_id)||!id32.test(b.resource_id)||
    !hex.test(b.payload_sha256)||!b.household_id||!b.requester_user_id||
    !b.approver_user_id||b.approver_user_id===b.requester_user_id||
    typeof b.household_id!=='string'||b.household_id.length>128||
    typeof b.requester_user_id!=='string'||b.requester_user_id.length>128||
    typeof b.approver_user_id!=='string'||b.approver_user_id.length>128||
    !Object.hasOwn(allowed,b.resource_type)||
    allowed[b.resource_type]!==b.operation)
  return deny('INVALID_BODY',400);
 if(!equal(signature,await hmac(env.KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET,stamp,raw)))
  return deny('INVALID_SIGNATURE');
 const db=env.DB;
 try{
  // The source must independently confirm a CURRENT owner and member link.
  const links=(await db.prepare('SELECT user_id,role,state FROM homeflow_identity_links '+
   'WHERE household_id=? AND user_id IN (?,?)')
   .bind(b.household_id,b.approver_user_id,b.requester_user_id).all()).results||[];
  if(!links.some(x=>x.user_id===b.approver_user_id&&x.role==='owner'&&x.state==='active')||
     !links.some(x=>x.user_id===b.requester_user_id&&x.role==='member'&&x.state==='active'))
   return deny('CURRENT_MEMBERSHIP_INVALID');
  let item,entry;
  if(b.resource_type==='finance_entry'){
   item=await db.prepare('SELECT p.*,a.account_kind,a.origin,a.owner_user_id,'+
    'a.is_archived,a.household_id AS account_household,l.role AS requester_role,'+
    'l.state AS requester_state FROM family_finance_pending_actions p '+
    'JOIN family_financial_accounts a ON a.account_id=p.account_id '+
    'JOIN homeflow_identity_links l ON l.user_id=p.requester_user_id '+
    'AND l.household_id=p.household_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
    .bind(b.resource_id,b.request_id).first();
   if(!item||item.state!=='submitted'||item.operation!==b.operation||
      item.requester_user_id!==b.requester_user_id||
      item.household_id!==b.household_id||item.payload_sha256!==b.payload_sha256||
      item.account_kind!=='cash'||item.owner_user_id!==b.requester_user_id||
      item.account_household!==b.household_id||item.is_archived!==0||
      item.origin!=='member_created'||item.requester_role!=='member'||
      item.requester_state!=='active'||Number(item.expires_at)<=Date.now())
    return deny('SOURCE_OR_ACCOUNT_CHANGED',409);
   const opened=await decodePayload(env,item);
   if(!opened||!validCash(opened.payload,item))return deny('SEALED_INTENT_INVALID',409);
   entry=present(opened.payload,'現金');
  }else if(b.resource_type==='credit_card_purchase'){
   item=await db.prepare('SELECT p.*,a.account_kind,a.version AS live_version,'+
    'a.owner_user_id,a.household_id AS account_household,a.is_archived,a.origin,a.closing_day,'+
    'm.role AS requester_role,m.state AS requester_state FROM family_card_purchase_intents p '+
    'JOIN family_financial_accounts a ON a.account_id=p.account_id '+
    'JOIN homeflow_identity_links m ON m.user_id=p.requester_user_id '+
    'AND m.household_id=p.household_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
    .bind(b.resource_id,b.request_id).first();
   if(!sameSource(item,b)||item.account_kind!=='credit_card'||item.origin!=='member_created'||
      item.owner_user_id!==b.requester_user_id||item.account_household!==b.household_id||
      item.is_archived!==0||item.account_version!==item.live_version)
    return deny('SOURCE_OR_ACCOUNT_CHANGED',409);
   const opened=await openCard(env,item);
   if(!opened)return deny('SEALED_INTENT_INVALID',409);
   entry=present(opened,'个人信用卡');
  }else{
   item=await db.prepare('SELECT p.*,a.account_kind AS prepaid_kind,'+
    'a.origin AS prepaid_origin,a.version AS prepaid_live,'+
    'a.is_archived AS prepaid_archived,a.owner_user_id AS prepaid_owner,'+
    'a.household_id AS prepaid_household,m.role AS requester_role,'+
    'm.state AS requester_state FROM family_prepaid_action_intents p '+
    'JOIN family_financial_accounts a ON a.account_id=p.prepaid_account_id '+
    'JOIN homeflow_identity_links m ON m.user_id=p.requester_user_id '+
    'AND m.household_id=p.household_id WHERE p.request_id=? AND p.homeflow_approval_id=? LIMIT 1')
    .bind(b.resource_id,b.request_id).first();
   if(!sameSource(item,b)||item.action!=='spend'||item.prepaid_kind!=='prepaid'||
      item.prepaid_origin!=='member_created'||item.prepaid_owner!==b.requester_user_id||
      item.prepaid_household!==b.household_id||item.prepaid_archived!==0||
      item.prepaid_version!==item.prepaid_live)
    return deny('SOURCE_OR_ACCOUNT_CHANGED',409);
   const opened=await openPrepaid(env,item);
   if(!opened||opened.action!=='spend')return deny('SEALED_INTENT_INVALID',409);
   entry=present(opened,'个人储值卡');
  }
  if(!entry||!['income','expense'].includes(entry.type)||
     !Number.isSafeInteger(entry.amount)||entry.amount<1)
   return deny('PREVIEW_INVALID',503);
  return reply({ok:true,approval_id:b.request_id,proposal_id:b.resource_id,
   operation:b.operation,entry,before:null});
 }catch{return deny('LEDGER_PREVIEW_UNAVAILABLE',503)}
}
