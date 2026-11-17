// Only PRIVATE HomeFlow-confirmed shared-entry execution may use these
// statements. They are returned for inclusion in the same D1 db.batch as
// the protected ledger mutation and the immutable owner-review receipt.
import {planAccountLinkedExpenseCorrection,closingMonth} from '../../../src/approved-account-correction-plan.js';
import {memberPrepaidBalances} from '../family-finance/prepaid-balance-projection.js';

const id32=/^[a-f0-9]{32}$/;
const spendSource=s=>typeof s==='string'&&/^(?:cc|prepaid):[a-f0-9]{32}$/.test(s);
const fail=code=>({error:code});
export async function futureApprovedPaidRevision(db,{env,registry,proposal,approval,
  requestId,entry,action,at}){
 if(!registry)return null;
 const original=await db.prepare(
  "SELECT 'credit_card' kind,homeflow_request_id receipt_id,requester_user_id spender "+
  "FROM family_card_purchase_applied WHERE entry_id=? AND household_id=? "+
  "UNION ALL "+
  "SELECT 'prepaid' kind,homeflow_request_id receipt_id,requester_user_id spender "+
  "FROM family_prepaid_actions_applied WHERE entry_id=? AND household_id=? AND action='spend' "+
  "LIMIT 2").bind(registry.entry_id,proposal.household_id,
   registry.entry_id,proposal.household_id).all();
 if(!original?.results?.length)return null;
 if(original.results.length!==1)return fail('CORRECTION_AMBIGUOUS_ORIGINAL');
 if(env.KAKEIBO_ACCOUNT_CORRECTIONS_ENABLED!=='true')
  return fail('CORRECTION_EXECUTOR_DISABLED');
 // Deletion is an approved ZERO-value tombstone while the immutable original
 // receipt and its foreign keys remain intact. Restoration reauthorizes the
 // original expense only after current balance and approval checks.
 if(!['update','delete','restore'].includes(action))
  return fail('CORRECTION_UNKNOWN_ACTION');
 const source=original.results[0];
 const physical=await db.prepare(
  'SELECT id,date,amount,type,payment_source,family_account_id,'+
  'client_request_id FROM entries WHERE id=? LIMIT 1')
  .bind(registry.entry_id).first();
 // A zero-account row is valid only if the immediately preceding immutable,
 // owner-approved correction moved this SAME paid receipt to cash. Never
 // mistake an arbitrary legacy cash record for an eligible paid entry.
 const validCard=!!physical?.family_account_id&&spendSource(physical.payment_source)&&
  physical.payment_source.split(':')[1]===physical.family_account_id;
 const validCash=physical?.family_account_id===null&&physical?.payment_source===''&&
  !!await db.prepare('SELECT 1 FROM family_approved_account_corrections '+
   "WHERE entry_id=? AND version_after=? AND json_extract(after_json,'$.accountId') IS NULL "+
   "AND CAST(json_extract(after_json,'$.amount') AS INTEGER)=? LIMIT 1")
   .bind(registry.entry_id,registry.version,physical.amount).first();
 if(!physical||physical.type!=='expense'||!(validCard||validCash)||
  physical.client_request_id!=='hf'+(source.kind==='credit_card'?'card':'prepaid')+':'+source.receipt_id)
  return fail('CORRECTION_ORIGINAL_ENTRY_CHANGED');
 let previous;
 try{previous=JSON.parse(registry.snapshot_json)}catch{return fail('CORRECTION_SNAPSHOT_INVALID')}
 if(previous?.type!=='expense'||previous.date!==physical.date||
  (previous.payment_source||'')!==physical.payment_source||
  (action==='restore'?physical.amount!==0:
   previous.amount!==physical.amount||physical.amount<1))
  return fail('CORRECTION_SNAPSHOT_CHANGED');
 const next=action==='delete'?{...previous,amount:0}:
  action==='restore'?previous:entry;
 if(!next||next.type!=='expense'||(action!=='delete'&&next.amount<1))
  return fail('CORRECTION_INVALID_NEXT_ENTRY');
 const explicit=action==='update'&&Object.hasOwn(next,'payment_source');
 const newSource=explicit?next.payment_source:physical.payment_source;
 if(newSource!==''&&!spendSource(newSource))return fail('CORRECTION_TARGET_MUST_BE_PERSONAL_ACCOUNT');
 const newAccountId=newSource===''?null:newSource.split(':')[1];
 if(explicit&&newAccountId!==physical.family_account_id&&
  proposal.requester_user_id!==source.spender)
  return fail('CORRECTION_OTHER_PERSON_ACCOUNT_READ_ONLY');
 const rows=await db.prepare(
  'SELECT account_id,owner_user_id,account_kind,origin,is_archived,closing_day '+
  'FROM family_financial_accounts WHERE household_id=? AND owner_user_id=?')
  .bind(proposal.household_id,source.spender).all();
 const accounts=rows.results||[];
 const target=newAccountId?accounts.find(x=>x.account_id===newAccountId):null;
 if(newAccountId&&(!target||newSource!==(target.account_kind==='credit_card'?'cc:':'prepaid:')+newAccountId))
  return fail('CORRECTION_ACCOUNT_KIND_MISMATCH');
 const prepaid=await memberPrepaidBalances(db,proposal.household_id);
 if(!prepaid)return fail('CORRECTION_PREPAID_BALANCE_UNKNOWN');
 const balances=Object.fromEntries(prepaid.accounts.map(x=>[x.account_id,x.balance_jpy]));
 // Changes to an already settled/points-offset purchase require an immutable
 // allocation reversal FIRST. Do not silently leave money on the old account.
 const settlement=await db.prepare(
  'SELECT COALESCE(SUM(amount_jpy),0) amount FROM family_card_settlement_allocations '+
  'WHERE purchase_request_id=?').bind(source.receipt_id).first();
 const points=await db.prepare(
  'SELECT COALESCE(SUM(o.amount_jpy-COALESCE(r.restored_jpy,0)),0) amount '+
  'FROM family_points_card_offsets o LEFT JOIN family_points_card_offset_refunds r '+
  'ON r.original_request_id=o.homeflow_request_id WHERE o.purchase_request_id=?')
  .bind(source.receipt_id).first();
 const before={type:'expense',date:physical.date,amount:physical.amount,
  accountId:physical.family_account_id};
 const after={type:'expense',date:next.date,amount:next.amount,
  accountId:newAccountId};
 let planned;
 try{planned=planAccountLinkedExpenseCorrection({
  before,after,accounts,spenderUserId:source.spender,
  editorUserId:proposal.requester_user_id,prepaidBalances:balances,
  settledJpy:Number(settlement?.amount||0),offsetJpy:Number(points?.amount||0),
  operation:action
 })}catch(err){return fail(err.code||'CORRECTION_PLAN_INVALID')}
 const commands=[db.prepare('INSERT INTO family_approved_account_corrections '+
  '(homeflow_request_id,proposal_id,household_id,entry_id,spender_user_id,'+
  'requester_user_id,approver_user_id,version_before,version_after,before_json,'+
  'after_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(requestId,proposal.proposal_id,proposal.household_id,registry.entry_id,
   source.spender,proposal.requester_user_id,approval.approver_user_id,
   registry.version,registry.version+1,JSON.stringify(before),JSON.stringify(after),at)];
 const originalAccount=accounts.find(x=>x.account_id===physical.family_account_id);
 const oldMonth=originalAccount?.account_kind==='credit_card'?
  closingMonth(physical.date,originalAccount.closing_day):null;
 const nextMonth=target?.account_kind==='credit_card'?
  closingMonth(next.date,target.closing_day):null;
 for(const x of planned.effects){
  const beforeCount=Number(before.amount)>0&&x.kind==='credit_card'&&
   x.accountId===physical.family_account_id&&
   x.billMonth===oldMonth?1:0;
  const afterCount=Number(after.amount)>0&&x.kind==='credit_card'&&
   x.accountId===newAccountId&&
   x.billMonth===nextMonth?1:0;
  const count=afterCount-beforeCount;
  commands.push(db.prepare('INSERT INTO family_approved_account_effects '+
   '(homeflow_request_id,household_id,account_id,account_kind,bill_month,'+
   'delta_jpy,purchase_count_delta,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(requestId,proposal.household_id,x.accountId,x.kind,
    x.billMonth||'',x.deltaJpy,count,at));
 }
 return {commands,originalClientId:physical.client_request_id,
  originalAccountId:physical.family_account_id,
  newAccountId,paymentSource:newSource,amount:physical.amount,date:physical.date,
  requiresApproval:true};
}
