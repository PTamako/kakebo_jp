// DRAFT: authenticated member-originated standing payment occurrences.
// Preparation stores sealed user-attested evidence, never a bank or broker order.
// Execute only after HomeFlow immutable per-month reservation + live approval proof.
import {postRecurringFinanceLedger,recurringFinanceReceipt} from './recurring-ledger.js'
const enc=new TextEncoder(),hex=/^[a-f0-9]{64}$/i,id=/^[a-f0-9]{32}$/i,
 uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,s=409)=>reply({ok:false,code,ledger_applied:false},s);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
const day=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)&&
 new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const ready=e=>e.APP_ENV==='production'&&e.KAKEIBO_FAMILY_FINANCE_ENABLED==='true'&&
 e.KAKEIBO_RECURRING_FINANCE_PLANS_ENABLED==='true'&&
 e.KAKEIBO_RECURRING_EXECUTION_ENABLED==='true'&&e.DB?.prepare&&
 typeof e.HOMEFLOW_IDENTITY_SERVICE?.fetch==='function'&&
 /^https:\/\/[a-z0-9.-]+$/i.test(e.HOMEFLOW_OAUTH_ORIGIN||'')&&
 ['KAKEIBO_RECURRING_PAYLOAD_KEY','KAKEIBO_RECURRING_HOMEFLOW_RESERVATION_SECRET',
 'KAKEIBO_RECURRING_HOMEFLOW_PROOF_SECRET','KAKEIBO_RECURRING_HOMEFLOW_RECORD_SECRET']
  .every(k=>hex.test(e[k]||''));
const reserveFields=['occurrence_id','policy_id','household_id','member_user_id',
 'plan_resource_id','plan_payload_sha256','source_account_version','period_key',
 'due_date','amount_jpy','entry_intent_sha256'];
async function sign(secret,domain,stamp,raw){
 const k=await crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/.{2}/g),x=>parseInt(x,16)),
  {name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,
  enc.encode(domain+'\n'+stamp+'\n'+raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function home(e,mode,body){
 const raw=JSON.stringify(body),stamp=String(Date.now());
 let r;
 try{
  r=await e.HOMEFLOW_IDENTITY_SERVICE.fetch(new Request(
    new URL('/api/internal/recurring-finance/'+mode,e.HOMEFLOW_OAUTH_ORIGIN),{
     method:'POST',redirect:'manual',headers:{'content-type':'application/json',
      'x-approval-client':'kakeibo-recurring-finance','x-approval-timestamp':stamp,
      'x-approval-signature':await sign(
        e[mode==='reserve'?'KAKEIBO_RECURRING_HOMEFLOW_RESERVATION_SECRET':
          mode==='execution-proof'?'KAKEIBO_RECURRING_HOMEFLOW_PROOF_SECRET':
            'KAKEIBO_RECURRING_HOMEFLOW_RECORD_SECRET'],
        'kakeibo-recurring-finance:'+mode,stamp,raw)},body:raw}));
  if(r.headers.has('location'))return null;
  const text=await r.text();
  if(text.length>2600)return null;
  const data=JSON.parse(text);
  return r.status===200||r.status===201?data:null;
 }catch{return null}
}
async function member(db,u){
 const r=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?')
  .bind(u.user_id,u.household_id).first();
 return u.role==='member'&&r?.role==='member'&&r?.state==='active';
}
async function read(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const s=await req.text();return s.length<=2100?JSON.parse(s):null}catch{return null}
}
const view=p=>({occurrence_id:p.occurrence_id,policy_id:p.policy_id,
 plan_resource_id:p.plan_resource_id,period_key:p.period_key,due_date:p.due_date,
 amount_jpy:p.amount_jpy,source_account_version:p.source_account_version,
 plan_payload_sha256:p.plan_payload_sha256,entry_intent_sha256:p.entry_intent_sha256,
 debit_date:p.debit_date,plan_type:p.securities_account_id?'sbi_tsumitate':'fixed_cost',
 state:'prepared_without_posting',ledger_applied:false,recorded_at:p.created_at});
const one=(db,idValue,u)=>db.prepare('SELECT * FROM family_recurring_execution_intents '+
 'WHERE occurrence_id=? AND household_id=? AND member_user_id=? LIMIT 1')
 .bind(idValue,u.household_id,u.user_id).first();
async function encrypt(e,idValue,raw){
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(
  e.KAKEIBO_RECURRING_PAYLOAD_KEY.match(/.{2}/g),x=>parseInt(x,16)),
  'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const buf=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:enc.encode('kakeibo-recurring-evidence:'+idValue)},key,enc.encode(raw));
 const b64=v=>btoa(String.fromCharCode(...v));
 return {iv:b64(iv),cipher:b64(new Uint8Array(buf))};
}
async function create(req,e,url,u){
 const x=await read(req,url);
 const keys=['expected_user_id','policy_id','plan_resource_id','period_key',
  'debit_date','bank_reference','bank_debit_posted','confirmed_units',
  'broker_trade_reference','trade_date','effective_date','broker_order_executed'];
 if(!exact(x,keys)||x.expected_user_id!==u.user_id||
  !uuid.test(x.policy_id)||!id.test(x.plan_resource_id)||
  typeof x.period_key!=='string'||!/^20\d\d-(0[1-9]|1[0-2])$/.test(x.period_key)||
  !day(x.debit_date)||x.debit_date>today()||
  x.bank_debit_posted!==true||
  typeof x.bank_reference!=='string'||x.bank_reference.trim().length<8||
  x.bank_reference.length>160)return fail('RECURRING_EVIDENCE_INVALID',400);
 const plan=await e.DB.prepare('SELECT * FROM family_member_recurring_plans WHERE plan_resource_id=? AND household_id=? AND owner_user_id=? LIMIT 1')
  .bind(x.plan_resource_id,u.household_id,u.user_id).first();
 if(!plan||plan.status!=='active'||plan.start_month>x.period_key||
  plan.end_month<x.period_key)return fail('RECURRING_PLAN_NOT_CURRENT');
 const due=x.period_key+'-'+String(plan.due_day).padStart(2,'0');
 if(!day(due)||due>today()||x.debit_date<due||
  x.debit_date>new Date(Date.parse(due+'T00:00:00Z')+7*86400000).toISOString().slice(0,10))
  return fail('RECURRING_DUE_WINDOW_NOT_POSTED');
 const isSbi=plan.plan_type==='sbi_tsumitate';
 if(isSbi?(!Number.isSafeInteger(x.confirmed_units)||x.confirmed_units<1||
  x.confirmed_units>1e12||
  typeof x.broker_trade_reference!=='string'||x.broker_trade_reference.trim().length<8||
  x.broker_trade_reference.length>160||
  x.broker_order_executed!==true||!day(x.trade_date)||!day(x.effective_date)||
  x.debit_date>x.trade_date||x.trade_date>x.effective_date||x.effective_date>today()):
  (x.confirmed_units!==null||x.broker_trade_reference!==null||
   x.trade_date!==null||x.effective_date!==null||x.broker_order_executed!==false))
  return fail('RECURRING_BROKER_EVIDENCE_INVALID',400);
 const key=await digest([u.household_id,u.user_id,x.plan_resource_id,x.period_key].join('\0'));
 const occurrence=key.slice(0,32);
 const bankHash=await digest('bank-statement:'+plan.bank_account_id+'\0'+x.bank_reference.trim());
 const brokerHash=isSbi?await digest(u.household_id+'\0sbi-confirmed-trade\0'+x.broker_trade_reference.trim()):null;
 const intent={occurrence_id:occurrence,policy_id:x.policy_id,
  household_id:u.household_id,member_user_id:u.user_id,
  plan_resource_id:plan.plan_resource_id,plan_payload_sha256:plan.plan_payload_sha256,
  source_account_version:plan.bank_version,securities_version:plan.securities_version,
  bank_account_id:plan.bank_account_id,securities_account_id:plan.securities_account_id,
  period_key:x.period_key,due_date:due,amount_jpy:plan.amount_jpy,
  debit_date:x.debit_date,bank_reference_hash:bankHash,
  fund_code:plan.fund_code,confirmed_units:x.confirmed_units,
  broker_reference_hash:brokerHash,trade_date:x.trade_date,effective_date:x.effective_date,
  plan_type:plan.plan_type};
 intent.entry_intent_sha256=await digest(JSON.stringify(intent));
 const existing=await one(e.DB,occurrence,u);
 if(existing)return existing.entry_intent_sha256===intent.entry_intent_sha256?
  reply({ok:true,prepared:view(existing),replayed:true}):
  fail('RECURRING_MONTHLY_INTENT_CHANGED');
 const secure=await encrypt(e,occurrence,JSON.stringify(intent));
 try{
  const r=await e.DB.prepare('INSERT INTO family_recurring_execution_intents '+
   '(occurrence_id,policy_id,household_id,member_user_id,plan_resource_id,'+
   'plan_payload_sha256,source_account_version,securities_version,bank_account_id,'+
   'securities_account_id,period_key,due_date,amount_jpy,debit_date,bank_reference_hash,'+
   'fund_code,confirmed_units,broker_reference_hash,trade_date,effective_date,'+
   'entry_intent_sha256,payload_cipher,payload_iv,created_at) '+
   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(occurrence,x.policy_id,u.household_id,u.user_id,plan.plan_resource_id,
    plan.plan_payload_sha256,plan.bank_version,plan.securities_version,
    plan.bank_account_id,plan.securities_account_id,x.period_key,due,plan.amount_jpy,
    x.debit_date,bankHash,plan.fund_code,x.confirmed_units,brokerHash,
    x.trade_date,x.effective_date,intent.entry_intent_sha256,
    secure.cipher,secure.iv,Date.now()).run();
  if(r.meta?.changes!==1)return fail('RECURRING_PREPARE_UNKNOWN',503);
  return reply({ok:true,prepared:view(await one(e.DB,occurrence,u)),replayed:false},201);
 }catch{
  const collided=await one(e.DB,occurrence,u).catch(()=>null);
  return collided?.entry_intent_sha256===intent.entry_intent_sha256?
   reply({ok:true,prepared:view(collided),replayed:true}):
   fail('RECURRING_PREPARE_CONFLICT');
 }
}
async function reconcile(e,p){
 const post=await recurringFinanceReceipt(e.DB,p,true);
 if(post.status!==200)return post;
 const receipt=await post.json();
 const body={...Object.fromEntries(reserveFields.map(k=>[k,p[k]])),
  target_journal_sha256:receipt.target_journal_sha256,
  target_entry_id:receipt.target_entry_id,target_plan_type:receipt.target_plan_type,
  target_applied_at:receipt.target_applied_at,
  owner_authorizer_user_id:receipt.owner_authorizer_user_id,
  external_bank_verified:false,external_broker_verified:false};
 const acknowledged=await home(e,'record',body);
 if(acknowledged?.ok!==true||acknowledged.ledger_applied!==true||
  acknowledged.target_journal_sha256!==body.target_journal_sha256||
  acknowledged.target_entry_id!==body.target_entry_id||
  acknowledged.occurrence_id!==p.occurrence_id)
  return reply({...receipt,homeflow_receipt_confirmed:false,
   reconciliation_required:true,financial_action_replayed:true},202);
 return reply({...receipt,homeflow_receipt_confirmed:true,
  reconciliation_required:false});
}
async function execute(req,e,url,u,idValue){
 const x=await read(req,url);
 if(!exact(x,['expected_user_id','confirm_occurrence_id'])||
  x.expected_user_id!==u.user_id||x.confirm_occurrence_id!==idValue)
  return fail('RECURRING_EXECUTION_CONFIRM_REQUIRED',428);
 const p=await one(e.DB,idValue,u);
 if(!p)return fail('RECURRING_INTENT_NOT_FOUND',404);
 const previous=await e.DB.prepare('SELECT occurrence_id FROM family_recurring_execution_applied WHERE occurrence_id=?')
  .bind(idValue).first();
 if(previous)return reconcile(e,p);
 const wire=Object.fromEntries(reserveFields.map(k=>[k,p[k]]));
 const reservation=await home(e,'reserve',wire);
 if(reservation?.ok!==true||reservation.reserved_only!==true||
  reservation.execution_permitted!==false||
  !reserveFields.every(k=>reservation[k]===wire[k]))
  return fail('RECURRING_HOMEFLOW_RESERVATION_NOT_CONFIRMED',503);
 const authority=await home(e,'execution-proof',wire);
 if(authority?.ok!==true||authority.execution_permitted!==true||
  !reserveFields.every(k=>authority[k]===wire[k]))
  return fail('RECURRING_HOMEFLOW_EXECUTION_NOT_APPROVED',409);
 const plan=await e.DB.prepare('SELECT plan_type FROM family_member_recurring_plans WHERE plan_resource_id=?')
  .bind(p.plan_resource_id).first();
 const target=await postRecurringFinanceLedger(e,{...p,plan_type:plan?.plan_type},authority);
 if(target.status!==200)return target;
 return reconcile(e,p);
}
export async function familyRecurringOccurrences(req,e,url,u,parts){
 if(!ready(e))return fail('RECURRING_EXECUTION_DISABLED',503);
 if(!await member(e.DB,u))return fail('RECURRING_MEMBER_REVOKED',403);
 if(parts.length===1&&req.method==='POST')return create(req,e,url,u);
 if(parts.length===1&&req.method==='GET'){
  const items=(await e.DB.prepare('SELECT * FROM family_recurring_execution_intents '+
   'WHERE household_id=? AND member_user_id=? ORDER BY created_at DESC LIMIT 30')
   .bind(u.household_id,u.user_id).all()).results||[];
  return reply({ok:true,items:items.map(view)});
 }
 if(parts.length===3&&id.test(parts[1])&&req.method==='POST'){
  if(parts[2]==='execute')return execute(req,e,url,u,parts[1]);
  if(parts[2]==='reconcile'){
   const x=await read(req,url);
   if(!exact(x,['expected_user_id'])||x.expected_user_id!==u.user_id)
    return fail('RECURRING_ACTOR_CHANGED',403);
   const p=await one(e.DB,parts[1],u);
   if(!p)return fail('RECURRING_INTENT_NOT_FOUND',404);
   return reconcile(e,p);
  }
 }
 return fail('NOT_FOUND',404);
}
