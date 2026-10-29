import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const api=read('functions/api/[[path]].js')
const portfolio=read('functions/api/investment-portfolio.js')
const ui=read('src/pages/AssetsPage.vue')
const component=read('src/SbiPortfolio.vue')
const schema=read('schema.sql')
const migration=read('migrations/0006_sbi_portfolio_linkage.sql')

test('merging before D1 migration fails closed ONLY for portfolio API and retains legacy investment editing',()=>{
  assert.match(portfolio,/portfolio_migration_required/)
  assert.match(portfolio,/no such table:/)
  assert.match(api,/if \(a === 'investment-portfolio'\)/)
  assert.match(api,/if \(a === 'investments'\)/)
  assert.match(ui,/@migration-status="migrationPending = \$event"/)
  assert.match(ui,/:open="migrationPending"/)
  assert.match(ui,/v-if="migrationPending" class="legacy-edit-controls"/)
  assert.match(ui,/@click="saveInvestment\(item\)"/)
  assert.match(component,/emit\('migration-status', \/投資テーブルの移行が未実施\/\.test\(e\.message\)\)/)
  assert.match(api,/portfolioReady \? 4 : 3/)
})

test('0006 migration is additive and never edits/deletes an existing transaction or old valuation',()=>{
  assert.doesNotMatch(migration,/\b(?:DELETE|UPDATE|DROP|REPLACE)\s+(?:FROM\s+)?(?:entries|investment_snapshots)\b/i)
  assert.match(migration,/CREATE TABLE IF NOT EXISTS investment_holdings/)
  assert.match(migration,/INSERT OR IGNORE INTO investment_plan_history/)
  assert.match(migration,/WHERE NOT EXISTS\(SELECT 1 FROM investment_holdings WHERE fund_code=/)
  assert.match(schema,/CREATE TABLE IF NOT EXISTS investment_plan_history/)
  assert.match(component,/毎月の振替は買付予定と照合/)
})
