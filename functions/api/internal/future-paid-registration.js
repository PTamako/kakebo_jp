// Register only newly approved member-owned card/prepaid expenses as
// editable household resources in the SAME atomic transaction as the original
// immutable purchase. Never retroactively adopt existing / historical rows.
const enc=new TextEncoder();
const hash=async x=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(x)))]
 .map(b=>b.toString(16).padStart(2,'0')).join('');
export async function futurePaidRegistrationCommands(db,{householdId,memberUserId,
  requestId,kind,accountId,date,amount,category,merchant,note,at}){
 if(!['credit_card','prepaid'].includes(kind)||!requestId||!memberUserId||
  !householdId||!accountId||!Number.isSafeInteger(amount)||amount<1)
  throw Error('FUTURE_PAID_REGISTRATION_INVALID');
 const resourceId=(await hash('kakeibo:future-paid:'+requestId)).slice(0,32);
 const reference='hf'+(kind==='credit_card'?'card':'prepaid')+':'+requestId;
 const snapshot=JSON.stringify({date,time:'',amount,type:'expense',
  category,merchant,note,payment_source:(kind==='credit_card'?'cc:':'prepaid:')+accountId});
 const payloadSha=await hash(snapshot);
 const statements=[
  db.prepare('INSERT INTO family_shared_entry_write_context '+
   '(resource_id,entry_id,actor_user_id,action,expected_version,stamp) '+
   "SELECT ?,id,?,'create',0,? FROM entries WHERE client_request_id=?")
   .bind(resourceId,memberUserId,at,reference),
  db.prepare('INSERT INTO family_shared_entry_registry '+
   '(resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,state,'+
   'version,snapshot_json,payload_sha256,created_at,updated_at) '+
   "SELECT ?,?,id,?,?,'active',1,?,?,?,? FROM entries WHERE client_request_id=?")
   .bind(resourceId,householdId,memberUserId,memberUserId,snapshot,payloadSha,at,at,reference),
  db.prepare('DELETE FROM family_shared_entry_write_context WHERE resource_id=?')
   .bind(resourceId)
 ];
 return {resourceId,statements};
}
