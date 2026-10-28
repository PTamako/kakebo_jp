import test from 'node:test'
import assert from 'node:assert/strict'
import { isAppliedSbiTransfer, investedTotal } from '../functions/api/investment-transfer.js'
import { readFileSync } from 'node:fs'
const api = readFileSync(new URL('../functions/api/[[path]].js', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const today = '2026-10-28'
const row = (amount, transferDate, type='transfer', transferTarget='sbi') => ({ amount, transferDate, date: '2026-10-01', type, transferTarget })

test('SBI total follows edited amount and application date without altering market value', () => {
  const snapshot = { current_value: 70093, pnl: 93 }
  assert.equal(investedTotal([row(15000, '2026-10-01')], today), 15000)
  assert.equal(investedTotal([row(18000, '2026-10-01')], today), 18000)
  assert.equal(investedTotal([row(18000, '2026-11-01')], today), 0)
  assert.equal(investedTotal([row(18000, '2026-10-01', 'expense')], today), 0)
  assert.equal(investedTotal([row(18000, '2026-10-01', 'transfer', null)], today), 0)
  assert.deepEqual(snapshot, { current_value: 70093, pnl: 93 })
})

test('SBI backend computes applied status from edited type, target and date', () => {
  assert.equal(isAppliedSbiTransfer(row(15000, '2026-11-01'), today), false)
  assert.equal(isAppliedSbiTransfer(row(15000, '2026-10-01'), today), true)
  assert.match(api, /isAppliedSbiTransfer\(\{ type: transfer \? 'transfer' : e\.type, transferTarget: target, transferDate, date: e\.date \}, today\)/)
  assert.match(api, /SUM\(amount\).*transfer_applied = 1/)
  assert.match(api, /UPDATE entries SET date = .*transfer_applied = \?10/)
})

test('edited records clear stale type/category/day filters before month navigation', () => {
  assert.match(app, /entryTypeFilter\.value = 'all'\s+selectedDay\.value = ''\s+editingEntry\.value = null/)
  assert.match(app, /detailFilter\.value = null\s+detailSourceEntries\.value = \[\]/)
  assert.match(app, /if \(destinationMonth && destinationMonth !== month\.value\) month\.value = destinationMonth/)
  assert.match(app, /if \(!operatedDay \|\| days\.includes\(operatedDay\)\) preserveOperatedDay\.value = ''/)
})
