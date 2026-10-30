import { prepaidTarget } from './prepaid-card.js'

// Filter one selected prepaid card, not all registered stored-value cards.
// The monthly ledger already bounds entries by the chosen month.
export function matchesPrepaidHistoryEntry(entry, filter) {
  if (!filter) return true
  if (!filter.card || !['charge', 'usage'].includes(filter.kind)) return false
  if (filter.kind === 'charge') {
    return entry.type === 'transfer' && entry.transfer_target === prepaidTarget(filter.card)
  }
  return entry.type === 'expense' && entry.payment_source === filter.card
}
