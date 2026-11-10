// Same-origin, authenticated receipt storage. Browser never receives R2 credentials
// or a public bucket URL. All images are strictly capped at 200 KiB.
const ENDPOINT='/api/receipts'
const LIMIT=200*1024
let cachedIndex=null

async function requestR2(path='',options={}) {
  let token=''
  try { token=sessionStorage.getItem('kakeibo-device-session')||'' } catch {}
  const headers=new Headers(options.headers||{})
  if(token)headers.set('x-session',token)
  const response=await fetch(ENDPOINT+path,{
    ...options,credentials:'same-origin',cache:'no-store',headers
  })
  if(!response.ok) {
    let errorBody={}
    try { errorBody=await response.json() } catch {}
    const error=new Error(errorBody.error||'R2画像の通信に失敗しました（HTTP '+response.status+'）')
    error.status=response.status
    throw error
  }
  return response
}
export const invalidateR2ReceiptIndex=()=>{cachedIndex=null}
export async function listR2Receipts({fresh=false}={}) {
  if(cachedIndex && !fresh)return cachedIndex.map(item=>({...item}))
  const response=await requestR2()
  const body=await response.json()
  if(!body?.ok || !Array.isArray(body.items))throw Error('R2画像一覧の形式を確認できません')
  const entries=[]
  const ids=new Set()
  for(const item of body.items){
    const id=Number(item.id)
    if(!Number.isSafeInteger(id)||id<=0||ids.has(id))continue
    ids.add(id)
    entries.push({entryId:id,size:Number(item.size)||0})
  }
  cachedIndex=entries
  return entries.map(item=>({...item}))
}
const asId=id=>{
  const value=Number(id)
  if(!Number.isSafeInteger(value)||value<=0)throw Error('レシートIDを確認できません')
  return value
}
const sha256=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))]
  .map(b=>b.toString(16).padStart(2,'0')).join('')
export async function uploadR2Receipt(entryId,blob,{replace=false,migration=false}={}) {
  const id=asId(entryId)
  if(!blob || !['image/webp','image/jpeg'].includes(blob.type) ||
    blob.size<=0 || blob.size>LIMIT)throw Error('レシート画像は200KB以下のWebPまたはJPEGを選択してください')
  const originalSha=await sha256(blob)
  const response=await requestR2('/'+id,{
    method:'PUT',headers:{'content-type':blob.type,...(replace?{'x-receipt-replace':'1'}:{}),...(migration?{'x-receipt-migration':'1'}:{})},body:blob
  })
  const result=await response.json()
  if(!result.ok || result.sha256!==originalSha || Number(result.size)!==blob.size)
    throw Error('R2保存の照合ができませんでした。元の画像を保持してください')
  invalidateR2ReceiptIndex()
  return result
}
export async function getR2Receipt(entryId) {
  const id=asId(entryId)
  let response
  try { response=await requestR2('/'+id) }
  catch(error){if(error.status===404)return null;throw error}
  const type=response.headers.get('content-type')?.split(';')[0]
  if(!['image/webp','image/jpeg'].includes(type)) throw Error('R2の画像形式を確認できません')
  const blob=await response.blob()
  if(!blob.size || blob.size>LIMIT)throw Error('R2から取得した画像サイズを確認できません')
  return blob
}
export async function deleteR2Receipt(entryId) {
  const id=asId(entryId)
  await requestR2('/'+id,{method:'DELETE'})
  invalidateR2ReceiptIndex()
  return id
}
export async function deleteR2ReceiptsByIds(ids) {
  if(!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id)||id<=0))
    throw Error('R2の削除対象を確認してください')
  const unique=[...new Set(ids)]
  const deleted=[]
  for(let i=0;i<unique.length;i+=100){
    const chunk=unique.slice(i,i+100)
    const response=await requestR2('',{method:'DELETE',headers:{'content-type':'application/json'},
      body:JSON.stringify({ids:chunk})})
    const result=await response.json()
    if(!result.ok || JSON.stringify(result.deleted)!==JSON.stringify(chunk))
      throw Error('R2での画像削除結果を確認できません')
    deleted.push(...chunk)
  }
  invalidateR2ReceiptIndex()
  return deleted
}
export async function listReceiptsForBackup(localRows) {
  const remote=await listR2Receipts({fresh:true})
  const rows=new Map((localRows||[]).map(row=>[Number(row.entryId),row]))
  for(let i=0;i<remote.length;i+=4) {
    const batch=await Promise.all(remote.slice(i,i+4).map(async item=>{
      const blob=await getR2Receipt(item.entryId)
      if(!blob)throw Error('R2からレシート '+item.entryId+' を取得できませんでした')
      return {entryId:item.entryId,blob}
    }))
    for(const row of batch)rows.set(row.entryId,row)
  }
  return [...rows.values()]
}
export async function receiptInventory(localRows,{fresh=true}={}) {
  const remote=await listR2Receipts({fresh})
  const entries=new Map((localRows||[]).map(row=>[Number(row.entryId),{
    entryId:Number(row.entryId),size:row.blob?.size||0,local:true,remote:false
  }]))
  for(const row of remote){
    const previous=entries.get(row.entryId)
    entries.set(row.entryId,{entryId:row.entryId,size:row.size,
      local:!!previous?.local,remote:true})
  }
  return [...entries.values()]
}
