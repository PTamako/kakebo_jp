import test from 'node:test'
import assert from 'node:assert/strict'
import { onRequest } from '../functions/api/[[path]].js'

// A minimal D1-compatible double. These tests exercise HTTP handlers, retries,
// scheduled transfers, and the separation of valuation and deposited principal.
class LedgerDb {
  constructor() { this.entries = []; this.snapshot = 120000; this.nextId = 1; this.sql = []; this.seeded = true; this.rules = []; this.customRules = [] }
  async batch(statements) { for (const statement of statements) await statement.run() }
  prepare(sql) {
    const db = this
    return {
      args: [],
      bind(...args) { this.args = args; return this },
      async first() {
        if (sql.startsWith('SELECT id, amount, transfer_target, transfer_applied, transfer_date, date FROM entries'))
          return db.entries.find(e => e.id === this.args[0] && e.type === 'transfer') || null
        if (sql.startsWith('SELECT amount, type, transfer_target'))
          return db.entries.find(e => e.id === this.args[0]) || null
        if (sql.startsWith('SELECT amount, transfer_target'))
          return db.entries.find(e => e.id === this.args[0]) || null
        if (sql.startsWith('SELECT keyword FROM rules WHERE keyword')) return db.seeded ? { keyword: this.args[0] } : null
        return { exists: true }
      },
      async all() {
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
        if (sql.startsWith('INSERT INTO entries')) {
          const a = this.args
          if (a[11] && db.entries.some(e => e.client_request_id === a[11])) return { meta: { changes: 0 } }
          db.entries.push({ id: db.nextId++, date: a[0], amount: a[2], type: a[7],
            transfer_target: a[8], transfer_applied: a[9], transfer_date: a[10], client_request_id: a[11] })
          return { meta: { changes: 1 } }
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
  const request = new Request('https://example.test/api/' + path, {
    method, headers: { 'x-token': options.token ?? 'test-secret', 'content-type': 'application/json', ...(options.confirmId ? { 'x-confirm-delete': String(options.confirmId) } : {}) }, body
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
