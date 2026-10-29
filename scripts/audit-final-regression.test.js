import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateBackup } from '../src/finance-tools.js'

const api = readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
const restore = readFileSync(new URL('../functions/api/restore-atomic.js',import.meta.url),'utf8')
const app = readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const finance = readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
const base = {format:'kakeibo-ledger-backup',version:3,entries:[]}

test('old backups remain accepted without categoryMetadata',()=>{
  assert.deepEqual(validateBackup({...base}),base)
})
test('categoryMetadata preserves Japanese labels, icon and sort and rejects invalid data',()=>{
  const meta=[{category:'勉強会',display_name:'勉強会',icon:'education',sort_order:9}]
  assert.equal(validateBackup({...base,categoryMetadata:meta}).categoryMetadata[0].display_name,'勉強会')
  assert.throws(()=>validateBackup({...base,categoryMetadata:[{category:'bad',sort_order:-1}]}))
  assert.throws(()=>validateBackup({...base,categoryMetadata:[{category:'bad',icon:'<script>'}]}))
})
test('snapshot and both backup paths carry categoryMetadata',()=>{
  assert.match(api,/SELECT category,sort_order,icon,display_name FROM category_source ORDER BY category/)
  assert.match(api,/categoryMetadata:rows\(8\)/)
  assert.match(finance,/props\.api\('category-source'\)/)
  assert.match(finance,/categoryMetadata:first\?backup\.categoryMetadata:\[\]/)
  assert.match(restore,/for \(const row of archive\.categoryMetadata\|\|\[\]\)/)
  assert.match(restore,/display_name=COALESCE\(category_source\.display_name,excluded\.display_name\)/)
})
test('calendar badges use filtered calendar entries',()=>{
  assert.match(app,/for \(const entry of calendarEntries\.value\) \{\s*const key=String\(entry\.date/)
})
test('duplicate candidates take time into account',()=>{
  assert.match(api,/COALESCE\(time,''\)=COALESCE\(\?2,''\) AND amount=\?3/)
})
