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

test('missing portfolio tables fail closed without deleting historical SBI values or reintroducing old UI',()=>{
  assert.match(portfolio,/portfolio_migration_required/)
  assert.match(portfolio,/no such table:/)
  assert.match(api,/if \(a === 'investment-portfolio'\)/)
  assert.match(api,/if \(a === 'investments'\)/)
  assert.match(ui,/<SbiPortfolio :api="api" :transfer-loading="transferLoading" \\/>/)
  assert.doesNotMatch(ui,/旧評価額|旧評価損益|legacy-investment-details|investment-card/)
  assert.match(component,/投資テーブルの移行が未実施/)
  assert.match(api,/SELECT platform, current_value, pnl, updated_at/)
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
