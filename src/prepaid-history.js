import { prepaidTarget } from './prepaid-card.js'

// A calendar-month history also shows older monthly activity before the opening anchor.
// Match unsourced legacy rewards to a real same-day, same-amount wallet debit.
export function matchedUnassignedPointIncomeIds(entries, wallet='ポイント還元') {
  const latestByDayAndAmount=new Map()
  const matched=new Set()
  for(const entry of [...entries].sort((a,b)=>Number(a.id)-Number(b.id))) {
    const key=entry.date+'|'+Number(entry.amount)
    if(entry.type==='income' && entry.category==='ポイント還元' &&
       !entry.payment_source && !entry.transfer_target) latestByDayAndAmount.set(key,Number(entry.id))
    if(entry.type==='transfer' && entry.payment_source===wallet) {
      const id=latestByDayAndAmount.get(key)
      if(id) matched.add(id)
    }
  }
  return matched
}

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
  if (!entry?.date || entry.date>today) return false
  // The selected calendar month shows every transaction in that month.
  // Older months keep the anchored balance-history rule when not selected.
  const isSelectedMonth = filter.reportingMonth && entry.date.slice(0,7)===filter.reportingMonth
  if (!isSelectedMonth && ((entry.date<opened && effective<opened) || Number(entry.id)<=idCutoff)) return false
  if (filter.kind === 'charge') {
    return (entry.type==='transfer' && entry.transfer_target===prepaidTarget(filter.card) && entry.payment_source!==filter.card &&
      (entry.transfer_date||entry.date)<=today) ||
      (entry.type==='income' && entry.category==='ポイント還元' &&
        (entry.payment_source===filter.card ||
         (filter.card==='ポイント還元' && !entry.payment_source && !entry.transfer_target &&
           (!filter.matchedUnassignedPointIncomeIds || filter.matchedUnassignedPointIncomeIds.has(Number(entry.id))))))
  }
  return (entry.type==='expense' && entry.payment_source===filter.card) ||
    (entry.type==='transfer' && entry.payment_source===filter.card &&
      entry.transfer_target!==prepaidTarget(filter.card) && (entry.transfer_date||entry.date)<=today)
}
