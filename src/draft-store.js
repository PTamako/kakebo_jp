// Drafts are device-local first. The D1 cloud copy is a periodic backup only.
// Keep this database separate from receipt photos; clearing photos must not erase drafts.
const DB_NAME = 'kakeibo-drafts'
const STORE_NAME = 'current'
const RECORD_KEY = 'unsaved_draft'

function openDraftDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || Error('IndexedDBを開けません'))
    request.onblocked = () => reject(Error('下書き用データベースが使用中です'))
  })
}

async function transaction(mode, action) {
  const db = await openDraftDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode)
      const request = action(tx.objectStore(STORE_NAME))
      let value
      request.onsuccess = () => { value = request.result }
      request.onerror = () => reject(request.error || Error('下書きを保存できません'))
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => reject(tx.error || Error('下書きを保存できません'))
      tx.onabort = () => reject(tx.error || Error('下書きの保存が中断されました'))
    })
  } finally {
    db.close()
  }
}

export function readDeviceDraft() {
  return transaction('readonly', store => store.get(RECORD_KEY))
}

export function writeDeviceDraft(snapshot) {
  // A tombstone prevents an older cloud copy from reviving a cleared draft.
  return transaction('readwrite', store => store.put(snapshot, RECORD_KEY))
}


// Member drafts and retry receipts live in the SAME existing IndexedDB store,
// but use a key scoped to the verified HomeFlow household and user. Never
// read the owner's 'unsaved_draft' key or another member's state.
export function memberDraftStorageKey(userId, householdId, slot='draft') {
  const valid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x)
  if(!valid(userId)||!valid(householdId)||!['draft','shared-inline','shared-editor'].includes(slot))
    throw Error('下書きの本人確認に失敗しました')
  return 'member-v1:'+householdId+':'+userId+':'+slot
}
export function readMemberDeviceState(userId, householdId, slot='draft') {
  const key=memberDraftStorageKey(userId,householdId,slot)
  return transaction('readonly',store=>store.get(key))
}
export function writeMemberDeviceState(userId, householdId, snapshot, slot='draft') {
  const key=memberDraftStorageKey(userId,householdId,slot)
  return transaction('readwrite',store=>store.put(snapshot,key))
}
export function clearMemberDeviceState(userId, householdId, slot='draft') {
  const key=memberDraftStorageKey(userId,householdId,slot)
  return transaction('readwrite',store=>store.delete(key))
}
