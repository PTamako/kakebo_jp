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
  assert.match(api, /UPDATE entries SET transfer_applied = 1 WHERE type = 'transfer' AND transfer_target = 'sbi'/)
  assert.equal(investedTotal([row(15000,'2026-10-01'),row(900,'2026-10-01','transfer','prepaid:Suica')],today),15000)
  assert.match(api, /UPDATE entries SET date = .*transfer_applied = \?10/)
})

test('editing an SBI transfer preserves calendar context and updates the destination month safely', () => {
  const saveEdit = app.match(/async function saveEdit\(\) \{([\s\S]*?)\n\}\n\nconst pendingTransfers/)?.[1]
  assert.ok(saveEdit, 'entry edit handler exists')
  // The old test required every save to clear the user's selected day and
  // filters. That would regress the deliberate calendar/ledger UX fix.
  assert.doesNotMatch(saveEdit, /entryTypeFilter\.value\s*=\s*'all'/)
  assert.doesNotMatch(saveEdit, /detailFilter\.value\s*=\s*null/)
  assert.doesNotMatch(saveEdit, /selectedDay\.value\s*=\s*''/)
  assert.match(saveEdit, /const destinationMonth = editedEntryMonth\(e\.date\)/)
  assert.match(saveEdit, /const returnDay = selectedDay\.value \? editedDay : ''/)
  assert.match(saveEdit, /preserveOperatedDay\.value = editedDay/)
  assert.match(saveEdit, /pendingEditMonthReturn = \{ month: destinationMonth, selectedDay: returnDay, calendarExpanded: returnCalendarExpanded \}/)
  assert.match(saveEdit, /month\.value = destinationMonth/)
  assert.match(saveEdit, /await loadTransfers\(\)/, 'SBI transfer status is still refreshed after save')
  // The list may be automatically expanded, but only after the edit succeeds.
  assert.ok(saveEdit.indexOf("await api('entries/' + e.id") < saveEdit.indexOf('editingEntry.value = null'))
  assert.match(app, /if \(!operatedDay \|\| days\.includes\(operatedDay\)\) preserveOperatedDay\.value = ''/)
})
