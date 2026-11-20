// Private, identity-scoped, durable receipt upload outbox.
// Keep image Blobs separate from text-only member drafts and never send them to D1.
// A receipt is removed here only after the server confirmed R2 and the ledger
// draft was durably consumed. Closing iOS Safari must not erase retry evidence.
const DB_NAME='kakeibo-member-receipt-outbox'
const STORE='pending'
const ACTOR=/^[a-zA-Z0-9_-]{1,128}$/
const KEY=/^receipt:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const REF=/^(?:proposal|request):[a-f0-9]{32}$|^entry:[1-9][0-9]{0,14}$/
const MAX=200*1024

export function memberReceiptOutboxKey(userId,householdId,key){
 if(!ACTOR.test(userId||'')||!ACTOR.test(householdId||'')||!KEY.test(key||''))
  throw Error('小票の保存先の本人確認に失敗しました')
 return 'member-v1:'+householdId+':'+userId+':'+key
}
function prefix(userId,householdId){
 return memberReceiptOutboxKey(userId,householdId,'receipt:00000000-0000-0000-0000-000000000000').split('receipt:')[0]
}
function open(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1)
  request.onupgradeneeded=()=>{
   if(!request.result.objectStoreNames.contains(STORE))
    request.result.createObjectStore(STORE)
  }
  request.onsuccess=()=>resolve(request.result)
  request.onerror=()=>reject(request.error||Error('小票保存領域を開けません'))
  request.onblocked=()=>reject(Error('小票保存領域が使用中です'))
 })
}
async function transaction(mode,action){
 const db=await open()
 return new Promise((resolve,reject)=>{
  let value,settled=false
  const done=(fn,v)=>{if(settled)return;settled=true;db.close();fn(v)}
  try{
   const tx=db.transaction(STORE,mode)
   const request=action(tx.objectStore(STORE))
   request.onsuccess=()=>{value=request.result}
   request.onerror=()=>done(reject,request.error||Error('小票の保存に失敗しました'))
   tx.oncomplete=()=>done(resolve,value)
   tx.onerror=()=>done(reject,tx.error||Error('小票の保存に失敗しました'))
   tx.onabort=()=>done(reject,tx.error||Error('小票の保存が中断されました'))
  }catch(error){done(reject,error)}
 })
}
async function digest(blob){
 const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())
 return [...new Uint8Array(hash)].map(v=>v.toString(16).padStart(2,'0')).join('')
}
export async function stageMemberReceiptOutbox({userId,householdId,key,blob,date,merchant}){
 const id=memberReceiptOutboxKey(userId,householdId,key)
 if(!(blob instanceof Blob)||!['image/jpeg','image/webp'].includes(blob.type)||
    blob.size<1||blob.size>MAX)
  throw Error('小票は200KB以下のJPEG・WebP画像を選択してください')
 const sha256=await digest(blob)
 const previous=await transaction('readonly',store=>store.get(id))
 if(previous){
  if(previous.sha256!==sha256)
   throw Error('保存済み小票と画像が異なります。再度添付してください')
  return previous
 }
 const row={version:1,userId,householdId,key,receiptRef:'',
  date:String(date||''),merchant:String(merchant||'').slice(0,120),
  blob,sha256,createdAt:Date.now()}
 await transaction('readwrite',store=>store.put(row,id))
 return row
}
export async function bindMemberReceiptOutbox({userId,householdId,key,receiptRef}){
 if(!REF.test(receiptRef||''))throw Error('小票の記帳先を確認できません')
 const id=memberReceiptOutboxKey(userId,householdId,key)
 const row=await transaction('readonly',store=>store.get(id))
 if(!row||row.version!==1||row.userId!==userId||row.householdId!==householdId)
  throw Error('小票の端末保存を確認できません。再送せず元の画像を保持してください')
 if(row.receiptRef&&row.receiptRef!==receiptRef)
  throw Error('別の記帳先へ同じ小票を送信できません')
 if(!row.receiptRef)await transaction('readwrite',store=>store.put({...row,receiptRef},id))
}
export async function readMemberReceiptOutbox(userId,householdId){
 const p=prefix(userId,householdId)
 const items=await transaction('readonly',store=>store.getAll(IDBKeyRange.bound(p,p+'\uffff')))
 return (items||[]).filter(row=>row?.version===1&&row.userId===userId&&
  row.householdId===householdId&&KEY.test(row.key||'')&&
  row.blob instanceof Blob&&row.blob.size<=MAX&&row.sha256)
}
export function removeMemberReceiptOutbox(userId,householdId,key){
 return transaction('readwrite',store=>store.delete(memberReceiptOutboxKey(userId,householdId,key)))
}
