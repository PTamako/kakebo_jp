import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, existsSync} from 'node:fs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('category metadata is served from D1 while reusable SVG rendering stays frontend-only',()=>{
  const app=read('src/App.vue')
  const api=read('functions/api/[[path]].js')
  const store=read('functions/api/category-source-store.js')
  const icons=read('src/icon-library.js')
  assert.match(api,/if \(a === 'category-source' && m === 'GET'\)/)
  assert.match(api,/SELECT category,sort_order,icon,display_name FROM category_source/)
  assert.match(store,/category-presentation-v1/)
  assert.match(store,/ALTER TABLE category_source ADD COLUMN display_name TEXT/)
  assert.match(store,/display_name=COALESCE\(category_source.display_name,excluded.display_name\)/)
  assert.match(store,/icon=COALESCE\(category_source.icon,excluded.icon\)/)
  assert.match(app,/await api\('category-source'\)/)
  assert.match(app,/categoryDisplayNames.value\[name\] \|\| name/)
  assert.doesNotMatch(app,/CATEGORY_LABELS|CATEGORY_ICON_PATHS/)
  assert.doesNotMatch(icons,/CATEGORY_LABELS|CATEGORY_ICON_PATHS/)
  assert.equal(existsSync(new URL('../src/category-ui.js',import.meta.url)),false)
})
test('category icon artwork remains available without storing raw SVG path strings as category rows',()=>{
  const icons=read('src/icon-library.js')
  const server=read('functions/api/category-source-store.js')
  const schema=read('schema.sql')
  for(const id of ['dining','food','transport','entertainment','salary','bonus','sidejob','family-gift','refund','transfer','other']){
    assert.match(icons,new RegExp('id:[\\x27\\x22]'+id+'[\\x27\\x22]'),id)
    assert.match(server,new RegExp('[\\x27\\x22]'+id+'[\\x27\\x22]'),id)
  }
  assert.match(schema,/display_name TEXT/)
  assert.doesNotMatch(schema,/icon_path TEXT|svg_path TEXT/)
})
