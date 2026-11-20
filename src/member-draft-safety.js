// Durable household-member drafts: deliberately store text/typed fields only.
// Image Blobs remain explicitly user-supplied and must be reselected after a
// restart; do not turn an OCR-only operation into an R2 upload.
export function memberDraftSnapshot({userId,householdId,forms=[],rawText='',inputMode='manual',pendingPaidEntry=null}) {
  if(!userId||!householdId||!Array.isArray(forms))throw Error('家族の下書きが無効です')
  const cleanForms=forms.slice(0,150).map(form=>{
    const {receiptImage,receiptFileName,showReceiptAttachment,...record}=form||{}
    return JSON.parse(JSON.stringify(record))
  })
  return {
    version:1,userId,householdId,updatedAt:Date.now(),
    forms:cleanForms,rawText:String(rawText||'').slice(0,100000),
    inputMode:inputMode==='scan'?'scan':'manual',
    pendingPaidEntry:pendingPaidEntry ? JSON.parse(JSON.stringify(pendingPaidEntry)) : null
  }
}
export function verifiedMemberDraft(saved,userId,householdId) {
  if(!saved||saved.version!==1||saved.userId!==userId||
     saved.householdId!==householdId||!Array.isArray(saved.forms)||
     saved.forms.length>150||typeof saved.rawText!=='string'||
     saved.rawText.length>100000||
     !['manual','scan'].includes(saved.inputMode))return null
  const pending=saved.pendingPaidEntry
  if(pending && (typeof pending.snapshot!=='string'||
     !pending.snapshot.includes(userId)||
     !/^member-spend:[0-9a-f-]{36}$/.test(pending.key||'')||
     (pending.requestId!=null&&typeof pending.requestId!=='string')))return null
  return {
    forms:saved.forms.map(x=>({...x,receiptImage:null,receiptFileName:''})),
    rawText:saved.rawText,inputMode:saved.inputMode,
    pendingPaidEntry:pending||null
  }
}
export function memberRetrySnapshot({operation,entry,resourceId=null,expectedVersion=0}) {
  return JSON.stringify({operation,entry,resource_id:resourceId,expected_version:expectedVersion})
}
