// Household-visible receipt reader. Original images stay in their private R2 keys.
// Only verified household sessions can read images attached to posted household expenses.
// Mutations remain on the owner's pre-existing receipt endpoints.
const IMAGE_TYPES = new Set(['image/jpeg','image/webp'])
const MAX_BYTES = 200 * 1024
const POSITIVE_ID = /^[1-9]\d{0,14}$/
const reply = (data,status=200) => Response.json(data,{status,headers:{
 'cache-control':'no-store, private','x-content-type-options':'nosniff'
}})
const fail = (code,status=404) => reply({ok:false,code},status)
const isEntryId = x => POSITIVE_ID.test(String(x)) && Number.isSafeInteger(Number(x))
const textBytes = new TextEncoder()
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(n=>n.toString(16).padStart(2,'0')).join('')
async function memberKey(row){
 const scope=(await digest(textBytes.encode(row.household_id+'\0'+row.owner_user_id))).slice(0,32)
 return 'member/v1/'+scope+'/'+row.receipt_id
}
const image = async (bucket,key,expected=null) => {
 const object=await bucket.get(key)
 if(!object || !IMAGE_TYPES.has(object.httpMetadata?.contentType) ||
  !Number.isSafeInteger(object.size) || object.size<1 || object.size>MAX_BYTES)
  return fail('HOUSEHOLD_RECEIPT_MISSING')
 if(expected && (object.size!==Number(expected.size_bytes) ||
  object.httpMetadata.contentType!==expected.content_type ||
  object.customMetadata?.sha256!==expected.sha256))
  return fail('HOUSEHOLD_RECEIPT_INTEGRITY',503)
 return new Response(object.body,{status:200,headers:{
  'content-type':object.httpMetadata.contentType,
  'content-length':String(object.size),'cache-control':'no-store, private',
  'cross-origin-resource-policy':'same-origin','x-content-type-options':'nosniff',
  'content-security-policy':"default-src 'none'; sandbox"
 }})
}
function entryIds(value){
 if(typeof value!=='string'||!value||value.length>2000)return null
 const tokens=value.split(',')
 if(!tokens.length||tokens.length>100||tokens.some(x=>!isEntryId(x)))return null
 const numbers=[...new Set(tokens.map(Number))]
 return numbers.length>0?numbers:null
}
// Only accepted/applied HomeFlow postings are published. Pending proposals,
// unrelated personal receipts and transfers never become household images.
function memberSql(ids){
 const targets=ids.map(()=>'(?)').join(',')
 return `WITH targets(id) AS (VALUES ${targets}),
 linked AS (
  SELECT a.entry_id,a.household_id,a.requester_user_id owner_user_id,
   a.proposal_id origin_id,'proposal:' origin_prefix
  FROM family_shared_mutation_applied a
  JOIN targets t ON t.id=a.entry_id
  JOIN family_shared_entry_registry reg
   ON reg.resource_id=a.resource_id AND reg.entry_id=a.entry_id
   AND reg.household_id=a.household_id AND reg.state='active'
  WHERE a.action IN ('create','update')
  UNION ALL
  SELECT a.entry_id,a.household_id,a.requester_user_id,
   a.proposal_id,'request:'
  FROM family_card_purchase_applied a JOIN targets t ON t.id=a.entry_id
  UNION ALL
  SELECT a.entry_id,a.household_id,a.requester_user_id,
   a.proposal_id,'request:'
  FROM family_prepaid_actions_applied a JOIN targets t ON t.id=a.entry_id
  WHERE a.action='spend'
 )
 SELECT r.receipt_id,r.owner_user_id,r.household_id,r.content_type,
  r.size_bytes,r.sha256,r.created_at,l.entry_id
 FROM linked l
 JOIN entries e ON e.id=l.entry_id AND e.type='expense'
 JOIN family_member_receipts r ON r.household_id=l.household_id
  AND r.owner_user_id=l.owner_user_id AND r.state='ready'
  AND (r.receipt_ref=l.origin_prefix||l.origin_id
    OR r.receipt_ref='entry:'||CAST(l.entry_id AS TEXT))
 JOIN homeflow_identity_links uploader
  ON uploader.user_id=r.owner_user_id AND uploader.household_id=r.household_id
  AND uploader.state='active'
 WHERE l.household_id=?
 ORDER BY r.created_at DESC,r.receipt_id DESC`
}
async function index(db,user,ids){
 // Cloudflare D1 allows at most 100 bound SQL parameters per statement.
 // The member query has one additional household_id binding beyond the IDs.
 // Split server-side, including for clients already deployed with 100-ID pages.
 // NEVER exceed 99 IDs here even if the public API accepts 100 IDs.
 const member=[]
 for(let offset=0;offset<ids.length;offset+=99){
  const chunk=ids.slice(offset,offset+99)
  const rows=(await db.prepare(memberSql(chunk)).bind(...chunk,user.household_id).all()).results||[]
  member.push(...rows)
 }
 const result=new Map()
 for(const r of member){
  if(!result.has(Number(r.entry_id)))result.set(Number(r.entry_id),{
   entry_id:Number(r.entry_id),source:'member',can_delete:r.owner_user_id===user.user_id,
   ...{_receipt:r}
  })
 }
 const slots=ids.map(()=>'?').join(',')
 const legacy=(await db.prepare(`SELECT e.id entry_id,s.size_bytes
  FROM entries e JOIN receipt_r2_state s ON s.entry_id=e.id AND s.deleted=0
  WHERE e.type='expense' AND e.id IN (${slots})`).bind(...ids).all()).results||[]
 for(const r of legacy){
  if(!result.has(Number(r.entry_id)))result.set(Number(r.entry_id),{
   entry_id:Number(r.entry_id),source:'legacy',can_delete:user.role==='owner',
   _receipt:r
  })
 }
 return result
}
export async function familyHouseholdReceipts(request,env,url,user,parts){
 if(!env.DB?.prepare || !env.RECEIPTS_R2?.get)
  return fail('HOUSEHOLD_RECEIPT_STORAGE_UNAVAILABLE',503)
 if(!['owner','member'].includes(user?.role)||!user?.user_id||!user?.household_id)
  return fail('HOUSEHOLD_RECEIPT_IDENTITY_REQUIRED',403)
 if(request.method!=='GET')return fail('HOUSEHOLD_RECEIPT_READ_ONLY',405)
 const link=await env.DB.prepare(
  "SELECT 1 AS permitted FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role=? AND state='active' LIMIT 1"
 ).bind(user.user_id,user.household_id,user.role).first()
 if(!link)return fail('HOUSEHOLD_RECEIPT_ACCESS_REVOKED',403)
 try{
  let ids=null
  if(parts.length===1)ids=entryIds(url.searchParams.get('ids'))
  else if(parts.length===2&&isEntryId(parts[1]))ids=[Number(parts[1])]
  if(!ids)return fail('HOUSEHOLD_RECEIPT_IDS_INVALID',400)
  const found=await index(env.DB,user,ids)
  if(parts.length===1)return reply({ok:true,items:[...found.values()].map(
   ({entry_id,source,can_delete})=>({entry_id,source,can_delete}))})
  const selected=found.get(ids[0])
  if(!selected)return fail('HOUSEHOLD_RECEIPT_NOT_FOUND')
  if(selected.source==='member')return image(env.RECEIPTS_R2,
   await memberKey(selected._receipt),selected._receipt)
  return image(env.RECEIPTS_R2,'receipts/v1/'+ids[0])
 }catch{
  return fail('HOUSEHOLD_RECEIPT_UNAVAILABLE',503)
 }
}
