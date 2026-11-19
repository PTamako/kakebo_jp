import test from 'node:test'
import assert from 'node:assert/strict'
import {updatePrepaidAlert,privatePrepaidAlertSnapshot,validAlertAmount} from '../functions/api/prepaid-alert-settings.js'

test('low balance settings validate yen and reject unsafe thresholds before any DB access',async()=>{
 assert.equal(validAlertAmount(0),true)
 assert.equal(validAlertAmount(1000),true)
 assert.equal(validAlertAmount(-1),false)
 assert.equal(validAlertAmount(1.5),false)
 assert.equal(validAlertAmount(100000001),false)
 const db={prepare(){throw Error('DB must not be touched')}}
 const result=await updatePrepaidAlert(db,{scope:'member',key:'a'.repeat(32),
  ownerUserId:'person',householdId:'home',enabled:true,thresholdJpy:1.5})
 assert.equal(result.status,400)
})

test('a spouse cannot configure another member\'s prepaid card',async()=>{
 let writes=0
 const db={prepare(sql){
  assert.match(sql,/family_financial_accounts/)
  return {bind(){return {first:async()=>null,run:async()=>{writes++}}}}
 }}
 const result=await updatePrepaidAlert(db,{scope:'member',key:'a'.repeat(32),
  ownerUserId:'spouse',householdId:'home',enabled:true,thresholdJpy:500})
 assert.equal(result.status,403)
 assert.equal(writes,0)
})

test('the legacy setting requires an immutable owner claim, not card sharing',async()=>{
 let writes=0
 const db={prepare(sql){
  assert.match(sql,/family_legacy_owner_claims/)
  return {bind(){return {first:async()=>null,run:async()=>{writes++}}}}
 }}
 const result=await updatePrepaidAlert(db,{scope:'legacy',key:'Suica',
  ownerUserId:'unverified',householdId:'home',enabled:true,thresholdJpy:1000})
 assert.equal(result.status,403)
 assert.equal(writes,0)
})

test('private snapshot is strictly scoped to an active identity',async()=>{
 const db={prepare(sql){
  assert.match(sql,/homeflow_identity_links/)
  return {bind(){return {first:async()=>null}}}
 }}
 const result=await privatePrepaidAlertSnapshot({DB:db},{
  householdId:'household',ownerUserId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})
 assert.equal(result.status,403)
})
