// Optional, browser-only encryption for both JSON and complete ZIP backups.
// AES-256-GCM authenticates the whole backup; PBKDF2 slows password guessing.
// The password is never sent to Cloudflare or persisted in browser storage.
const HEADER = Uint8Array.from([75, 65, 75, 69, 78, 67, 49, 0]) // KA ENC1
const SALT_BYTES = 16
const IV_BYTES = 12
const ROUNDS = 210000
const MAX_BYTES = 75 * 1024 * 1024
const concat = (...arrays) => {
  const length=arrays.reduce((n,x)=>n+x.byteLength,0)
  const bytes=new Uint8Array(length)
  let cursor=0
  for(const part of arrays){bytes.set(part,cursor);cursor+=part.byteLength}
  return bytes
}
function validPassword(password) {
  if(typeof password!=='string'||password.length<10||password.length>128)
    throw Error('暗号化には10～128文字のパスワードが必要です')
}
async function keyFor(password,salt,usage) {
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey'])
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt,iterations:ROUNDS,hash:'SHA-256'},material,
    {name:'AES-GCM',length:256},false,[usage])
}
function looksLikeZip(data) {
  return data.length>=4 && data[0]===0x50 && data[1]===0x4b && data[2]===0x03 && data[3]===0x04
}
export async function encryptBackupBlob(blob,password) {
  validPassword(password)
  if(!(blob instanceof Blob)||blob.size<1||blob.size>MAX_BYTES)throw Error('暗号化対象のサイズを確認してください')
  const salt=crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv=crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key=await keyFor(password,salt,'encrypt')
  const ciphertext=await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:HEADER},key,await blob.arrayBuffer())
  return new Blob([HEADER,salt,iv,ciphertext],{type:'application/octet-stream'})
}
export async function decryptBackupBlob(blob,password) {
  validPassword(password)
  if(!(blob instanceof Blob)||blob.size<HEADER.length+SALT_BYTES+IV_BYTES+17||
     blob.size>MAX_BYTES+HEADER.length+SALT_BYTES+IV_BYTES+16)
    throw Error('暗号化バックアップのサイズが不正です')
  const buffer=new Uint8Array(await blob.arrayBuffer())
  if(!HEADER.every((byte,i)=>buffer[i]===byte))throw Error('家計簿の暗号化バックアップではありません')
  const salt=buffer.subarray(HEADER.length,HEADER.length+SALT_BYTES)
  const iv=buffer.subarray(HEADER.length+SALT_BYTES,HEADER.length+SALT_BYTES+IV_BYTES)
  const payload=buffer.subarray(HEADER.length+SALT_BYTES+IV_BYTES)
  try {
    const key=await keyFor(password,salt,'decrypt')
    const decrypted=new Uint8Array(await crypto.subtle.decrypt(
      {name:'AES-GCM',iv,additionalData:HEADER},key,payload))
    const format=looksLikeZip(decrypted)?'zip':
      decrypted[0]===0x7b?'json':null
    if(!format)throw Error('invalid_format')
    return {blob:new Blob([decrypted],{type:format==='zip'?'application/zip':'application/json'}),format}
  }catch {
    throw Error('パスワードが違うか、暗号化バックアップが破損しています')
  }
}