// Receipt images are private to this PWA installation. No server upload.
const DB_NAME = 'kakeibo-receipt-images'
const STORE = 'receipts'
const TTL = 30 * 24 * 60 * 60 * 1000
const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'entryId' })
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
async function operate(mode, callback) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      let result
      try { result = callback(tx.objectStore(STORE)) } catch (error) { reject(error); return }
      tx.oncomplete = () => resolve(result?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}
export async function saveReceiptImage(entryId, blob) {
  if (!Number.isSafeInteger(entryId) || entryId <= 0 || blob?.type !== 'image/webp' || blob.size > 200 * 1024) throw new Error('画像を保存できません')
  await operate('readwrite', store => store.put({ entryId, blob, expiresAt: Date.now() + TTL }))
}
export async function getReceiptImage(entryId) {
  const row = await operate('readonly', store => store.get(Number(entryId)))
  if (!row) return null
  if (row.expiresAt <= Date.now()) { await deleteReceiptImage(entryId); return null }
  return row.blob
}
export async function deleteReceiptImage(entryId) {
  await operate('readwrite', store => store.delete(Number(entryId)))
}
export async function cleanupReceiptImages() {
  const db = await openDb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const cursor = tx.objectStore(STORE).openCursor()
      cursor.onsuccess = () => {
        const row = cursor.result
        if (row) { if (row.value.expiresAt <= Date.now()) row.delete(); row.continue() }
      }
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}
