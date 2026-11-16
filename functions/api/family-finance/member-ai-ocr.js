// The same OCR engine and daily quota as the original owner input page,
// authenticated by the member's verified HomeFlow session at the parent router.
import {recognizeWithGemma} from '../gemma-ocr.js'
import {aiQuotaState,reserveAiAttempt} from '../ai-quota.js'
const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})
export async function familyMemberAiOcr(request,env,url,user,parts){
 if(!user?.user_id||!['member','owner'].includes(user.role))
  return reply({ok:false,error:'認証が必要です'},403)
 if(parts.length===2&&parts[1]==='quota'&&request.method==='GET'){
  try{return reply({ok:true,...await aiQuotaState(env.DB,env)})}
  catch{return reply({ok:false,error:'AI利用枠を確認できません'},503)}
 }
 if(parts.length!==1||request.method!=='POST')return reply({ok:false,error:'Not found'},404)
 if(request.headers.get('origin')!==url.origin)
  return reply({ok:false,error:'リクエスト元を確認してください'},403)
 if(!env.AI)return reply({ok:false,error:'AI接続が未設定です'},503)
 const size=Number(request.headers.get('content-length')||0)
 if(size>5*1024*1024)return reply({ok:false,error:'画像サイズが大きすぎます'},413)
 let body
 try{body=await request.formData()}catch{return reply({ok:false,error:'画像を読み込めませんでした'},400)}
 const f=body.get('image'),rawMode=body.get('mode')
 const mode=['receipt','statement'].includes(rawMode)?rawMode:'statement'
 if(!f||typeof f.arrayBuffer!=='function'||
  !['image/jpeg','image/png','image/webp'].includes(f.type)||
  f.size<1||f.size>4*1024*1024)
  return reply({ok:false,error:'JPEG・PNG・WebP画像（4MB以下）を選択してください'},400)
 try{
  const quota=await reserveAiAttempt(env.DB,env)
  if(!quota.allowed)return reply({ok:false,error:'本日のAI画像認識の上限に達しました',code:'daily_limit'},429)
 }catch{return reply({ok:false,error:'AI使用枠を確認できません'},503)}
 try{
  const text=await recognizeWithGemma(env.AI,await f.arrayBuffer(),f.type,mode)
  return reply({ok:true,text,engine:'gemma4'})
 }catch(e){
  console.error('Member AI OCR failed',{name:String(e?.name||''),message:String(e?.message||'').slice(0,100)})
  return reply({ok:false,error:'AI画像認識に失敗しました。端末内OCRをご利用ください'},502)
 }
}
