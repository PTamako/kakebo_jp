// Per-member merchant rules. Each request is bound to the revalidated HomeFlow
// identity by the parent router, and each SQL statement filters both owner and household.
// No privileged legacy merchant rules or other household account metadata are exposed.
const json = (x, status=200) => Response.json(x,{status,headers:{
  'cache-control':'no-store','x-content-type-options':'nosniff'
}});
const fail=(code,status=409)=>json({ok:false,code,ledger_changed:false},status);
const normal=x=>typeof x==='string'?x.normalize('NFKC').trim():null;
const safe=(x,max)=>typeof x==='string'&&x.length<=max&&
 [...x].every(ch=>ch.charCodeAt(0)>31&&ch.charCodeAt(0)!==127);
async function first(db,sql,...args){return db.prepare(sql).bind(...args).first();}
async function body(req,url){
 if(req.headers.get('origin')!==url.origin||
  req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return null;
 try{
  const raw=await req.text(),x=raw.length<=1800?JSON.parse(raw):null;
  return x&&typeof x==='object'&&!Array.isArray(x)?x:null;
 }catch{return null;}
}
function exact(x,keys){
 return !!x&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
}
async function paymentAllowed(db,user,source){
 if(!source||source==='cash')return true;
 if(source.startsWith('personal:')&&/^[a-f0-9]{32}$/i.test(source.slice(9))){
  return !!await first(db,"SELECT 1 FROM family_financial_accounts WHERE account_id=? "+
   "AND household_id=? AND owner_user_id=? AND origin='member_created' "+
   "AND account_kind IN ('credit_card','prepaid') AND is_archived=0",
   source.slice(9),user.household_id,user.user_id);
 }
 if(source.startsWith('shared:')&&source.slice(7).length<=80){
  return !!await first(db,"SELECT 1 FROM family_legacy_card_shares s "+
   "JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id "+
   "JOIN payment_sources p ON p.name=s.card_name "+
   "WHERE s.card_name=? AND s.household_id=? AND s.grantee_user_id=? "+
   "AND s.is_active=1 AND o.role='owner' AND o.state='active' "+
   "AND p.is_archived=0 AND p.stat_group='card'",
   source.slice(7),user.household_id,user.user_id);
 }
 return false;
}
export async function familyMemberMerchantRules(req,env,url,user,parts){
 if(user?.role!=='member'||!user.user_id||!user.household_id)return fail('MEMBER_REQUIRED',403);
 if(!env.DB?.prepare)return fail('D1_UNAVAILABLE',503);
 const db=env.DB;
 try{
  const active=await first(db,"SELECT 1 FROM homeflow_identity_links "+
   "WHERE user_id=? AND household_id=? AND role='member' AND state='active'",
   user.user_id,user.household_id);
  if(!active)return fail('SESSION_REVOKED',403);
  if(parts.length!==1)return fail('NOT_FOUND',404);
  if(req.method==='GET'){
   const result=await db.prepare('SELECT keyword,category,payment_source,version FROM family_member_merchant_rules '+
    'WHERE household_id=? AND owner_user_id=? ORDER BY keyword LIMIT 200')
    .bind(user.household_id,user.user_id).all();
   return json({ok:true,scope:'personal',viewer_user_id:user.user_id,
    items:result.results||[],ledger_changed:false});
  }
  if(req.method==='POST'){
   const x=await body(req,url);
   if(x?.expected_user_id!==undefined&&x.expected_user_id!==user.user_id)
    return fail('ACTOR_CHANGED',403);
   if(!(exact(x,['expected_user_id','expected_version','keyword','category','payment_source'])||
     exact(x,['expected_user_id','expected_version','keyword','category','payment_source','previous_keyword']))||
    (x.previous_keyword!==undefined&&!safe(x.previous_keyword,120))||
    x.expected_user_id!==user.user_id||!Number.isSafeInteger(x.expected_version)||
    x.expected_version<0||!safe(x.keyword,120)||!safe(x.category,100)||
    !safe(x.payment_source,160))return fail('INVALID_RULE',400);
   const keyword=normal(x.keyword),previousKeyword=x.previous_keyword===undefined?keyword:normal(x.previous_keyword);
   const category=normal(x.category),source=x.payment_source;
   if(!keyword||!previousKeyword||keyword.length>120||previousKeyword.length>120||
    (!category&&!source))return fail('INVALID_RULE',400);
   if(!await paymentAllowed(db,user,source))return fail('PAYMENT_SOURCE_NOT_ALLOWED',403);
   const old=await first(db,'SELECT version FROM family_member_merchant_rules WHERE '+
    'household_id=? AND owner_user_id=? AND keyword=?',
    user.household_id,user.user_id,previousKeyword);
   if((old?.version||0)!==x.expected_version)return fail('RULE_VERSION_CHANGED',409);
   if(previousKeyword!==keyword){
    const destination=await first(db,'SELECT 1 FROM family_member_merchant_rules WHERE '+
     'household_id=? AND owner_user_id=? AND keyword=?',user.household_id,user.user_id,keyword);
    if(destination)return fail('RULE_KEYWORD_EXISTS',409);
   }
   const stamp=Date.now();
   if(!old){
    if(x.previous_keyword!==undefined)return fail('RULE_VERSION_CHANGED',409);
    const count=await first(db,'SELECT COUNT(*) AS count FROM family_member_merchant_rules '+
     'WHERE household_id=? AND owner_user_id=?',user.household_id,user.user_id);
    if(Number(count?.count||0)>=200)return fail('RULE_LIMIT_REACHED',409);
    const res=await db.prepare('INSERT INTO family_member_merchant_rules '+
     '(household_id,owner_user_id,keyword,category,payment_source,version,updated_at) '+
     'VALUES(?,?,?,?,?,1,?)').bind(user.household_id,user.user_id,keyword,
      category,source,stamp).run().catch(()=>null);
    if(res?.meta?.changes!==1)return fail('RULE_VERSION_CHANGED',409);
   }else{
    const res=await db.prepare('UPDATE family_member_merchant_rules '+
     'SET keyword=?,category=?,payment_source=?,version=version+1,updated_at=? '+
     'WHERE household_id=? AND owner_user_id=? AND keyword=? AND version=? '+
     'AND NOT EXISTS (SELECT 1 FROM family_member_merchant_rules '+
     'WHERE household_id=? AND owner_user_id=? AND keyword=? AND keyword<>?)')
     .bind(keyword,category,source,stamp,user.household_id,user.user_id,previousKeyword,x.expected_version,
      user.household_id,user.user_id,keyword,previousKeyword).run().catch(()=>null);
    if(res?.meta?.changes!==1)return fail('RULE_VERSION_CHANGED',409);
   }
   return json({ok:true,scope:'personal',keyword,version:x.expected_version+1,ledger_changed:false});
  }
  if(req.method==='DELETE'){
   const x=await body(req,url);
   if(x?.expected_user_id!==undefined&&x.expected_user_id!==user.user_id)
    return fail('ACTOR_CHANGED',403);
   if(!exact(x,['expected_user_id','expected_version','keyword'])||
    x.expected_user_id!==user.user_id||!Number.isSafeInteger(x.expected_version)||
    x.expected_version<1||!safe(x.keyword,120))return fail('INVALID_RULE',400);
   const keyword=normal(x.keyword);
   if(!keyword)return fail('INVALID_RULE',400);
   const res=await db.prepare('DELETE FROM family_member_merchant_rules WHERE '+
    'household_id=? AND owner_user_id=? AND keyword=? AND version=?')
    .bind(user.household_id,user.user_id,keyword,x.expected_version).run();
   if(res.meta?.changes!==1)return fail('RULE_VERSION_CHANGED',409);
   return json({ok:true,removed:true,scope:'personal',ledger_changed:false});
  }
  return fail('METHOD_NOT_ALLOWED',405);
 }catch{return fail('MERCHANT_RULE_UNAVAILABLE',503);}
}