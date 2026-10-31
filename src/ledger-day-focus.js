// Show all preceding transactions needed to make a previously edited day
// reachable in the monthly "すべて" list (without applying a day filter).
export function countThroughEditedDay(entries = [], day = '', pageSize = 20) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Array.isArray(entries)) return 0
  let lastIndex = -1
  for (let i = 0; i < entries.length; i++) {
    if (String(entries[i]?.date || '').slice(0, 10) === day) lastIndex = i
  }
  return lastIndex < 0 ? 0 : Math.max(pageSize, lastIndex + 1)
}
