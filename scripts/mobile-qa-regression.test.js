import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')
const transactionForm = source('src/TransactionForm.vue')
const finance = source('src/FinanceTools.vue')
const mobile = source('src/mobile-ui.css')
const html = source('index.html')
const pkg = JSON.parse(source('package.json'))

test('switching expense/income/transfer inside the edit form must not submit it', () => {
  const switchGroup = transactionForm.match(/<div class="type-switch"[\s\S]*?<\/div>/)?.[0]
  assert.ok(switchGroup, 'transaction type switch exists')
  assert.match(switchGroup, /<button\b[^>]*type="button"[^>]*@click="emit\('change-type'/)
  const editor = app.match(/<form class="edit-dialog"[\s\S]*?<\/form>/)?.[0]
  assert.ok(editor, 'edit dialog remains a form')
  assert.match(editor, /type="submit"[^>]*>.*?変更を保存/s)
})

test('cross-month duplicate navigation selects date after month watcher resets it', () => {
  const handler = app.match(/async function openDuplicateDate\(date\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(handler, 'navigation handler exists')
  const changeMonth = handler.indexOf('month.value = targetMonth')
  const flushWatchers = handler.indexOf('await nextTick()')
  const expand = handler.indexOf('calendarExpanded.value = true')
  const selectDay = handler.indexOf('selectedDay.value = date')
  assert.ok(changeMonth >= 0 && flushWatchers > changeMonth)
  assert.ok(selectDay > flushWatchers && expand > flushWatchers)
  assert.match(app, /watch\(month, async \(\) => \{ selectedDay\.value = ''; calendarExpanded\.value = false/)
})

test('finance management starts loading only when tab is active and refreshes on revisit', () => {
  assert.match(app, /<FinanceTools v-show="tab === 'finance'" :active="tab === 'finance'"/)
  assert.match(finance, /onMounted\(\(\) => \{ if \(props\.active\) void initializeFinance\(\) \}\)/)
  assert.match(finance, /watch\(\(\) => props\.active, active => \{[\s\S]*?if \(!active\) return[\s\S]*?void loadAll\(\)[\s\S]*?void initializeFinance\(\)/)
})

test('failed finance loads cannot be exported as stale complete backups', () => {
  assert.match(finance, /catch\(e\)\{\s*\/\/ Never show or export stale data/)
  assert.match(finance, /rows\.value=\[\];loaded\.value=false;lastLoadedAt\.value=null/)
  assert.match(finance, /loadError\.value='全明細の読み込みに失敗しました：'/)
  assert.match(finance, /financeInitialized = await loadAll\(\)/)
  assert.match(finance, /v-if="loadError" class="finance-load-error" role="alert"/)
  assert.match(finance, /:disabled="busy\|\|backupBusy\|\|!loaded" @click="downloadBackup"/)
  assert.match(finance, /SBI証券の評価額と損益/)
})

test('mobile navigation, keyboard and charts retain touch-safe affordances', () => {
  const nav = app.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0]
  assert.ok(nav)
  assert.equal((nav.match(/:aria-current=/g) || []).length, 5)
  assert.match(mobile, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(mobile, /main:has\(input:focus, textarea:focus, select:focus\) \.bottom-nav/)
  assert.match(mobile, /main:has\(input:focus, textarea:focus, select:focus\) \.batch-actions/)
  assert.match(mobile, /main \.trend-month-labels button \{ min-height: 44px; \}/)
  assert.equal((app.match(/r="14" class="chart-point-hit"/g) || []).length, 3)
  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/)
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/)
})

test('Pages production build runs API and OCR regression suite before Vite', () => {
  assert.equal(pkg.scripts.build, 'npm run test:parse && vite build')
  assert.equal(pkg.scripts['test:parse'], 'node --test scripts/*.test.js')
})
