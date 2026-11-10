import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {handleR2Receipts} from '../functions/api/r2-receipts.js'

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
function mockedBackend(){
  const objects=new Map(),states=new Map(),ledger=new Set([4,5,6])
  const bucket={
    async put(key,bytes,{httpMetadata,customMetadata}){
      objects.set(key,{data:new Uint8Array(bytes),httpMetadata,customMetadata})
    },
    async head(key){
      const row=objects.get(key)
      return row?{size:row.data.length,customMetadata:row.customMetadata,httpMetadata:row.httpMetadata}:null
    },
    async get(key){
      const row=objects.get(key)
      return row?{size:row.data.length,httpMetadata:row.httpMetadata,
        body:new Response(row.data).body}:null
    },
    async delete(keys){for(const k of Array.isArray(keys)?keys:[keys])objects.delete(k)},
    async list({prefix}){
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
              if(sql.includes('INSERT INTO receipt_r2_state'))states.set(values[0],sql.includes('VALUES(?1,1')?1:0)
              return {success:true}
            }
          }
        },
        async all(){
          if(sql.includes('SELECT entry_id FROM receipt_r2_state'))
            return {results:[...states].filter(([,deleted])=>deleted===1).map(([entry_id])=>({entry_id}))}
          return {results:[]}
        }
      }
    },
    async batch(statements){for(const item of statements)await item.run()}
  }
  return {env:{RECEIPTS_R2:bucket},db,objects,states}
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
