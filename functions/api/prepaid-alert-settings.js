// Owner-only per-prepaid-card notification preferences and private service projection.
// Nothing here posts a transaction or discloses another member's wallet.
import {handlePrepaid} from './prepaid-assets.js'
import {familyPrepaidReport} from './family-finance/prepaid-report.js'

const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}})
export const validAlertAmount=value=>Number.isSafeInteger(value)&&value>=0&&value<=100000000
export const validAlertMode=value=>['lower','upper','both'].includes(value)
export const validAlertBounds=(mode,lower,upper)=>validAlertMode(mode)&&
 validAlertAmount(lower)&&validAlertAmount(upper)&&(mode!=='both'||lower<upper)

export async function updatePrepaidAlert(db,{scope,key,householdId,ownerUserId,enabled,thresholdJpy,mode='lower',upperThresholdJpy=10000}){
 if(!['legacy','member'].includes(scope)||typeof key!=='string'||!key||key.length>160||
    !householdId||!ownerUserId||typeof enabled!=='boolean'||
    !validAlertBounds(mode,thresholdJpy,upperThresholdJpy))
   return json({code:'INVALID_ALERT_SETTINGS'},400)
 const owner=scope==='legacy'
   ?await db.prepare(`SELECT p.name FROM payment_sources p JOIN family_legacy_owner_claims c
       ON c.record_scope='payment_source' AND c.record_key=p.name
       WHERE p.name=?1 AND p.source_type='prepaid' AND p.is_archived=0
         AND c.household_id=?2 AND c.owner_user_id=?3`)
       .bind(key,householdId,ownerUserId).first()
   :await db.prepare(`SELECT account_id FROM family_financial_accounts
       WHERE account_id=?1 AND account_kind='prepaid' AND origin='member_created'
         AND is_archived=0 AND household_id=?2 AND owner_user_id=?3`)
       .bind(key,householdId,ownerUserId).first()
 if(!owner)return json({code:'PREPAID_ALERT_NOT_OWNED'},403)
 const time=Date.now()
 await db.prepare(`INSERT INTO prepaid_balance_alert_settings
   (account_scope,resource_key,household_id,owner_user_id,enabled,threshold_jpy,alert_mode,upper_threshold_jpy,updated_at)
   VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
   ON CONFLICT(account_scope,resource_key) DO UPDATE SET
     enabled=excluded.enabled,threshold_jpy=excluded.threshold_jpy,
     alert_mode=excluded.alert_mode,upper_threshold_jpy=excluded.upper_threshold_jpy,
     version=prepaid_balance_alert_settings.version+1,updated_at=excluded.updated_at
   WHERE prepaid_balance_alert_settings.household_id=excluded.household_id
     AND prepaid_balance_alert_settings.owner_user_id=excluded.owner_user_id
     AND (prepaid_balance_alert_settings.enabled<>excluded.enabled
       OR prepaid_balance_alert_settings.threshold_jpy<>excluded.threshold_jpy
       OR prepaid_balance_alert_settings.alert_mode<>excluded.alert_mode
       OR prepaid_balance_alert_settings.upper_threshold_jpy<>excluded.upper_threshold_jpy)`)
   .bind(scope,key,householdId,ownerUserId,enabled?1:0,thresholdJpy,mode,upperThresholdJpy,time).run()
 const setting=await db.prepare(`SELECT enabled,threshold_jpy,alert_mode,upper_threshold_jpy,version
   FROM prepaid_balance_alert_settings WHERE account_scope=?1 AND resource_key=?2
     AND household_id=?3 AND owner_user_id=?4`)
   .bind(scope,key,householdId,ownerUserId).first()
 if(!setting)return json({code:'PREPAID_ALERT_OWNER_CONFLICT'},409)
 return json({ok:true,alert_enabled:!!setting.enabled,
   alert_threshold_jpy:setting.threshold_jpy,
   alert_mode:setting.alert_mode,alert_upper_threshold_jpy:setting.upper_threshold_jpy,
   alert_version:setting.version})
}

export async function privatePrepaidAlertSnapshot(env,{householdId,ownerUserId}){
 if(!env.DB||typeof householdId!=='string'||!householdId||householdId.length>128||
    typeof ownerUserId!=='string'||!/^[0-9a-f-]{36}$/i.test(ownerUserId))
   return json({error:'invalid_identity'},400)
 const db=env.DB
 const identity=await db.prepare(`SELECT 1 FROM homeflow_identity_links
   WHERE user_id=?1 AND household_id=?2 AND state='active'`)
   .bind(ownerUserId,householdId).first()
 if(!identity)return json({error:'not_authorized'},403)
 let settings
 try{
  settings=(await db.prepare(`SELECT s.account_scope,s.resource_key,s.threshold_jpy,s.alert_mode,s.upper_threshold_jpy,s.version
    FROM prepaid_balance_alert_settings s
    WHERE s.household_id=?1 AND s.owner_user_id=?2 AND s.enabled=1
    ORDER BY s.account_scope,s.resource_key LIMIT 101`)
    .bind(householdId,ownerUserId).all()).results||[]
 }catch{return json({error:'alert_settings_unavailable'},503)}
 if(settings.length>100)return json({error:'alert_limit'},409)
 if(!settings.length)return json({ok:true,householdId,ownerUserId,items:[]})
 const result=new Map()
 if(settings.some(s=>s.account_scope==='legacy')){
  const req=new Request('https://kakeibo.internal/api/prepaid-assets')
  const res=await handlePrepaid({db,request:req,method:'GET',sub:null})
  if(!res.ok)return json({error:'legacy_balance_unavailable'},503)
  const data=await res.json()
  for(const card of data.cards||[]){
   if(!card.is_archived&&Number.isSafeInteger(card.balance))
     result.set('legacy:'+card.name,{name:card.name,balance:card.balance})
  }
 }
 if(settings.some(s=>s.account_scope==='member')){
  const res=await familyPrepaidReport(env,{household_id:householdId,user_id:ownerUserId})
  if(!res.ok)return json({error:'personal_balance_unavailable'},503)
  const data=await res.json()
  for(const card of data.cards||[]){
   if(!card.is_archived&&Number.isSafeInteger(card.balance))
     result.set('member:'+card.account_id,{name:card.name,balance:card.balance})
  }
 }
 const items=[]
 for(const row of settings){
  if(!['legacy','member'].includes(row.account_scope)||
    !validAlertBounds(row.alert_mode,row.threshold_jpy,row.upper_threshold_jpy)||
    !Number.isSafeInteger(row.version))continue
  // Revalidate the immutable recorded owner: a shared card is never the grantee's card.
  const allowed=row.account_scope==='legacy'
   ?await db.prepare(`SELECT 1 FROM family_legacy_owner_claims c
      JOIN payment_sources p ON p.name=c.record_key
      WHERE c.record_scope='payment_source' AND c.record_key=?1
        AND c.household_id=?2 AND c.owner_user_id=?3
        AND p.source_type='prepaid' AND p.is_archived=0`)
        .bind(row.resource_key,householdId,ownerUserId).first()
   :await db.prepare(`SELECT 1 FROM family_financial_accounts
      WHERE account_id=?1 AND household_id=?2 AND owner_user_id=?3
        AND account_kind='prepaid' AND origin='member_created' AND is_archived=0`)
        .bind(row.resource_key,householdId,ownerUserId).first()
  const card=result.get(row.account_scope+':'+row.resource_key)
  if(!allowed||!card)continue
  items.push({scope:row.account_scope,key:row.resource_key,name:card.name,
    balance:card.balance,thresholdJpy:row.threshold_jpy,
    mode:row.alert_mode,upperThresholdJpy:row.upper_threshold_jpy,version:row.version})
 }
 return json({ok:true,householdId,ownerUserId,items})
}
