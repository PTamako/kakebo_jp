import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseEntry, parseEntries } from '../src/parse.js'
import { DEFAULT_RULE_ROWS } from '../functions/api/[[path]].js'
import { sealBackup, verifyBackupIntegrity } from '../src/backup-integrity.js'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('exported JSON detects accidental tampering but legacy v1/v2/v3 archives remain readable', async () => {
  const backup = { format:'kakeibo-ledger-backup',version:3,
    entries:[{id:1,date:'2026-10-01',amount:1234,type:'expense',merchant:'スーパー',category:'饮食料品'}],
    plans:[],bills:[],paymentSources:[],customRules:[] }
  const sealed = await sealBackup(backup)
  assert.equal(await verifyBackupIntegrity(sealed),true)
  assert.equal(await verifyBackupIntegrity(backup),true)
  await assert.rejects(verifyBackupIntegrity({...sealed,entries:[{...sealed.entries[0],amount:1235}]}))
  for (const version of [1,2,3]) assert.equal(await verifyBackupIntegrity({...backup,version}),true)
  assert.equal(backup.integrity,undefined,'sealing does not mutate the input')
})

test('card statement regex uses actual whitespace/digits and can parse dated CSV and installments', () => {
  const src=source('src/parse.js')
  for (const fragment of ['const csvParts','const csvDate','const csvAmount','const match = line.match(/^((?:20)?']) {
    const target=src.split('\n').find(line=>line.includes(fragment))
    assert.ok(target,fragment)
    assert.ok(!target.includes('\\\\d') && !target.includes('\\\\s'),fragment)
  }
  const row = parseEntry('26.10.18, マクドナルド, ¥1,234, 1回払い',[])
  assert.equal(row.amount,1234)
  assert.equal(row.merchant,'マクドナルド')
  assert.equal(row.date,'2026-10-18')
  const many = parseEntries('26.10.18 マクドナルド 1,234円 1回払い\n26.10.19 サイゼリヤ 780円 1回払い',[])
  assert.deepEqual(many.map(x=>x.amount),[1234,780])
})

test('saving imported expenses checks all draft months against D1, never deletes valid duplicates', () => {
  const src=source('src/App.vue')
  assert.match(src,/months\.map\(fetchMonthEntries\)/)
  assert.match(src,/const historical = \(await Promise\.all\(months\.map\(fetchMonthEntries\)\)\)\.flat\(\)/)
  assert.match(src,/possibleDuplicates\.length && !confirm/)
  assert.match(src,/重複確認ができないため、保存を中止/)
  assert.match(src,/if \(!f\.clientRequestId\) f\.clientRequestId = crypto\.randomUUID\(\)/)
})

test('new database default categorization agrees with D1 runtime defaults',()=>{
  const schema=source('schema.sql')
  for(const kw of ['ローソン','セブン','ファミリーマート','イオン','スーパー']) {
    assert.match(schema,new RegExp('\\(' + "'" + kw + "','饮食料品'" + '\\)'))
  }
  const runtime = new Map(DEFAULT_RULE_ROWS)
  for (const kw of ['ローソン','セブン','ファミリーマート','イオン','スーパー']) assert.equal(runtime.get(kw),'饮食料品',kw)
  assert.match(schema,/payment_source TEXT NOT NULL DEFAULT ''/)
  assert.match(source('migrations/0001_support_tables.sql'),/CREATE TABLE IF NOT EXISTS/)
})

test('preview remains closed until verified and release audit fails on production High advisories',()=>{
  const api=source('functions/api/[[path]].js')
  assert.match(api,/env\.APP_ENV === 'preview'/)
  assert.match(api,/PREVIEW_D1_ISOLATED !== 'true'/)
  assert.match(api,/preview_read_only/)
  assert.match(source('wrangler.toml'),/\[env\.preview\.vars\]/)
  const pkg=JSON.parse(source('package.json'))
  assert.equal(pkg.scripts['verify:release'],'npm run build && npm run security:audit:prod')
  const workflow=source('.github/workflows/validate.yml')
  assert.match(workflow,/workflow_dispatch/)
  assert.match(workflow,/npm run verify:release/)
})
