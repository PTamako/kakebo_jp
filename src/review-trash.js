// The trash removes reviewed notices, not ledger rows or D1 recurring exclusions.
// The latter MUST remain effective after clearing this list.
const KEY = 'kakeibo-reviewed-trash-v1'
const validKey = value => typeof value === 'string' &&
  (/^d:v1:[0-9a-f]{16}$/.test(value) ||
   /^r:[A-Za-z0-9_-]{1,80}:\d{4}-(0[1-9]|1[0-2])$/.test(value) ||
   /^t:[1-9]\d{0,14}$/.test(value))

export const duplicateTrashKey = signature =>
  /^v1:[0-9a-f]{16}$/.test(String(signature || '')) ? 'd:' + signature : ''

export const recurringTrashKey = row => {
  const id = String(row?.planId || ''), month = String(row?.month || '')
  return validKey('r:' + id + ':' + month) ? 'r:' + id + ':' + month : ''
}

export const transferTrashKey = row => {
  const id = Number(row?.id)
  return Number.isSafeInteger(id) && id > 0 ? 't:' + id : ''
}

export function readArchivedTrash(storage = null) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) || '[]')
    return new Set(Array.isArray(value) ? value.filter(validKey) : [])
  } catch { return new Set() }
}

export function saveArchivedTrash(keys, storage = null) {
  if (!storage) return false
  try {
    const safe = [...keys]
    if (safe.length > 5000 || safe.some(key => !validKey(key))) return false
    storage.setItem(KEY, JSON.stringify(safe))
    return true
  } catch { return false }
}

export const visibleReviewedTrash = (confirmedGroups, exclusions, transfers, archivedKeys, signatureOfGroup) => ({
  duplicateGroups: (confirmedGroups || []).filter(group => {
    const key = duplicateTrashKey(signatureOfGroup(group))
    return key && !archivedKeys.has(key)
  }),
  recurringExclusions: (exclusions || []).filter(item => {
    const key = recurringTrashKey(item)
    return key && !archivedKeys.has(key)
  }),
  transferReminders: (transfers || []).filter(item => {
    const key = transferTrashKey(item)
    return key && !archivedKeys.has(key)
  })
})
