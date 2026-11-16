// Member-scoped manual fund positions, independent of legacy owner holdings,
// bank debits, HomeFlow approvals and actual SBI broker transactions.
const reply=(body,status=200)=>Response.json(body,{status,headers:{
 'cache-control':'no-store','x-content-type-options':'nosniff'}})
const reject=(code,status=409)=>reply({ok:false,code,ledger_changed:false},status)
const id=x=>typeof x==='string'&&/^[0-9a-f]{32}$/i.test(x)
const fund=x=>typeof x==='string'&&/^[A-Z0-9]{8}$/.test(x)
const goodInteger=(x,max=1000000000000)=>Number.isSafeInteger(x)&&x>=0&&x<=max
const strict=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join()===keys.slice().sort().join()
const date=x=>typeof x==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(x)
const types=new Set(['growth','tsumitate','combined'])
const fields='household_id,owner_user_id,fund_code,account_type,fund_name,units,acquisition_cost,nav_per_10000,price_date,version,updated_at'
async function getRows(db,u){
 const r=await db.prepare('SELECT '+fields+' FROM family_member_manual_holdings '+
  'WHERE household_id=? AND owner_user_id=? ORDER BY updated_at DESC LIMIT 101')
  .bind(u.household_id,u.user_id).all()
 if((r.results||[]).length>100)throw Error('HOLDING_LIMIT')
 return r.results||[]
}
function validHolding(x){
 return x&&fund(x.fundCode)&&types.has(x.accountType)&&
  typeof x.fundName==='string'&&x.fundName.trim().length>0&&x.fundName.length<=120&&
  goodInteger(x.units)&&goodInteger(x.acquisitionCost)&&
  ((x.units===0)===(x.acquisitionCost===0))&&
  Number.isInteger(x.expectedVersion)&&x.expectedVersion>=0
}
async function input(req,url){
 if(req.headers.get('origin')!==url.origin||req.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')return null
 try{const x=await req.text();return x.length<=16000?JSON.parse(x):null}catch{return null}
}
const selectOne=(db,u,code,type)=>db.prepare('SELECT '+fields+' FROM family_member_manual_holdings '+
 'WHERE household_id=? AND owner_user_id=? AND fund_code=? AND account_type=? LIMIT 1')
 .bind(u.household_id,u.user_id,code,type).first()
const view=x=>{
 const mv=x.nav_per_10000===null?null:Math.round(x.units*x.nav_per_10000/10000)
 const safe=mv===null||Number.isSafeInteger(mv)
 if(!safe)throw Error('HOLDING_VALUATION_INVALID')
 return {fund_code:x.fund_code,account_type:x.account_type,fund_name:x.fund_name,
  units:x.units,acquisition_cost:x.acquisition_cost,nav_per_10000:x.nav_per_10000,
  price_date:x.price_date,source:x.price_date?'manual':'unknown',
  market_value:mv,pnl:mv===null?null:mv-x.acquisition_cost,
  version:x.version,broker_reconciled:false,owner_user_id:x.owner_user_id,
  data_source:'manual_member_tracking'}
}
export async function familyManualHoldings(req,env,url,user,parts){
 if(!id(user.user_id)||!id(user.household_id)||!env.DB?.prepare)return reject('IDENTITY_REQUIRED',403)
 const db=env.DB
 if(req.method==='GET'&&parts.length===1){
  try{
   const rows=await getRows(db,user)
   return reply({ok:true,scope:'personal',owner_user_id:user.user_id,
    holdings:rows.map(view),broker_verified:false,ledger_changed:false})
  }catch{return reject('MEMBER_HOLDINGS_UNAVAILABLE',503)}
 }
 if(req.method!=='PUT'||parts.length!==2)return reject('METHOD_NOT_ALLOWED',405)
 const x=await input(req,url)
 if(!x||x.expected_user_id!==user.user_id)return reject('HOLDING_ACTOR_CHANGED',403)
 const stamp=Date.now()
 if(parts[1]==='holding'){
  if(!strict(x,['expected_user_id','fundCode','fundName','accountType','units','acquisitionCost','expectedVersion'])||
   !validHolding(x))return reject('HOLDING_INPUT_INVALID',400)
  const current=await selectOne(db,user,x.fundCode,x.accountType)
  if((current?.version||0)!==x.expectedVersion)return reject('HOLDING_VERSION_CHANGED')
  if(!current){
   if((await getRows(db,user)).length>=100)return reject('HOLDING_LIMIT_REACHED')
   try{
    await db.prepare('INSERT INTO family_member_manual_holdings '+
     '(household_id,owner_user_id,fund_code,account_type,fund_name,units,acquisition_cost,created_at,updated_at) '+
     'VALUES(?,?,?,?,?,?,?,?,?)')
     .bind(user.household_id,user.user_id,x.fundCode,x.accountType,x.fundName.trim(),
      x.units,x.acquisitionCost,stamp,stamp).run()
   }catch{return reject('HOLDING_CREATE_CONFLICT')}
  }else{
   const r=await db.prepare('UPDATE family_member_manual_holdings '+
    'SET fund_name=?,units=?,acquisition_cost=?,version=version+1,updated_at=? '+
    'WHERE household_id=? AND owner_user_id=? AND fund_code=? AND account_type=? AND version=?')
    .bind(x.fundName.trim(),x.units,x.acquisitionCost,stamp,user.household_id,user.user_id,
     x.fundCode,x.accountType,x.expectedVersion).run()
   if(r.meta?.changes!==1)return reject('HOLDING_VERSION_CHANGED')
  }
  return reply({ok:true,ledger_changed:false,broker_ordered:false,
   holding:view(await selectOne(db,user,x.fundCode,x.accountType))})
 }
 if(parts[1]==='price'){
  if(!strict(x,['expected_user_id','fundCode','navPer10000','priceDate'])||
   !fund(x.fundCode)||!goodInteger(x.navPer10000,1000000000)||x.navPer10000===0||
   !date(x.priceDate))return reject('PRICE_INPUT_INVALID',400)
  const r=await db.prepare('UPDATE family_member_manual_holdings SET '+
   'nav_per_10000=?,price_date=?,version=version+1,updated_at=? '+
   'WHERE household_id=? AND owner_user_id=? AND fund_code=?')
   .bind(x.navPer10000,x.priceDate,stamp,user.household_id,user.user_id,x.fundCode).run()
  if(!r.meta?.changes)return reject('HOLDING_NOT_FOUND',404)
  return reply({ok:true,ledger_changed:false,source:'manual',changed:r.meta.changes})
 }
 if(parts[1]==='holdings-bulk'){
  if(!strict(x,['expected_user_id','holdings'])||!Array.isArray(x.holdings)||
   x.holdings.length<1||x.holdings.length>100)return reject('BULK_INPUT_INVALID',400)
  const key=new Set()
  for(const row of x.holdings){
   if(!strict(row,['fundCode','accountType','units','acquisitionCost','expectedUnits','expectedAcquisitionCost','expectedVersion'])||
    !fund(row.fundCode)||!types.has(row.accountType)||
    !goodInteger(row.units)||!goodInteger(row.acquisitionCost)||
    (row.units===0)!==(row.acquisitionCost===0)||
    !goodInteger(row.expectedUnits)||!goodInteger(row.expectedAcquisitionCost)||
    !Number.isSafeInteger(row.expectedVersion)||row.expectedVersion<1||
    key.has(row.fundCode+':'+row.accountType))return reject('BULK_INPUT_INVALID',400)
   key.add(row.fundCode+':'+row.accountType)
  }
  // A single UPDATE with a complete CAS count ensures ALL or NONE.
  const incoming=JSON.stringify(x.holdings)
  try{
   const result=await db.prepare("WITH incoming AS (SELECT "+ 
    "json_extract(value,'$.fundCode') code,json_extract(value,'$.accountType') kind,"+
    "json_extract(value,'$.units') units,json_extract(value,'$.acquisitionCost') cost,"+
    "json_extract(value,'$.expectedUnits') old_units,json_extract(value,'$.expectedAcquisitionCost') old_cost,"+
    "json_extract(value,'$.expectedVersion') ver FROM json_each(?)) "+
    "UPDATE family_member_manual_holdings SET "+
    "units=(SELECT units FROM incoming WHERE code=fund_code AND kind=account_type),"+
    "acquisition_cost=(SELECT cost FROM incoming WHERE code=fund_code AND kind=account_type),"+
    "version=version+1,updated_at=? WHERE household_id=? AND owner_user_id=? "+
    "AND (SELECT COUNT(*) FROM incoming i JOIN family_member_manual_holdings h "+
    "ON h.fund_code=i.code AND h.account_type=i.kind AND h.household_id=? AND h.owner_user_id=? "+
    "AND h.units=i.old_units AND h.acquisition_cost=i.old_cost AND h.version=i.ver)=? "+
    "AND EXISTS (SELECT 1 FROM incoming WHERE code=fund_code AND kind=account_type)")
    .bind(incoming,stamp,user.household_id,user.user_id,
     user.household_id,user.user_id,x.holdings.length).run()
   if(result.meta?.changes!==x.holdings.length)return reject('BULK_CAS_CONFLICT')
   return reply({ok:true,ledger_changed:false,changed:result.meta.changes})
  }catch{return reject('BULK_HOLDINGS_FAILED',503)}
 }
 return reject('NOT_FOUND',404)
}
