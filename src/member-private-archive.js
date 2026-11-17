// Portable member snapshot (read-only financial journals + own private R2 images).
// The encrypted archive is for disaster evidence and identity-scoped recovery.
// It MUST NOT directly re-post household transactions or broker trades.
export const MAX_MEMBER_IMAGE_BYTES=42*1024*1024;
export const ARCHIVE_KINDS=Object.freeze([
 'shared','card','settlement','prepaid','sbi','bank','cross_bank','points','points_sbi','legacy_spend'
]);
const hex32=/^[0-9a-f]{32}$/i;
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
 .map(x=>x.toString(16).padStart(2,'0')).join('');
export const bytesToBase64=x=>{
 const bytes=x instanceof Uint8Array?x:new Uint8Array(x);
 let text='';
 for(let i=0;i<bytes.length;i+=32768)
  text+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(text);
};
export const base64ToBytes=x=>Uint8Array.from(atob(x),c=>c.charCodeAt(0));
function provePersonal(data,actor,key='viewer_user_id'){
 if(data?.ok!==true||data.scope!=='personal'||data[key]!==actor)
  throw Error('本人のアーカイブ範囲を確認できません');
}
export async function collectMemberArchive({actor,household,get,image,check=()=>{}}){
 if(typeof actor!=='string'||!actor||typeof household!=='string'||!household)
  throw Error('本人の認証情報を確認できません');
 const req=async path=>{check();const d=await get(path);check();return d};
 const [accounts,rules,fixed,categories,holdings,plans,assets,sbiLots]=await Promise.all([
  req('accounts'),req('member-merchant-rules'),req('member-fixed-costs'),
  req('member-categories'),req('manual-holdings'),req('member-recurring-plans'),
  req('personal/assets'),req('shared/sbi-cash-lots')
 ]);
 if(accounts?.account_scope!=='personal'||!Array.isArray(accounts.items)||
  accounts.items.some(x=>x.owner_user_id!==actor))throw Error('本人の口座範囲が一致しません');
 for(const x of [rules,categories,assets])provePersonal(x,actor);
 if(fixed?.scope!=='personal'||!Array.isArray(fixed.items)||fixed.items.some(x=>x.owner_user_id!==actor))
  throw Error('本人の固定費を確認できません');
 if(holdings?.scope!=='personal'||holdings.owner_user_id!==actor||
  !Array.isArray(holdings.holdings)||holdings.holdings.some(x=>x.owner_user_id!==actor))
  throw Error('本人の保有銘柄を確認できません');
 if(plans?.ok!==true||!Array.isArray(plans.items)||plans.items.some(x=>x.owner_user_id!==actor))
  throw Error('本人の積立計画を確認できません');
 if(sbiLots?.ok!==true||sbiLots.scope!=='personal'||!Array.isArray(sbiLots.positions)||
  sbiLots.positions.some(x=>x.owner_user_id!==actor))
  throw Error('本人の約定履歴を確認できません');
 const history={};
 for(const kind of ARCHIVE_KINDS){
  const own=kind==='legacy_spend'?'actor_user_id':kind==='points_sbi'?'owner_user_id':'requester_user_id';
  let before='',rows=[],pages=0;
  while(true){
   const d=await req('member-archive-history?kind='+kind+
    (before?'&before='+encodeURIComponent(before):''));
   provePersonal(d,actor);
   if(d.kind!==kind||d.read_only!==true||!Array.isArray(d.items)||
    d.items.length>80||d.items.some(x=>x[own]!==actor||x.household_id!==household))
    throw Error('本人の取引記録が一致しません：'+kind);
   rows.push(...d.items);
   if(!d.next_cursor)break;
   if(d.next_cursor===before||rows.length>20000||++pages>250)
    throw Error('取引履歴の全件取得を確認できません：'+kind);
   before=d.next_cursor;
  }
  history[kind]=rows;
 }
 let before='',receipts=[],bytes=0,pages=0;
 while(true){
  const d=await req('member-receipts'+(before?'?before='+encodeURIComponent(before):''));
  provePersonal(d,actor);
  if(!Array.isArray(d.items)||d.items.length>200||
   d.items.some(x=>!hex32.test(x.receipt_id)||x.state!=='ready'||
    !['image/jpeg','image/webp'].includes(x.content_type)||
    !Number.isInteger(x.size_bytes)||x.size_bytes<1||x.size_bytes>204800))
   throw Error('本人のレシート情報を確認できません');
  for(const meta of d.items){
   check();
   if(bytes+meta.size_bytes>MAX_MEMBER_IMAGE_BYTES)
    throw Error('画像の合計が42MBを超えました。既存画像を減らさず、分割保存が必要です');
   const blob=await image(meta.receipt_id);
   check();
   if(!(blob instanceof Blob)||blob.type!==meta.content_type||blob.size!==meta.size_bytes)
    throw Error('R2画像の形式・容量が変わりました：'+meta.receipt_id);
   const raw=await blob.arrayBuffer();
   const digest=await sha(raw);
   receipts.push({...meta,sha256:digest,data_base64:bytesToBase64(raw)});
   bytes+=meta.size_bytes;
  }
  if(!d.next_cursor)break;
  if(d.next_cursor===before||++pages>250)
   throw Error('レシート全件取得を確認できません');
  before=d.next_cursor;
 }
 const record={format:'kakeibo-member-private-archive-v3',
  scope:'personal_history_evidence_and_settings',owner_user_id:actor,
  household_id:household,exported_at:new Date().toISOString(),
  accounts:accounts.items,merchant_rules:rules.items,fixed_costs:fixed.items,
  categories:categories.items,manual_holdings:holdings.holdings,
  recurring_plans:plans.items,personal_assets:assets.accounts,
  sbi_cash_lots:sbiLots.positions,history,receipts,
  restore_policy:'settings_and_missing_manual_holdings_and_verified_receipts_only',
  transaction_restore:'requires_separate_original_HomeFlow_household_entry_review',
  issuer_or_broker_verified:false};
 if(JSON.stringify(record).length>73*1024*1024)
  throw Error('アーカイブが暗号化上限を超えました');
 return record;
}
export async function verifiedArchiveImage(item){
 if(!hex32.test(item?.receipt_id)||!['image/jpeg','image/webp'].includes(item.content_type)||
  !Number.isInteger(item.size_bytes)||item.size_bytes<1||item.size_bytes>204800||
  typeof item.data_base64!=='string'||item.data_base64.length>275000||
  !/^[a-f0-9]{64}$/i.test(item.sha256||''))throw Error('画像データの形式が不正です');
 let bytes;
 try{bytes=base64ToBytes(item.data_base64)}catch{throw Error('画像データが破損しています')}
 if(bytes.length!==item.size_bytes||await sha(bytes)!==item.sha256)
  throw Error('レシート画像のハッシュが一致しません');
 return new Blob([bytes],{type:item.content_type});
}
