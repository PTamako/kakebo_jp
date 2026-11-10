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
    // Explicit owner action only. Re-issue idempotent deletes for tombstoned
    // IDs after an interrupted network/R2 delete, without listing R2 objects.
    // Never run from startup, pagination, login or scheduled jobs.
    if(idSegment==='cleanup' && segments.length===1 && method==='POST'){
      const payload=await request.json().catch(()=>null)
      const after=Number(payload?.after??0)
      if(!Number.isSafeInteger(after)||after<0)return json({error:'再確認の位置を確認してください'},400)
      const {results=[]}=await db.prepare(
        'SELECT entry_id FROM receipt_r2_state WHERE deleted=1 AND entry_id>?1 ORDER BY entry_id LIMIT 100'
      ).bind(after).all()
      const ids=results.map(row=>Number(row.entry_id))
      if(ids.length)await bucket.delete(ids.map(key))
      return json({ok:true,checked:ids.length,nextCursor:ids.length===100?ids[ids.length-1]:null})
    }
    if (!idSegment) {
      if (method==='GET') {
        // Ledger reads a bounded D1 index for its own entries only.
        // Full inventory is reserved for explicit backup and management.
        const selected=new URL(request.url).searchParams.get('ids')
        if(selected!==null){
          const values=selected.split(',')
          const ids=values.map(Number)
          if(!values.length||values.length>250||values.some((raw,i)=>
            !/^[1-9]\d{0,14}$/.test(raw)||!validId(raw)||!Number.isSafeInteger(ids[i]))||
            new Set(ids).size!==ids.length)
            return json({error:'画像の検索対象を確認してください（最大250件）'},400)
          const marks=ids.map((_,i)=>'?'+(i+1)).join(',')
          const {results=[]}=await db.prepare(
            'SELECT entry_id AS id,size_bytes AS size FROM receipt_r2_state WHERE deleted=0 AND entry_id IN ('+marks+') ORDER BY entry_id'
          ).bind(...ids).all()
          return json({ok:true,items:results.map(row=>({id:Number(row.id),size:row.size===null?null:Number(row.size)}))})
        }
        // Neither query performs an R2 operation.
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
    if(method==='HEAD') {
      // A version request happens only when the user selects a replacement
      // image. Ordinary ledger views never HEAD each receipt.
      const removed=(await deletedRow(id))?.deleted===1
      if(removed)return new Response(null,{status:410,headers:cacheHeaders('text/plain')})
      const metadata=await bucket.head(objectKey)
      if(!metadata)return new Response(null,{status:404,headers:cacheHeaders('text/plain')})
      return new Response(null,{status:200,headers:{...cacheHeaders('text/plain'),etag:metadata.httpEtag}})
    }
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
      const expected=request.headers.get('x-receipt-if-match')
      // Replacements must use the ETag captured when the user selected the
      // new image. This rejects stale edits rather than last-writer-wins.
      if(replace && expected!=='*' && !/^"[a-zA-Z0-9_-]{16,128}"$/.test(expected||''))
        return json({error:'画像の更新前の状態を確認してください',code:'receipt_version_required'},428)
      const condition=replace && expected!=='*'
        ? new Headers({'If-Match':expected})
        : new Headers({'If-None-Match':'*'})
      // Conditional PUT avoids a preliminary HEAD on every upload. Only an
      // ordinary idempotent retry checks HEAD after a failed condition.
      const stored=await bucket.put(objectKey,image,{
        onlyIf:condition,
        httpMetadata:{contentType:type},
        customMetadata:{sha256:hash},
        // R2 validates this checksum as part of the same PUT (no extra read).
        sha256:hash
      })
      if(!stored){
        if(replace)return json({error:'別の端末で画像が変更されました。最新の画像を確認して再度選択してください',code:'receipt_changed'},409)
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
