// Export-only provenance of the CURRENT authenticated member's transactions.
// Never expose the household owner's historical ledger or anyone's private balances.
// This endpoint has no mutation methods, no arbitrary table or SQL input.
const json=(body,status=200)=>Response.json(body,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,status=403)=>json({ok:false,code},status);
const pageSize=80;
const sources=Object.freeze({
 shared:{table:'family_shared_mutation_applied',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'entry_id'},
 card:{table:'family_card_purchase_applied',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'entry_id'},
 settlement:{table:'family_card_settlements_applied',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'transfer_entry_id'},
 prepaid:{table:'family_prepaid_actions_applied',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'entry_id'},
 sbi:{table:'family_sbi_cash_applied',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'transfer_entry_id'},
 bank:{table:'family_bank_transfers_applied',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'transfer_entry_id'},
 cross_bank:{table:'family_cross_bank_journal',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'transfer_entry_id'},
 points:{table:'family_points_journal',owner:'requester_user_id',stamp:'applied_at',id:'homeflow_request_id',entry:'linked_entry_id'},
 points_sbi:{table:'family_sbi_point_lots',owner:'owner_user_id',stamp:'recorded_at',id:'homeflow_request_id',entry:null},
 legacy_spend:{table:'family_legacy_card_spends',owner:'actor_user_id',stamp:'created_at',id:'spend_id',entry:'entry_id'}
});
const before=/^([1-9][0-9]{10,15})\.([a-f0-9-]{32,36})$/i;
export async function familyMemberArchiveHistory(req,env,url,user,parts){
 if(req.method!=='GET'||parts.length!==1)return fail('NOT_FOUND',404);
 if(user?.role!=='member'||!user.user_id||!user.household_id||!env.DB?.prepare)
  return fail('MEMBER_REQUIRED',403);
 const kind=url.searchParams.get('kind');
 if(!Object.hasOwn(sources,kind))return fail('ARCHIVE_KIND_INVALID',400);
 const cursor=url.searchParams.get('before')||'';
 if(cursor&&!before.test(cursor))return fail('ARCHIVE_CURSOR_INVALID',400);
 const config=sources[kind];
 try{
  const active=await env.DB.prepare("SELECT 1 FROM homeflow_identity_links "+
   "WHERE user_id=? AND household_id=? AND role='member' AND state='active' LIMIT 1")
   .bind(user.user_id,user.household_id).first();
  if(!active)return fail('SESSION_REVOKED',403);
  const fields="e.id AS archived_entry_id,e.date AS archived_entry_date,"+
   "e.time AS archived_entry_time,e.type AS archived_entry_type,"+
   "e.amount AS archived_entry_amount,e.category AS archived_entry_category,"+
   "e.merchant AS archived_entry_merchant,e.note AS archived_entry_note";
  const link=config.entry?" LEFT JOIN entries e ON e.id=j."+config.entry:
   " LEFT JOIN entries e ON 1=0";
  const sql="SELECT j.*,"+fields+" FROM "+config.table+" j"+link+
   " WHERE j.household_id=? AND j."+config.owner+"=? "+
   "AND (?='' OR j."+config.stamp+"<? OR (j."+config.stamp+"=? AND j."+config.id+"<?)) "+
   "ORDER BY j."+config.stamp+" DESC,j."+config.id+" DESC LIMIT ?";
  const stamp=cursor?Number(cursor.split('.')[0]):0;
  const pk=cursor?cursor.slice(cursor.indexOf('.')+1):'';
  const result=await env.DB.prepare(sql).bind(user.household_id,user.user_id,
   cursor,stamp,stamp,pk,pageSize+1).all();
  const items=result.results||[],page=items.slice(0,pageSize),last=page.at(-1);
  return json({ok:true,scope:'personal',viewer_user_id:user.user_id,
   kind,items:page,read_only:true,
   next_cursor:items.length>pageSize&&last?
    String(last[config.stamp])+'.'+String(last[config.id]):null});
 }catch{return fail('ARCHIVE_HISTORY_UNAVAILABLE',503)}
}
