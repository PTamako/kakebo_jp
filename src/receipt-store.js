// Receipt photos never leave this browser. Device mode: durable IndexedDB until an explicit deletion.
// Session mode: sessionStorage (cleared with the browser session or logout).
// Do not silently delete already-saved images while switching modes.
const DB_NAME='kakeibo-receipt-images'
const STORE='receipts'
const SESSION_PREFIX='kakeibo-session-receipt-v1-'
const storeSession=()=>typeof sessionStorage==='undefined'?null:sessionStorage
let deviceMode = true
// The preference comes from authenticated D1 settings, not browser storage.
export function configureReceiptStorageMode(remember) { deviceMode = !!remember }
const isDeviceMode=()=>deviceMode
const sessionKey=id=>SESSION_PREFIX+id
const sessionKeys=()=>{
  const storage=storeSession()
  if(!storage)return []
  const keys=[]
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i)
    if(key?.startsWith(SESSION_PREFIX))keys.push(key)
  }
  return keys
}
const openDb=()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME,1)
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'entryId'})
  request.onsuccess=()=>resolve(request.result)
  request.onerror=()=>reject(request.error)
})
async function operate(mode,callback){
  const db=await openDb()
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode)
      let result
      try{result=callback(tx.objectStore(STORE))}catch(error){reject(error);return}
      tx.oncomplete=()=>resolve(result?.result)
      tx.onerror=()=>reject(tx.error)
      tx.onabort=()=>reject(tx.error)
    })
  }finally{db.close()}
}
const validRow=row=>Number.isSafeInteger(row?.entryId) && row.entryId>0 &&
  ['image/webp','image/jpeg'].includes(row.blob?.type)
async function readDeviceRows(){
  return (await operate('readonly',store=>store.getAll())||[]).filter(validRow)
}
async function encodeImage(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer())
  let binary=''
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
  return btoa(binary)
}
const decodeImage=(base64,mime)=>{
  const binary=atob(base64),bytes=new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i)
  return new Blob([bytes],{type:mime})
}
async function serializeSessionRow(row){
  return JSON.stringify({entryId:row.entryId,expiresAt:row.expiresAt,
    mime:row.blob.type,base64:await encodeImage(row.blob)})
}
function readSessionRow(key){
  const storage=storeSession()
  if(!storage)return null
  try{
    const data=JSON.parse(storage.getItem(key)||'null')
    if(!Number.isSafeInteger(data?.entryId) || data.entryId<=0 ||
      !['image/jpeg','image/webp'].includes(data.mime) || !data.base64)return null
    return {entryId:data.entryId,expiresAt:data.expiresAt,blob:decodeImage(data.base64,data.mime)}
  }catch{return null}
}
const readSessionRows=()=>sessionKeys().map(readSessionRow).filter(Boolean)
const writeSessionRow=async row=>{
  const storage=storeSession()
  if(!storage)throw Error('セッション内に画像を保存できません')
  storage.setItem(sessionKey(row.entryId),await serializeSessionRow(row))
}

// A change of policy first copies all live photos to the destination.
// On copy/quota failure, leave both the old policy and original images intact.
export async function setReceiptStorageMode(remember){
  if(remember){
    const rows=readSessionRows()
    for(const row of rows)await operate('readwrite',store=>store.put(row))
    for(const key of sessionKeys())storeSession()?.removeItem(key)
    deviceMode = true
    return
  }
  const rows=await readDeviceRows()
  if(!rows.length){
    if(!storeSession())throw Error('この端末ではセッション保存を利用できません')
    deviceMode = false
    return
  }
  const storage=storeSession()
  if(!storage)throw Error('この端末ではセッション保存を利用できません')
  const prior=new Map(rows.map(row=>[sessionKey(row.entryId),storage.getItem(sessionKey(row.entryId))]))
  try{
    for(const row of rows)await writeSessionRow(row)
  }catch(error){
    // Roll back only keys touched by this migration.
    for(const [key,value] of prior){
      try{if(value===null)storage.removeItem(key);else storage.setItem(key,value)}catch{}
    }
    throw Error('画像を移動できませんでした。元の画像は残っています：'+error.message)
  }
  // All new copies are now present; clearing happens only after explicit UI confirmation.
  await operate('readwrite',store=>store.clear())
  deviceMode = false
}
export function clearSessionReceiptImages(){
  const storage=storeSession()
  for(const key of sessionKeys())storage?.removeItem(key)
}
export async function saveReceiptImage(entryId,blob){
  if(!Number.isSafeInteger(entryId)||entryId<=0 ||
    !['image/webp','image/jpeg'].includes(blob?.type)||blob.size>200*1024)
    throw Error('画像を保存できません')
  const row={entryId,blob}
  if(isDeviceMode()){
    await operate('readwrite',store=>store.put(row))
    storeSession()?.removeItem(sessionKey(entryId))
  }else{
    await writeSessionRow(row)
    // Updating an old device photo must not leave an unrequested 30-day copy.
    await operate('readwrite',store=>store.delete(entryId))
  }
}
export async function getReceiptImage(entryId){
  const id=Number(entryId)
  const session=readSessionRow(sessionKey(id))
  if(session)return session.blob
  const row=await operate('readonly',store=>store.get(id))
  if(!row)return null
  return row.blob
}
export async function deleteReceiptImage(entryId){
  storeSession()?.removeItem(sessionKey(Number(entryId)))
  await operate('readwrite',store=>store.delete(Number(entryId)))
}
export async function countReceiptImages(){
  // Preserve the inexpensive IndexedDB count path for devices without session photos.
  const sessions=readSessionRows()
  if(!sessions.length)return operate('readonly',store=>store.count())
  const ids=new Set(sessions.map(row=>row.entryId))
  for(const row of await readDeviceRows())ids.add(row.entryId)
  return ids.size
}
// Read keys without loading historical image Blob payloads into memory.
export async function listReceiptImageIds(){
  const keys=await operate('readonly',store=>store.getAllKeys())||[]
  const ids=new Set(keys.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))
  for(const key of sessionKeys()){
    const id=Number(key.slice(SESSION_PREFIX.length))
    if(Number.isSafeInteger(id)&&id>0)ids.add(id)
  }
  return [...ids]
}
export async function listReceiptImagesForExport(){
  const unique=new Map((await readDeviceRows()).map(row=>[row.entryId,row]))
  for(const row of readSessionRows())unique.set(row.entryId,row)
  return [...unique.values()]
}
// Delete exactly the validated IDs in one IndexedDB transaction, then clear
// session copies. A failed IndexedDB write leaves session copies untouched.
export async function deleteReceiptImagesByIds(entryIds) {
  if (!Array.isArray(entryIds) || entryIds.some(id=>!Number.isSafeInteger(id)||id<=0))
    throw Error('画像の削除対象を確認できません')
  const unique=[...new Set(entryIds)]
  if (!unique.length) return 0
  await operate('readwrite', store=>{
    for (const id of unique) store.delete(id)
  })
  const storage=storeSession()
  for (const id of unique) storage?.removeItem(sessionKey(id))
  return unique.length
}
export async function clearAllReceiptImages() {
  await operate('readwrite', store => store.clear())
  clearSessionReceiptImages()
}
// Retain all legacy images, including photos previously marked with a 30-day
// expiration. Device storage is cleared only by the explicit user action.
export async function cleanupReceiptImages(){
  // No automatic deletion. Session photos disappear on logout/session end.
}
