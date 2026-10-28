import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizedDraftType, editedEntryMonth } from '../src/entry-type.js'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const form = readFileSync(new URL('../src/TransactionForm.vue', import.meta.url), 'utf8')

test('OCR drafts always receive an explicit type, preserving income and transfer', () => {
  for (const input of [undefined, null, '', 'unknown', 'expense']) assert.equal(normalizedDraftType(input), 'expense')
  assert.equal(normalizedDraftType('income'), 'income')
  assert.equal(normalizedDraftType('transfer'), 'transfer')
  assert.match(app, /normalizedDraftType\(f\.type\)/)
})

test('form type selection does not visually default when type is absent', () => {
  assert.match(form, /selected:record\.type===t\.id/)
  assert.doesNotMatch(form, /record\.type\s*\|\|\s*'expense'/)
})

test('editing into another month navigates to the edited month and keeps edited day', () => {
  assert.equal(editedEntryMonth('2026-09-22'), '2026-09')
  assert.equal(editedEntryMonth('2026-10-22'), '2026-10')
  assert.equal(editedEntryMonth('2026-13-22'), '')
  assert.match(app, /const destinationMonth = editedEntryMonth\(e\.date\)/)
  assert.match(app, /month\.value = destinationMonth/)
  assert.match(app, /preserveOperatedDay\.value = editedDay/)
  assert.match(app, /if \(!operatedDay \|\| days\.includes\(operatedDay\)\) preserveOperatedDay\.value = ''/)
})
