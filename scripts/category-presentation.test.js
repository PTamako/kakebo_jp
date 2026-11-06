import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
test('category presentation reads already-migrated D1 without auto-seeding or importing old tables',()=>{
  const app=read('src/App.vue')
  const api=read('functions/api/[[path]].js')
  const icons=read('src/icon-library.js')
  assert.match(api,/if \(a === 'category-source' && m === 'GET'\)/)
  assert.match(api,/SELECT category,sort_order,icon,display_name,entry_type,is_default FROM category_source/)
  assert.match(app,/await api\('category-source'\)/)
  assert.match(app,/categoryDisplayNames\.value\[name\] \|\| name/)
  assert.doesNotMatch(app,/legacyCategoryLabels|const INCOME_CATEGORIES = sortOtherLast\(\[/)
  assert.match(app,/INCOME_CATEGORIES\.value = sortOtherLast\(rows\.filter/)
  assert.doesNotMatch(app,/CATEGORY_LABELS|CATEGORY_ICON_PATHS/)
  assert.doesNotMatch(icons,/CATEGORY_LABELS|CATEGORY_ICON_PATHS/)
  assert.doesNotMatch(api,/ensureCategorySource|ensureUnifiedMerchantRules|category-presentation-v1|ALTER TABLE category_source ADD COLUMN/)
  assert.equal(existsSync(new URL('../src/category-ui.js',import.meta.url)),false)
  assert.equal(existsSync(new URL('../functions/api/category-source-store.js',import.meta.url)),false)
  assert.equal(existsSync(new URL('../functions/api/merchant-rules-store.js',import.meta.url)),false)
})
test('SVG artwork remains a static drawing library, not old category backfill logic',()=>{
  const icons=read('src/icon-library.js')
  const schema=read('schema.sql')
  for(const id of ['dining','food','transport','entertainment','salary','bonus','sidejob','family-gift','refund','transfer','other']){
    assert.match(icons,new RegExp('id:[\\x27\\x22]'+id+'[\\x27\\x22]'),id)
  }
  assert.match(schema,/display_name TEXT/)
  assert.doesNotMatch(schema,/icon_path TEXT|svg_path TEXT/)
})
