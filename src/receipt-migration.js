import { listReceiptImagesForExport, deleteReceiptImage } from './receipt-store.js'
import { uploadR2Receipt, getR2Receipt, listR2Receipts, invalidateR2ReceiptIndex } from './receipt-cloud.js'

// This operation runs in the user's actual installed PWA, where iOS IndexedDB
// is available. The server cannot directly access a phone's local images.
// Never remove a legacy blob unless R2 has a verified byte-for-byte copy or
// a server-side deletion tombstone explicitly rejects its resurrection.
const sha=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))]
  .map(b=>b.toString(16).padStart(2,'0')).join('')

let inFlight=null
export async function migrateLegacyReceipts({onProgress}={}) {
  if(inFlight)return inFlight
  inFlight=(async()=>{
    const local=await listReceiptImagesForExport()
    const result={total:local.length,migrated:0,removedAlreadyCloud:0,removedDeleted:0,failed:0,conflicts:0}
    if(!local.length)return result
    const remote=await listR2Receipts({fresh:true})
    const remoteIds=new Set(remote.map(x=>x.entryId))
    for(const item of local){
      try{
        if(remoteIds.has(item.entryId)){
          const cloud=await getR2Receipt(item.entryId)
          if(!cloud || cloud.size!==item.blob.size ||
              await sha(cloud)!==await sha(item.blob)){
            result.conflicts++
            continue
          }
          await deleteReceiptImage(item.entryId)
          result.removedAlreadyCloud++
        }else{
          try{
            await uploadR2Receipt(item.entryId,item.blob,{migration:true})
          }catch(error){
            if(error.status===410){
              await deleteReceiptImage(item.entryId)
              result.removedDeleted++
              continue
            }
            throw error
          }
          // Re-download and check content before erasing any local backup.
          const verified=await getR2Receipt(item.entryId)
          if(!verified || verified.size!==item.blob.size ||
              await sha(verified)!==await sha(item.blob))
            throw Error('R2画像の照合ができませんでした')
          await deleteReceiptImage(item.entryId)
          remoteIds.add(item.entryId)
          result.migrated++
        }
      }catch(error){
        result.failed++
      }finally{onProgress?.({...result})}
    }
    invalidateR2ReceiptIndex()
    return result
  })()
  try{return await inFlight}finally{inFlight=null}
}
