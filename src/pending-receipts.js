// Keep only tiny recovery markers, NEVER photo bytes, in device localStorage.
// A refresh can then identify which committed ledger entries need reattachment.
export const PENDING_RECEIPTS_KEY='kakeibo-pending-receipts-v1'
const valid=row=>Number.isSafeInteger(row?.id)&&row.id>0&&
  (row.month===''||/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month))
export function readPendingReceiptMarkers(storage=typeof localStorage==='undefined'?null:localStorage){
  if(!storage)return []
  try{
    const rows=JSON.parse(storage.getItem(PENDING_RECEIPTS_KEY)||'[]')
    return Array.isArray(rows)?rows.filter(valid).slice(0,100):[]
  }catch{return []}
}
export function markPendingReceipt(id,date='',storage=typeof localStorage==='undefined'?null:localStorage){
  if(!Number.isSafeInteger(id)||id<=0)throw Error('レシートIDを確認してください')
  const month=typeof date==='string'&&/^\d{4}-(0[1-9]|1[0-2])/.test(date)?date.slice(0,7):''
  const rows=[...readPendingReceiptMarkers(storage).filter(x=>x.id!==id),{id,month}].slice(-100)
  storage?.setItem(PENDING_RECEIPTS_KEY,JSON.stringify(rows))
  return rows
}
export function clearPendingReceipt(id,storage=typeof localStorage==='undefined'?null:localStorage){
  const rows=readPendingReceiptMarkers(storage).filter(x=>x.id!==Number(id))
  if(rows.length)storage?.setItem(PENDING_RECEIPTS_KEY,JSON.stringify(rows))
  else storage?.removeItem(PENDING_RECEIPTS_KEY)
  return rows
}
