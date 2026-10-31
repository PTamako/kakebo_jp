import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')
const ledger = source('src/pages/LedgerPage.vue')
const form = source('src/TransactionForm.vue')
const backend = source('functions/api/[[path]].js')

const saveEdit = app.match(/async function saveEdit\(\) \{([\s\S]*?)\n\}\n\nconst pendingTransfers/)?.[1] || ''
const monthWatch = app.match(/watch\(month, async \(\) => \{([\s\S]*?)\n\}\)/)?.[1] || ''

test('saved-entry editor applies a manually selected card, even after statement import', () => {
  const editor = ledger.match(/<TransactionForm [^\n]*edit-mode[^\n]*\/>/)?.[0] || ''
  assert.ok(editor, 'saved-entry editor exists')
  assert.match(editor, /@payment-change="manualPayment\(editingEntry, \$event\)"/)
  assert.match(ledger, /saveEdit, manualPayment, selectedDay/)
  assert.match(form, /@change="emit\('payment-change', \$event.target.value\)"/)

  const manual = app.match(/function manualPayment\(form, value\) \{[^\n]*\}/)?.[0] || ''
  assert.ok(manual)
  const choose = new Function(manual + '\nreturn manualPayment')()
  const imported = { paymentSource: 'PayPayカード', importPaymentLocked: true, paymentManuallySelected: false }
  choose(imported, '楽天カード')
  assert.equal(imported.paymentSource, '楽天カード')
  assert.equal(imported.paymentManuallySelected, true)

  // The editing payload must use the latest live selection, not a stored import card.
  assert.match(saveEdit, /JSON\.stringify\(\{ \.\.\.e, amount: Number\(e\.amount\) \}\)/)
  assert.match(backend, /const paymentSource = e\.paymentSource == null \? \(previous\.payment_source \|\| ''\) : String\(e\.paymentSource\)\.trim\(\)/)
  assert.match(backend, /payment_source = \?12 WHERE id = \?13/)
})

test('editing a selected calendar day keeps the selected day and existing filters', () => {
  assert.ok(saveEdit)
  assert.match(saveEdit, /const returnDay = selectedDay\.value \? editedDay : ''/)
  assert.match(saveEdit, /selectedDay\.value = returnDay/)
  assert.doesNotMatch(saveEdit, /detailFilter\.value\s*=\s*null/)
  assert.doesNotMatch(saveEdit, /entryTypeFilter\.value\s*=\s*'all'/)
  assert.doesNotMatch(saveEdit, /selectedDay\.value\s*=\s*''/)
  assert.match(saveEdit, /preserveOperatedDay\.value = editedDay/)
})

test('editing to a different month restores day AFTER month watcher and filtered loading', () => {
  assert.ok(monthWatch)
  assert.match(saveEdit, /pendingEditMonthReturn = \{ month: destinationMonth, selectedDay: returnDay, calendarExpanded: returnCalendarExpanded \}/)
  const reload = monthWatch.indexOf('await openCategoryDetails(')
  const restore = monthWatch.indexOf('selectedDay.value = returning.selectedDay')
  assert.ok(restore > monthWatch.indexOf('await load()'))
  assert.ok(reload < 0 || restore > reload, 'returning day must win after filtered reload')
  assert.match(monthWatch, /calendarExpanded\.value = returning\.calendarExpanded/)
  assert.match(monthWatch, /pendingEditMonthReturn = null/)
})

test('failed edit keeps original calendar view and existing payment record untouched', () => {
  const apiWrite = saveEdit.indexOf("await api('entries/' + e.id")
  const editClear = saveEdit.indexOf('editingEntry.value = null')
  assert.ok(apiWrite >= 0 && editClear > apiWrite, 'dismiss modal only after successful API update')
  assert.match(saveEdit, /catch \(err\) \{ flash\('更新に失敗しました：' \+ err\.message\) \}/)
})
