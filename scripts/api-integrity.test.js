import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../functions/api/[[path]].js'

// A minimal D1-compatible double. These tests exercise HTTP handlers, retries,
// scheduled transfers, and the separation of valuation and deposited principal.
class LedgerDb {
  constructor() { this.entries = []; this.snapshot = 120000; this.nextId = 1; this.sql = []; this.seeded = true; this.rules = []; this.customRules = []; this.paymentSources = new Set(); this.paymentClosingDays = new Map(); this.recurringPlans = new Map(); this.cardBills = new Map(); this.financeSettings = new Map(); this.icons = []; this.sessions = new Map(); this.attempts = new Map() }
  async batch(statements) { const results=[]; for (const statement of statements) results.push(await statement.run()); return results }
  prepare(sql) {
    const db = this
    return {
      args: [],
      bind(...args) { this.args = args; return this },
      async first() {
        if (sql.includes("name='closing-days-migrated-v1'")) return db.financeSettings.has('closing-days-migrated-v1') ? {value:'true'} : null
        if (sql.includes("name='closing-days'")) return db.financeSettings.has('closing-days') ? {value:db.financeSettings.get('closing-days')} : null
        if (sql.startsWith('SELECT COUNT(*) AS n FROM payment_sources')) return {n:db.paymentSources.size}
        if (sql.startsWith('SELECT 1 AS found FROM card_bills')) return [...db.cardBills.values()].some(v=>v.name===this.args[0] && [...db.cardBills.values()].some(w=>w.name===this.args[1] && w.month===v.month)) ? {found:1} : null
        if (sql.startsWith('SELECT value FROM finance_settings WHERE name=')) return db.financeSettings.has(this.args[0]) ? { value: db.financeSettings.get(this.args[0]) } : null
        if (sql.startsWith('SELECT name FROM payment_sources WHERE name=')) return db.paymentSources.has(this.args[0]) ? { name: this.args[0] } : null
        if (sql.startsWith('SELECT token_hash FROM device_sessions')) return (db.sessions.get(this.args[0]) || 0) > this.args[1] ? { token_hash: this.args[0] } : null
        if (sql.startsWith('SELECT attempts, reset_at FROM login_attempts')) return db.attempts.get(this.args[0]) || null
        if (sql.startsWith('SELECT id, amount, transfer_target, transfer_applied, transfer_date, date FROM entries'))
          return db.entries.find(e => e.id === this.args[0] && e.type === 'transfer') || null
        if (sql.startsWith('SELECT amount, type, transfer_target'))
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
        if (sql.startsWith('PRAGMA table_info(payment_sources)')) return {results:[{name:'closing_day'}]}
        if (sql.startsWith('SELECT name, is_default, closing_day FROM payment_sources')) return {results:[...db.paymentSources].map(name=>({name,is_default:0,closing_day:db.paymentClosingDays.has(name)?db.paymentClosingDays.get(name):null}))}
        if (sql.startsWith('SELECT id,name,amount,day,category,payment_source,start_month,enabled FROM recurring_plans')) return {results:[...db.recurringPlans.values()].map(p=>({id:p.id,name:p.name,amount:p.amount,day:p.day,category:p.category,payment_source:p.paymentSource,start_month:p.startMonth,enabled:p.enabled?1:0}))}
        if (sql.startsWith('SELECT payment_source,bill_month,period_start,period_end,total_amount,transaction_count FROM card_bills')) return {results:[...db.cardBills.values()].map(v=>({payment_source:v.name,bill_month:v.month,period_start:v.start,period_end:v.end,total_amount:v.total,transaction_count:v.count}))}
        if (sql.startsWith('SELECT category, icon FROM category_icons')) return { results: db.icons }
        if (sql.startsWith('SELECT keyword, category FROM rules WHERE substr')) return { results: db.rules }
        if (sql.startsWith('SELECT * FROM rules WHERE keyword')) return { results: db.rules }
        if (sql.startsWith('SELECT keyword, category FROM custom_rules')) return { results: db.customRules }
        if (sql.includes('AS invested_total FROM investment_snapshots')) return { results: [{
          platform: 'sbi', current_value: db.snapshot, pnl: 10000, updated_at: null,
          invested_total: db.entries.filter(e => e.type === 'transfer' && e.transfer_target === 'sbi' && e.transfer_applied === 1)
            .reduce((sum, e) => sum + e.amount, 0)
        }] }
        return { results: [] }
      },
      async run() {
        db.sql.push(sql)
        if (sql.startsWith('INSERT OR IGNORE INTO recurring_plans')) {
          const [id,name,amount,day,category,paymentSource,startMonth,enabled]=this.args
          if (!db.recurringPlans.has(id)) {db.recurringPlans.set(id,{id,name,amount,day,category,paymentSource,startMonth,enabled:!!enabled}); return {meta:{changes:1}}}
          return {meta:{changes:0}}
        }
        if (sql.startsWith('DELETE FROM recurring_plans')) {
          db.recurringPlans.delete(this.args[0]); return {meta:{changes:1}}
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
        if (sql.startsWith('INSERT INTO entries')) {
          const a = this.args
          if (a[11] && db.entries.some(e => e.client_request_id === a[11])) return { meta: { changes: 0 } }
          db.entries.push({ id: db.nextId++, date: a[0], amount: a[2], type: a[7],
            transfer_target: a[8], transfer_applied: a[9], transfer_date: a[10], client_request_id: a[11], payment_source: a[12] })
          return { meta: { changes: 1 } }
        }
        if (sql.startsWith('UPDATE entries SET payment_source =')) {
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
        if (sql.startsWith('INSERT OR IGNORE INTO category_icons') && !db.icons.some(r => r.category === this.args[0])) db.icons.push({ category: this.args[0], icon: this.args[1] })
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
  const r = await call(db, 'investments', 'GET', undefined, { token: 'wrong' })
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
test('investment transfers do not mutate manually entered market valuations', async () => {
  const db = new LedgerDb()
  const tx = { date: '2026-01-05', transferDate: '2026-01-05', transferTarget: 'sbi',
    amount: 15000, type: 'transfer', clientRequestId: 'sbi-payment-001' }
  assert.equal((await call(db, 'entries', 'POST', tx)).status, 200)
  const a = await call(db, 'investments')
  assert.equal(a.body[0].invested_total, 15000)
  assert.equal(a.body[0].current_value, 120000)
  assert.equal((await call(db, 'entries/1', 'DELETE')).status, 428)
  assert.equal(db.entries.length, 1)
  assert.equal((await call(db, 'entries/1', 'DELETE', undefined, { confirmId: 1 })).status, 200)
  const b = await call(db, 'investments')
  assert.equal(b.body[0].invested_total, 0)
  assert.equal(b.body[0].current_value, 120000)
  assert.ok(db.sql.every(sql => !sql.startsWith('UPDATE investment_snapshots SET current_value')))
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
  assert.ok(db.sql.every(sql => !/^\\s*(?:DELETE|DROP|TRUNCATE|REPLACE)\\b/i.test(sql)))
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
    assert.equal(db.snapshot, 120000)
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
  assert.equal((await call(db, 'investments', 'GET', undefined, { token: session })).status, 200)
  assert.equal((await call(db, 'auth/logout', 'POST', undefined, { token: session })).status, 200)
  assert.equal((await call(db, 'investments', 'GET', undefined, { token: session })).status, 401)
  const again = await call(db, 'auth/login', 'POST', { code: 'test-secret' }, { token: 'login-request' })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(again.body.session))
  const key = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('')
  db.sessions.set(key, Date.now() - 1)
  assert.equal((await call(db, 'investments', 'GET', undefined, { token: again.body.session })).status, 401)
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
  await call(db,'entries','POST',{date:'2026-10-01',amount:1200,type:'expense',paymentSource:'旧カード',clientRequestId:'rename-test-001'})
  await call(db,'entries','POST',{date:'2026-10-02',amount:15000,type:'transfer',transferTarget:'sbi',paymentSource:'旧カード',clientRequestId:'rename-test-002'})
  const before = db.entries.map(e=>({id:e.id,amount:e.amount,type:e.type,transfer_target:e.transfer_target}))
  const response = await call(db,'payment-sources/rename','POST',{oldName:'旧カード',newName:'新カード'})
  assert.equal(response.status,200)
  assert.equal(response.body.changes,2)
  assert.deepEqual(db.entries.map(e=>({id:e.id,amount:e.amount,type:e.type,transfer_target:e.transfer_target})),before)
  assert.ok(db.entries.every(e=>e.payment_source==='新カード'))
  assert.equal(db.snapshot,120000)
})

test('D1 finance settings migrate once and protect pre-existing plans', async () => {
  const db = new LedgerDb()
  const plan = { id:'fixed-rent',name:'家賃',amount:102000,day:25,category:'居住',paymentSource:'口座振替',startMonth:'2026-06',enabled:true }
  let x = await call(db,'finance-settings/plans')
  assert.equal(x.status,200)
  assert.equal(x.body.exists,false)
  assert.equal((await call(db,'finance-settings/plans','POST',{value:[plan]})).status,200)
  assert.equal((await call(db,'finance-settings/plans','POST',{value:[]})).status,200)
  x = await call(db,'finance-settings/plans')
  assert.equal(x.body.exists,true)
  assert.deepEqual(x.body.value,[plan])
  assert.equal(db.entries.length,0)
})

test('D1 closing days and card bills survive retrieval and reject wrong data', async () => {
  const db = new LedgerDb()
  const closing = {'セゾンカード':'10','セブンカード・プラス':'15'}
  assert.equal((await call(db,'finance-settings/closing-days','PUT',{value:closing})).status,200)
  assert.deepEqual((await call(db,'finance-settings/closing-days')).body.value,closing)
  const bills = [{ name:'セゾンカード',month:'2026-10',total:31000,start:'2026-09-11',end:'2026-10-10',count:12 }]
  assert.equal((await call(db,'finance-settings/bills','PUT',{value:bills})).status,200)
  assert.deepEqual((await call(db,'finance-settings/bills')).body.value,bills)
  assert.equal((await call(db,'finance-settings/closing-days','PUT',{value:{card:500}})).status,400)
  assert.deepEqual((await call(db,'finance-settings/closing-days')).body.value,closing)
  assert.equal((await call(db,'finance-settings/unknown','GET')).status,400)
  assert.equal(db.entries.length,0)
})

test('PWA theme persists in D1 while rejecting unknown theme values', async () => {
  const db = new LedgerDb()
  assert.equal((await call(db,'finance-settings/theme')).body.exists,false)
  assert.equal((await call(db,'finance-settings/theme','PUT',{value:'green'})).status,200)
  assert.deepEqual((await call(db,'finance-settings/theme')).body,{exists:true,value:'green'})
  assert.equal((await call(db,'finance-settings/theme','PUT',{value:'unknown'})).status,400)
  assert.equal((await call(db,'finance-settings/theme')).body.value,'green')
})

test('legacy closing dates migrate to payment_sources and preserve independent settings', async () => {
  const db = new LedgerDb()
  for (const name of ['PayPay','楽天カード','三井住友カード','セブンカード・プラス','セゾンカード']) db.paymentSources.add(name)
  const old={'PayPay':'末日','楽天カード':'末日','三井住友カード':'末日','セブンカード・プラス':'15','セゾンカード':'10'}
  db.financeSettings.set('closing-days',JSON.stringify(old))
  db.financeSettings.set('theme',JSON.stringify('green'))
  db.financeSettings.set('plans',JSON.stringify([{name:'家賃',amount:101500}]))
  const response = await call(db,'payment-sources')
  assert.equal(response.status,200)
  assert.deepEqual(Object.fromEntries(response.body.map(x=>[x.name,x.closing_day])),{'PayPay':0,'楽天カード':0,'三井住友カード':0,'セブンカード・プラス':15,'セゾンカード':10})
  assert.equal(db.financeSettings.get('closing-days'),JSON.stringify(old))
  assert.equal(db.financeSettings.get('theme'),JSON.stringify('green'))
  assert.deepEqual(JSON.parse(db.financeSettings.get('plans')),[{name:'家賃',amount:101500}])
  assert.equal((await call(db,'payment-sources/closing-day','POST',{name:'楽天カード',closingDay:25})).status,200)
  assert.equal((await call(db,'payment-sources')).body.find(x=>x.name==='楽天カード').closing_day,25)
  assert.equal((await call(db,'payment-sources/closing-day','POST',{name:'楽天カード',closingDay:40})).status,400)
  assert.equal((await call(db,'payment-sources/closing-day','POST',{name:'存在しないカード',closingDay:10})).status,404)
})

test('closing day migration is deferred when there are no card records', async () => {
  const db = new LedgerDb()
  db.financeSettings.set('closing-days',JSON.stringify({'セゾンカード':'10'}))
  assert.equal((await call(db,'payment-sources')).status,200)
  assert.equal(db.financeSettings.has('closing-days-migrated-v1'),false)
  db.paymentSources.add('セゾンカード')
  const response=await call(db,'payment-sources')
  assert.equal(response.body[0].closing_day,10)
})

test('normalized D1 plans preserve IDs and allow deleting only a schedule', async () => {
  const db=new LedgerDb()
  const p={name:'家賃',amount:101500,day:27,category:'居住',paymentSource:'現金',id:'2a23e8e5-d621-4e2b-b858-460b52407ca2',startMonth:'2026-10',enabled:true}
  db.financeSettings.set('plans',JSON.stringify([p]))
  db.entries.push({id:1,amount:101500,client_request_id:'recurring_2a23e8e5d6214e2bb858460b52407ca2_202610'})
  const first=await call(db,'recurring-plans')
  assert.equal(first.status,200)
  assert.deepEqual(first.body,[p])
  const again=await call(db,'recurring-plans')
  assert.deepEqual(again.body,[p])
  assert.equal((await call(db,'recurring-plans/'+p.id,'DELETE')).status,200)
  assert.deepEqual((await call(db,'recurring-plans')).body,[])
  assert.equal(db.entries.length,1)
  assert.equal(db.financeSettings.get('plans'),JSON.stringify([p]))
})

test('normalized D1 bills support update and delete without editing ledger', async () => {
  const db=new LedgerDb()
  const bill={name:'セゾンカード',month:'2026-10',start:'2026-09-11',end:'2026-10-10',total:45000,count:18}
  db.financeSettings.set('bills',JSON.stringify([bill]))
  db.entries.push({id:1,amount:3000,payment_source:'セゾンカード'})
  assert.deepEqual((await call(db,'card-bills')).body,[bill])
  assert.equal((await call(db,'card-bills','PUT',{...bill,total:46000})).status,200)
  assert.equal((await call(db,'card-bills')).body[0].total,46000)
  assert.equal((await call(db,'card-bills?name=%E3%82%BB%E3%82%BE%E3%83%B3%E3%82%AB%E3%83%BC%E3%83%89&month=2026-10','DELETE')).status,200)
  assert.deepEqual((await call(db,'card-bills')).body,[])
  assert.equal(db.entries[0].amount,3000)
  assert.equal(db.financeSettings.get('bills'),JSON.stringify([bill]))
})
