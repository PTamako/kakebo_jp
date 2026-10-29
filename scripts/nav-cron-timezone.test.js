import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('NAV Cron is exactly 20:30 JST (11:30 UTC) every day', () => {
  const config = read('wrangler.nav.toml')
  const docs = read('scripts/deploy-nav-worker.md')
  const match = config.match(/^crons\s*=\s*\["(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*"\]/m)
  assert.ok(match, 'expected one daily cron at UTC time')
  const [, minutes, utcHour] = match
  assert.equal(Number(minutes), 30)
  assert.equal(Number(utcHour), 11)
  assert.equal((Number(utcHour) + 9) % 24, 20)
  assert.match(docs, /日本時間20:30（UTC11:30）/)
  assert.doesNotMatch(config, /30 21 \* \* \*/)
})

test('NAV job reuses D1 prices and never creates a fresh database or changes transactions', () => {
  const config = read('wrangler.nav.toml')
  const worker = read('workers/fund-nav-cron.js')
  assert.match(config, /name = "kakeibo-nav-sync"/)
  assert.match(config, /database_name = "kakeibo"/)
  assert.match(worker, /syncFundNav\(env\.DB\)/)
  assert.doesNotMatch(worker, /DELETE\s+FROM|DROP\s+TABLE|investment_holdings\s+SET/i)
})
