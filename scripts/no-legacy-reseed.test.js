import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('normal production API never runs completed legacy migrations or imports old rule tables',()=>{
 const api=read('functions/api/[[path]].js')
 assert.doesNotMatch(api,/ensureUnifiedMerchantRules|ensureCategorySource|FROM custom_rules|FROM merchant_payment_rules|FROM category_sort_order|FROM category_icons/)
 assert.doesNotMatch(api,/api-compat-v1|ALTER TABLE entries ADD COLUMN|ALTER TABLE payment_sources ADD COLUMN/)
 assert.doesNotMatch(api,/__kakeibo_japanese_rules_v9_initialized__|__kakeibo_d1_category_rules_v10__/)
 assert.doesNotMatch(api,/INSERT OR IGNORE INTO rules\s*\(keyword, category\) VALUES\s*\+ placeholders/)
 assert.doesNotMatch(api,/INSERT INTO category_source\(category,sort_order\) VALUES\('其他',99999\)/)
 assert.equal(existsSync(new URL('../functions/api/merchant-rules-store.js',import.meta.url)),false)
 assert.equal(existsSync(new URL('../functions/api/category-source-store.js',import.meta.url)),false)
})

test('category reads and rule listing preserve current D1 data without automatic writes',()=>{
 const api=read('functions/api/[[path]].js')
 const begin=api.indexOf("if (a === 'categories')")
 const end=api.indexOf("if (a === 'custom-rules')",begin)
 assert.ok(begin>=0&&end>begin)
 const categories=api.slice(begin,end)
 const get=categories.slice(0,categories.indexOf("if (m === 'POST')"))
 assert.match(get,/SELECT category FROM category_source WHERE category NOT IN/)
 assert.doesNotMatch(get,/INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE/)
 const r=api.indexOf("if (a === 'rules')")
 const ruleGet=api.slice(r,api.indexOf("if (m === 'POST')",r))
 assert.match(ruleGet,/SELECT keyword,category FROM rules ORDER BY keyword/)\n assert.match(ruleGet,/SELECT keyword,category FROM merchant_rules WHERE category IS NOT NULL ORDER BY keyword/)\n assert.match(ruleGet,/is_custom:false/)\n assert.match(ruleGet,/is_custom:true/)
 assert.doesNotMatch(ruleGet,/INSERT|UPDATE|DELETE|ALTER TABLE|CREATE TABLE/)
})

test('explicit user adds and backup restore continue to write intended new data',()=>{
 const api=read('functions/api/[[path]].js')
 const restore=read('functions/api/restore-atomic.js')
 assert.match(api,/INSERT INTO merchant_rules/)
 assert.match(api,/INSERT INTO category_source\(category,sort_order,icon,display_name\)/)
 assert.match(restore,/INSERT INTO merchant_rules/)
 assert.match(restore,/INSERT INTO category_source/)
 assert.doesNotMatch(restore,/FROM custom_rules|FROM merchant_payment_rules|FROM category_sort_order|FROM category_icons/)
})

test('completed card and SBI migrations can never be replayed by stale clients',()=>{
 const app=read('src/App.vue')
 const api=read('functions/api/[[path]].js')
 const portfolio=read('functions/api/investment-portfolio.js')
 const ui=read('src/SbiPortfolio.vue')
 const migration=read('migrations/0006_sbi_portfolio_linkage.sql')
 assert.doesNotMatch(app,/readLegacyPaymentSources|payment-sources\/initialize/)
 assert.doesNotMatch(ui,/investment-portfolio\/initialize|async function initialize\(/)
 assert.match(api,/if \(a === 'payment-sources' && b === 'initialize'\)/)
 assert.match(api,/旧カード設定の自動移行は終了しました/)
 assert.match(portfolio,/if\(sub==='initialize'\)return respond\(\{error:'旧SBI初期データの登録は終了しました'\},410\)/)
 assert.doesNotMatch(portfolio,/sbiInitialHoldings|const initialPlans|INSERT OR IGNORE INTO investment_plans/)
 assert.doesNotMatch(migration,/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(?:investment_plans|investment_plan_history|investment_holdings|fund_prices)\b/i)
})

test('default rules and user merchant_rules are only read, never seeded or copied',()=>{
 const api=read('functions/api/[[path]].js')
 const schema=read('schema.sql')
 assert.doesNotMatch(api,/DEFAULT_RULES|DEFAULT_RULE_ROWS|PARSER_DEFAULT_RULE_ROWS|LEGACY_DEFAULT_RULE_ROWS/)
 assert.match(api,/if \(a === 'rules'\)/)
 assert.match(api,/FROM merchant_rules r WHERE r.category IS NOT NULL/)
 assert.match(api,/is_custom:Boolean\(rule\.is_custom\)/)
 assert.doesNotMatch(schema,/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(?:rules|category_source|investment_plans|investment_holdings|fund_prices)\b/i)
 assert.doesNotMatch(api,/INSERT\s+OR\s+IGNORE\s+INTO\s+rules\(keyword,category\)/i)
})

test('historic SBI screenshot data and default merchant records never ship with production API',()=>{
 const portfolio=read('functions/api/investment-portfolio.js')
 const snapshotFixture=read('scripts/fixtures/sbi-initial-holdings.js')
 const ruleFixture=read('scripts/fixtures/default-rule-rows.js')
 assert.equal(existsSync(new URL('../functions/api/sbi-initial-holdings.js',import.meta.url)),false)
 assert.match(portfolio,/if\(sub==='initialize'\)return respond\(\{error:'旧SBI初期データの登録は終了しました'\},410\)/)
 assert.match(snapshotFixture,/sbiInitialHoldings/)
 assert.match(ruleFixture,/DEFAULT_RULE_ROWS/)
})
