// Signed document-assistant ledger entries receive a deterministic internal ID.
// Identify origin from this ID, not from merchant, which must remain unmodified
// so store rules, grouping, searches and edits keep working.
export const isExternalLedgerEntry = entry =>
  /^jda_[a-f0-9]{60}$/.test(String(entry?.client_request_id || ''))
