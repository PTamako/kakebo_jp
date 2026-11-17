import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
const billing=source.match(/<article v-show="managementTab === 'cards'" class="finance-panel card-billing-panel">[\s\S]*?<\/article>/)?.[0] || ''
const shared=readFileSync(new URL('../src/CardUsageSummaryFields.vue',import.meta.url),'utf8')
const backups=source.slice(source.lastIndexOf('<template #backup>'),source.lastIndexOf('<template #duplicates>'))
const privacy=source.slice(source.lastIndexOf('<template #privacy>'),source.lastIndexOf('<template #backup>'))
test('card billing on iPhone has identical shared inputs for both identities',()=>{
  assert.match(billing, /<CardUsageSummaryFields :card="bill\.name" :month="bill\.month"/)
  assert.match(billing, /@update:card="bill\.name=\$event" @update:month="bill\.month=\$event"/)
  assert.match(shared, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(shared, /\.card-usage-summary-card\{grid-column:1\/-1\}/)
  assert.match(shared, /class="card-usage-summary-field card-usage-summary-month"/)
  assert.match(shared, /class="card-usage-summary-field card-usage-summary-amount"/)
  assert.match(shared, /<output aria-live="polite">\{\{amount\}\}<\/output>/)
})
test('blank billing selections do not show redundant instructions or large disabled save action',()=>{
  assert.doesNotMatch(billing,/カードと締め月を選択してください/)
  assert.match(billing,/<div v-if="bill\.name" class="card-billing-actions">/)
  assert.match(billing,/class="card-billing-save"/)
  assert.match(billing,/class="card-billing-detail"/)
  assert.match(billing,/class="card-billing-period"/)
  assert.doesNotMatch(billing,/<strong>\{\{yen\(cardTotal\)\}\}<\/strong>/)
})
test('image ZIP save is beside ledger JSON backup; original shared privacy controls retain deletion',()=>{
  const shared=readFileSync(new URL('../src/OriginalOtherManagement.vue',import.meta.url),'utf8')
  assert.match(shared,/<summary>バックアップ・復元<\/summary>/)
  assert.match(shared,/<summary>端末のプライバシー設定<\/summary>/)
  assert.match(backups,/全画像を分割ZIP保存/)
  assert.match(backups,/@click="downloadReceiptImages"/)
  assert.match(backups,/@click="downloadBackup"/)
  assert.match(privacy,/@click="clearLocalReceiptImages"/)
  assert.doesNotMatch(privacy,/@click="downloadReceiptImages"/)
  assert.match(source,/await listReceiptImagesForExport\(\)/)
  assert.match(source,/document\.body\.appendChild\(a\)/)
})
