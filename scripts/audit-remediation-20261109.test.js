import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
test('the backup chooser accepts complete ZIP and JSON without routing photos to D1',()=>{
  const ui=source('src/FinanceTools.vue')
  assert.match(ui,/accept="\.json,\.zip,\.kbe,application\/json,application\/zip,application\/octet-stream"/)
  assert.match(ui,/decryptBackupBlob\(file,backupPassword\.value\)/)
  assert.match(ui,/readCompleteBackupZip\(selectedFile\)/)
  assert.match(ui,/verifyBackupIntegrity\(backup\)/)
  assert.match(ui,/planReceiptRestoration\(backup\.entries,images,rows\.value,preparedRows\)/)
  assert.match(ui,/if\(cloudIds\.has\(item\.id\) \|\| await getReceiptImage\(item\.id\)\)/)
  assert.match(ui,/await uploadR2Receipt\(item\.id,item\.blob\)/)
  assert.match(ui,/未復元/)
})
test('NAV non-trading days are recorded and status UI shows absent jobs',()=>{
  const cron=source('workers/fund-nav-cron.js')
  const ui=source('src/FinanceTools.vue')
  assert.match(cron,/heartbeat\('nav','skipped',\{skipped:1\}\)/)
  assert.match(ui,/status:'missing'/)
  assert.match(ui,/実行記録なし/)
})
test('mobile browser checks are required for API changes',()=>{
  const yaml=source('.github/workflows/mobile-e2e.yml')
  assert.match(yaml,/functions\/api\/\*\*/)
})
