import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {validAlertMode,validAlertBounds,updatePrepaidAlert} from '../functions/api/prepaid-alert-settings.js'

test('lower, upper, both are valid options and both must be ordered',()=>{
 for(const mode of ['lower','upper','both'])assert.equal(validAlertMode(mode),true)
 for(const mode of ['all','none','other',''])assert.equal(validAlertMode(mode),false)
 assert.equal(validAlertBounds('lower',450,10000),true)
 assert.equal(validAlertBounds('upper',450,2000),true)
 assert.equal(validAlertBounds('both',450,2000),true)
 assert.equal(validAlertBounds('both',2000,450),false)
 assert.equal(validAlertBounds('both',1000,1000),false)
 assert.equal(validAlertBounds('upper',500,-1),false)
 assert.equal(validAlertBounds('both',300,100000001),false)
 assert.equal(validAlertBounds('both',2.5,2000),false)
})

test('invalid or reversed limits fail before any database call',async()=>{
 const db={prepare(){throw Error('invalid input cannot touch database')}}
 for(const options of [
  {mode:'both',thresholdJpy:3000,upperThresholdJpy:2000},
  {mode:'both',thresholdJpy:1000,upperThresholdJpy:1000},
  {mode:'invalid',thresholdJpy:300,upperThresholdJpy:3000}
 ]){
  const r=await updatePrepaidAlert(db,{scope:'legacy',key:'Suica',
   householdId:'household',ownerUserId:'owner',enabled:true,...options})
  assert.equal(r.status,400)
 }
})

test('upper and both settings still require the actual owner and never modify the ledger',async()=>{
 const writes=[]
 const db={prepare(sql){return {bind(...params){return {
  async first(){
   if(sql.includes('family_legacy_owner_claims'))return {name:'Suica'}
   return {enabled:1,threshold_jpy:450,upper_threshold_jpy:2300,
    alert_mode:'both',version:3}
  },
  async run(){writes.push({sql,params});return {meta:{changes:1}}}
 }}}}}
 const r=await updatePrepaidAlert(db,{scope:'legacy',key:'Suica',householdId:'house',
  ownerUserId:'owner',enabled:true,thresholdJpy:450,upperThresholdJpy:2300,mode:'both'})
 assert.equal(r.status,200)
 const body=await r.json()
 assert.equal(body.alert_mode,'both')
 assert.equal(body.alert_upper_threshold_jpy,2300)
 assert.equal(writes.length,1)
 assert.match(writes[0].sql,/prepaid_balance_alert_settings/)
 assert.doesNotMatch(writes[0].sql,/\bentries\b/i)
 assert.ok(writes[0].params.includes('both'))
})

test('migration keeps existing lower settings enabled at the same threshold',()=>{
 const db=new DatabaseSync(':memory:')
 try{
  db.exec(`CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT);
   CREATE TABLE prepaid_balance_alert_settings(
    account_scope TEXT NOT NULL,resource_key TEXT NOT NULL,household_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,enabled INTEGER NOT NULL,threshold_jpy INTEGER NOT NULL,
    version INTEGER NOT NULL,updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_scope,resource_key));
   INSERT INTO prepaid_balance_alert_settings VALUES('legacy','Suica','family','owner',1,450,2,1000);`)
  db.exec(readFileSync(new URL('../migrations/0111_prepaid_two_sided_alerts.sql',import.meta.url),'utf8'))
  const result=db.prepare("SELECT * FROM prepaid_balance_alert_settings WHERE resource_key='Suica'").get()
  assert.equal(result.enabled,1)
  assert.equal(result.threshold_jpy,450)
  assert.equal(result.version,2)
  assert.equal(result.alert_mode,'lower')
  assert.equal(result.upper_threshold_jpy,10000)
 }finally{db.close()}
})
