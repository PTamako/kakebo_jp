import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { onRequest } from '../functions/api/[[path]].js'
import { investedTotal } from '../functions/api/investment-transfer.js'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const session = 'a'.repeat(64)

class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec(schema)
    const hash = createHash('sha256').update(session).digest('hex')
    this.sqlite.prepare('INSERT INTO device_sessions(token_hash,expires_at) VALUES(?,?)')
      .run(hash,Date.now()+600000)
  }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql)
    return {
      args: [],
      bind(...args) { this.args = args; return this },
      async first() { return statement.get(...this.args) ?? null },
      async all() { return { results: statement.all(...this.args) } },
      async run() {
        const result = statement.run(...this.args)
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      }
    }
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return results
    } catch (err) {
      this.sqlite.exec('ROLLBACK')
      throw err
    }
  }
  rows() { return this.sqlite.prepare('SELECT * FROM entries ORDER BY id').all() }
  close() { this.sqlite.close() }
}

async function api(db, path, method = 'GET', payload, headers = {}) {
  const request = new Request('https://example.test/api/' + path, {
    method,
    headers: { 'x-session': session, 'content-type': 'application/json', ...headers },
    ...(['POST','PUT','DELETE'].includes(method) ? { body: JSON.stringify(payload ?? {}) } : {})
  })
  const response = await onRequest({
    request, env: { DB: db, AUTH_TOKEN: 'test-secret' },
    params: { path: path.split('/') }
  })
  return { status:response.status, body:await response.json() }
}

const reward = (effectiveDate, id='reward_sbi_test_01') => ({
  type:'income', date:'2026-11-10', time:'10:00', amount:18, category:'ポイント還元',
  merchant:'', note:'', raw:'', paymentSource:'', rewardDestination:'sbi',
  transferDate:effectiveDate, clientRequestId:id
})

test('SBI point reward requires a user-selected effective date and does not write on error', async () => {
  const db=new SqliteD1()
  try {
    const result=await api(db,'entries','POST',reward(''))
    assert.equal(result.status,400)
    assert.match(result.body.error,/適用日/)
    assert.equal(db.rows().length,0)
    const malformed=await api(db,'entries','POST',reward('2026-02-30'))
    assert.equal(malformed.status,400)
    assert.equal(db.rows().length,0)
  } finally { db.close() }
})

test('one point income creates exactly one linked future SBI transfer on its effective date', async () => {
  const db=new SqliteD1()
  try {
    const entry=reward('2099-01-12')
    const first=await api(db,'entries','POST',entry)
    assert.equal(first.status,200,JSON.stringify(first.body))
    const [income,transfer]=db.rows()
    assert.equal(income.type,'income')
    assert.equal(income.date,'2026-11-10')
    assert.equal(income.transfer_date,'2099-01-12')
    assert.equal(income.transfer_target,'sbi')
    assert.equal(transfer.type,'transfer')
    assert.equal(transfer.date,'2099-01-12')
    assert.equal(transfer.transfer_date,'2099-01-12')
    assert.equal(transfer.transfer_target,'sbi')
    assert.equal(transfer.transfer_applied,0)
    assert.equal(transfer.amount,18)
    assert.equal(transfer.payment_source,'ポイント還元')
    assert.equal(transfer.client_request_id,'point_charge_'+entry.clientRequestId)
    assert.equal(investedTotal(db.rows().map(r => ({...r,transferTarget:r.transfer_target,transferDate:r.transfer_date})), '2026-11-11'),0)

    const retry=await api(db,'entries','POST',entry)
    assert.equal(retry.status,200,JSON.stringify(retry.body))
    assert.equal(db.rows().length,2,'repeated requests must not double-count points or funding')
  } finally { db.close() }
})

test('editing the reward updates its linked SBI amount/date and changing destination removes the transfer', async () => {
  const db=new SqliteD1()
  try {
    const created=await api(db,'entries','POST',reward('2099-01-12','reward_sbi_edit_01'))
    assert.equal(created.status,200)
    const incomeId=created.body.id
    const changed=await api(db,'entries/'+incomeId,'PUT',{
      ...reward('2026-11-05','reward_sbi_edit_01'), amount:27, paymentSource:'ポイント還元'
    })
    assert.equal(changed.status,200,JSON.stringify(changed.body))
    const [income,transfer]=db.rows()
    assert.equal(income.amount,27)
    assert.equal(income.date,'2026-11-10')
    assert.equal(income.transfer_date,'2026-11-05')
    assert.equal(transfer.date,'2026-11-05')
    assert.equal(transfer.amount,27)
    assert.equal(transfer.transfer_applied,1)
    assert.equal(investedTotal(db.rows().map(r => ({...r,transferTarget:r.transfer_target,transferDate:r.transfer_date})), '2026-11-11'),27)

    const direct=await api(db,'entries/'+transfer.id,'PUT',{
      ...reward('2026-11-05'), type:'transfer',transferTarget:'sbi',amount:999
    })
    assert.equal(direct.status,409,'generated transfers cannot be edited independently')
    const cleared=await api(db,'entries/'+incomeId,'PUT',{
      ...reward('','reward_sbi_edit_01'),rewardDestination:'',paymentSource:'ポイント還元'
    })
    assert.equal(cleared.status,200,JSON.stringify(cleared.body))
    assert.equal(db.rows().length,1)
    assert.equal(db.rows()[0].transfer_target,null)
    assert.equal(db.rows()[0].transfer_date,null)
  } finally { db.close() }
})

test('trash and restore keep linked SBI transfers and their explicit purchase month together', async () => {
  const db=new SqliteD1()
  try {
    const created=await api(db,'entries','POST',reward('2099-01-12','reward_sbi_trash_01'))
    assert.equal(created.status,200)
    const [income,transfer]=db.rows()
    db.sqlite.prepare('INSERT INTO sbi_transfer_links(entry_id,purchase_month) VALUES(?,?)')
      .run(transfer.id,'2099-02')
    const removed=await api(db,'entries/'+income.id,'DELETE',{}, {'x-confirm-delete':String(income.id)})
    assert.equal(removed.status,200,JSON.stringify(removed.body))
    assert.equal(db.rows().length,0)
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM trash_items WHERE item_type=\'entry\'').get().n,2)
    const restored=await api(db,'trash-items/'+income.id+'/restore','POST')
    assert.equal(restored.status,200,JSON.stringify(restored.body))
    const rows=db.rows()
    assert.equal(rows.length,2)
    assert.equal(rows.find(r=>r.type==='transfer')?.transfer_date,'2099-01-12')
    const month=db.sqlite.prepare('SELECT purchase_month FROM sbi_transfer_links WHERE entry_id=?').get(transfer.id)
    assert.equal(month.purchase_month,'2099-02')
  } finally { db.close() }
})
