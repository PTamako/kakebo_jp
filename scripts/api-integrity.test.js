import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../functions/api/[[path]].js'
const approvedPost = (plan, month = '2026-10') => ({
  planId:plan.id,month,
  expected:{name:plan.name,amount:plan.amount,day:plan.day,category:plan.category,
    paymentSource:plan.paymentSource || '',startMonth:plan.startMonth,
    date:month+'-'+String(Math.min(plan.day,new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate())).padStart(2,'0')}
})


// A minimal D1-compatible double. These tests exercise HTTP handlers, retries,
// scheduled transfers, and the separation of valuation and deposited principal.
class LedgerDb {
  constructor() { this.entries = []; this.nextId = 1; this.sql = []; this.seeded = true; this.rules = []; this.customRules = []; this.paymentSources = new Set(); this.paymentClosingDays = new Map(); this.recurringPlans = new Map(); this.recurringTrash = new Set(); this.recurringExclusions = new Set(); this.recurringDateExclusions = new Set(); this.cardBills = new Map(); this.financeSettings = new Map(); this.icons = []; this.sessions = new Map(); this.attempts = new Map() }
  async batch(statements) { const results=[]; for (const statement of statements) results.push(await statement.run()); return results }
  prepare(sql) {
    const db = this
    return {
      args: [],
      bind(...args) { this.args = args; return this },
      async first() {
        // Mock represents the pre-existing active-only card registry.
        if (sql.startsWith('SELECT 1 FROM payment_sources WHERE name=?1 AND is_archived=1')) return null
        if (sql.startsWith('SELECT 1 AS linked FROM entries')) {
          const name=this.args[0]
          return db.entries.some(e=>e.payment_source===name || e.transfer_target==='prepaid:'+name || e.transfer_target==='credit:'+name) ||
            [...db.cardBills.values()].some(b=>b.name===name) ||
            [...db.recurringPlans.values()].some(p=>p.paymentSource===name) ? {linked:1}:null
        }
        if (sql.includes("name='closing-days-migrated-v1'")) return db.financeSettings.has('closing-days-migrated-v1') ? {value:'true'} : null
        if (sql.includes("name='closing-days'")) return db.financeSettings.has('closing-days') ? {value:db.financeSettings.get('closing-days')} : null
        if (sql.startsWith('SELECT COUNT(*) AS n FROM payment_sources')) return {n:db.paymentSources.size}
        if (sql.startsWith('SELECT 1 AS found FROM card_bills')) return [...db.cardBills.values()].some(v=>v.name===this.args[0] && [...db.cardBills.values()].some(w=>w.name===this.args[1] && w.month===v.month)) ? {found:1} : null
        if (sql.startsWith('SELECT value FROM finance_settings WHERE name=')) return db.financeSettings.has(this.args[0]) ? { value: db.financeSettings.get(this.args[0]) } : null
        if (sql.startsWith('SELECT name FROM payment_sources WHERE name=')) return db.paymentSources.has(this.args[0]) ? { name: this.args[0] } : null
        if (sql.startsWith("SELECT 1 FROM trash_items WHERE item_type='recurring_plan' AND item_id=")) return db.recurringTrash.has(this.args[0]) ? {exists:1} : null
        if (sql.startsWith('SELECT 1 FROM recurring_plans WHERE id=')) return db.recurringPlans.has(this.args[0]) ? {exists:1} : null
        if (sql.includes('FROM recurring_plans WHERE id=?1') || sql.startsWith('SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans WHERE id=')) {
          const p=db.recurringPlans.get(this.args[0])
          return p && (!sql.includes('NOT EXISTS (SELECT 1 FROM trash_items') || !db.recurringTrash.has(this.args[0]))
            ? {...p,payment_source:p.paymentSource,start_month:p.startMonth,enabled:p.enabled?1:0,posting_mode:p.postingMode||'manual',auto_from_month:p.autoFromMonth||'',schedule_type:p.scheduleType||'monthly',weekday:p.weekday??0} : null
        }
        if (sql.startsWith('SELECT start_month FROM recurring_plans WHERE id=')) {
          const p=db.recurringPlans.get(this.args[0]);return p?{start_month:p.startMonth}:null
        }
        if (sql.startsWith('SELECT 1 FROM recurring_candidate_exclusions')) {
          return db.recurringExclusions.has(this.args[0]+':'+this.args[1])?{found:1}:null
        }
        if (sql.startsWith('SELECT 1 FROM recurring_date_exclusions')) {
          return db.recurringDateExclusions.has(this.args[0]+':'+this.args[1])?{found:1}:null
        }
        if (sql.startsWith('SELECT id FROM entries WHERE client_request_id=')) return db.entries.find(e=>e.client_request_id===this.args[0])||null
        if (sql.startsWith('SELECT id FROM recurring_plans WHERE payment_source=')) {
          const p=[...db.recurringPlans.values()].find(p=>p.paymentSource===this.args[0]&&p.enabled)
          return p?{id:p.id}:null
        }
        if (sql.startsWith('SELECT token_hash FROM device_sessions')) return (db.sessions.get(this.args[0]) || 0) > this.args[1] ? { token_hash: this.args[0] } : null
        if (sql.startsWith('SELECT attempts, reset_at FROM login_attempts')) return db.attempts.get(this.args[0]) || null
        if (sql.startsWith('SELECT id, amount, transfer_target, transfer_applied, transfer_date, date FROM entries'))
          return db.entries.find(e => e.id === this.args[0] && e.type === 'transfer') || null
        if (sql.startsWith('SELECT amount, type, category, client_request_id, transfer_target'))
          return db.entries.find(e => e.id === this.args[0]) || null
        if (sql.startsWith('SELECT amount, transfer_target'))
          return db.entries.find(e => e.id === this.args[0]) || null
        if (sql.startsWith('SELECT keyword FROM rules WHERE keyword')) {
          if (String(this.args[0]).startsWith('__category__:')) return db.rules.find(r => r.keyword === this.args[0]) || null
          return db.seeded ? { keyword: this.args[0] } : null
        }
        return { exists: true }
      },
      async all() {
        if (sql.startsWith('SELECT substr(date,1,4) AS year')) {
          const counts=new Map()
          for(const e of db.entries){const year=String(e.date||'').slice(0,4);counts.set(year,(counts.get(year)||0)+1)}
          return {results:[...counts].map(([year,count])=>({year,count}))}
        }
        if (sql.startsWith('PRAGMA table_info(payment_sources)')) return {results:[{name:'closing_day'}]}
        if (sql.startsWith('SELECT name,is_default,closing_day,') && sql.includes('FROM payment_sources')) return {results:[...db.paymentSources].map(name=>({name,is_default:0,closing_day:db.paymentClosingDays.has(name)?db.paymentClosingDays.get(name):null}))}
        if (sql.includes('FROM recurring_plans') && sql.includes('p.id') ||
            sql.startsWith('SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans')) {
          const archived=sql.includes('JOIN trash_items')
          const activeOnly=sql.includes('NOT EXISTS (SELECT 1 FROM trash_items')
          return {results:[...db.recurringPlans.values()]
            .filter(p=>archived ? db.recurringTrash.has(p.id) : activeOnly ? !db.recurringTrash.has(p.id) : true)
            .map(p=>({id:p.id,name:p.name,amount:p.amount,day:p.day,category:p.category,
              payment_source:p.paymentSource,start_month:p.startMonth,enabled:p.enabled?1:0,posting_mode:p.postingMode||'manual',auto_from_month:p.autoFromMonth||'',schedule_type:p.scheduleType||'monthly',weekday:p.weekday??0,archived_at:archived?'2026-10-31':undefined}))}
        }
        if (sql.startsWith('SELECT plan_id,month FROM recurring_candidate_exclusions')) {
          return {results:[...db.recurringExclusions].map(key=>({plan_id:key.slice(0,key.lastIndexOf(':')),month:key.slice(key.lastIndexOf(':')+1)}))}
        }
        if (sql.startsWith('SELECT payment_source,bill_month,period_start,period_end,total_amount,transaction_count FROM card_bills')) return {results:[...db.cardBills.values()].map(v=>({payment_source:v.name,bill_month:v.month,period_start:v.start,period_end:v.end,total_amount:v.total,transaction_count:v.count}))}
        if (sql.startsWith('SELECT category, icon FROM category_source')) return { results: db.icons }
        if (sql.startsWith('SELECT keyword, category FROM rules WHERE substr')) return { results: db.rules }
        if (sql.startsWith('SELECT * FROM rules WHERE keyword')) return { results: db.rules }
        if (sql.startsWith('SELECT keyword, category FROM custom_rules')) return { results: db.customRules }
        return { results: [] }
      },
      async run() {
        db.sql.push(sql)
        if (sql.startsWith('INSERT OR IGNORE INTO trash_items')) {
          const id=this.args[0]
          if (!db.recurringPlans.has(id) || db.recurringTrash.has(id)) return {meta:{changes:0}}
          db.recurringTrash.add(id);return {meta:{changes:1}}
        }
        if (sql.startsWith('DELETE FROM trash_items')) {
          const changed=Number(db.recurringTrash.delete(this.args[0]))
          return {meta:{changes:changed}}
        }
        if (sql.startsWith('INSERT OR IGNORE INTO recurring_plans')) {
          const [id,name,amount,day,category,paymentSource,startMonth,enabled,postingMode,autoFromMonth,scheduleType,weekday]=this.args
          if (!db.recurringPlans.has(id)) {db.recurringPlans.set(id,{id,name,amount,day,category,paymentSource,startMonth,enabled:!!enabled,postingMode:postingMode||'manual',autoFromMonth:autoFromMonth||'',scheduleType:scheduleType||'monthly',weekday:weekday??0}); return {meta:{changes:1}}}
          return {meta:{changes:0}}
        }
        if (sql.startsWith('INSERT OR IGNORE INTO recurring_candidate_exclusions')) {
          const key=this.args[0]+':'+this.args[1]
          if(db.recurringExclusions.has(key))return {meta:{changes:0}}
          db.recurringExclusions.add(key);return {meta:{changes:1}}
        }
        if (sql.startsWith('DELETE FROM recurring_candidate_exclusions WHERE plan_id=?1 AND month=?2')) {
          db.recurringExclusions.delete(this.args[0]+':'+this.args[1]);return {meta:{changes:1}}
        }
        if (sql.startsWith('DELETE FROM recurring_candidate_exclusions WHERE plan_id=?1')) {
          db.recurringExclusions=new Set([...db.recurringExclusions].filter(key=>!key.startsWith(this.args[0]+':')))
          return {meta:{changes:1}}
        }
        if (sql.startsWith('DELETE FROM recurring_plans')) {
          if (sql.includes('EXISTS (SELECT 1 FROM trash_items') && !db.recurringTrash.has(this.args[0])) return {meta:{changes:0}}
          const changed=Number(db.recurringPlans.delete(this.args[0]))
          db.recurringTrash.delete(this.args[0])
          return {meta:{changes:changed}}
        }
        if (sql.startsWith('INSERT OR IGNORE INTO card_bills') || sql.startsWith('INSERT INTO card_bills')) {
          const [name,month,start,end,total,count]=this.args
          const key=name+'|'+month
          if (!db.cardBills.has(key) || sql.startsWith('INSERT INTO card_bills')) db.cardBills.set(key,{name,month,start,end,total,count})
          return {meta:{changes:1}}
        }
        if (sql.startsWith('DELETE FROM card_bills')) {
          db.cardBills.delete(this.args[0]+'|'+this.args[1]); return {meta:{changes:1}}
        }
        if (sql.startsWith('UPDATE recurring_plans SET name=')) {
          const [name,amount,day,category,paymentSource,startMonth,enabled,postingMode,autoFromMonth,scheduleType,weekday,id]=this.args
          const plan=db.recurringPlans.get(id)
          if (!plan || db.recurringTrash.has(id)) return {meta:{changes:0}}
          db.recurringPlans.set(id,{id,name,amount,day,category,paymentSource,startMonth,enabled:!!enabled,postingMode,autoFromMonth,scheduleType,weekday})
          return {meta:{changes:1}}
        }
        if (sql.startsWith('UPDATE recurring_plans SET payment_source=')) {
          for (const plan of db.recurringPlans.values()) if(plan.paymentSource===this.args[1]) plan.paymentSource=this.args[0]
          return {meta:{changes:1}}
        }
        if (sql.startsWith('UPDATE card_bills SET payment_source=')) {
          for (const [key,bill] of [...db.cardBills]) if(bill.name===this.args[1]) {db.cardBills.delete(key); bill.name=this.args[0]; db.cardBills.set(bill.name+'|'+bill.month,bill)}
          return {meta:{changes:1}}
        }
        if (sql.includes("VALUES('closing-days-migrated-v1','true')")) db.financeSettings.set('closing-days-migrated-v1','true')
        if (sql.startsWith('UPDATE payment_sources SET closing_day=')) {
          const [day,name] = this.args
          if (db.paymentSources.has(name) && (sql.includes('closing_day IS NULL') ? !db.paymentClosingDays.has(name) : true)) {
            db.paymentClosingDays.set(name,day)
            return {meta:{changes:1}}
          }
          return {meta:{changes:0}}
        }
        if (sql.startsWith('INSERT OR IGNORE INTO finance_settings')) {
          if (!db.financeSettings.has(this.args[0])) db.financeSettings.set(this.args[0], this.args[1])
        }
        if (sql.startsWith('INSERT INTO finance_settings')) db.financeSettings.set(this.args[0], this.args[1])
        if (sql.startsWith('INSERT OR IGNORE INTO payment_sources')) db.paymentSources.add(this.args[0])
        if (sql.startsWith('UPDATE payment_sources SET name=')) {
          if (db.paymentSources.delete(this.args[1])) { db.paymentSources.add(this.args[0]); if (db.paymentClosingDays.has(this.args[1])) {db.paymentClosingDays.set(this.args[0],db.paymentClosingDays.get(this.args[1])); db.paymentClosingDays.delete(this.args[1])} }
        }
        if (sql.startsWith('INSERT INTO device_sessions')) db.sessions.set(this.args[0], this.args[1])
        if (sql.startsWith('DELETE FROM device_sessions')) db.sessions.delete(this.args[0])
        if (sql.startsWith('DELETE FROM login_attempts')) db.attempts.delete(this.args[0])
        if (sql.startsWith('INSERT INTO login_attempts')) {
          const prior = db.attempts.get(this.args[0])
          db.attempts.set(this.args[0], prior && prior.reset_at > this.args[2] ? { attempts: prior.attempts + 1, reset_at: prior.reset_at } : { attempts: 1, reset_at: this.args[1] })
        }
        if (sql.startsWith('INSERT INTO entries') && sql.includes('FROM recurring_plans p')) {
          const weekly=sql.includes('e.date=?1')
          const [date,requestId,planId,merchant,amount,day,weekday,month,scheduleType,category,paymentSource]=this.args
          const existing=db.entries.some(e=>(weekly?String(e.date)===String(date):String(e.date).slice(0,7)===String(date).slice(0,7)) && e.merchant===merchant &&
            (e.payment_source||'')===paymentSource && e.type==='expense')
          if(existing||db.recurringExclusions.has(planId+':'+month)||db.recurringDateExclusions.has(planId+':'+date)||db.recurringTrash.has(planId)||db.entries.some(e=>e.client_request_id===requestId))return {meta:{changes:0}}
          db.entries.push({id:db.nextId++,date,amount,category,merchant,type:'expense',payment_source:paymentSource,client_request_id:requestId})
          return {meta:{changes:1}}
        }
        if (sql.startsWith('INSERT INTO entries')) {
          const a = this.args
          if (a[11] && db.entries.some(e => e.client_request_id === a[11])) return { meta: { changes: 0 } }
          db.entries.push({ id: db.nextId++, date: a[0], amount: a[2], type: a[7],
            transfer_target: a[8], transfer_applied: a[9], transfer_date: a[10], client_request_id: a[11], payment_source: a[12] })
          return { meta: { changes: 1 } }
        }
        if (/^UPDATE entries SET payment_source\s*=/.test(sql)) {
          let changes = 0
          for (const e of db.entries) if (e.payment_source === this.args[1]) { e.payment_source = this.args[0]; changes++ }
          return { meta: { changes } }
        }
        if (sql.startsWith('UPDATE entries SET date =')) {
          const a = this.args
          const e = db.entries.find(row => row.id === a[12])
          if (e) Object.assign(e, { date: a[0], amount: a[2], category: a[3], merchant: a[4], type: a[7], transfer_target: a[8], transfer_applied: a[9], transfer_date: a[10], payment_source: a[11] })
          return { meta: { changes: e ? 1 : 0 } }
        }
        if (sql.startsWith('UPDATE entries SET transfer_applied = 1 WHERE type')) {
          for (const e of db.entries) if (e.type === 'transfer' && e.transfer_target === 'sbi' && !e.transfer_applied && (e.transfer_date || e.date) <= this.args[0]) e.transfer_applied = 1
        }
        if (sql.startsWith('UPDATE entries SET transfer_applied = 1 WHERE id')) {
          const e = db.entries.find(e => e.id === this.args[0]); if (e) e.transfer_applied = 1
        }
        if (sql.startsWith('DELETE FROM entries')) db.entries = db.entries.filter(e => e.id !== this.args[0])
        if (sql.startsWith('DELETE FROM rules')) throw Error('migration attempted to delete user rules')
        if (sql.startsWith('INSERT OR REPLACE INTO rules')) throw Error('migration attempted to overwrite user rules')
        if (sql.startsWith('INSERT INTO category_source(category,sort_order,icon')) {
          // Mirror SQLite's ON CONFLICT(category) DO NOTHING behavior so a
          // second insertion cannot falsely report success in the API test.
          if (db.icons.some(r => r.category === this.args[0])) return {meta:{changes:0}}
          db.icons.push({category:this.args[0],icon:this.args[1]})
          return {meta:{changes:1}}
        }
        if (sql.startsWith('INSERT OR IGNORE INTO custom_rules') && !db.customRules.some(r => r.keyword === this.args[0]))
          db.customRules.push({ keyword: this.args[0], category: this.args[1] })
        if (sql.startsWith('INSERT OR IGNORE INTO rules') && !db.rules.some(r => r.keyword === this.args[0]))
          db.rules.push({ keyword: this.args[0], category: this.args[1] })
        return { meta: { changes: 1 } }
      }
    }
  }
}

const call = async (db, path, method = 'GET', payload, options = {}) => {
  const body = payload === undefined ? undefined : JSON.stringify(payload)
  if (!options.token && options.auth !== '') {
    const login = await call(db, 'auth/login', 'POST', { code: options.auth ?? 'test-secret' }, { token: 'login-request', auth: options.auth })
    if (login.status !== 200) throw Error('test login failed: ' + login.status)
    options = { ...options, session: login.body.session }
  }
  const request = new Request('https://example.test/api/' + path, {
    method, headers: { 'x-session': options.session ?? options.token ?? '', 'content-type': 'application/json', ...(options.confirmId ? { 'x-confirm-delete': String(options.confirmId) } : {}) }, body
  })
  const response = await onRequest({ request, env: { DB: db, AUTH_TOKEN: options.auth ?? 'test-secret' },
    params: { path: path.split('?')[0].split('/') } })
  return { status: response.status, body: await response.json(), headers: response.headers }
}

test('personal API fails closed when authentication is not configured', async () => {
  const db = new LedgerDb()
  const r = await call(db, 'entries?month=2026-10', 'GET', undefined, { auth: '' })
  assert.equal(r.status, 503)
  assert.equal(db.sql.length, 0)
})
test('rejects a wrong token before accessing the database', async () => {
  const db = new LedgerDb()
  const r = await call(db, 'entries?month=2026-10', 'GET', undefined, { token: 'wrong' })
  assert.equal(r.status, 401)
  assert.equal(db.sql.length, 0)
})
test('retrying an identical imported payment never inserts it twice', async () => {
  const db = new LedgerDb()
  const tx = { date: '2026-10-10', amount: 580, type: 'expense',
    category: '饮食料品', merchant: 'コンビニ', clientRequestId: 'replay-item-0001' }
  const first = await call(db, 'entries', 'POST', tx)
  const again = await call(db, 'entries', 'POST', tx)
  assert.equal(first.status, 200)
  assert.equal(first.body.duplicate, false)
  assert.equal(again.body.duplicate, true)
  assert.equal(db.entries.length, 1)
  assert.equal(db.entries[0].amount, 580)
})
test('SBI transfers remain independent from the retired snapshot table', async () => {
  const db=new LedgerDb()
  const tx={date:'2026-01-05',transferDate:'2026-01-05',transferTarget:'sbi',amount:15000,type:'transfer',clientRequestId:'sbi-payment-001'}
  assert.equal((await call(db,'entries','POST',tx)).status,200)
  assert.equal(db.entries.length,1)
  assert.equal(db.entries[0].transfer_target,'sbi')
  assert.equal((await call(db,'entries/1','DELETE')).status,428)
  assert.equal((await call(db,'entries/1','DELETE',undefined,{confirmId:1})).status,200)
  assert.equal(db.entries.length,0)
  assert.ok(db.sql.every(sql => !/investment_snapshots/i.test(sql)))
})
test('a scheduled future transfer cannot be confirmed early', async () => {
  const db = new LedgerDb()
  const tx = { date: '2099-12-01', transferDate: '2099-12-31', transferTarget: 'sbi',
    amount: 1000, type: 'transfer', clientRequestId: 'future-transfer-001' }
  await call(db, 'entries', 'POST', tx)
  const result = await call(db, 'transfers/1', 'POST')
  assert.equal(result.status, 409)
  assert.equal(db.entries[0].transfer_applied, 0)
})

test('rejects impossible dates and invalid reporting periods', async () => {
  const db = new LedgerDb()
  const invalid = await call(db, 'entries', 'POST', {
    date: '2026-02-31', amount: 1000, type: 'expense', clientRequestId: 'invalid-date-001'
  })
  assert.equal(invalid.status, 400)
  assert.equal(db.entries.length, 0)
  assert.equal((await call(db, 'entries?month=2026-13')).status, 400)
  assert.equal((await call(db, 'entries?year=20x6')).status, 400)
  assert.equal((await call(db, 'entries?year=2026&offset=-5')).status, 400)
})

test('upgrade preserves all saved transactions and custom classification rules', async () => {
  const db = new LedgerDb()
  db.seeded = false
  db.entries.push({ id: 42, date: '2026-09-12', amount: 8820, type: 'expense',
    category: '日用品', merchant: '保存している店舗', transfer_target: null, transfer_applied: 0 })
  db.rules.push({ keyword: '個人専用の店', category: 'ペット' })
  const original = JSON.parse(JSON.stringify(db.entries))
  const originalRule = { ...db.rules[0] }
  const answer = await call(db, 'rules')
  assert.equal(answer.status, 200)
  assert.deepEqual(db.entries, original)
  assert.ok(db.rules.some(r => r.keyword === originalRule.keyword && r.category === originalRule.category))
  assert.ok(db.sql.every(sql => !/^\\s*(?:DELETE|DROP|TRUNCATE|REPLACE)\\s+(?:FROM\\s+)?(?:entries|rules|custom_rules|investment_snapshots)\\b/i.test(sql)))
})
test('deletion is refused unless a matching single entry ID is explicitly confirmed', async () => {
  const db = new LedgerDb()
  db.entries.push({ id: 31, date: '2026-10-01', amount: 350, type: 'expense' })
  assert.equal((await call(db, 'entries/31', 'DELETE')).status, 428)
  assert.equal((await call(db, 'entries/31', 'DELETE', undefined, { confirmId: 30 })).status, 428)
  assert.equal(db.entries.length, 1)
  assert.equal((await call(db, 'entries/31', 'DELETE', undefined, { confirmId: 31 })).status, 200)
  assert.equal(db.entries.length, 0)
})

test('editing respects explicit expense or income even for investment-looking text', async () => {
  const db = new LedgerDb()
  await call(db, 'entries', 'POST', { date: '2026-10-01', amount: 1000, type: 'expense', clientRequestId: 'edit-type-test-001' })
  for (const type of ['expense', 'income']) {
    const result = await call(db, 'entries/1', 'PUT', { date: '2026-10-01', amount: 1000, type, merchant: '証券投信積立サービス', category: '日用品' })
    assert.equal(result.status, 200)
    assert.equal(db.entries[0].type, type)
    assert.equal(db.entries[0].transfer_target, null)
    assert.ok(db.sql.every(sql=>!/investment_snapshots/i.test(sql)))
  }
})
test('editing rejects fractional and unsafe amounts without changing the entry', async () => {
  const db = new LedgerDb()
  await call(db, 'entries', 'POST', { date: '2026-10-01', amount: 1000, type: 'expense', clientRequestId: 'edit-amount-test-001' })
  for (const amount of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await call(db, 'entries/1', 'PUT', { date: '2026-10-01', amount, type: 'expense' })).status, 400)
    assert.equal(db.entries[0].amount, 1000)
  }
})

test('new category icon persists and existing entries stay untouched', async () => {
  const db = new LedgerDb()
  db.entries.push({ id: 42, date: '2026-10-01', amount: 1000, type: 'expense' })
  assert.equal((await call(db, 'categories', 'POST', { name: '美容', icon: 'beauty' })).status, 200)
  assert.deepEqual((await call(db, 'category-icons')).body, { '美容': 'beauty' })
  assert.equal((await call(db, 'categories', 'POST', { name: '美容', icon: 'insurance' })).status, 409)
  assert.equal((await call(db, 'categories', 'POST', { name: '教育', icon: 'invalid' })).status, 400)
  assert.equal(db.entries[0].amount, 1000)
  assert.equal(db.icons[0].icon, 'beauty')
})

test('device session persists, expires and is revoked on logout', async () => {
  const db = new LedgerDb()
  const login = await call(db, 'auth/login', 'POST', { code: 'test-secret' }, { token: 'login-request' })
  assert.equal(login.status, 200)
  const session = login.body.session
  assert.match(session, /^[a-f0-9]{64}$/)
  assert.equal((await call(db, 'entries?month=2026-10', 'GET', undefined, { token: session })).status, 200)
  assert.equal((await call(db, 'auth/logout', 'POST', undefined, { token: session })).status, 200)
  assert.equal((await call(db, 'entries?month=2026-10', 'GET', undefined, { token: session })).status, 401)
  const again = await call(db, 'auth/login', 'POST', { code: 'test-secret' }, { token: 'login-request' })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(again.body.session))
  const key = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('')
  db.sessions.set(key, Date.now() - 1)
  assert.equal((await call(db, 'entries?month=2026-10', 'GET', undefined, { token: again.body.session })).status, 401)
})
test('wrong access codes are rate limited without exposing ledger', async () => {
  const db = new LedgerDb()
  for (let i = 0; i < 5; i++) assert.equal((await call(db, 'auth/login', 'POST', { code: 'wrong' }, { token: 'login-request' })).status, 401)
  assert.equal((await call(db, 'auth/login', 'POST', { code: 'wrong' }, { token: 'login-request' })).status, 429)
  assert.equal(db.entries.length, 0)
})

test('renaming a card rejects existing destination without touching transactions', async () => {
  const db = new LedgerDb()
  db.paymentSources.add('旧カード')
  db.paymentSources.add('既存カード')
  await call(db,'entries','POST',{date:'2026-10-01',amount:1200,type:'expense',paymentSource:'旧カード',clientRequestId:'collision-001'})
  const response = await call(db,'payment-sources/rename','POST',{oldName:'旧カード',newName:'既存カード'})
  assert.equal(response.status,409)
  assert.equal(db.entries[0].payment_source,'旧カード')
  assert.equal(db.entries[0].amount,1200)
  assert.ok(db.paymentSources.has('旧カード'))
})
test('renaming a card rebinds historical payments without altering amounts or investments', async () => {
  const db = new LedgerDb()
  db.paymentSources.add('旧カード')
  await call(db,'entries','POST',{date:'2026-10-01',amount:1200,type:'expense',paymentSource:'旧カード',clientRequestId:'rename-test-001'})
  await call(db,'entries','POST',{date:'2026-10-02',amount:15000,type:'transfer',transferTarget:'sbi',paymentSource:'旧カード',clientRequestId:'rename-test-002'})
  const before = db.entries.map(e=>({id:e.id,amount:e.amount,type:e.type,transfer_target:e.transfer_target}))
  const response = await call(db,'payment-sources/rename','POST',{oldName:'旧カード',newName:'新カード'})
  assert.equal(response.status,200)
  assert.equal(response.body.changes,2)
  assert.deepEqual(db.entries.map(e=>({id:e.id,amount:e.amount,type:e.type,transfer_target:e.transfer_target})),before)
  assert.ok(db.entries.every(e=>e.payment_source==='新カード'))
  assert.ok(db.sql.every(sql=>!/investment_snapshots/i.test(sql)))
})


test('orphaned ledger entries are never renamed when old payment source is missing',async()=>{
  const db=new LedgerDb()
  db.entries.push({id:1,date:'2026-10-20',amount:2000,type:'expense',payment_source:'削除済の名前',transfer_target:null})
  const before=JSON.stringify(db.entries)
  const result=await call(db,'payment-sources/rename','POST',{oldName:'削除済の名前',newName:'別カード'})
  assert.equal(result.status,404)
  assert.equal(JSON.stringify(db.entries),before)
  assert.ok(!db.paymentSources.has('別カード'))
})
test('retired finance-settings APIs never recreate deprecated D1 tables',async()=>{
  const db=new LedgerDb()
  for(const key of ['plans','bills','closing-days','theme']) {
    const response=await call(db,'finance-settings/'+key)
    assert.equal(response.status,410)
    assert.equal(response.body.code,'deprecated_finance_settings')
  }
  assert.equal((await call(db,'finance-settings/theme','PUT',{value:'green'})).status,410)
  assert.equal(db.sql.some(sql=>/CREATE TABLE IF NOT EXISTS finance_settings|INSERT INTO finance_settings|SELECT value FROM finance_settings/.test(sql)),false)
})

test('card closing days are persisted directly in payment_sources only',async()=>{
  const db=new LedgerDb()
  for(const name of ['PayPay','楽天カード','三井住友カード','セブンカード・プラス','セゾンカード'])
    db.paymentSources.add(name)
  for(const name of ['PayPay','楽天カード','三井住友カード']) db.paymentClosingDays.set(name,0)
  db.paymentClosingDays.set('セブンカード・プラス',15)
  db.paymentClosingDays.set('セゾンカード',10)
  const response=await call(db,'payment-sources')
  assert.equal(response.status,200)
  assert.deepEqual(Object.fromEntries(response.body.map(x=>[x.name,x.closing_day])),{'PayPay':0,'楽天カード':0,'三井住友カード':0,'セブンカード・プラス':15,'セゾンカード':10})
  assert.equal((await call(db,'payment-sources/closing-day','POST',{name:'楽天カード',closingDay:25})).status,200)
  assert.equal((await call(db,'payment-sources')).body.find(x=>x.name==='楽天カード').closing_day,25)
  assert.equal((await call(db,'payment-sources/closing-day','POST',{name:'楽天カード',closingDay:40})).status,400)
  assert.equal((await call(db,'payment-sources/closing-day','POST',{name:'存在しないカード',closingDay:10})).status,404)
  assert.equal(db.sql.some(sql=>sql.includes('finance_settings')),false)
})

test('normalized D1 plans preserve IDs and allow deleting only a schedule', async () => {
  const db=new LedgerDb()
  const p={name:'家賃',amount:101500,day:27,category:'居住',paymentSource:'現金',id:'2a23e8e5-d621-4e2b-b858-460b52407ca2',startMonth:'2026-10',enabled:true}
  db.recurringPlans.set(p.id,p)
  db.entries.push({id:1,amount:101500,client_request_id:'recurring_2a23e8e5d6214e2bb858460b52407ca2_202610'})
  const first=await call(db,'recurring-plans')
  assert.equal(first.status,200)
  assert.deepEqual(first.body,[{...p,postingMode:'manual',autoFromMonth:'',scheduleType:'monthly',weekday:0}])
  const again=await call(db,'recurring-plans')
  assert.deepEqual(again.body,[{...p,postingMode:'manual',autoFromMonth:'',scheduleType:'monthly',weekday:0}])
  assert.equal((await call(db,'recurring-plans/'+p.id,'DELETE')).status,200)
  assert.deepEqual((await call(db,'recurring-plans')).body,[])
  assert.equal(db.recurringPlans.has(p.id),true,'plan is archived, not hard-deleted')
  assert.equal(db.recurringTrash.has(p.id),true)
  assert.equal((await call(db,'recurring-plans?trash=1')).body.length,1)
  assert.equal((await call(db,'recurring-plans/'+p.id+'/restore','POST')).status,200)
  assert.deepEqual((await call(db,'recurring-plans')).body,[{...p,postingMode:'manual',autoFromMonth:'',scheduleType:'monthly',weekday:0}])
  assert.equal(db.recurringTrash.has(p.id),false)
  assert.equal(db.entries.length,1)
  assert.equal(db.sql.some(sql=>sql.includes('finance_settings')),false)
})

test('historic card-bill backup is insert-only; deleting a bill leaves ledger unchanged', async () => {
  const db=new LedgerDb()
  const bill={name:'セゾンカード',month:'2026-10',start:'2026-09-11',end:'2026-10-10',total:45000,count:18}
  db.cardBills.set(bill.name+'|'+bill.month,bill)
  db.entries.push({id:1,amount:3000,payment_source:'セゾンカード'})
  assert.deepEqual((await call(db,'card-bills')).body,[bill])
  assert.equal((await call(db,'card-bills','POST',{...bill,total:46000})).status,200)
  assert.equal((await call(db,'card-bills')).body[0].total,45000)
  assert.equal((await call(db,'card-bills?name=%E3%82%BB%E3%82%BE%E3%83%B3%E3%82%AB%E3%83%BC%E3%83%89&month=2026-10','DELETE')).status,200)
  assert.deepEqual((await call(db,'card-bills')).body,[])
  assert.equal(db.entries[0].amount,3000)
  assert.equal(db.sql.some(sql=>sql.includes('finance_settings')),false)
})

test('all real years are discoverable for complete ledger export',async()=>{
  const db=new LedgerDb()
  db.entries.push({id:1,date:'2017-12-31',amount:1500,type:'expense'})
  db.entries.push({id:2,date:'2027-01-02',amount:1200,type:'expense'})
  const response=await call(db,'entry-years')
  assert.equal(response.status,200)
  assert.deepEqual(response.body,[{year:'2017',count:1},{year:'2027',count:1}])
})

test('server skips matching hand-entered recurring expense and retries are idempotent',async()=>{
  const db=new LedgerDb()
  const p={id:'plan-regular-001',name:'家賃',amount:102000,day:25,category:'居住',paymentSource:'現金',startMonth:'2026-10',enabled:true}
  db.recurringPlans.set(p.id,p)
  db.entries.push({id:1,date:'2026-10-25',amount:102000,type:'expense',merchant:'家賃',payment_source:'現金',client_request_id:null})
  let response=await call(db,'recurring-post','POST',approvedPost(p))
  assert.equal(response.status,200)
  assert.equal(response.body.conflict,true)
  assert.equal(db.entries.length,1)
  db.entries=[];db.nextId=1
  response=await call(db,'recurring-post','POST',approvedPost(p))
  assert.equal(response.body.created,true)
  assert.equal(db.entries.length,1)
  response=await call(db,'recurring-post','POST',approvedPost(p))
  assert.equal(response.body.duplicate,true)
  assert.equal(db.entries.length,1)
})

test('retired snapshot API returns 410 without any SQL mutation',async()=>{
  const db=new LedgerDb()
  const get=await call(db,'investments','GET')
  const put=await call(db,'investments','PUT',{platform:'sbi',currentValue:70000,pnl:2000})
  const restore=await call(db,'investments/restore-empty','POST',{platform:'sbi',currentValue:70000,pnl:2000})
  assert.equal(get.status,410)
  assert.equal(put.status,410)
  assert.equal(restore.status,410)
  // Authentication/session handling can write audit state; retired valuation
  // endpoints must not mutate ledger, holdings, prices or legacy snapshots.
  assert.ok(db.sql.every(sql => !/\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:entries|investment_snapshots|investment_holdings|fund_prices)\b/i.test(sql)))
})
