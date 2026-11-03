import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { nextAutomaticStartMonth, scheduledRecurringDate, recurringRequestId } from '../src/recurring-posting.js'
import { postScheduledRecurring } from '../functions/api/recurring-auto.js'
import { previewRecurringEntries } from '../src/recurring-check.js'

function memoryDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE recurring_plans(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,amount INTEGER NOT NULL,day INTEGER NOT NULL,
      category TEXT NOT NULL,payment_source TEXT NOT NULL,start_month TEXT NOT NULL,enabled INTEGER NOT NULL
    );
    CREATE TABLE entries(
      id INTEGER PRIMARY KEY,date TEXT NOT NULL,time TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL,category TEXT NOT NULL,merchant TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',
      raw TEXT NOT NULL DEFAULT '',type TEXT NOT NULL,transfer_target TEXT,
      transfer_applied INTEGER NOT NULL DEFAULT 0, transfer_date TEXT,
      client_request_id TEXT UNIQUE, payment_source TEXT NOT NULL
    );
    CREATE TABLE trash_items(item_type TEXT NOT NULL,item_id TEXT NOT NULL,PRIMARY KEY(item_type,item_id));
    CREATE TABLE recurring_candidate_exclusions(plan_id TEXT NOT NULL,month TEXT NOT NULL,PRIMARY KEY(plan_id,month));
  `)
  const migration=readFileSync(new URL('../migrations/0013_recurring_posting_mode.sql',import.meta.url),'utf8')
  sqlite.exec(migration)
  sqlite.exec(readFileSync(new URL('../migrations/0014_recurring_business_days.sql',import.meta.url),'utf8'))
  const db={
    prepare(sql) {
      let args=[]
      // D1 accepts indexed ?1/?2 placeholders; node:sqlite's experimental
      // binding API treats those differently. Expand positional values in
      // lexical SQL placeholder order without changing the production query.
      const order=[...sql.matchAll(/\\?(\\d+)/g)].map(match=>Number(match[1])-1)
      const statement=sqlite.prepare(sql.replace(/\\?\\d+/g,'?'))
      const bindArgs=()=>order.length ? order.map(index=>args[index]) : args
      return {
        bind(...values){args=values;return this},
        async all(){return {results:statement.all(...bindArgs())}},
        async first(){return statement.get(...bindArgs())},
        async run(){const result=statement.run(...bindArgs());return {meta:{changes:Number(result.changes)}}},
      }
    }
  }
  return {sqlite,db}
}
function insertPlan(sqlite, values={}) {
  const p={
    id:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',name:'家賃',amount:101500,day:27,
    category:'住居',payment_source:'現金',start_month:'2026-07',enabled:1,
    posting_mode:'auto',auto_from_month:'2026-11',...values
  }
  sqlite.prepare(`INSERT INTO recurring_plans(id,name,amount,day,category,payment_source,start_month,enabled,posting_mode,auto_from_month)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(p))
  return p
}

test('migration preserves every existing plan and defaults old plans to manual',()=>{
  const {sqlite}=memoryDb()
  sqlite.prepare(`INSERT INTO recurring_plans(id,name,amount,day,category,payment_source,start_month,enabled)
    VALUES(?,?,?,?,?,?,?,?)`).run('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee','家賃',101500,27,'住居','現金','2026-07',1)
  const row=sqlite.prepare('SELECT posting_mode,auto_from_month FROM recurring_plans').get()
  assert.equal(row.posting_mode,'manual')
  assert.equal(row.auto_from_month,'')
})

test('automatic start month prevents retroactive posting for old plans',()=>{
  assert.equal(nextAutomaticStartMonth('2026-11-02',27,'2026-07'),'2026-11')
  assert.equal(nextAutomaticStartMonth('2026-11-27',27,'2026-07'),'2026-12')
  assert.equal(nextAutomaticStartMonth('2026-11-28',27,'2026-07'),'2026-12')
  assert.equal(nextAutomaticStartMonth('2026-12-30',27,'2026-07'),'2027-01')
  assert.equal(nextAutomaticStartMonth('2026-11-02',27,'2027-02'),'2027-02')
  assert.equal(scheduledRecurringDate('2028-02',31),'2028-02-29')
  assert.equal(scheduledRecurringDate('2027-02',31),'2027-02-28')
})

test('due date posts exactly once across retries, without creating July–October entries', async()=>{
  const {sqlite,db}=memoryDb()
  const p=insertPlan(sqlite)
  const first=await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(first.created,1)
  const second=await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(second.created,0)
  const rows=sqlite.prepare('SELECT date,amount,type,payment_source,client_request_id FROM entries').all()
  assert.equal(rows.length,1)
  assert.equal(rows[0].date,'2026-11-27')
  assert.equal(rows[0].amount,101500)
  assert.equal(rows[0].payment_source,'現金')
  assert.equal(rows[0].type,'expense')
  assert.equal(rows[0].client_request_id,recurringRequestId(p.id,'2026-11'))
})

test('before due day, manual posting mode, and disabled or deleted plan never auto-post',async()=>{
  const {sqlite,db}=memoryDb()
  const p=insertPlan(sqlite)
  await postScheduledRecurring(db,{today:'2026-11-26'})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0)
  sqlite.prepare("UPDATE recurring_plans SET posting_mode='manual' WHERE id=?").run(p.id)
  await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0)
  sqlite.prepare("UPDATE recurring_plans SET posting_mode='auto',enabled=0 WHERE id=?").run(p.id)
  await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0)
  sqlite.prepare("UPDATE recurring_plans SET enabled=1 WHERE id=?").run(p.id)
  sqlite.prepare("INSERT INTO trash_items(item_type,item_id) VALUES('recurring_plan',?)").run(p.id)
  await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0)
})

test('a pre-existing manual entry and a monthly exclusion both block auto-posting',async()=>{
  const {sqlite,db}=memoryDb()
  const p=insertPlan(sqlite)
  sqlite.prepare(`INSERT INTO entries(date,amount,category,merchant,type,payment_source)
    VALUES('2026-11-25',101500,'住居','家賃','expense','現金')`).run()
  await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,1)
  sqlite.prepare('DELETE FROM entries').run()
  sqlite.prepare('INSERT INTO recurring_candidate_exclusions(plan_id,month) VALUES(?,?)').run(p.id,'2026-11')
  await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,0)
})

test('month end is clipped and future activation is respected',async()=>{
  const {sqlite,db}=memoryDb()
  insertPlan(sqlite,{day:31,start_month:'2026-01',auto_from_month:'2027-02'})
  let result=await postScheduledRecurring(db,{today:'2027-01-31'})
  assert.equal(result.created,0)
  result=await postScheduledRecurring(db,{today:'2027-02-28'})
  assert.equal(result.created,1)
  assert.equal(sqlite.prepare('SELECT date FROM entries').get().date,'2027-02-28')
})

test('UI displays saved mode and dynamic explanation with responsive layout',()=>{
  const page=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(page,/v-model="plan.postingMode"/)
  assert.match(page,/recurringFrequencyLabel\(plan\).*?自動で支出明細に登録します。/)
  assert.match(page,/p.postingMode==='auto' \? '自動記帳' : '確認して記帳'/)
  assert.match(page,/v-model="plan.scheduleType"/)
  assert.match(api,/posting_mode=\?8,auto_from_month=\?9,schedule_type=\?10,weekday=\?11,workday_only=\?13/)
  assert.match(api,/nextAutomaticStartMonth\(tokyoToday\(\),item.day,item.startMonth,item.scheduleType\|\|'monthly',item.weekday\|\|0\)/)
  assert.match(api,/postingMode:p.posting_mode\|\|'manual'/)
})

test('two active auto plans with identical merchant, amount and source each post once',async()=>{
  const {sqlite,db}=memoryDb()
  const first=insertPlan(sqlite)
  const second=insertPlan(sqlite,{id:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'})
  const run=await postScheduledRecurring(db,{today:'2026-11-27'})
  assert.equal(run.created,2)
  assert.equal((await postScheduledRecurring(db,{today:'2026-11-27'})).created,0)
  const rows=sqlite.prepare('SELECT client_request_id FROM entries ORDER BY client_request_id').all()
  assert.equal(rows.length,2)
  assert.deepEqual(rows.map(r=>r.client_request_id),[
    recurringRequestId(first.id,'2026-11'),
    recurringRequestId(second.id,'2026-11')
  ])
})

test('one direct manual expense occupies one of two identical recurring slots',async()=>{
  const {sqlite,db}=memoryDb()
  insertPlan(sqlite)
  insertPlan(sqlite,{id:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'})
  sqlite.prepare(`INSERT INTO entries(date,amount,category,merchant,type,payment_source)
      VALUES('2026-11-25',101500,'住居','家賃','expense','現金')`).run()
  assert.equal((await postScheduledRecurring(db,{today:'2026-11-27'})).created,1)
  assert.equal((await postScheduledRecurring(db,{today:'2026-11-27'})).created,0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,2)
})

test('two direct manual expenses block both matching recurring slots',async()=>{
  const {sqlite,db}=memoryDb()
  insertPlan(sqlite)
  insertPlan(sqlite,{id:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'})
  const manual=sqlite.prepare(`INSERT INTO entries(date,amount,category,merchant,type,payment_source)
      VALUES('2026-11-25',101500,'住居','家賃','expense','現金')`)
  manual.run();manual.run()
  assert.equal((await postScheduledRecurring(db,{today:'2026-11-27'})).created,0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,2)
})

test('confirmed recurring plan does not block a separate same-name auto plan',async()=>{
  const {sqlite,db}=memoryDb()
  const first=insertPlan(sqlite)
  insertPlan(sqlite,{id:'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'})
  sqlite.prepare(`INSERT INTO entries(date,amount,category,merchant,type,payment_source,client_request_id)
      VALUES('2026-11-27',101500,'住居','家賃','expense','現金',?)`)
    .run(recurringRequestId(first.id,'2026-11'))
  assert.equal((await postScheduledRecurring(db,{today:'2026-11-27'})).created,1)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM entries').get().n,2)
})

test('direct manual expense with an edited amount still blocks its fixed-expense slot',async()=>{
  const {sqlite,db}=memoryDb()
  insertPlan(sqlite)
  sqlite.prepare(`INSERT INTO entries(date,amount,category,merchant,type,payment_source)
      VALUES('2026-11-25',500,'住居','家賃','expense','現金')`).run()
  assert.equal((await postScheduledRecurring(db,{today:'2026-11-27'})).created,0)
})

test('candidate preview claims a direct expense only once, not all same-name plans',()=>{
  const first='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const second='bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
  const base={name:'家賃',amount:101500,day:27,category:'住居',paymentSource:'現金',startMonth:'2026-07',scheduleType:'monthly',enabled:true}
  const plans=[{...base,id:first},{...base,id:second}]
  const manual=[{date:'2026-11-25',merchant:'家賃',amount:101500,category:'住居',payment_source:'現金',type:'expense'}]
  const opts={today:new Date(2026,10,27)}
  const candidates=previewRecurringEntries(plans,manual,opts)
  assert.equal(candidates.length,2)
  assert.deepEqual(candidates.map(x=>x.conflict),[true,false])
  const confirmed=[{...manual[0],client_request_id:recurringRequestId(first,'2026-11')}]
  const unposted=previewRecurringEntries(plans,confirmed,opts)
  assert.equal(unposted.length,1)
  assert.equal(unposted[0].planId,second)
  assert.equal(unposted[0].conflict,false)
})
