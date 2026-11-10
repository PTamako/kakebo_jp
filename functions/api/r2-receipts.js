// Private Cloudflare R2 receipt operations, called ONLY after the parent's
// D1 session verification and preview-environment safety checks.
// No public bucket URLs or R2 credentials are ever sent to the browser.
const PREFIX='receipts/v1/'
const MAX_BYTES=200*1024
const MAX_BULK=100
const ID=/^[1-9]\d{0,14}$/
const IMAGE_TYPES=new Set(['image/webp','image/jpeg'])
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
})
const key=id=>PREFIX+id
const validId=value=>ID.test(String(value)) && Number.isSafeInteger(Number(value))

function digestHex(data) {
  return crypto.subtle.digest('SHA-256',data).then(hash=>
    [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''))
}
function cacheHeaders(type) {
  return {'content-type':type,'cache-control':'no-store, private',
    'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'}
}

// This route never reads HomeFlow's bucket and never allows object-key input
// from the browser. Only numeric IDs under the fixed prefix are permitted.
export async function handleR2Receipts(request,env,db,segments=[]) {
  if (!env.RECEIPTS_R2) return json({error:'R2画像ストレージが未設定です'},503)
  const bucket=env.RECEIPTS_R2
  const method=request.method
  const deletedRow=async id=>db.prepare('SELECT deleted FROM receipt_r2_state WHERE entry_id=?1').bind(id).first()
  const tombstone=ids=>db.batch(ids.map(id=>db.prepare(
    'INSERT INTO receipt_r2_state(entry_id,deleted,updated_at) VALUES(?1,1,CURRENT_TIMESTAMP) ON CONFLICT(entry_id) DO UPDATE SET deleted=1,updated_at=CURRENT_TIMESTAMP'
  ).bind(id)))
  const activate=id=>db.prepare(
    'INSERT INTO receipt_r2_state(entry_id,deleted,updated_at) VALUES(?1,0,CURRENT_TIMESTAMP) ON CONFLICT(entry_id) DO UPDATE SET deleted=0,updated_at=CURRENT_TIMESTAMP'
  ).bind(id).run()
  const idSegment=segments[0] || ''
  try {
    if (!idSegment) {
      if (method==='GET') {
        let cursor
        const items=[]
        do {
          const page=await bucket.list({prefix:PREFIX,limit:1000,...(cursor?{cursor}:{})})
          if (!page || !Array.isArray(page.objects)) return json({error:'R2画像一覧を確認できません'},503)
          for(const object of page.objects){
            const idString=object.key.startsWith(PREFIX)?object.key.slice(PREFIX.length):''
            if(!validId(idString))continue
            items.push({id:Number(idString),size:Number(object.size)||0})
            if(items.length>10000) return json({error:'画像が多いため一覧を確認できません'},413)
          }
          if(!page.truncated)break
          if(!page.cursor || page.cursor===cursor) return json({error:'R2画像一覧を最後まで読み込めません'},503)
          cursor=page.cursor
        }while(true)
        // A retryable failed R2 deletion must not re-expose a tombstoned photo.
        const deleted=await db.prepare('SELECT entry_id FROM receipt_r2_state WHERE deleted=1 LIMIT 10001').all()
        const banned=new Set((deleted.results||[]).map(x=>Number(x.entry_id)))
        return json({ok:true,items:items.filter(x=>!banned.has(x.id))})
      }
      if(method==='DELETE') {
        const payload=await request.json().catch(()=>null)
        const ids=payload?.ids
        if(!Array.isArray(ids)||!ids.length||ids.length>MAX_BULK||
          ids.some(id=>typeof id!=='number'||!validId(id))||
          new Set(ids).size!==ids.length)
          return json({error:'削除する画像IDを確認してください（最大100件）'},400)
        const keys=ids.map(key)
        // Tombstone first: an offline iPhone may have an older local photo.
        await tombstone(ids)
        await bucket.delete(keys)
        // R2 delete is idempotent; verify that objects are actually absent.
        const heads=await Promise.all(keys.map(k=>bucket.head(k)))
        if(heads.some(Boolean)) return json({error:'R2に画像が残っています。再確認してください'},503)
        return json({ok:true,deleted:ids})
      }
      return json({error:'操作を確認してください'},405)
    }
    if(segments.length!==1 || !validId(idSegment))
      return json({error:'画像IDを確認してください'},400)
    const id=Number(idSegment)
    const objectKey=key(id)
    if(method==='GET') {
      if((await deletedRow(id))?.deleted===1)return json({error:'削除済みのレシート画像です',code:'receipt_previously_deleted'},410)
      const object=await bucket.get(objectKey)
      if(!object)return json({error:'画像が見つかりません'},404)
      const type=object.httpMetadata?.contentType
      if(!IMAGE_TYPES.has(type)) return json({error:'画像形式を確認できません'},415)
      return new Response(object.body,{status:200,headers:{...cacheHeaders(type),'content-length':String(object.size)}})
    }
    if(method==='DELETE') {
      await tombstone([id])
      await bucket.delete(objectKey)
      if(await bucket.head(objectKey)) return json({error:'画像の削除を確認できません'},503)
      return json({ok:true,deleted:id})
    }
    if(method==='PUT') {
      const type=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()
      if(!IMAGE_TYPES.has(type))return json({error:'WebPまたはJPEGを選択してください'},415)
      const length=request.headers.get('content-length')
      if(length && Number(length)>MAX_BYTES)return json({error:'画像は200KB以下にしてください'},413)
      const image=await request.arrayBuffer()
      if(!image.byteLength || image.byteLength>MAX_BYTES)return json({error:'画像は200KB以下にしてください'},413)
      // Reject orphan or fabricated IDs. Soft-deleted ledger records remain
      // eligible for re-attaching their previously stored receipt.
      const found=await db.prepare(
        "SELECT 1 AS found FROM entries WHERE id=?1 UNION ALL SELECT 1 AS found FROM trash_items WHERE item_type='entry' AND item_id=?2 LIMIT 1"
      ).bind(id,String(id)).first()
      if(!found)return json({error:'対象の記帳明細が見つかりません'},404)
      if(request.headers.get('x-receipt-migration')==='1' && (await deletedRow(id))?.deleted===1)
        return json({error:'以前に削除された画像です。端末の旧画像も削除してください',code:'receipt_previously_deleted'},410)
      const hash=await digestHex(image)
      const before=await bucket.head(objectKey)
      if(before && request.headers.get('x-receipt-replace')!=='1'){
        if(before.size===image.byteLength && before.customMetadata?.sha256===hash){
          await activate(id)
          return json({ok:true,id,size:before.size,sha256:hash,already:true})
        }
        return json({error:'R2に別の画像があります。元画像は端末に保持します'},409)
      }
      await bucket.put(objectKey,image,{
        httpMetadata:{contentType:type},
        customMetadata:{sha256:hash}
      })
      const verified=await bucket.head(objectKey)
      if(!verified || verified.size!==image.byteLength ||
        verified.customMetadata?.sha256!==hash ||
        verified.httpMetadata?.contentType!==type)
        return json({error:'R2保存の検証が完了しませんでした。端末の画像を保持してください'},503)
      await activate(id)
      return json({ok:true,id,size:verified.size,sha256:hash,already:false})
    }
    return json({error:'操作を確認してください'},405)
  }catch(error){
    console.error('receipt R2 operation failed',method,idSegment,error?.message||error)
    return json({error:'R2での画像操作に失敗しました。元の画像は削除しないでください'},503)
  }
}
