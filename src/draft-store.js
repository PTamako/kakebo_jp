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
