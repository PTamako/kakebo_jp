import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {saveReceiptImage,getReceiptImage,countReceiptImages,listReceiptImagesForExport,
  setReceiptStorageMode,configureReceiptStorageMode,clearSessionReceiptImages,clearAllReceiptImages,cleanupReceiptImages} from '../src/receipt-store.js'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')

test('privacy and backup no longer repeat receipt count, expiry or refresh controls',()=>{
  const privacy=finance.split('<summary>端末のプライバシー設定</summary>')[1].split('</details>')[0]
  const backup=finance.split('<summary>バックアップ・復元</summary>')[1].split('</details>')[0]
  assert.match(privacy,/ログイン状態の保存/)
  assert.match(privacy,/保存済みレシート画像/)
  assert.match(privacy,/非公開R2で保管・自動削除なし/)
  assert.doesNotMatch(privacy,/件数を更新/)
  assert.match(privacy,/画像をすべて削除/)
  assert.match(backup,/レシート画像をZIP保存/)
  assert.doesNotMatch(backup,/device-privacy-count|30日間保存|帳簿JSONとは別に保存/)
  assert.match(finance,/if\(managementTab.value==='tools'\)await refreshLocalReceiptCount\(\)/)
  assert.match(app,/await uploadR2Receipt\(entryId, blob, \{ replace \}\)/)
  assert.doesNotMatch(app,/if\(!rememberDevice.value\)clearSessionReceiptImages\(\)/)
})
function fakeStorage(){
  const map=new Map()
  return {
    get length(){return map.size},
    key(i){return [...map.keys()][i]??null},
    getItem(k){return map.get(k)??null},
    setItem(k,v){map.set(String(k),String(v))},
    removeItem(k){map.delete(k)},
    get data(){return map}
  }
}
function fakeDb(saved){
  return {open(){
    const request={}
    queueMicrotask(()=>{
      request.result={
        close(){},
        createObjectStore(){throw Error('schema changed')},
        transaction(){
          const tx={}
          const done=value=>{
            const req={result:value}
            queueMicrotask(()=>tx.oncomplete?.())
            return req
          }
          tx.objectStore=()=>({
            get:k=>done(saved.get(k)),
            getAll:()=>done([...saved.values()]),
            count:()=>done(saved.size),
            put:row=>{saved.set(row.entryId,row);return done(row.entryId)},
            delete:k=>{saved.delete(k);return done(undefined)},
            clear:()=>{saved.clear();return done(undefined)}
          })
          return tx
        }
      }
      request.onsuccess?.()
    })
    return request
  }}
}
test('session receipts migrate safely from device, export, then disappear on logout',async()=>{
  const originals={indexedDB:globalThis.indexedDB,sessionStorage:globalThis.sessionStorage}
  const disk=new Map()
  const ss=fakeStorage()
  globalThis.indexedDB=fakeDb(disk);globalThis.sessionStorage=ss
  try{
    configureReceiptStorageMode(true)
    const photo=new Blob([new Uint8Array([1,4,6,8])],{type:'image/jpeg'})
    await saveReceiptImage(7,photo)
    assert.equal(await countReceiptImages(),1)
    assert.equal(disk.size,1)
    await setReceiptStorageMode(false)
    assert.equal(disk.size,0,'migration succeeded before disk removal')
    assert.equal(disk.size,0)
    assert.equal((await getReceiptImage(7)).size,4)
    assert.equal((await listReceiptImagesForExport()).length,1)
    assert.equal(await countReceiptImages(),1)
    await saveReceiptImage(8,photo)
    assert.equal(disk.size,0,'new session images stay off persistent IndexedDB')
    clearSessionReceiptImages()
    assert.equal(await countReceiptImages(),0)
    await clearAllReceiptImages()
  }finally{
    configureReceiptStorageMode(true)
    for(const [key,value] of Object.entries(originals)){
      if(value===undefined)delete globalThis[key]
      else globalThis[key]=value
    }
  }
})
test('session storage quota failure retains all original device images',async()=>{
  const originals={indexedDB:globalThis.indexedDB,sessionStorage:globalThis.sessionStorage}
  const disk=new Map()
  const ss=fakeStorage()
  const originalSet=ss.setItem.bind(ss)
  ss.setItem=(key,value)=>{
    if(key.startsWith('kakeibo-session-receipt-v1-'))throw Error('QuotaExceededError')
    originalSet(key,value)
  }
  globalThis.indexedDB=fakeDb(disk);globalThis.sessionStorage=ss
  try{
    configureReceiptStorageMode(true)
    await saveReceiptImage(21,new Blob([new Uint8Array([1,2,3])],{type:'image/webp'}))
    await assert.rejects(()=>setReceiptStorageMode(false),/元の画像は残っています/)
    assert.equal(disk.size,1)
    assert.equal((await getReceiptImage(21)).size,3)
    assert.equal(disk.size,1)
  }finally{
    configureReceiptStorageMode(true)
    for(const [key,value] of Object.entries(originals)){
      if(value===undefined)delete globalThis[key]
      else globalThis[key]=value
    }
  }
})

test('expired legacy device receipts remain visible until the user explicitly clears them',async()=>{
  const originals={indexedDB:globalThis.indexedDB,sessionStorage:globalThis.sessionStorage}
  const photo=new Blob([new Uint8Array([9,8,7])],{type:'image/jpeg'})
  const disk=new Map([[41,{entryId:41,blob:photo,expiresAt:Date.now()-40*86400000}]])
  globalThis.indexedDB=fakeDb(disk)
  globalThis.sessionStorage=fakeStorage()
  try{
    configureReceiptStorageMode(true)
    await cleanupReceiptImages()
    assert.equal(disk.size,1,'expired legacy photos cannot be silently deleted')
    assert.equal((await getReceiptImage(41)).size,3)
    assert.equal((await listReceiptImagesForExport()).length,1)
    await saveReceiptImage(42,photo)
    assert.equal(disk.get(42).expiresAt,undefined,'new permanent photos have no TTL')
    assert.equal(await countReceiptImages(),2)
    await clearAllReceiptImages()
    assert.equal(disk.size,0,'explicit confirmed clear still removes device photos')
  }finally{
    configureReceiptStorageMode(true)
    for(const [key,value] of Object.entries(originals)){
      if(value===undefined)delete globalThis[key]
      else globalThis[key]=value
    }
  }
})
