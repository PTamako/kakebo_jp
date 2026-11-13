import test from 'node:test'
import assert from 'node:assert/strict'
import { isExternalLedgerEntry } from '../src/ledger-origin.js'

test('signed document-assistant ledger entries get an external display marker', () => {
  assert.equal(isExternalLedgerEntry({ merchant:'セブン-イレブン', client_request_id:'jda_'+'a'.repeat(60) }), true)
  assert.equal(isExternalLedgerEntry({ merchant:'はじめてのお店', client_request_id:'jda_'+'f'.repeat(60) }), true)
  assert.equal(isExternalLedgerEntry({ merchant:'セブン-イレブン', client_request_id:'manual-abc' }), false)
  assert.equal(isExternalLedgerEntry({ merchant:'セブン-イレブン • 外部', client_request_id:null }), false)
  assert.equal(isExternalLedgerEntry({ merchant:'セブン-イレブン', client_request_id:'jda_'+'a'.repeat(59) }), false)
  assert.equal(isExternalLedgerEntry(null), false)
})
