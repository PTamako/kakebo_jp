import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {projectBillConfirmationReminders,readBillConfirmationReminders} from '../workers/homeflow-bill-reminders.js'
import bridge from '../workers/homeflow-service-bridge.js'
const OWNER='11111111-1111-4111-8111-111111111111',MEMBER='22222222-2222-4222-8222-222222222222',HID='household-1',F='33333333-3333-4333-8333-333333333333',V='44444444-4444-4444-8444-444444444444'
function fixture(){
 const sql=new DatabaseSync(':memory:')
 sql.exec(`CREATE TABLE homeflow_identity_links(user_id TEXT,household_id TEXT,role TEXT,state TEXT);
 CREATE TABLE recurring_plans(id TEXT,name TEXT,amount INTEGER,day INTEGER,weekday INTEGER,
 schedule_type TEXT,workday_only INTEGER,weekdays_json TEXT,month_days_json TEXT,
 interval_months INTEGER,payment_source TEXT,start_month TEXT,posting_mode TEXT,enabled INTEGER);
 CREATE TABLE trash_items(item_type TEXT,item_id TEXT);
 CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,merchant TEXT,payment_source TEXT,
 amount INTEGER,type TEXT,client_request_id TEXT,family_account_id TEXT);
 CREATE TABLE family_shared_mutation_applied(entry_id INTEGER,household_id TEXT,requester_user_id TEXT,action TEXT);
 CREATE TABLE family_shared_entry_registry(entry_id INTEGER,household_id TEXT,creator_user_id TEXT);
 CREATE TABLE family_card_purchase_applied(entry_id INTEGER,household_id TEXT,requester_user_id TEXT);
 CREATE TABLE family_prepaid_actions_applied(entry_id INTEGER,household_id TEXT,requester_user_id TEXT);
 CREATE TABLE family_legacy_card_spends(entry_id INTEGER,household_id TEXT,actor_user_id TEXT);
 CREATE TABLE family_recurring_execution_applied(target_entry_id INTEGER,household_id TEXT,member_user_id TEXT);
 CREATE TABLE family_finance_applied_actions(entry_id INTEGER,household_id TEXT,requester_user_id TEXT);
 CREATE TABLE recurring_candidate_exclusions(plan_id TEXT,month TEXT);
 CREATE TABLE recurring_date_exclusions(plan_id TEXT,date TEXT);
 CREATE TABLE family_member_fixed_cost_settings(plan_id TEXT,household_id TEXT,owner_user_id TEXT,
 name TEXT,amount_jpy INTEGER,month_days_json TEXT,weekdays_json TEXT,schedule_type TEXT,
 interval_months INTEGER,payment_source TEXT,start_month TEXT,enabled INTEGER);
 CREATE TABLE variable_recurring_plans(id TEXT,name TEXT,payment_source TEXT,enabled INTEGER);
 CREATE TABLE variable_recurring_bills(plan_id TEXT,period_month TEXT,amount_jpy INTEGER,
 expense_date TEXT,status TEXT);
 INSERT INTO homeflow_identity_links VALUES('11111111-1111-4111-8111-111111111111','household-1','owner','active'),
 ('22222222-2222-4222-8222-222222222222','household-1','member','active');
 INSERT INTO recurring_plans VALUES('33333333-3333-4333-8333-333333333333','家賃',101500,27,0,'monthly',0,'[0]','[27]',1,'cash','2026-07','manual',1);
 INSERT INTO variable_recurring_plans VALUES('44444444-4444-4444-8444-444444444444','オクトパスエナジー','card',1);
 INSERT INTO variable_recurring_bills VALUES('44444444-4444-4444-8444-444444444444','2026-10',1987,'2026-11-26','draft');
 INSERT INTO family_member_fixed_cost_settings VALUES('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
 'household-1','22222222-2222-4222-8222-222222222222','家族語学',100,'[27]','[0]','monthly',1,'cash','2026-11',1);`)
 const db={prepare(query){const st=sql.prepare(query);return {
  bind(...args){this.args=args;return this},
  async first(){return st.get(...(this.args||[]))||null},
  async all(){return {results:st.all(...(this.args||[]))}}
 }}}
 return {sql,db}
}
test('fixed reminder one day before; variable on selected entry day, never day before',async()=>{
 const {sql,db}=fixture()
 const early=await projectBillConfirmationReminders(db,{day:'2026-11-25',recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(early.items,[])
 const exact=await projectBillConfirmationReminders(db,{day:'2026-11-26',recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(exact.items.map(x=>x.kind),['fixed','variable'])
 assert.deepEqual(exact.items.map(x=>x.dueOn),['2026-11-27','2026-11-26'])
 sql.close()
})
test('member sees only own bill; owner never gets spouse bill',async()=>{
 const {sql,db}=fixture()
 const member=await projectBillConfirmationReminders(db,{day:'2026-11-26',recipientUserId:MEMBER,householdId:HID})
 assert.deepEqual(member.items.map(x=>x.name),['家族語学'])
 const owner=await projectBillConfirmationReminders(db,{day:'2026-11-26',recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(owner.items.map(x=>x.name),['家賃','オクトパスエナジー'])
 sql.close()
})
test('owner same-name expenses never suppress a member reminder; attributed approval does',async()=>{
 const {sql,db}=fixture()
 // This owner ledger row shares name, amount, day and payment source with
 // the member plan. It must NOT be mistaken for the member's payment.
 sql.exec("INSERT INTO entries(date,merchant,payment_source,amount,type) VALUES('2026-11-27','家族語学','cash',100,'expense')")
 const initial=await projectBillConfirmationReminders(db,{day:'2026-11-26',
   recipientUserId:MEMBER,householdId:HID})
 assert.deepEqual(initial.items.map(x=>x.name),['家族語学'])
 // Only a committed, member-attributed approval can consume that slot.
 sql.prepare("INSERT INTO family_shared_mutation_applied(entry_id,household_id,requester_user_id,action) VALUES(1,?,?,?)")
  .run(HID,MEMBER,'create')
 const paid=await projectBillConfirmationReminders(db,{day:'2026-11-26',
   recipientUserId:MEMBER,householdId:HID})
 assert.deepEqual(paid.items,[])
 const owner=await projectBillConfirmationReminders(db,{day:'2026-11-26',
   recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(owner.items.map(x=>x.name),['家賃','オクトパスエナジー'])
 sql.close()
})
test('posted entries and bills stop reminder',async()=>{
 const {sql,db}=fixture()
 sql.exec("INSERT INTO entries(date,merchant,payment_source,amount,type) VALUES('2026-11-27','家賃','cash',101500,'expense')")
 sql.exec("UPDATE variable_recurring_bills SET status='posted'")
 const r=await projectBillConfirmationReminders(db,{day:'2026-11-26',recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(r.items,[])
 sql.close()
})
test('bridge rejects POST, malformed owner IDs and unmapped family users',async()=>{
 const {sql,db}=fixture()
 const base='https://private.invalid/api/internal/bill-confirmation-reminders'
 assert.equal((await bridge.fetch(new Request(base,{method:'POST'}),{DB:db})).status,405)
 assert.equal((await readBillConfirmationReminders(new Request(base+'?day=2026-11-26&recipientUserId=x&householdId='+HID),db)).status,400)
 const r=await readBillConfirmationReminders(new Request(base+'?day=2026-11-26&recipientUserId=55555555-5555-4555-8555-555555555555&householdId='+HID),db)
 assert.deepEqual((await r.json()).items,[])
 sql.close()
})


test('member-attributed identical payments cannot suppress owner fixed or variable reminders',async()=>{
 const {sql,db}=fixture()
 sql.exec("INSERT INTO entries(id,date,merchant,payment_source,amount,type) VALUES(10,'2026-11-27','家賃','cash',101500,'expense')")
 sql.exec("INSERT INTO entries(id,date,merchant,payment_source,amount,type) VALUES(11,'2026-11-26','オクトパスエナジー','card',1987,'expense')")
 sql.prepare("INSERT INTO family_shared_mutation_applied(entry_id,household_id,requester_user_id,action) VALUES(?,?,?,'create')")
   .run(10,HID,MEMBER)
 sql.prepare("INSERT INTO family_card_purchase_applied(entry_id,household_id,requester_user_id) VALUES(?,?,?)")
   .run(11,HID,MEMBER)
 const owner=await projectBillConfirmationReminders(db,{day:'2026-11-26',recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(owner.items.map(x=>x.kind),['fixed','variable'])
 // A confirmed owner transaction, not a spouse's matching payment, consumes the slot.
 sql.exec("INSERT INTO entries(id,date,merchant,payment_source,amount,type) VALUES(12,'2026-11-27','家賃','cash',101500,'expense')")
 sql.exec("INSERT INTO entries(id,date,merchant,payment_source,amount,type) VALUES(13,'2026-11-26','オクトパスエナジー','card',1987,'expense')")
 const after=await projectBillConfirmationReminders(db,{day:'2026-11-26',recipientUserId:OWNER,householdId:HID})
 assert.deepEqual(after.items,[])
 sql.close()
})
