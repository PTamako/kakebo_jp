import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('monthly and yearly statistics reuse existing aggregate queries for all record counts', () => {
  const api = source('functions/api/[[path]].js')
  const statsHandler = api.slice(api.indexOf("if (a === 'stats' && m === 'GET')"))
  assert.equal((statsHandler.match(/COUNT\(\*\) recordCount FROM entries WHERE date>=\?1 AND date<\?2/g) || []).length, 2)
  assert.equal((statsHandler.match(/recordCount: total\.recordCount/g) || []).length, 2)
  assert.equal((statsHandler.match(/SUM\(CASE WHEN type = 'expense' THEN 1 ELSE 0 END\) n/g) || []).length, 2)
  assert.equal((statsHandler.match(/SUM\(CASE WHEN type = 'transfer' THEN 1 ELSE 0 END\) transferCount/g) || []).length, 2)
})

test('monthly top card shows expense count then all period entries', () => {
  const ui = source('src/pages/StatisticsPage.vue')
  assert.match(ui, /\{\{ stats\?\.count \|\| 0 \}\}件の支出記録 · 全\{\{ stats\?\.recordCount \?\? 0 \}\}件/)
})

test('annual top card shows expense count then all period entries', () => {
  const ui = source('src/pages/StatisticsPage.vue')
  assert.match(ui, /\{\{ annualStats\?\.count \|\| 0 \}\}件の支出記録 · 全\{\{ annualStats\?\.recordCount \?\? 0 \}\}件/)
})

test('top cards keep unchanged expense totals, without extra D1 queries', () => {
  const ui = source('src/pages/StatisticsPage.vue')
  const api = source('functions/api/[[path]].js')
  assert.match(ui, /yen\(stats\?\.total\)/)
  assert.match(ui, /yen\(annualStats\?\.total\)/)
  // Both counts are returned by the original period-specific SELECT.
  assert.equal((api.match(/COUNT\(\*\) recordCount FROM entries WHERE date>=\?1 AND date<\?2/g) || []).length, 2)
})
