import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { countReceiptImages, clearAllReceiptImages } from '../src/receipt-store.js'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('device privacy belongs only to management Other; not a separate panel below the management page', () => {
  const app = source('src/App.vue')
  const management = source('src/FinanceTools.vue')
  assert.doesNotMatch(app, /class="panel device-security-settings"/)
  assert.match(app, /:remember-device="rememberDevice"/)
  assert.match(app, /@change-remember-device="setRememberDevice"/)
  assert.match(app, /@receipt-images-cleared="onReceiptImagesCleared"/)
  assert.match(app, /function onReceiptImagesCleared\(\)\s*\{[\s\S]*?closeReceipt\(\)[\s\S]*?receiptImageIds\.value = new Set\(\)/)
  assert.match(management, /<details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure device-privacy-panel">/)
  assert.match(management, /端末のプライバシー設定/)
  assert.match(management, /@change="emit\('change-remember-device',/)
})

test('image clearing is explicitly confirmed, local only, and synchronizes the visible receipt indicators', () => {
  const management = source('src/FinanceTools.vue')
  const store = source('src/receipt-store.js')
  assert.match(management, /await countReceiptImages\(\)/)
  assert.match(management, /if \(latest !== localReceiptCount\.value\)/)
  assert.match(management, /if \(!confirm\('レシート画像 /)
  assert.match(management, /await clearAllReceiptImages\(\)/)
  assert.match(management, /emit\('receipt-images-cleared'\)/)
  assert.doesNotMatch(management.slice(management.indexOf('async function clearLocalReceiptImages()'),management.indexOf('watch([() => props.active')), /props\.api\(/)
  assert.doesNotMatch(store, /const TTL = 30 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(store, /export async function clearAllReceiptImages\(\) \{\s*await operate\('readwrite', store => store\.clear\(\)\)/)
})

test('actual local IndexedDB adapter: count reads and clear removes images only', async () => {
  const original = globalThis.indexedDB
  const saved = new Map([[11,{entryId:11,blob:new Blob(['image'])}],[22,{entryId:22,blob:new Blob(['image'])}]])
  globalThis.indexedDB = {
    open() {
      const request = {}
      queueMicrotask(() => {
        request.result = {
          close() {},
          createObjectStore() { throw Error('unexpected schema mutation') },
          transaction() {
            const tx = {}
            tx.objectStore = () => ({
              count() {
                const r = {result:saved.size}
                queueMicrotask(() => tx.oncomplete?.())
                return r
              },
              clear() {
                saved.clear()
                const r = {result:undefined}
                queueMicrotask(() => tx.oncomplete?.())
                return r
              }
            })
            return tx
          }
        }
        request.onsuccess?.()
      })
      return request
    }
  }
  try {
    assert.equal(await countReceiptImages(), 2)
    assert.equal(saved.size, 2, 'checking count must not remove images')
    await clearAllReceiptImages()
    assert.equal(await countReceiptImages(), 0)
  } finally {
    if (original === undefined) delete globalThis.indexedDB
    else globalThis.indexedDB = original
  }
})
