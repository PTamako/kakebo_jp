// Member-private, account-free SBI document movements. Only after signed
// source submission; displayed as asset transfers, never income/expense or lots.
const json=(x,status=200)=>Response.json(x,{status,headers:{'cache-control':'no-store'}});
const deny=(code,status=409)=>json({ok:false,code},status);
const id=/^[a-f0-9]{32}$/i;
const validDay=x=>typeof x==='string'&&/^20\d\d-\d\d-\d\d$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const view=r=>({id:'doc-sbi:'+r.transfer_id,transfer_id:r.transfer_id,
 date:r.date,time:'',amount:r.amount_jpy,type:'transfer',
 category:'投資・資産移動',merchant:r.merchant,note:r.note,
 transfer_target:'sbi',transfer_date:r.effective_date,
 purpose:r.purpose,version:r.version,document_personal_sbi:true,
 recorded_by:r.display_name||'',creator_user_id:r.owner_user_id,
 state:r.state,source_document_linked:true,asset_balance_unverified:true});
export async function familyPersonalDocumentSbi(request,env,url,user,parts){
 if(env.KAKEIBO_DOCUMENT_PERSONAL_SBI_ENABLED!=='true'||!env.DB?.prepare)
  return deny('PERSONAL_SBI_DISABLED',503);
 if(user.role!=='member')return deny('MEMBER_REQUIRED',403);
 const db=env.DB;
 const active=await db.prepare("SELECT display_name FROM homeflow_identity_links WHERE user_id=? AND household_id=? AND role='member' AND state='active'")
  .bind(user.user_id,user.household_id).first();
 if(!active)return deny('IDENTITY_INACTIVE',403);
 if(request.method==='GET'&&parts.length===1){
  const month=url.searchParams.get('month'),year=url.searchParams.get('year');
  const offset=Number(url.searchParams.get('offset')||'0');
  if((month&&year)||!Number.isInteger(offset)||offset<0||offset>100000||
   (month&&!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))||
   (year&&!/^20\d\d$/.test(year))||
   (!month&&!year))return deny('INVALID_RANGE',400);
  const start=month?month+'-01':year+'-01-01',end=month?month+'-31':year+'-12-31';
  const rows=(await db.prepare('SELECT * FROM family_document_personal_sbi_transfers '+
   "WHERE household_id=? AND owner_user_id=? AND date>=? AND date<=? AND state='active' "+
   'ORDER BY date DESC,transfer_id DESC LIMIT 101 OFFSET ?')
    .bind(user.household_id,user.user_id,start,end,offset).all()).results||[];
  return json({ok:true,scope:'personal',viewer_user_id:user.user_id,
   items:rows.slice(0,100).map(r=>view({...r,display_name:active.display_name})),
   next_offset:rows.length>100?offset+100:null,
   excluded_from_income_expense:true,no_fund_units_inferred:true});
 }
 if(parts.length!==2||!id.test(parts[1]))return deny('NOT_FOUND',404);
 const transferId=parts[1];
 const record=await db.prepare('SELECT * FROM family_document_personal_sbi_transfers '+
  'WHERE transfer_id=? AND household_id=? AND owner_user_id=?').bind(transferId,user.household_id,user.user_id).first();
 if(!record)return deny('NOT_FOUND',404);
 if(!['PATCH','DELETE','POST'].includes(request.method))return deny('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('origin')!==url.origin||
  request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json')
  return deny('ORIGIN_REQUIRED',403);
 let data;try{const raw=await request.text();data=raw.length<=1200?JSON.parse(raw):null;}catch{}
 if(!data||data.expected_user_id!==user.user_id||
  !Number.isSafeInteger(data.expected_version)||data.expected_version!==record.version)
  return deny('ACTOR_OR_VERSION_CONFLICT',409);
 const patch=request.method==='PATCH',action=patch?'update':request.method==='DELETE'?'trash':'restore';
 if((request.method==='POST'&&data.action!=='restore')||
  (patch&&record.state!=='active')||(action==='trash'&&record.state!=='active')||
  (action==='restore'&&record.state!=='trashed'))return deny('INVALID_STATE');
 if(patch&&(!validDay(data.date)||!validDay(data.effective_date)||
  !Number.isSafeInteger(data.amount_jpy)||data.amount_jpy<1||data.amount_jpy>10000000||
  typeof data.note!=='string'||data.note.length>180))
  return deny('INVALID_CHANGES',400);
 const newDate=patch?data.date:record.date,effective=patch?data.effective_date:record.effective_date,
  newAmount=patch?data.amount_jpy:record.amount_jpy,note=patch?data.note:record.note,
  state=action==='trash'?'trashed':'active',at=Date.now();
 const audit=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
 try{
  await db.batch([
   db.prepare('UPDATE family_document_personal_sbi_transfers SET '+
    'date=?,effective_date=?,amount_jpy=?,note=?,state=?,version=version+1,updated_at=? '+
    'WHERE transfer_id=? AND owner_user_id=? AND household_id=? AND version=? AND state=?')
    .bind(newDate,effective,newAmount,note,state,at,transferId,user.user_id,user.household_id,
      record.version,record.state),
   db.prepare('INSERT INTO family_document_personal_sbi_audit '+
    '(audit_id,transfer_id,actor_user_id,action,before_version,after_version,created_at) '+
    'SELECT ?,transfer_id,owner_user_id,?,?,version,? FROM family_document_personal_sbi_transfers '+
    'WHERE transfer_id=? AND version=?')
    .bind(audit,action,record.version,at,transferId,record.version+1)
  ]);
 }catch{return deny('PERSONAL_SBI_REVISION_RETRY',503)}
 const after=await db.prepare('SELECT * FROM family_document_personal_sbi_transfers '+
  'WHERE transfer_id=? AND owner_user_id=? AND version=?')
  .bind(transferId,user.user_id,record.version+1).first();
 return after&&after.state===state?json({ok:true,item:view({...after,display_name:active.display_name})}):
  deny('PERSONAL_SBI_REVISION_UNCONFIRMED',503);
}
