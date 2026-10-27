import test from 'node:test'
import assert from 'node:assert/strict'
import { groupAnnualEntries } from '../src/detail-pagination.js'

test('annual month pagination preserves full totals and reveals entries in batches', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i, date: '2026-10-01', amount: 100 }))
  rows.push(...Array.from({ length: 3 }, (_, i) => ({ id: 100 + i, date: '2026-09-01', amount: 200 })))
  let [oct, sep] = groupAnnualEntries(rows, {})
  assert.equal(oct.count, 45)
  assert.equal(oct.total, 4500)
  assert.equal(oct.items.length, 20)
  assert.equal(sep.count, 3)
  assert.equal(sep.items.length, 3)
  ;[oct, sep] = groupAnnualEntries(rows, { '2026-10': 40 })
  assert.equal(oct.items.length, 40)
  assert.equal(oct.total, 4500)
  assert.equal(sep.items.length, 3)
  ;[oct] = groupAnnualEntries(rows, { '2026-10': 60 })
  assert.equal(oct.items.length, 45)
  assert.equal(new Set(oct.items.map(e => e.id)).size, 45)
})
