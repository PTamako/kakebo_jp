import test from 'node:test'
import assert from 'node:assert/strict'
import { listR2ReceiptsByIds } from '../src/receipt-cloud.js'
import { handleR2Receipts } from '../functions/api/r2-receipts.js'

test('receipt metadata batches stay within the D1 100-bind limit', async () => {
  const previousFetch = globalThis.fetch
  const batches = []
  globalThis.fetch = async url => {
    const ids = new URL('https://example.test' + url).searchParams.get('ids')
      .split(',').map(Number)
    batches.push(ids)
    return new Response(JSON.stringify({
      ok: true,
      items: ids.slice(0, 1).map(id => ({ id, size: 123 }))
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const ids = Array.from({ length: 251 }, (_, i) => i + 1)
    const found = await listR2ReceiptsByIds(ids)
    assert.deepEqual(batches.map(batch => batch.length), [100, 100, 51])
    assert.deepEqual(found.map(item => item.entryId), [1, 101, 201])
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('receipt index API rejects requests that would exceed D1 bind limits', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => i + 1)
  let queried = false
  const db = { prepare() { queried = true; throw Error('should not query D1') } }
  const request = new Request('https://example.test/api/receipts?ids=' + ids.join(','))
  const response = await handleR2Receipts(request, { RECEIPTS_R2: {} }, db)
  assert.equal(response.status, 400)
  assert.equal(queried, false)
  assert.match((await response.json()).error, /最大100件/)
})

test('receipt index API accepts exactly 100 D1 bindings', async () => {
  const ids = Array.from({ length: 100 }, (_, i) => i + 1)
  let bindCount = 0
  const db = {
    prepare(sql) {
      assert.match(sql, /receipt_r2_state/)
      return {
        bind(...values) {
          bindCount = values.length
          return { all: async () => ({ results: [] }) }
        }
      }
    }
  }
  const request = new Request('https://example.test/api/receipts?ids=' + ids.join(','))
  const response = await handleR2Receipts(request, { RECEIPTS_R2: {} }, db)
  assert.equal(response.status, 200)
  assert.equal(bindCount, 100)
  assert.deepEqual((await response.json()).items, [])
})
