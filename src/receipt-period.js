// Plan a local-only receipt cleanup against dated D1 records.
// Images contain an entry ID, not a date; unknown/colliding IDs are never deleted.
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/
const safeId = value => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
const validDate = value => typeof value === 'string' && ISO_DATE.test(value) ? value : null

export function planReceiptPeriodDeletion(images, entries, trashedItems, year, month = '') {
  if (!Array.isArray(images) || !Array.isArray(entries) || !Array.isArray(trashedItems))
    throw Error('レシートの削除対象を確認できません')
  if (!/^\d{4}$/.test(String(year)) || (month !== '' && !/^(0[1-9]|1[0-2])$/.test(String(month))))
    throw Error('対象期間を確認してください')

  const dated = new Map(), conflicting = new Set()
  function addEntry(entry) {
    const id = safeId(entry?.id), date = validDate(entry?.date)
    if (!id || !date) return
    if (dated.has(id) && dated.get(id) !== date) conflicting.add(id)
    else dated.set(id, date)
  }
  for (const entry of entries) addEntry(entry)
  for (const item of trashedItems) {
    try {
      const entry = JSON.parse(item?.payload_json)?.entry
      if (safeId(entry?.id) !== safeId(item?.item_id) || !safeId(entry?.id)) continue
      addEntry(entry)
    } catch { /* Malformed trash records must never authorize image deletion. */ }
  }
  const ids = [], seen = new Set()
  let bytes = 0, unmatched = 0, unknownSizes = 0
  for (const image of images) {
    const id = safeId(image?.entryId)
    if (!id || seen.has(id) || conflicting.has(id) || !dated.has(id)) {
      unmatched++
      continue
    }
    seen.add(id)
    const date = dated.get(id)
    if (date.slice(0, 4) !== String(year) || (month && date.slice(5, 7) !== month)) continue
    ids.push(id)
    const size=image?.size ?? image?.blob?.size
    if(size == null) unknownSizes++
    else bytes += Number(size) || 0
  }
  ids.sort((a, b) => a - b)
  return {ids, bytes, unmatched, unknownSizes, total: images.length}
}
