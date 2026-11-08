// Lossless local-only ZIP. No external library, network access or D1 writes.
const w16=(v,i,n)=>v.setUint16(i,n,true),w32=(v,i,n)=>v.setUint32(i,n>>>0,true)
function crc32(bytes) {
 let c=0xffffffff
 for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}
 return (c^0xffffffff)>>>0
}
export async function receiptZip(rows, extraFiles=[]) {
 if(!Array.isArray(rows)||!Array.isArray(extraFiles)||rows.length+extraFiles.length<1||
   rows.length+extraFiles.length>1001)throw Error('ZIP保存対象を確認してください')
 // Allow one signed JSON ledger alongside the existing device-only receipts.
 // No other arbitrary paths or MIME types can enter the archive.
 if(extraFiles.length>1 || extraFiles.some(x=>x?.name!=='kakeibo-ledger-settings.json'||x.blob?.type!=='application/json'))
   throw Error('帳簿JSONの形式を確認してください')
 const items=[...rows,...extraFiles.map(x=>({entryId:0,blob:x.blob,name:x.name}))]
 const enc=new TextEncoder(),local=[],central=[]
 let offset=0,cdSize=0,total=0
 for(const row of items){
   if(row.entryId!==0 && (!Number.isSafeInteger(row.entryId)||row.entryId<=0||
     !['image/jpeg','image/webp'].includes(row.blob?.type)))throw Error('画像の形式を確認してください')
   if(row.entryId===0 && (row.name!=='kakeibo-ledger-settings.json'||row.blob?.type!=='application/json'))
     throw Error('帳簿JSONの形式を確認してください')
   const bytes=new Uint8Array(await row.blob.arrayBuffer())
   total+=bytes.length
   if(!bytes.length||total>60*1024*1024)throw Error('画像が多いため分割して保存してください')
   const name=enc.encode(row.entryId===0?row.name:'receipt-'+row.entryId+(row.blob.type==='image/jpeg'?'.jpg':'.webp'))
   const crc=crc32(bytes),header=new Uint8Array(30+name.length),h=new DataView(header.buffer)
   w32(h,0,0x04034b50);w16(h,4,20);w16(h,6,0x800);w16(h,8,0);w16(h,10,0);w16(h,12,33)
   w32(h,14,crc);w32(h,18,bytes.length);w32(h,22,bytes.length);w16(h,26,name.length);w16(h,28,0)
   header.set(name,30);local.push(header,bytes)
   const record=new Uint8Array(46+name.length),r=new DataView(record.buffer)
   w32(r,0,0x02014b50);w16(r,4,20);w16(r,6,20);w16(r,8,0x800);w16(r,10,0);w16(r,12,0);w16(r,14,33)
   w32(r,16,crc);w32(r,20,bytes.length);w32(r,24,bytes.length);w16(r,28,name.length)
   w16(r,30,0);w16(r,32,0);w16(r,34,0);w16(r,36,0);w32(r,38,0);w32(r,42,offset)
   record.set(name,46);central.push(record);cdSize+=record.length;offset+=header.length+bytes.length
 }
 const end=new Uint8Array(22),v=new DataView(end.buffer)
 w32(v,0,0x06054b50);w16(v,8,items.length);w16(v,10,items.length);w32(v,12,cdSize);w32(v,16,offset)
 return new Blob([...local,...central,end],{type:'application/zip'})
}

// Portable recovery bundle: unzip and import the signed JSON to restore ledger
// settings; receipt photos stay in the ZIP for separate device recovery.
export function ledgerAndReceiptsZip(sealedLedger,rows) {
  if(!sealedLedger || sealedLedger.format!=='kakeibo-ledger-backup')
    throw Error('帳簿データの形式を確認してください')
  const blob=new Blob([JSON.stringify(sealedLedger,null,2)],{type:'application/json'})
  return receiptZip(rows,[{name:'kakeibo-ledger-settings.json',blob}])
}
