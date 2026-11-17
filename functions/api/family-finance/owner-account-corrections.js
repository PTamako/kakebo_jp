// Signed-in household owner only. This is NOT a member asset-management route:
// the original spender always owns the card and its immutable purchase receipt.
// Return only D1 statements to be placed in the same CAS batch as the owner
// household-ledger mutation; never reveal a private account list to the browser.
import {planAccountLinkedExpenseCorrection,closingMonth} from '../../../src/approved-account-correction-plan.js';
import {memberPrepaidBalances} from './prepaid-balance-projection.js';

const fail=code=>({error:code});
const amount=x=>Number.isSafeInteger(Number(x))?Number(x):NaN;
export async function prepareOwnerAccountCorrection(db,{registry,householdId,actorUserId,
 action,entry,at,correctionId}){
 if(!registry||!['update','delete','restore'].includes(action))return null;
 const paid=(await db.prepare(
  "SELECT 'credit_card' kind,homeflow_request_id receipt,requester_user_id spender "+
  "FROM family_card_purchase_applied WHERE entry_id=? AND household_id=? UNION ALL "+
  "SELECT 'prepaid' kind,homeflow_request_id receipt,requester_user_id spender "+
  "FROM family_prepaid_actions_applied WHERE entry_id=? AND household_id=? AND action='spend' LIMIT 2")
  .bind(registry.entry_id,householdId,registry.entry_id,householdId).all()).results||[];
 if(!paid.length)return null;
 if(paid.length!==1)return fail('OWNER_CORRECTION_ORIGINAL_AMBIGUOUS');
 const source=paid[0];
 const actor=await db.prepare('SELECT role,state FROM homeflow_identity_links WHERE user_id=? AND household_id=?')
  .bind(actorUserId,householdId).first();
 if(actor?.role!=='owner'||actor?.state!=='active')return fail('OWNER_CORRECTION_OWNER_REQUIRED');
 const physical=await db.prepare('SELECT date,amount,type,payment_source,family_account_id,client_request_id '+
  'FROM entries WHERE id=?').bind(registry.entry_id).first();
 if(!physical||physical.type!=='expense'||
    physical.client_request_id!=='hf'+(source.kind==='credit_card'?'card':'prepaid')+':'+source.receipt)
  return fail('OWNER_CORRECTION_ORIGINAL_INVALID');
 let snapshot;
 try{snapshot=JSON.parse(registry.snapshot_json)}catch{return fail('OWNER_CORRECTION_SNAPSHOT_INVALID')}
 if(snapshot?.type!=='expense'||snapshot.date!==physical.date||
    (snapshot.payment_source||'')!==physical.payment_source||
    (action==='restore'?physical.amount!==0:snapshot.amount!==physical.amount||physical.amount<1))
  return fail('OWNER_CORRECTION_STALE_SNAPSHOT');
 const next=action==='delete'?{...snapshot,amount:0}:
  action==='restore'?snapshot:entry;
 if(!next||next.type!=='expense'||(action!=='delete'&&amount(next.amount)<1)||
    (Object.hasOwn(next,'payment_source')&&next.payment_source!==physical.payment_source))
  return fail('OWNER_CORRECTION_PRIVATE_PAYMENT_READ_ONLY');
 const accounts=(await db.prepare('SELECT account_id,owner_user_id,account_kind,origin,is_archived,closing_day '+
  'FROM family_financial_accounts WHERE household_id=? AND owner_user_id=?')
  .bind(householdId,source.spender).all()).results||[];
 const original=accounts.find(a=>a.account_id===physical.family_account_id);
 if(!original||!['prepaid','credit_card'].includes(original.account_kind)||
    original.origin!=='member_created'||original.is_archived!==0||
    physical.payment_source!==(original.account_kind==='credit_card'?'cc:':'prepaid:')+original.account_id)
  return fail('OWNER_CORRECTION_PRIVATE_ACCOUNT_ORIGIN_INVALID');
 // Do not let household-admin privilege migrate the spouse's private
 // payment method to cash, another private card or another account.
 const before={type:'expense',date:physical.date,amount:physical.amount,accountId:original.account_id};
 const after={type:'expense',date:next.date,amount:next.amount,accountId:original.account_id};
 const prepaid=await memberPrepaidBalances(db,householdId);
 if(!prepaid)return fail('OWNER_CORRECTION_BALANCE_UNAVAILABLE');
 const balances=Object.fromEntries(prepaid.accounts.map(a=>[a.account_id,a.balance_jpy]));
 const settlement=await db.prepare('SELECT COALESCE(SUM(amount_jpy),0) n FROM family_card_settlement_allocations '+
  'WHERE purchase_request_id=?').bind(source.receipt).first();
 const points=await db.prepare('SELECT COALESCE(SUM(o.amount_jpy-COALESCE(r.restored_jpy,0)),0) n '+
  'FROM family_points_card_offsets o LEFT JOIN family_points_card_offset_refunds r '+
  'ON r.original_request_id=o.homeflow_request_id WHERE o.purchase_request_id=?')
  .bind(source.receipt).first();
 let plan;
 try{plan=planAccountLinkedExpenseCorrection({before,after,accounts,spenderUserId:source.spender,
  editorUserId:actorUserId,prepaidBalances:balances,
  settledJpy:Number(settlement?.n||0),offsetJpy:Number(points?.n||0),operation:action})}
 catch(e){return fail(e.code||'OWNER_CORRECTION_INVALID_PLAN')}
 const commands=[db.prepare('INSERT INTO family_owner_account_corrections '+
  '(correction_id,household_id,resource_id,entry_id,owner_user_id,spender_user_id,'+
  'version_before,version_after,before_json,after_json,action,created_at) '+
  'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
  .bind(correctionId,householdId,registry.resource_id,registry.entry_id,actorUserId,source.spender,
   registry.version,registry.version+1,JSON.stringify(before),JSON.stringify(after),action,at)];
 const bill=original.account_kind==='credit_card'?closingMonth(physical.date,original.closing_day):null;
 const later=original.account_kind==='credit_card'?closingMonth(next.date,original.closing_day):null;
 for(const e of plan.effects){
  const count=(after.amount>0&&e.billMonth===later?1:0)-
   (before.amount>0&&e.billMonth===bill?1:0);
  commands.push(db.prepare('INSERT INTO family_owner_account_effects '+
   '(correction_id,household_id,account_id,account_kind,bill_month,delta_jpy,purchase_count_delta,created_at) '+
   'VALUES(?,?,?,?,?,?,?,?)').bind(correctionId,householdId,e.accountId,e.kind,e.billMonth||'',
    e.deltaJpy,e.kind==='credit_card'?count:0,at));
 }
 return {commands,amountBefore:physical.amount,dateBefore:physical.date,
  clientRequestId:physical.client_request_id,accountId:original.account_id,
  paymentSource:physical.payment_source,amountAfter:next.amount,dateAfter:next.date,
  entryAfter:next,correctionId};
}
