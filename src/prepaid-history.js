import { prepaidTarget } from './prepaid-card.js'

// Show only posted ledger movements that participate in this wallet's balance.
// The opening anchor prevents pre-registration historical entries from appearing
// as charges even if those old transactions remain in the immutable ledger.
export function matchesPrepaidHistoryEntry(entry, filter, today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)) {
  if (!filter) return true
  if (!filter.card || !['charge','usage'].includes(filter.kind)) return false
  const idCutoff=Number(filter.openingEntryId||0)
  const opened=String(filter.openingDate||'')
  // A scheduled transfer booked before a restore/rebase may become effective
  // after the new opening date. Use its effective date for the anchor boundary.
  const effective=entry?.type==='transfer' ? (entry.transfer_date||entry.date) : entry?.date
  if (!entry?.date || entry.date>today ||
      (entry.date<opened && effective<opened) || Number(entry.id)<=idCutoff) return false
  if (filter.kind === 'charge') {
    return entry.type==='transfer' && entry.transfer_target===prepaidTarget(filter.card) && entry.payment_source!==filter.card &&
      (entry.transfer_date||entry.date)<=today
  }
  return (entry.type==='expense' && entry.payment_source===filter.card) ||
    (entry.type==='transfer' && entry.payment_source===filter.card &&
      entry.transfer_target!==prepaidTarget(filter.card) && (entry.transfer_date||entry.date)<=today)
}
