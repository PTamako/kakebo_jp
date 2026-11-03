import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('monthly recurring lookups use idx_entries_date instead of scanning the ledger', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE entries(date TEXT NOT NULL, type TEXT, merchant TEXT, payment_source TEXT, client_request_id TEXT)')
    db.exec('CREATE INDEX idx_entries_date ON entries(date)')
    const plan = db.prepare(`EXPLAIN QUERY PLAN
      SELECT client_request_id FROM entries
      WHERE date >= ('2026-11' || '-01')
        AND date < date('2026-11' || '-01', '+1 month')
        AND type='expense' AND merchant='家賃' AND COALESCE(payment_source,'')='現金'`).all()
    assert.ok(plan.some(row => /SEARCH entries USING INDEX idx_entries_date/.test(row.detail)),
      'range query should use the existing date index')
    const old = db.prepare(`EXPLAIN QUERY PLAN
      SELECT client_request_id FROM entries
      WHERE substr(date,1,7)='2026-11'`).all()
    assert.ok(old.some(row => /SCAN entries/.test(row.detail)), 'old substring lookup scanned all rows')
    assert.equal(db.prepare("SELECT date('2026-12-01','+1 month') AS next").get().next, '2027-01-01')
  } finally { db.close() }
})

test('both automatic and confirmed recurring paths use indexable monthly date bounds', () => {
  const collision = read('functions/api/recurring-collision.js')
  const automatic = read('functions/api/recurring-auto.js')
  const manual = read('functions/api/[[path]].js')
  assert.match(collision, /date >= \(\?1 \|\| '-01'\) AND date < date\(/)
  assert.match(automatic, /e\.date >= \(\?5 \|\| '-01'\) AND e\.date < date\(/)
  assert.match(manual, /e\.date >= \(\?8 \|\| '-01'\) AND e\.date < date\(/)
  for (const source of [collision, automatic, manual]) {
    assert.doesNotMatch(source, /substr\((?:e\.)?date,1,7\)/)
  }
})
