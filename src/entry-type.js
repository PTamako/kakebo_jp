// Keep all entry drafts explicitly typed before rendering conditional fields.
export function normalizedDraftType(type) {
  return type === 'income' || type === 'transfer' ? type : 'expense'
}

// Editing a transaction into a different month must navigate to its new location.
export function editedEntryMonth(date) {
  return /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(String(date || '')) ? date.slice(0, 7) : ''
}
