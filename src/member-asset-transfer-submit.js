import {memberOwnActiveAssets,memberTransferOperation} from './member-transfer-options.js'
const today=()=>new Date(Date.now()+32400000).toISOString().slice(0,10)
const positive=(value,max)=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=max
const clean=s=>typeof s==='string'?s.trim():''
const requiredReference=s=>clean(s).length>=8&&clean(s).length<=160
const endpoint='/api/family-finance/'
async function familyApi(path,options={}){
 const r=await fetch(endpoint+path,{credentials:'same-origin',cache:'no-store',...options})
 const x=await r.json().catch(()=>({}))
 if(!r.ok||x.ok!==true)throw Error(x.code||'本人の資産移動の保存結果を確認できません')
 return x
}
// Commit only existing, verified personal-asset ledger routes. No personal
// transfer can be reclassified as a household income/expense or sent for
// the other member's private accounts.
export async function submitMemberPersonalTransfer({record,userId,accounts,persistPending=null}){
 if(record?.type!=='transfer')throw Error('資産移動を選択してください')
 const operation=memberTransferOperation(record.transferTarget)
 if(!operation||operation==='spouse')throw Error('振替先を選択してください')
 const amount=Number(record.amount),effectiveDate=clean(record.transferDate)
 if(!positive(amount,10000000)||!effectiveDate||effectiveDate>today())
  throw Error('金額と実際の反映日を確認してください')
 const own=memberOwnActiveAssets(accounts,userId)
 const fingerprint=JSON.stringify({
  actor:userId,route:record.transferTarget,amount,effectiveDate,
  pointSourceId:record.pointSourceId||'',assetTargetId:record.assetTargetId||'',
  pointUnits:record.pointUnits||'',targetPointUnits:record.targetPointUnits||'',
  cardPurchaseId:record.cardPurchaseId||'',fundCode:record.fundCode||'',
  fundAccountType:record.fundAccountType||'',fundUnits:record.fundUnits||'',
  brokerReference:record.brokerReference||'',brokerConfirmed:record.brokerConfirmed===true,
  issuerReference:record.issuerReference||'',counterpartReference:record.counterpartReference||'',
  issuerConfirmed:record.issuerConfirmed===true,
  counterpartConfirmed:record.counterpartConfirmed===true,
  assetConfirmed:record.assetConfirmed===true
 })
 if(record.memberAssetPending&&record.memberAssetPending.fingerprint!==fingerprint)
  throw Error('前回の資産処理の送信結果が未確認です。内容を変更せず同じ申請を再送してください')
 if(record.memberAssetPending?.acknowledged===true)return {type:'applied'}
 const wasPending=!!record.memberAssetPending
 let pending=record.memberAssetPending
 if(!pending){
  let payload
  if(operation==='prepaid'){
   const targetId=record.transferTarget.slice('prepaid:'.length)
   const target=own.find(a=>a.account_id===targetId&&a.account_kind==='prepaid')
   if(!target||record.assetConfirmed!==true)
    throw Error('本人の電子マネーと実際のチャージ反映を確認してください')
   payload={expected_user_id:userId,prepaid_account_id:target.account_id,
    prepaid_version:target.version,amount_jpy:amount,effective_date:effectiveDate,
    confirmed:true}
  }else{
   if(record.issuerConfirmed!==true||record.counterpartConfirmed!==true||
    !positive(record.pointUnits,1000000000)||
    !requiredReference(record.issuerReference)||
    !requiredReference(record.counterpartReference))
    throw Error('ポイント数・発行元と受取先の確定明細番号・両方の反映確認が必要です')
   const fresh=await familyApi('member-points-asset-actions')
   if(fresh.scope!=='personal'||fresh.viewer_user_id!==userId||
    fresh.ledger_changed!==false||!Array.isArray(fresh.accounts)||
    !Array.isArray(fresh.purchases))
    throw Error('ポイント取引の本人資産を確認できません')
   // GET is already scoped to the signed-in member; its projected rows omit owner_user_id.
   const ownFresh=fresh.accounts
   const source=ownFresh.find(a=>a.account_id===record.pointSourceId&&a.account_kind==='points')
   const kind={transfer_prepaid:'prepaid',offset_card:'credit_card',redeem_asset:'securities',
    transfer_out:'points',exchange_out:'points'}[operation]
   const target=ownFresh.find(a=>a.account_id===record.assetTargetId&&
    a.account_kind===kind&&a.account_id!==record.pointSourceId)
   // Do not trust the browser's list: both sides must still belong to this
   // identity and be part of its current authenticated account inventory.
   if(!source||!target||!own.some(a=>a.account_id===source.account_id)||
    !own.some(a=>a.account_id===target.account_id))
    throw Error('本人のポイント口座・受取先の登録状況を確認してください')
   const units=Number(record.pointUnits)
   payload={expected_user_id:userId,operation,points_account_id:source.account_id,
    points_version:source.version,target_account_id:target.account_id,
    target_version:target.version,units,yen_value:amount,
    rate_numerator:amount,rate_denominator:units,effective_date:effectiveDate,
    issuer_reference:clean(record.issuerReference),
    counterpart_reference:clean(record.counterpartReference),
    issuer_confirmed:true,counterpart_confirmed:true}
   if(operation==='offset_card'){
    const purchase=fresh.purchases.find(p=>p.account_id===target.account_id&&
     p.homeflow_request_id===record.cardPurchaseId&&Number(p.remaining_jpy)>=amount&&
     p.purchase_date<=effectiveDate)
    if(!purchase)throw Error('本人の請求残額のあるカード支出を選択してください')
    payload.target_purchase_request_id=purchase.homeflow_request_id
   }
   if(operation==='redeem_asset'){
    if(!record.brokerConfirmed||!/^[A-Z0-9]{8}$/.test(clean(record.fundCode))||
     !['growth','tsumitate'].includes(record.fundAccountType)||!positive(record.fundUnits,1000000000000)||
     !/^[a-z0-9._:-]{8,128}$/i.test(clean(record.brokerReference)))
      throw Error('SBIの実際の約定番号・口数・銘柄情報を確認してください')
    Object.assign(payload,{sbi_fund_code:clean(record.fundCode),
     sbi_account_type:record.fundAccountType,
     sbi_confirmed_units:Number(record.fundUnits),
     broker_trade_reference:clean(record.brokerReference),
     broker_execution_confirmed:true})
   }
   if(operation==='transfer_out'||operation==='exchange_out'){
    const targetUnits=operation==='exchange_out'?Number(record.targetPointUnits):units
    if(!positive(targetUnits,1000000000))throw Error('受取ポイント数を確認してください')
    Object.assign(payload,{target_units:targetUnits,target_rate_numerator:amount,
     target_rate_denominator:targetUnits})
   }
  }
  pending={fingerprint,key:(operation==='prepaid'?'prepaid-topup:':'personal-asset:')+crypto.randomUUID(),operation,payload}
  record.memberAssetPending=pending
 }
 if(!window.confirm(operation==='prepaid'
  ?'このチャージが本人のカード残高へ実際に反映済みであることを確認しますか？'
  :'ポイント発行元と受取先の両方に実際に反映された内容を記録します。外部の金融取引は実行しません。よろしいですか？')){
  if(!wasPending)record.memberAssetPending=null
  throw Error('確認がキャンセルされました')
 }
 // The retry key and immutable submitted payload must survive an iOS crash
 // before the first POST; never rely on memory alone in the member workspace.
 if(typeof persistPending==='function')await persistPending()
 const path=operation==='prepaid'?'member-prepaid-topups':'member-points-asset-actions'
 const result=await familyApi(path,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({...pending.payload,idempotency_key:pending.key})})
 if(operation==='prepaid'){
  if(result.ledger_changed!==false||result.topup?.amount_jpy!==amount)
   throw Error('本人のチャージの受付結果を確認できません')
 }else if(result.scope!=='personal'||result.ledger_changed!==false||
  result.issuer_api_verified!==false||result.applied!==true||
  result.counterpart_confirmed!==true)
  throw Error('本人のポイント取引の受付結果を確認できません')
 if(typeof persistPending==='function'){
  // Keep the acknowledged key on the draft until its removal is durable.
  pending.acknowledged=true
  await persistPending()
 }else record.memberAssetPending=null
 return {type:'applied'}
}
