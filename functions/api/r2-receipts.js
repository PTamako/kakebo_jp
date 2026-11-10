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
    'INSERT INTO receipt_r2_state(entry_id,deleted,size_bytes,updated_at) VALUES(?1,1,NULL,CURRENT_TIMESTAMP) ON CONFLICT(entry_id) DO UPDATE SET deleted=1,size_bytes=NULL,updated_at=CURRENT_TIMESTAMP'
  ).bind(id)))
  const activate=(id,size)=>db.prepare(
    'INSERT INTO receipt_r2_state(entry_id,deleted,size_bytes,updated_at) VALUES(?1,0,?2,CURRENT_TIMESTAMP) ON CONFLICT(entry_id) DO UPDATE SET deleted=0,size_bytes=excluded.size_bytes,updated_at=CURRENT_TIMESTAMP'
  ).bind(id,size).run()
  const idSegment=segments[0] || ''
  try {
    if (!idSegment) {
      if (method==='GET') {
        // Only D1 is read for badge/index/count/period views. Never call
        // bucket.list() or bucket.head() during app launch or management.
        // The primary key of receipt_r2_state is the verified ledger entry ID.
        const {results}=await db.prepare(
          'SELECT entry_id AS id,size_bytes AS size FROM receipt_r2_state WHERE deleted=0 ORDER BY entry_id LIMIT 10001'
        ).all()
        if(results.length>10000)return json({error:'画像が多いため一覧を確認できません'},413)
        return json({ok:true,items:results.map(row=>({
          id:Number(row.id),
          size:row.size===null ? null : Number(row.size)
        }))})
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
        // Awaiting R2.delete is the authoritative completion signal. Additional
        // per-object HEAD checks waste one Class B operation per deleted photo.
        // The D1 tombstones already protect other devices after any failure.
        await bucket.delete(keys)
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
      if(request.headers.get('x-receipt-migration')==='1' && (await deletedRow(id))?.deleted===1){
        // A failed delete or interrupted explicit re-attachment may leave an
        // R2 blob behind. In that case, NEVER discard the old local copy.
        if(await bucket.head(objectKey))
          return json({error:'R2の削除または保存を確認できません。端末画像を保持してください',code:'receipt_deletion_pending'},409)
        return json({error:'以前に削除された画像です。端末の旧画像も削除してください',code:'receipt_previously_deleted'},410)
      }
      const hash=await digestHex(image)
      const replace=request.headers.get('x-receipt-replace')==='1'
      // A conditional PUT protects existing images without a separate HEAD.
      // If the key already exists, R2 returns null and only that collision
      // needs one Class B HEAD to distinguish idempotent retries from conflicts.
      // Explicit image editing intentionally overwrites this same entry ID.
      const stored=await bucket.put(objectKey,image,{
        ...(!replace ? {onlyIf:new Headers({'If-None-Match':'*'})} : {}),
        httpMetadata:{contentType:type},
        customMetadata:{sha256:hash},
        // R2 validates this checksum as part of the same PUT (no extra read).
        sha256:hash
      })
      if(!stored){
        const existing=await bucket.head(objectKey)
        if(existing && existing.size===image.byteLength &&
          existing.customMetadata?.sha256===hash){
          await activate(id,existing.size)
          return json({ok:true,id,size:existing.size,sha256:hash,already:true})
        }
        return json({error:'R2に別の画像があります。元画像は端末に保持します'},409)
      }
      // R2 returns committed object metadata; no post-upload HEAD needed.
      // Existing iPhone photos are still GET+SHA-verified during migration
      // before their local copies are erased.
      if(stored.size!==image.byteLength ||
        stored.customMetadata?.sha256!==hash ||
        stored.httpMetadata?.contentType!==type)
        return json({error:'R2保存の検証が完了しませんでした。元の写真を保持してください'},503)
      await activate(id,stored.size)
      return json({ok:true,id,size:stored.size,sha256:hash,already:false})
    }
    return json({error:'操作を確認してください'},405)
  }catch(error){
    console.error('receipt R2 operation failed',method,idSegment,error?.message||error)
    return json({error:'R2での画像操作に失敗しました。元の画像は削除しないでください'},503)
  }
}
