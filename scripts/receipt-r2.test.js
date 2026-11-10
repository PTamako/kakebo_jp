import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {handleR2Receipts} from '../functions/api/r2-receipts.js'

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
function mockedBackend(){
  const objects=new Map(),states=new Map(),sizes=new Map(),ledger=new Set([4,5,6])
  const calls={put:0,head:0,get:0,delete:0,list:0}
  const bucket={
    async put(key,bytes,{httpMetadata,customMetadata,onlyIf}){
      calls.put++
      if(onlyIf?.get('If-None-Match')==='*' && objects.has(key))return null
      const data=new Uint8Array(bytes)
      const metadata={size:data.length,httpMetadata,customMetadata}
      objects.set(key,{data,...metadata})
      return metadata
    },
    async head(key){
      calls.head++
      const row=objects.get(key)
      return row?{size:row.data.length,customMetadata:row.customMetadata,httpMetadata:row.httpMetadata}:null
    },
    async get(key){
      calls.get++
      const row=objects.get(key)
      return row?{size:row.data.length,httpMetadata:row.httpMetadata,
        body:new Response(row.data).body}:null
    },
    async delete(keys){calls.delete++;for(const k of Array.isArray(keys)?keys:[keys])objects.delete(k)},
    async list({prefix}){
      calls.list++
      return {objects:[...objects].filter(([key])=>key.startsWith(prefix))
        .map(([key,v])=>({key,size:v.data.length})),truncated:false}
    }
  }
  const db={
    prepare(sql){
      return {
        bind(...values){
          return {
            async first(){
              if(sql.includes('SELECT 1 AS found'))return ledger.has(values[0])?{found:1}:null
              if(sql.includes('SELECT deleted FROM receipt_r2_state'))
                return states.has(values[0])?{deleted:states.get(values[0])}:null
              return null
            },
            async all(){
              if(sql.includes('SELECT entry_id FROM receipt_r2_state'))
                return {results:[...states].filter(([,deleted])=>deleted===1).map(([entry_id])=>({entry_id}))}
              return {results:[]}
            },
            async run(){
              if(sql.includes('INSERT INTO receipt_r2_state')){
                const deleted=sql.includes('VALUES(?1,1')
                states.set(values[0],deleted?1:0)
                sizes.set(values[0],deleted?null:values[1])
              }
              return {success:true}
            }
          }
        },
        async all(){
          if(sql.includes('SELECT entry_id AS id,size_bytes AS size FROM receipt_r2_state'))
            return {results:[...states].filter(([,deleted])=>deleted===0)
              .map(([id])=>({id,size:sizes.get(id)??null})).sort((a,b)=>a.id-b.id)}
          if(sql.includes('SELECT entry_id FROM receipt_r2_state'))
            return {results:[...states].filter(([,deleted])=>deleted===1).map(([entry_id])=>({entry_id}))}
          return {results:[]}
        }
      }
    },
    async batch(statements){for(const item of statements)await item.run()}
  }
  return {env:{RECEIPTS_R2:bucket},db,objects,states,calls,sizes}
}
const call=(backend,method,parts=[],body,headers={})=>handleR2Receipts(
  new Request('https://kakeibo-f17.pages.dev/api/receipts'+(parts.length?'/'+parts.join('/'):''),
    {method,headers,body}),backend.env,backend.db,parts)
const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,1,2,3,4])
test('R2 upload is private, size-bound and visible through authenticated route',async()=>{
  const b=mockedBackend()
  const up=await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})
  assert.equal(up.status,200)
  const info=await up.json()
  assert.equal(info.size,jpeg.length)
  assert.match(info.sha256,/^[a-f0-9]{64}$/)
  assert.equal(b.states.get(4),0)
  const list=await call(b,'GET')
  assert.deepEqual((await list.json()).items,[{id:4,size:jpeg.length}])
  const down=await call(b,'GET',['4'])
  assert.equal(down.headers.get('cache-control'),'no-store, private')
  assert.deepEqual([...new Uint8Array(await down.arrayBuffer())],[...jpeg])
})
test('invalid ID, missing ledger, unsupported formats and >200 KiB fail without writing',async()=>{
  const b=mockedBackend()
  assert.equal((await call(b,'PUT',['999'],jpeg,{'content-type':'image/jpeg'})).status,404)
  assert.equal((await call(b,'PUT',['abc'],jpeg,{'content-type':'image/jpeg'})).status,400)
  assert.equal((await call(b,'PUT',['4'],jpeg,{'content-type':'image/png'})).status,415)
  assert.equal((await call(b,'PUT',['4'],new Uint8Array(204801),{'content-type':'image/jpeg'})).status,413)
  assert.equal(b.objects.size,0)
})
test('a deleted R2 receipt is hidden and stale-device migration cannot resurrect it',async()=>{
  const b=mockedBackend()
  assert.equal((await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})).status,200)
  assert.equal((await call(b,'DELETE',['4'])).status,200)
  assert.equal(b.states.get(4),1)
  assert.equal((await call(b,'GET',['4'])).status,410)
  const rejected=await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg','x-receipt-migration':'1'})
  assert.equal(rejected.status,410)
  assert.equal((await rejected.json()).code,'receipt_previously_deleted')
  assert.equal(b.objects.size,0)
  // Explicit re-attachment from ZIP or user-selected photo is still allowed.
  assert.equal((await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})).status,200)
  assert.equal(b.states.get(4),0)
})
test('bulk deletion tombstones and removes exactly provided receipt IDs',async()=>{
  const b=mockedBackend()
  for(const id of [4,5,6])
    assert.equal((await call(b,'PUT',[String(id)],jpeg,{'content-type':'image/jpeg'})).status,200)
  assert.equal((await call(b,'DELETE',[],JSON.stringify({ids:[4,5]}),{'content-type':'application/json'})).status,200)
  assert.deepEqual((await (await call(b,'GET')).json()).items,[{id:6,size:jpeg.length}])
  assert.equal(b.states.get(4),1)
  assert.equal(b.states.get(5),1)
  assert.equal(b.states.get(6),0)
  assert.equal((await call(b,'DELETE',[],JSON.stringify({ids:[5,5]}),{'content-type':'application/json'})).status,400)
})
test('R2 absent binding is fail closed and preview never shares production R2',async()=>{
  const b=mockedBackend()
  b.env={}
  assert.equal((await call(b,'GET')).status,503)
  const api=source('functions/api/[[path]].js')
  assert.match(api,/if \(isPagesPreview\) return json\(\{error:'プレビューではR2画像を利用できません'\},403\)/)
  assert.match(api,/return handleR2Receipts\(request,env,db,\(params.path\|\|\[\]\).slice\(1\)\)/)
  const config=source('wrangler.toml')
  assert.match(config,/bucket_name = "kakeibo-receipts"/)
  assert.doesNotMatch(config,/kakeibo-receipts-preview/)
  assert.match(config,/# Preview has no R2 binding/)
})

test('interrupted deletion or re-attachment never destroys a residual local receipt',async()=>{
  const b=mockedBackend()
  assert.equal((await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})).status,200)
  // Simulate an R2 deletion that left an object after D1 tombstoning.
  b.states.set(4,1)
  const result=await call(b,'PUT',['4'],jpeg,{
    'content-type':'image/jpeg','x-receipt-migration':'1'
  })
  assert.equal(result.status,409)
  assert.equal((await result.json()).code,'receipt_deletion_pending')
  assert.equal(b.objects.size,1)
})

test('index/list requests read D1 only, with no Class A/B R2 calls',async()=>{
  const b=mockedBackend()
  const up=await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})
  assert.equal(up.status,200)
  for(const kind of Object.keys(b.calls))b.calls[kind]=0
  const index=await call(b,'GET')
  assert.deepEqual((await index.json()).items,[{id:4,size:jpeg.length}])
  assert.deepEqual(b.calls,{put:0,head:0,get:0,delete:0,list:0})
})
test('new upload avoids HEAD, duplicate retry needs only one HEAD, editing needs none',async()=>{
  const b=mockedBackend()
  assert.equal((await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})).status,200)
  assert.deepEqual(b.calls,{put:1,head:0,get:0,delete:0,list:0})
  const repeat=await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg'})
  assert.equal(repeat.status,200)
  assert.equal((await repeat.json()).already,true)
  assert.deepEqual(b.calls,{put:2,head:1,get:0,delete:0,list:0})
  assert.equal((await call(b,'PUT',['4'],jpeg,{'content-type':'image/jpeg','x-receipt-replace':'1'})).status,200)
  assert.deepEqual(b.calls,{put:3,head:1,get:0,delete:0,list:0})
})
test('delete does not use costly per-image HEAD checks',async()=>{
  const b=mockedBackend()
  for(const id of [4,5,6])
    assert.equal((await call(b,'PUT',[String(id)],jpeg,{'content-type':'image/jpeg'})).status,200)
  for(const kind of Object.keys(b.calls))b.calls[kind]=0
  assert.equal((await call(b,'DELETE',[],JSON.stringify({ids:[4,5]}),{'content-type':'application/json'})).status,200)
  assert.deepEqual(b.calls,{put:0,head:0,get:0,delete:1,list:0})
  assert.deepEqual((await (await call(b,'GET')).json()).items,[{id:6,size:jpeg.length}])
  assert.equal(b.calls.list,0)
  assert.equal(b.calls.head,0)
})

test('app startup never migrates old images or reads R2 and a click fetches one receipt',()=>{
  const app=source('src/App.vue')
  const migration=source('src/receipt-migration.js')
  const server=source('functions/api/r2-receipts.js')
  const mounted=app.split('onMounted(async () => {')[1]?.split('// Only a successful cross-month edit')[0]
  const unlock=app.split('async function unlock() {')[1]?.slice(0,240)
  assert.ok(mounted)
  assert.ok(unlock)
  assert.doesNotMatch(mounted,/migrateReceiptsNow\(\)/)
  assert.doesNotMatch(unlock,/migrateReceiptsNow\(\)/)
  assert.match(app,/async function refreshReceiptImageIds\(\)[\s\S]*?listR2Receipts\(\{fresh:true\}\)/)
  assert.match(app,/async function viewReceipt\(entryId\)[\s\S]*?getR2Receipt\(entryId\)/)
  assert.match(migration,/if\(!local\.length\)return result[\s\S]*?await listR2Receipts\(\{fresh:true\}\)/)
  assert.doesNotMatch(server,/await bucket\.list\(/)
  assert.match(server,/await bucket\.get\(objectKey\)/)
})
