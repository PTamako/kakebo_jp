import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8')
const api = read('functions/api/[[path]].js')
const schema = read('schema.sql')

test('migrated production APIs never run schema DDL on any request', () => {
  assert.doesNotMatch(api, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i)
  assert.doesNotMatch(api, /\bALTER\s+TABLE\b|\bDROP\s+TABLE\b/i)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS device_sessions/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS recurring_plans/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS card_bills/)
})

test('investment GET is read only while a fresh schema has an empty SBI record', () => {
  const start = api.indexOf("if (a === 'investments')")
  const end = api.indexOf("if (a === 'stats'", start)
  assert.ok(start >= 0 && end > start)
  const investments = api.slice(start,end)
  assert.doesNotMatch(investments.slice(0,investments.indexOf("if (m === 'POST')")), /INSERT|UPDATE|DELETE|CREATE TABLE/)
  assert.match(schema, /INSERT OR IGNORE INTO investment_snapshots\(platform,current_value,pnl,updated_at\) VALUES\('sbi',NULL,NULL,NULL\)/)
})

test('expense picker does not include income categories based on display names alone', () => {
  const start = api.indexOf("if (a === 'categories')")
  const end = api.indexOf("if (a === 'custom-rules')",start)
  const categories = api.slice(start,end)
  assert.match(categories, /EXISTS\(SELECT 1 FROM rules WHERE keyword='__category__:'\|\|category_source\.category\)/)
  assert.doesNotMatch(categories.slice(0,categories.indexOf("if (m === 'POST')")), /OR display_name IS NOT NULL/)
})
