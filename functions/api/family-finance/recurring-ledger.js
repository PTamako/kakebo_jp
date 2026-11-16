// DRAFT: single-Kakeibo-D1 recurring posted fixed cost or SBI tsumitate
// accounting. No external bank transfer or broker order; user-attested evidence
// does not create NAV/tracked assets. The HomeFlow receipt is another D1 and
// must be independently reconciled with an immutable original ID.
const enc=new TextEncoder(),h64=/^[a-f0-9]{64}$/i,id32=/^[a-f0-9]{32}$/i;
const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
const fail=(code,s=409)=>reply({ok:false,code,applied:false},s);
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const newId=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
const wireFields=['occurrence_id','policy_id','household_id','member_user_id','plan_resource_id',
 'plan_payload_sha256','source_account_version','period_key','due_date','amount_jpy',
 'entry_intent_sha256'];
const isSame=(j,x)=>!!j&&wireFields.every(k=>j[k]===x[k]);
const isJstDate=d=>typeof d==='string'&&/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10);
export async function recurringFinanceReceipt(db,intent,replayed){
 const j=await db.prepare('SELECT * FROM family_recurring_execution_applied WHERE occurrence_id=? LIMIT 1')
  .bind(intent.occurrence_id).first();
 if(!isSame(j,intent))return fail('RECURRING_EXECUTION_RECEIPT_UNKNOWN',404);
 const [entry,audit,lot]=await Promise.all([
  db.prepare('SELECT * FROM entries WHERE id=?').bind(j.target_entry_id).first(),
  db.prepare('SELECT * FROM family_recurring_execution_audit WHERE occurrence_id=?')
   .bind(j.occurrence_id).first(),
  j.plan_type==='sbi_tsumitate'?
   db.prepare('SELECT * FROM family_recurring_sbi_lots WHERE occurrence_id=?')
    .bind(j.occurrence_id).first():Promise.resolve(null)
 ]);
 if(!entry||!audit||audit.member_user_id!==j.member_user_id||
  audit.owner_authorizer_user_id!==j.owner_authorizer_user_id||
  audit.occurred_at!==j.target_applied_at||
  audit.action!==(j.plan_type==='fixed_cost'?'fixed_cost_posted':'sbi_tsumitate_posted')||
  entry.client_request_id!=='hfrecurring:'+j.occurrence_id||
  entry.date!==j.debit_date||entry.amount!==j.amount_jpy||
  entry.payment_source!=='bank:'+j.bank_account_id||
  entry.family_account_id!==j.bank_account_id||
  (j.plan_type==='fixed_cost'?(entry.type!=='expense'||entry.family_transfer_target_account_id!==null):
   (!lot||entry.type!=='transfer'||entry.transfer_applied!==1||
     entry.family_transfer_target_account_id!==j.securities_account_id||
     entry.transfer_target!=='sbi:'+j.securities_account_id||
     entry.transfer_date!==j.effective_date||
     lot.broker_reference_hash!==j.broker_reference_hash||
     lot.confirmed_units!==j.confirmed_units||
     lot.acquisition_cost_jpy!==j.amount_jpy||
     lot.institution_broker_reconciled!==0||
     lot.included_in_tracked_assets!==0)))
  return fail('RECURRING_EXECUTION_JOURNAL_COUNTERPART_UNKNOWN',503);
 return reply({ok:true,applied:true,ledger_applied:true,
  ...Object.fromEntries(wireFields.map(k=>[k,j[k]])),
  owner_authorizer_user_id:j.owner_authorizer_user_id,
  target_plan_type:j.plan_type,
  target_entry_id:j.target_entry_id,
  target_journal_sha256:j.target_journal_sha256,
  target_applied_at:j.target_applied_at,
  external_bank_verified:false,external_broker_verified:false,
  bank_reference_hash:j.bank_reference_hash,
  source_account_id:j.bank_account_id,
  target_securities_account_id:j.securities_account_id,
  fund_code:j.fund_code,
  confirmed_units:j.confirmed_units,
  acquisition_cost_jpy:j.plan_type==='sbi_tsumitate'?j.amount_jpy:null,
  broker_reference_hash:j.broker_reference_hash,
  market_value_jpy:null,broker_reconciled:false,
  included_in_tracked_assets_jpy:false,already_applied:replayed});
}
const cols=['occurrence_id','policy_id','household_id','member_user_id',
 'owner_authorizer_user_id','plan_resource_id','plan_type','plan_payload_sha256',
 'source_account_version','period_key','due_date','amount_jpy',
 'entry_intent_sha256','bank_account_id','bank_reference_hash','debit_date',
 'securities_account_id','securities_version','fund_code','confirmed_units',
 'broker_reference_hash','trade_date','effective_date','target_entry_id',
 'target_journal_sha256','target_applied_at'];
export async function postRecurringFinanceLedger(e,intent,authority){
 const db=e.DB,now=Date.now();
 if(!authority||authority.execution_permitted!==true||
  authority.ledger_applied!==false||authority.plan_type!==intent.plan_type||
  authority.owner_authorizer_user_id===intent.member_user_id||
  typeof authority.owner_authorizer_user_id!=='string'||
  !Number.isSafeInteger(authority.proof_expires_at)||
  authority.proof_expires_at<=now||
  authority.bank_statements_verified_by_institution!==false||
  authority.broker_transactions_verified_by_institution!==false||
  !wireFields.every(k=>authority[k]===intent[k]))
  return fail('RECURRING_FINANCE_AUTHORIZATION_NOT_CURRENT');
 const prior=await db.prepare('SELECT * FROM family_recurring_execution_applied WHERE occurrence_id=?')
  .bind(intent.occurrence_id).first();
 if(prior)return recurringFinanceReceipt(db,intent,true);
 const row=await db.prepare('SELECT p.*,b.version AS bank_live,b.is_archived AS bank_archived,'+
  'b.owner_user_id AS bank_owner,b.account_kind AS bank_kind,b.origin AS bank_origin,'+
  's.version AS securities_live,s.is_archived AS securities_archived,'+
  's.owner_user_id AS securities_owner,s.account_kind AS securities_kind,'+
  'm.role AS member_role,m.state AS member_state,o.role AS owner_role,o.state AS owner_state '+
  'FROM family_member_recurring_plans p '+
  'JOIN family_financial_accounts b ON b.account_id=p.bank_account_id '+
  'LEFT JOIN family_financial_accounts s ON s.account_id=p.securities_account_id '+
  'JOIN homeflow_identity_links m ON m.user_id=p.owner_user_id '+
  'JOIN homeflow_identity_links o ON o.user_id=? '+
  'WHERE p.plan_resource_id=? AND p.household_id=? LIMIT 1')
  .bind(authority.owner_authorizer_user_id,intent.plan_resource_id,intent.household_id).first();
 if(!row||row.status!=='active'||row.plan_type!==intent.plan_type||
  row.owner_user_id!==intent.member_user_id||
  row.plan_payload_sha256!==intent.plan_payload_sha256||
  row.bank_version!==intent.source_account_version||
  row.bank_account_id!==intent.bank_account_id||
  row.amount_jpy!==intent.amount_jpy||
  row.start_month>intent.period_key||row.end_month<intent.period_key||
  String(row.due_day).padStart(2,'0')!==intent.due_date.slice(-2)||
  row.bank_live!==intent.source_account_version||row.bank_archived!==0||
  row.bank_owner!==intent.member_user_id||row.bank_kind!=='bank'||row.bank_origin!=='member_created'||
  row.member_role!=='member'||row.member_state!=='active'||
  row.owner_role!=='owner'||row.owner_state!=='active'||
  (intent.plan_type==='sbi_tsumitate'&&(
   row.securities_account_id!==intent.securities_account_id||
   row.securities_version!==intent.securities_version||
   row.securities_live!==intent.securities_version||
   row.securities_archived!==0||row.securities_owner!==intent.member_user_id||
   row.securities_kind!=='securities'||row.fund_code!==intent.fund_code))||
  !isJstDate(intent.debit_date)||!isJstDate(intent.due_date)||
  intent.debit_date<intent.due_date||intent.debit_date>today()||
  intent.debit_date>new Date(Date.parse(intent.due_date+'T00:00:00Z')+7*86400000)
    .toISOString().slice(0,10))
  return fail('RECURRING_FINANCE_PLAN_OR_ACCOUNT_CHANGED');
 const at=Date.now(),entryRef='hfrecurring:'+intent.occurrence_id;
 const journalHash=await hash(JSON.stringify({occurrence_id:intent.occurrence_id,
  policy_id:intent.policy_id,entry_intent_sha256:intent.entry_intent_sha256,
  owner_authorizer_user_id:authority.owner_authorizer_user_id,
  plan_type:intent.plan_type,bank_account_id:intent.bank_account_id,
  bank_reference_hash:intent.bank_reference_hash,
  broker_reference_hash:intent.broker_reference_hash,
  amount_jpy:intent.amount_jpy,target_applied_at:at}));
 const isSbi=intent.plan_type==='sbi_tsumitate';
 const entry=isSbi?db.prepare('INSERT INTO entries '+
  '(date,time,amount,category,merchant,note,raw,type,transfer_target,transfer_applied,'+
  'transfer_date,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) '+
  "VALUES(?,'',?,'投資・資産移動','SBI証券','周期積立・本人約定申告','','transfer',?,1,?,?,?,?,?)")
   .bind(intent.debit_date,intent.amount_jpy,'sbi:'+intent.securities_account_id,
    intent.effective_date,entryRef,'bank:'+intent.bank_account_id,
    intent.bank_account_id,intent.securities_account_id):
   db.prepare('INSERT INTO entries '+
    '(date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,'+
    'family_account_id) VALUES(? ,\'\',?,?,?,\'周期固定費・本人支払済み申告\',\'\',\'expense\',?,?,?)')
    .bind(intent.debit_date,intent.amount_jpy,row.category,row.merchant,
     entryRef,'bank:'+intent.bank_account_id,intent.bank_account_id);
 const data={...Object.fromEntries(cols.map(k=>[k,intent[k]??null])),
  owner_authorizer_user_id:authority.owner_authorizer_user_id,
  plan_type:intent.plan_type,target_journal_sha256:journalHash,
  target_applied_at:at};
 const fields=cols.map(c=>c==='target_entry_id'?'(SELECT id FROM entries WHERE client_request_id=?)':'?');
 const vals=cols.map(c=>c==='target_entry_id'?entryRef:data[c]);
 const journal=db.prepare('INSERT INTO family_recurring_execution_applied ('+
  cols.join(',')+') VALUES('+fields.join(',')+')').bind(...vals);
 const statements=[entry,journal];
 if(isSbi)statements.push(db.prepare('INSERT INTO family_recurring_sbi_lots '+
  '(occurrence_id,household_id,owner_user_id,securities_account_id,fund_code,'+
  'account_type,confirmed_units,acquisition_cost_jpy,broker_reference_hash,'+
  "trade_date,effective_date,recorded_at) VALUES(?,?,?,?,?,'tsumitate',?,?,?,?,?,?)")
  .bind(intent.occurrence_id,intent.household_id,intent.member_user_id,
   intent.securities_account_id,intent.fund_code,intent.confirmed_units,
   intent.amount_jpy,intent.broker_reference_hash,intent.trade_date,intent.effective_date,at));
 statements.push(db.prepare('INSERT INTO family_recurring_execution_audit '+
  '(audit_id,occurrence_id,member_user_id,owner_authorizer_user_id,actor_type,action,occurred_at) '+
  "VALUES(?,?,?,?,'policy_authorized_internal_service',?,?)")
  .bind(newId(),intent.occurrence_id,intent.member_user_id,
   authority.owner_authorizer_user_id,isSbi?'sbi_tsumitate_posted':'fixed_cost_posted',at));
 try{
  const result=await db.batch(statements);
  if(result.length!==statements.length||result.some(r=>r.meta?.changes!==1))
   return fail('RECURRING_LEDGER_ATOMIC_CONFIRMATION_REQUIRED',503);
 }catch{
  const raced=await db.prepare('SELECT * FROM family_recurring_execution_applied WHERE occurrence_id=?')
   .bind(intent.occurrence_id).first().catch(()=>null);
  return isSame(raced,intent)?recurringFinanceReceipt(db,intent,true):
   fail('RECURRING_LEDGER_BATCH_ROLLED_BACK',503);
 }
 return recurringFinanceReceipt(db,intent,false);
}
