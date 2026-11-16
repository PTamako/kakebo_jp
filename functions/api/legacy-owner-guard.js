// Strict original-owner authorization for legacy financial endpoints.
// Enabled only with the explicit production switch after existing devices
// have migrated to HomeFlow SSO. A legacy access code alone is NOT enough.
import {onRequest as homeflowIdentity,ssoReady} from './homeflow-sso/[[path]].js';

const json=(data,status)=>Response.json(data,{status,headers:{
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
}});
export async function verifyLegacyOwner(request,env,url){
 if(env.KAKEIBO_REQUIRE_OWNER_IDENTITY_FOR_LEGACY!=='true')return null;
 if(!ssoReady(env,url))return json({
  code:'HOMEFLOW_OWNER_VERIFICATION_UNAVAILABLE',
  error:'HomeFlow 管理员身份验证暂不可用，请先恢复统一登录'},503);
 const headers={Cookie:request.headers.get('cookie')||''};
 const proof=new Request(url,{method:'GET',headers});
 let verified;
 try{
  const response=await homeflowIdentity({request:proof,env,params:{path:['me']}});
  if(response.status!==200)return json({
   code:'HOMEFLOW_OWNER_REQUIRED',
   error:'请先以原账本管理员的 HomeFlow 账号登录'},401);
  verified=await response.json();
 }catch{return json({code:'HOMEFLOW_OWNER_REQUIRED',error:'HomeFlow 管理员身份无法核验'},401)}
 const user=verified?.identity;
 if(verified?.ok!==true||verified.ledger_access!==false||
   user?.role!=='owner'||typeof user.user_id!=='string'||
   user.household_id!==env.KAKEIBO_FAMILY_HOUSEHOLD_ID)
  return json({code:'HOMEFLOW_OWNER_REQUIRED',error:'非原账本管理员不能使用旧财务入口'},403);
 return null;
}
