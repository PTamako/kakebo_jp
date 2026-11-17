import test from 'node:test';
import assert from 'node:assert/strict';
import {collectMemberArchive,verifiedArchiveImage,ARCHIVE_KINDS} from '../src/member-private-archive.js';
function fake(){
 const data={
  accounts:{account_scope:'personal',items:[{owner_user_id:'m'}]},
  'member-merchant-rules':{ok:true,scope:'personal',viewer_user_id:'m',items:[]},
  'member-fixed-costs':{ok:true,scope:'personal',items:[]},
  'member-categories':{ok:true,scope:'personal',viewer_user_id:'m',items:[]},
  'manual-holdings':{ok:true,scope:'personal',owner_user_id:'m',holdings:[]},
  'member-recurring-plans':{ok:true,scope:'personal',items:[]},
  'personal/assets':{ok:true,scope:'personal',viewer_user_id:'m',accounts:[]},
  'shared/sbi-cash-lots':{ok:true,scope:'personal',positions:[]},
  'member-receipts':{ok:true,scope:'personal',viewer_user_id:'m',items:[],next_cursor:null}
 };
 const get=async path=>{
  if(path.startsWith('member-archive-history?')){
   const kind=new URL('https://x/?'+path.split('?')[1]).searchParams.get('kind');
   return {ok:true,scope:'personal',viewer_user_id:'m',read_only:true,kind,items:[],next_cursor:null}
  }
  return data[path];
 };
 return {get,data};
}
test('member archive gathers all categories and own immutable history types without writing any ledger',async()=>{
 const {get}=fake(),paths=[];
 const record=await collectMemberArchive({actor:'m',household:'h',get:async p=>(paths.push(p),get(p)),image:async()=>{throw Error('no receipts')}});
 assert.equal(record.format,'kakeibo-member-private-archive-v3');
 assert.equal(record.transaction_restore,'requires_separate_original_HomeFlow_household_entry_review');
 assert.deepEqual(Object.keys(record.history),[...ARCHIVE_KINDS]);
 assert.equal(paths.filter(x=>x.startsWith('member-archive-history')).length,ARCHIVE_KINDS.length);
});
test('member archive refuses a different user and corrupt image bytes',async()=>{
 const {get,data}=fake();
 data['member-categories'].viewer_user_id='other';
 await assert.rejects(collectMemberArchive({actor:'m',household:'h',get,image:async()=>null}),/本人のアーカイブ範囲/);
 const bogus={receipt_id:'a'.repeat(32),content_type:'image/jpeg',size_bytes:3,sha256:'f'.repeat(64),data_base64:'AAAA'};
 await assert.rejects(verifiedArchiveImage(bogus),/ハッシュが一致/);
});
test('private receipt bytes are sealed by digest and detected if altered',async()=>{
 const content=new TextEncoder().encode('abc');
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',content))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const {bytesToBase64}=await import('../src/member-private-archive.js');
 const data={receipt_id:'a'.repeat(32),content_type:'image/jpeg',size_bytes:3,sha256:sha,data_base64:bytesToBase64(content)};
 assert.equal((await verifiedArchiveImage(data)).size,3);
 await assert.rejects(verifiedArchiveImage({...data,data_base64:'AQID'}),/ハッシュが一致/);
});
