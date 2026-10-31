// Entries and totals are independently fetched; never present a mixed snapshot.
export function monthLedgerMatchesStats(entries, stats) {
  if (!Array.isArray(entries) || !stats || typeof stats !== 'object') return false
  const sum=type=>entries.reduce((n,row)=>n+(row.type===type?Number(row.amount||0):0),0)
  const count=type=>entries.filter(row=>row.type===type).length
  return [['expense','total','count'],['income','income',null],['transfer','transferTotal','transferCount']]
    .every(([type,totalField,countField])=>Number(stats[totalField])===sum(type) &&
      (!countField || Number(stats[countField]||0)===count(type)))
}
