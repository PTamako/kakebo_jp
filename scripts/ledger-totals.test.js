import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ledgerEntryAmount, ledgerEntriesTotal, formatLedgerTotal } from '../src/ledger-totals.js'
import { groupAnnualEntries } from '../src/detail-pagination.js'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const transactions = [
  {date:'2026-10-27',type:'income',amount:18735},
  {date:'2026-10-27',type:'expense',amount:1000},
  {date:'2026-10-27',type:'expense',amount:101500}
]

test('October 27 calendar net matches full daily ledger rather than sum of absolute amounts', () => {
  assert.equal(ledgerEntriesTotal(transactions), -83765)
  assert.equal(formatLedgerTotal(ledgerEntriesTotal(transactions)), '−¥83,765')
  assert.equal(ledgerEntriesTotal(transactions, 'income'), 18735)
  assert.equal(ledgerEntriesTotal(transactions, 'expense'), 102500)
  assert.equal(ledgerEntriesTotal(transactions, 'transfer'), 0)
})

test('asset transfers never inflate net income or expenses; the transfer tab still shows them', () => {
  const rows=[...transactions, {date:'2026-10-27',type:'transfer',amount:15000}]
  assert.equal(ledgerEntriesTotal(rows), -83765)
  assert.equal(ledgerEntriesTotal(rows, 'transfer'), 15000)
  assert.equal(ledgerEntriesTotal(rows, 'income'), 18735)
  assert.equal(ledgerEntriesTotal(rows, 'expense'), 102500)
  assert.equal(ledgerEntryAmount({amount:800,type:'transfer'}, 'all'), 0)
})

test('balanced and income-only days are visible, and signed display is natural in Japanese', () => {
  assert.equal(ledgerEntriesTotal([{type:'income',amount:2000},{type:'expense',amount:2000}]), 0)
  assert.equal(formatLedgerTotal(0), '¥0')
  assert.equal(formatLedgerTotal(18735), '+¥18,735')
  assert.equal(formatLedgerTotal(-83765), '−¥83,765')
  assert.equal(formatLedgerTotal(18735,'income'), '¥18,735')
  assert.equal(formatLedgerTotal(102500,'expense'), '¥102,500')
  assert.equal(formatLedgerTotal(15000,'transfer'), '¥15,000')
})

test('annual month totals use the same formula even when only some rows are displayed', () => {
  const rows=[...transactions, {date:'2026-10-27',type:'transfer',amount:15000}]
  const [oct]=groupAnnualEntries(rows, {}, 2, 'all')
  assert.equal(oct.count, 4)
  assert.equal(oct.items.length, 2)
  assert.equal(oct.total, -83765)
  const [income]=groupAnnualEntries(rows.filter(row=>row.type==='income'), {}, 20,'income')
  assert.equal(income.total, 18735)
})

test('ledger calendar and day section consume the shared formula, independent of pagination', () => {
  const app=source('src/App.vue'), ledger=source('src/pages/LedgerPage.vue')
  assert.match(app, /ledgerEntryAmount\(entry, entryTypeFilter\.value\)/)
  assert.match(app, /ledgerEntriesTotal\(all, entryTypeFilter\.value\)/)
  assert.match(ledger, /formatLedgerTotal\(day\.amount, entryTypeFilter\)/)
  assert.match(ledger, /formatLedgerTotal\(group\.total, entryTypeFilter\)/)
  assert.match(ledger, /group\.count/)
  assert.match(ledger, /day\.hasEntries/)
})
