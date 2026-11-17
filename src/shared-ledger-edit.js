// Payment belongs to its verified owner. An administrator must not silently
// become the owner of a spouse's historical card or cash selection.
export function isAnotherMembersPayment(entry,viewerUserId){
 if(!entry||typeof viewerUserId!=='string'||!viewerUserId)return true
 const ids=['shared_entry_requester_user_id','shared_card_actor_user_id',
  'payment_account_owner_user_id']
  .map(key=>entry[key]).filter(x=>typeof x==='string'&&x)
 return ids.some(id=>id!==viewerUserId)
}

// Owner-side original ledger editor -> protected household CAS write.
// Include the visible payment selection; omitting it silently kept the old
// card/cash even though the UI reported a successful revision.
export function sharedEntryFromEditor(e){
 return {
  date:e.date,time:e.time||'',amount:Number(e.amount),
  type:e.type,category:e.category,merchant:e.merchant||'',note:e.note||'',
  ...(e.type==='expense'?{payment_source:String(e.paymentSource??'')}:{ }),
  ...(e.type==='transfer'?{transfer_target:e.transferTarget,transfer_date:e.transferDate}:{})
 }
}
export function sameSharedEditValues(expected,actual){
 if(!expected||!actual)return false
 const keys=['date','time','amount','type','category','merchant','note']
 if(expected.type==='expense')keys.push('payment_source')
 if(expected.type==='transfer')keys.push('transfer_target','transfer_date')
 return keys.every(key=>{
  const empty=key==='payment_source'||key==='time'||key==='merchant'||key==='note'
  const a=expected[key]??(empty?'':null)
  const b=actual[key]??(empty?'':null)
  return key==='amount'?Number(a)===Number(b):a===b
 })
}
export function sharedEditConfirmed(requested,response,beforeVersion){
 return response?.ok===true&&response?.applied===true&&
  response.action?.version===beforeVersion+1&&
  response.action?.state==='active'&&
  sameSharedEditValues(requested,response.action?.entry)
}

export function sharedDeleteConfirmed(receipt,expectedEntryId,beforeVersion){
 return receipt?.ok===true&&receipt?.applied===true&&
  receipt.action?.entry_id===Number(expectedEntryId)&&
  receipt.action?.state==='deleted'&&
  receipt.action?.version===beforeVersion+1&&
  receipt.action?.entry!==null
}
