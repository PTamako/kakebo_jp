// Per-member custom categories. Changes affect only private settings, never the shared ledger.
const json=(x,status=200)=>Response.json(x,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false},status);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const valid=(x)=>typeof x==='string'&&x.trim().length>=1&&x.trim().length<=20&&
 [...x].every(ch=>ch.charCodeAt(0)>31&&ch.charCodeAt(0)!==127);
async function payload(request,url){
 if(request.headers.get('origin')!==url.origin||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')return null;
 try{const raw=await request.text();return raw.length<=500?JSON.parse(raw):null}catch{return null}
}
export async function familyMemberCategories(request,env,url,user,parts){
 if(user?.role!=='member'||!user.user_id||!user.household_id)return fail('MEMBER_REQUIRED',403);
 if(!env.DB?.prepare)return fail('D1_UNAVAILABLE',503);
 if(parts.length!==1)return fail('NOT_FOUND',404);
 try{
  const active=await env.DB.prepare("SELECT 1 FROM homeflow_identity_links "+
   "WHERE user_id=? AND household_id=? AND role='member' AND state='active' LIMIT 1")
   .bind(user.user_id,user.household_id).first();
  if(!active)return fail('SESSION_REVOKED',403);
  if(request.method==='GET'){
   const rows=await env.DB.prepare('SELECT entry_type AS type,category AS name,icon FROM family_member_categories '+
    'WHERE household_id=? AND owner_user_id=? ORDER BY entry_type,created_at LIMIT 80')
    .bind(user.household_id,user.user_id).all();
   return json({ok:true,scope:'personal',viewer_user_id:user.user_id,
    items:rows.results||[],ledger_changed:false});
  }
  if(request.method!=='POST'&&request.method!=='DELETE')return fail('METHOD_NOT_ALLOWED',405);
  const x=await payload(request,url);
  const keys=request.method==='POST'?['expected_user_id','type','name','icon']:
   ['expected_user_id','type','name'];
  if(!exact(x,keys)||x.expected_user_id!==user.user_id||
   !['expense','income'].includes(x.type)||!valid(x.name)||
   (request.method==='POST'&&!/^[a-z0-9-]{1,48}$/.test(x.icon)))
   return fail('INVALID_CATEGORY',400);
  const name=x.name.normalize('NFKC').trim();
  if(!valid(name))return fail('INVALID_CATEGORY',400);
  if(request.method==='POST'){
   const current=await env.DB.prepare('SELECT 1 FROM family_member_categories '+
    'WHERE household_id=? AND owner_user_id=? AND entry_type=? AND category=?')
    .bind(user.household_id,user.user_id,x.type,name).first();
   if(current)return json({ok:true,scope:'personal',created:false,ledger_changed:false});
   const count=await env.DB.prepare('SELECT COUNT(*) AS total FROM family_member_categories '+
    'WHERE household_id=? AND owner_user_id=?').bind(user.household_id,user.user_id).first();
   if(Number(count?.total||0)>=80)return fail('CATEGORY_LIMIT_REACHED',409);
   const r=await env.DB.prepare('INSERT INTO family_member_categories '+
    '(household_id,owner_user_id,entry_type,category,icon,created_at) VALUES(?,?,?,?,?,?) '+
    'ON CONFLICT DO NOTHING').bind(user.household_id,user.user_id,x.type,name,x.icon,Date.now()).run();
   if(r.meta?.changes!==1){
    const raced=await env.DB.prepare('SELECT 1 FROM family_member_categories '+
     'WHERE household_id=? AND owner_user_id=? AND entry_type=? AND category=?')
     .bind(user.household_id,user.user_id,x.type,name).first();
    return raced?json({ok:true,scope:'personal',created:false,ledger_changed:false}):
     fail('CATEGORY_CREATE_CONFLICT',409);
   }
   return json({ok:true,scope:'personal',created:true,ledger_changed:false},201);
  }
  const r=await env.DB.prepare('DELETE FROM family_member_categories WHERE '+
   'household_id=? AND owner_user_id=? AND entry_type=? AND category=?')
   .bind(user.household_id,user.user_id,x.type,name).run();
  return json({ok:true,scope:'personal',removed:r.meta?.changes===1,ledger_changed:false});
 }catch{return fail('PERSONAL_CATEGORIES_UNAVAILABLE',503)}
}
