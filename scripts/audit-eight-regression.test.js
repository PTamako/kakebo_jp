import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DEFAULT_RULE_ROWS, onRequest} from '../functions/api/[[path]].js'
import {classify} from '../src/parse.js'
import {restoreAtomic} from '../functions/api/restore-atomic.js'

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('legacy built-in categories are not loaded into the runtime defaults',()=>{
  const api=read('functions/api/[[path]].js')
  assert.match(api,/const merged = new Map\(DEFAULT_RULE_ROWS\.map/)
  assert.doesNotMatch(api,/const merged = new Map\(\(baseResult\.results/)
  const rules=DEFAULT_RULE_ROWS.map(([keyword,category])=>({keyword,category,is_custom:false}))
  assert.equal(classify('スーパーABC',rules).category,'饮食料品')
  assert.equal(classify('コジマ',rules).category,'购物')
  assert.equal(classify('ペットのコジマ',rules).category,'宠物')
  assert.equal(classify('コジマ×ビックカメラ',rules).category,'购物')
  assert.ok(DEFAULT_RULE_ROWS.some(([k,v])=>k==='UNIQLO'&&v==='购物'))
})

test('stable cursor listing avoids mutable OFFSET paging on browser reads',()=>{
  const source=read('src/App.vue')
  assert.match(source,/entries\?month=' \+ targetMonth \+ '&cursor=/)
  assert.match(source,/entries\?year=' \+ year \+ '&cursor=/)
  assert.doesNotMatch(source,/entries\?month=' \+ targetMonth \+ '&offset=/)
  assert.match(source,/duplicatePolicy:'check'/)
  assert.match(read('functions/api/[[path]].js'),/WHERE NOT EXISTS \(SELECT 1 FROM entries WHERE date=\?1/)
})

test('restore is atomic for bounded archives and never deletes real records',()=>{
  const ui=read('src/FinanceTools.vue'),api=read('functions/api/restore-atomic.js')
  assert.match(ui,/props\.api\('restore-atomic'/)
  assert.match(api,/await db\.batch\(statements\)/)
  assert.match(api,/current_value IS NULL AND pnl IS NULL/)
  assert.match(api,/INSERT INTO category_source\(category,icon\)/)
  assert.match(api,/category_source\.icon IS NULL/)
  assert.doesNotMatch(api,/DELETE FROM entries|DROP TABLE|REPLACE INTO entries/)
  assert.match(ui,/const BATCH_SIZE=150/)
  assert.match(ui,/settingTotal<=500/)
})

test('preview requires separate DB identity and automatic build requires production security audit',()=>{
  const source=read('functions/api/[[path]].js')
  assert.match(source,/PREVIEW_D1_ID/)
  assert.match(source,/PRODUCTION_D1_ID/)
  assert.match(source,/preview_db_not_verified/)
  const scripts=JSON.parse(read('package.json')).scripts
  assert.match(scripts.build,/npm run test:parse/)
  assert.match(scripts.build,/npm run security:audit:prod/)
  assert.match(scripts.build,/vite build/)
  assert.match(read('migrations/0002_versioned_migration_tracking.sql'),/schema_migrations/)
})

test('legacy backup version is not rewritten and user financial settings are not overwritten',()=>{
  const source=read('functions/api/restore-atomic.js')
  for(const table of ['card_bills','payment_sources','recurring_plans'])
    assert.match(source,new RegExp('INSERT OR IGNORE INTO '+table))
  assert.match(source,/INSERT INTO merchant_rules\(keyword,category\)/)
  assert.match(source,/INSERT INTO merchant_rules\(keyword,payment_source\)/)
  assert.match(source,/COALESCE\(merchant_rules\.category,excluded\.category\)/)
  assert.match(source,/COALESCE\(merchant_rules\.payment_source,excluded\.payment_source\)/)
  assert.match(source,/updated_at=\?3 WHERE platform='sbi' AND current_value IS NULL/)
})
