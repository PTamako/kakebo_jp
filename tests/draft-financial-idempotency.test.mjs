import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { persistFinancialDraftBeforePost } from '../src/draft-submit.js'

const draft = (id = '2d87e0dd-ccde-4a9b-932a-19ddcbe69f98') => ({
  updatedAt: Date.now(), mode: 'manual', input: 'shop 100',
  forms: [{ merchant: 'shop', amount: 100, clientRequestId: id }]
})

test('financial submission persists the same retry key before the server write', async () => {
  const order = []
  const snapshot = draft()
  const returned = await persistFinancialDraftBeforePost({
    hydrated: true, snapshot,
    persist: async saved => {
      order.push('device')
      assert.equal(saved.forms[0].clientRequestId, snapshot.forms[0].clientRequestId)
    }
  })
  order.push('network')
  assert.deepEqual(order, ['device','network'])
  assert.equal(returned, snapshot)
})

test('missing/empty idempotency key rejects financial writes', async () => {
  let calls = 0
  for(const missing of ['', null]){
    await assert.rejects(() => persistFinancialDraftBeforePost({
      hydrated: true, snapshot: draft(missing), persist: async()=>{ calls++ }
    }), /再送防止ID/)
  }
  assert.equal(calls, 0)
})

test('financial writes cannot run before local draft is hydrated', async () => {
  let writes = 0
  await assert.rejects(() => persistFinancialDraftBeforePost({
    hydrated: false, snapshot: draft(), persist: async()=>{ writes++ }
  }), /下書き/)
  assert.equal(writes, 0)
})

test('IndexedDB failure stops submission with an actionable message', async () => {
  await assert.rejects(() => persistFinancialDraftBeforePost({
    hydrated: true, snapshot: draft(),
    persist: async() => {throw Error('QuotaExceededError')}
  }), /記帳を中止しました：QuotaExceededError/)
})

test('owner save and edit paths keep durable-first and saved-vs-refresh semantics', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  const save = app.slice(app.indexOf('async function saveAll()'),app.indexOf('const ledgerRevision = ref(0)'))
  const durable = save.indexOf('await persistFinancialDraftBeforePost(')
  const post = save.indexOf("await api('entries', { method: 'POST'")
  assert.ok(durable >= 0 && post > durable)
  assert.match(save, /if \(!f\.clientRequestId\) f\.clientRequestId = crypto\.randomUUID\(\)/)
  const edit = app.slice(app.indexOf('async function saveEdit()'),app.indexOf('const pendingTransfers = ref('))
  assert.match(edit, /let entryCommitted=false/)
  assert.match(edit, /entryCommitted=true[\s\S]*await load\(\)/)
  assert.match(edit, /entryCommitted\s*\? '記録の変更は保存済みです/)
})
