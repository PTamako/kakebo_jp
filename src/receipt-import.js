// Parse only this application's bounded, uncompressed ZIP layout.
// No network access, no financial D1 writes, no arbitrary file paths.
import {crc32} from './receipt-export.js'
const MAX_ARCHIVE=75*1024*1024,MAX_JSON=25*1024*1024,MAX_IMAGE=200*1024
const reject=()=>{throw Error('ZIPの内容が不正です。家計簿で保存したZIPを選択してください')}
const decoder=new TextDecoder('utf-8',{fatal:true})
export async function readCompleteBackupZip(file){
  if(!file || !Number.isSafeInteger(file.size) || file.size<22 || file.size>MAX_ARCHIVE)reject()
  const data=new Uint8Array(await file.arrayBuffer())
  const v=new DataView(data.buffer,data.byteOffset,data.byteLength)
  const n=data.length,tail=n-22
  if(v.getUint32(tail,true)!==0x06054b50 ||
    v.getUint16(tail+4,true)!==0 || v.getUint16(tail+6,true)!==0 ||
    v.getUint16(tail+20,true)!==0)reject()
  const count=v.getUint16(tail+10,true),size=v.getUint32(tail+12,true)
  const offset=v.getUint32(tail+16,true)
  if(!count || count>1001 || count!==v.getUint16(tail+8,true) || offset+size!==tail)reject()
  let cursor=offset,ledger=null,total=0
  const images=new Map(),names=new Set()
  for(let i=0;i<count;i++){
    if(cursor+46>tail || v.getUint32(cursor,true)!==0x02014b50)reject()
    const flags=v.getUint16(cursor+8,true),method=v.getUint16(cursor+10,true)
    const checksum=v.getUint32(cursor+16,true),compressed=v.getUint32(cursor+20,true)
    const length=v.getUint32(cursor+24,true),nameLength=v.getUint16(cursor+28,true)
    const extra=v.getUint16(cursor+30,true),comment=v.getUint16(cursor+32,true)
    const localOffset=v.getUint32(cursor+42,true)
    if(flags!==0x800 || method!==0 || compressed!==length || !nameLength ||
       extra || comment || cursor+46+nameLength>tail)reject()
    const centralName=data.subarray(cursor+46,cursor+46+nameLength)
    let name
    try{name=decoder.decode(centralName)}catch{reject()}
    if(names.has(name))reject()
    names.add(name)
    cursor+=46+nameLength
    if(localOffset+30+nameLength>offset || v.getUint32(localOffset,true)!==0x04034b50 ||
       v.getUint16(localOffset+6,true)!==flags || v.getUint16(localOffset+8,true)!==method ||
       v.getUint32(localOffset+14,true)!==checksum ||
       v.getUint32(localOffset+18,true)!==compressed ||
       v.getUint32(localOffset+22,true)!==length ||
       v.getUint16(localOffset+28,true)!==0 ||
       v.getUint16(localOffset+26,true)!==nameLength)reject()
    const start=localOffset+30+nameLength
    if(start+length>offset ||
       !data.subarray(localOffset+30,start).every((b,j)=>b===centralName[j]))reject()
    const bytes=data.subarray(start,start+length)
    if(!length || crc32(bytes)!==checksum)reject()
    total+=length
    if(total>60*1024*1024)reject()
    if(name==='kakeibo-ledger-settings.json'){
      if(ledger!==null || length>MAX_JSON)reject()
      try{ledger=JSON.parse(decoder.decode(bytes))}catch{reject()}
    }else{
      const match=/^receipt-([1-9]\d{0,14})\.(jpg|webp)$/.exec(name)
      if(!match || length>MAX_IMAGE)reject()
      const id=Number(match[1])
      if(!Number.isSafeInteger(id)||images.has(id)||images.size>=1000)reject()
      images.set(id,new Blob([bytes],{type:match[2]==='jpg'?'image/jpeg':'image/webp'}))
    }
  }
  if(cursor!==tail || !ledger || ledger.format!=='kakeibo-ledger-backup')reject()
  return {ledger,images}
}
