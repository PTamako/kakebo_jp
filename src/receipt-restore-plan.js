// Receipt IDs in a recovered D1 are not necessarily the original entry IDs.
// Match the entire transaction and deterministic restore request ID, not just amount.
import {transactionKey} from './finance-tools.js'
export function planReceiptRestoration(backupEntries,images,currentEntries,restoredEntries=[]){
  if(!Array.isArray(backupEntries)||!(images instanceof Map)||
     !Array.isArray(currentEntries)||!Array.isArray(restoredEntries))
    throw Error('レシート復元候補の形式が不正です')
  const original=new Map(backupEntries.map(e=>[Number(e.id),e]))
  const restored=new Map(restoredEntries.map(e=>[Number(e.id),e]))
  const byId=new Map(currentEntries.map(e=>[Number(e.id),e]))
  const byClient=new Map(currentEntries.filter(e=>e.client_request_id)
    .map(e=>[e.client_request_id,e]))
  const byKey=new Map()
  for(const e of currentEntries){
    const key=transactionKey(e)
    if(!byKey.has(key))byKey.set(key,[])
    byKey.get(key).push(e)
  }
  const items=[],used=new Set()
  let unmatched=0
  for(const [originalId,blob] of images){
    const incoming=original.get(originalId)
    if(!incoming){unmatched++;continue}
    const key=transactionKey(incoming)
    const planned=restored.get(originalId)
    let target=planned?byClient.get(planned.clientRequestId):null
    if(!target && byId.has(originalId) && transactionKey(byId.get(originalId))===key)
      target=byId.get(originalId)
    if(!target){
      const matches=byKey.get(key)||[]
      if(matches.length===1)target=matches[0]
    }
    const id=Number(target?.id)
    if(!Number.isSafeInteger(id)||id<=0||used.has(id)||transactionKey(target)!==key){
      unmatched++;continue
    }
    used.add(id)
    items.push({id,blob})
  }
  return {items,unmatched}
}
