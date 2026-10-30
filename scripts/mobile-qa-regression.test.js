import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')+'\n'+source('src/pages/LedgerPage.vue')+'\n'+source('src/pages/StatisticsPage.vue')
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
  assert.match(app, /<ManagementPage [^>]*v-show="tab === 'finance'" :active="tab === 'finance'"/)
  assert.match(finance, /onMounted\(\(\) => \{ if \(props\.active\) void initializeFinance\(\) \}\)/)
  // Revisit reuses a fresh ledger; mutations, expiration and explicit backup force refresh.
  assert.match(finance, /watch\(\(\) => props\.ledgerRevision, \(\) => \{/)
  assert.match(finance, /ledgerDirty = props\.ledgerRevision !== startingRevision/)
  assert.match(finance, /if \(ledgerDirty \|\| !lastLoadedAt\.value \|\|/)
  assert.match(finance, /Date\.now\(\) - lastLoadedAt\.value\.getTime\(\) >= MANAGEMENT_LEDGER_TTL_MS/)
  assert.match(finance, /void loadAll\(\)/)
  assert.match(finance, /async function downloadBackup\(\)\{[\s\S]*?if \(!\(await loadAll\(\)\)\) throw Error/)
})

test('failed finance loads cannot be exported as stale complete backups', () => {
  assert.match(finance, /catch\(e\)\{\s*\/\/ Never show or export stale data/)
  assert.match(finance, /rows\.value=\[\];loaded\.value=false;lastLoadedAt\.value=null/)
  assert.match(finance, /loadError\.value='全明細の読み込みに失敗しました：'/)
  assert.match(finance, /financeInitialized = await loadAll\(\)/)
  assert.match(finance, /v-if="loadError" class="finance-load-error" role="alert"/)
  assert.match(finance, /:disabled="busy\|\|backupBusy\|\|!loaded" @click="downloadBackup"/)
  assert.match(finance, /帳簿・設定をJSON保存（レシート画像は対象外）/)
})

test('mobile navigation, keyboard and charts retain touch-safe affordances', () => {
  const nav = app.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0]
  assert.ok(nav)
  assert.equal((nav.match(/:aria-current=/g) || []).length, 5)
  assert.match(mobile, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(mobile, /main:has\(input:is\([^\n]+\):focus, textarea:focus\) \.bottom-nav/)
  assert.match(mobile, /main:has\(input:is\([^\n]+\):focus, textarea:focus\) \.batch-actions/)
  assert.match(mobile, /main \.trend-month-labels button \{ min-height: 44px; \}/)
  assert.equal((app.match(/r="14" class="chart-point-hit"/g) || []).length, 3)
  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover/)
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/)
})

test('native select, calendar and time pickers never hide the bottom tab bar on focus', () => {
  const focusRules = mobile.split('\n').filter(line =>
    line.includes('main:has(') &&
    (line.includes('.bottom-nav') || line.includes('.batch-actions'))
  )
  assert.equal(focusRules.length, 2)
  for (const rule of focusRules) {
    assert.doesNotMatch(rule, /select:focus|input:focus/)
    assert.doesNotMatch(rule, /\[type="(?:date|month|time|datetime-local|file|checkbox|radio)"\]/)
    assert.match(rule, /\[type="text"\]/)
    assert.match(rule, /\[type="number"\]/)
    assert.match(rule, /textarea:focus/)
  }
})

test('Pages production build runs API and OCR regression suite before Vite', () => {
  assert.equal(pkg.scripts.build, 'npm run test:parse && npm run security:audit:prod && vite build')
  assert.equal(pkg.scripts['test:parse'], 'node --test scripts/*.test.js')
})

test('OCR engine uses a compact, accessible two-option selector without changing free default', () => {
  const picker = app.match(/<div class="ocr-engine-picker"[\s\S]*?<\/div>\s*<p class="ocr-engine-note"/)?.[0]
  assert.ok(picker, 'the scanner shows a dedicated compact engine selector')
  assert.match(picker, /role="group" aria-label="画像の読み取り方法"/)
  assert.match(picker, /:aria-pressed="!aiOcrEnabled"/)
  assert.match(picker, /:aria-pressed="aiOcrEnabled"/)
  assert.match(picker, /@click="setAiOcrEnabled\(false\)"/)
  assert.match(picker, /@click="setAiOcrEnabled\(true\)"/)
  assert.match(picker, /:disabled="!!busy"/)
  assert.doesNotMatch(app, /class="ai-ocr-mode"/)
  assert.match(app, /if \(!aiOcrEnabled\.value\)/)
  assert.match(mobile, /main \.capture-panel \.ocr-engine-options button \{/)
  assert.match(mobile, /min-height: 44px/)
})

test('changing cards while editing refreshes the name and cannot rename the previous card', () => {
  // Watching the card selection is essential: selectCardForEdit() only runs
  // when the pencil icon is pressed, not when a different card is selected.
  const sync = finance.match(/watch\(selectedCard,\s*\(name\)\s*=>\s*\{([\s\S]*?)\n\}\)/)?.[1]
  assert.ok(sync, 'card selection has its own editor synchronization watcher')
  assert.match(sync, /editedCardName\.value\s*=\s*name\s*\|\|\s*''/)
  const picker = finance.match(/<select v-model="selectedCard"[^>]*>/)?.[0]
  assert.ok(picker)
  assert.match(picker, /:disabled="busy"/)
  const editor = finance.match(/<div v-if="cardMode === 'edit' && selectedCard"[\s\S]*?<\/div>/)?.[0]
  assert.ok(editor)
  assert.match(editor, /<input :key="selectedCard" v-model="editedCardName"/)
  assert.match(editor, /:disabled="busy \|\| selectedCard === '現金'"/)
  assert.match(editor, /<button type="button" :disabled="busy" @click="saveCardType">\{\{editSourceType!==selectedSourceType\?'種別を保存':'保存'\}\}<\/button>/)
  assert.match(finance, /if\(kind===selectedSourceType\.value\)return renameCard\(\)/)
  assert.match(finance, /名称変更と種別変更は分けて保存してください/)
  assert.match(finance, /async function renameCard\(\) \{\s*if \(busy\.value\) return/)
})

test('CSP permits local header logo without allowing the unused LINE image domain', () => {
  const headers = source('public/_headers')
  assert.match(headers, /img-src[^;\n]*'self'/)
  assert.doesNotMatch(headers, /stickershop\.line-scdn\.net/)
})

test('bookkeeping logo is a bundled and self-hosted SVG with no puppy graphics', () => {
  const asset = source('public/branding/kakeibo-ledger.svg')
  const header = app.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0]
  assert.ok(header, 'the app header exists')
  assert.match(header, /aria-label="家計簿のノートとコイン"/)
  assert.match(header, /<img class="brand-local-logo" src="\/branding\/kakeibo-ledger\.svg"/)
  assert.doesNotMatch(header, /https?:\/\/|line-dogs|brandImageFailed|@error=/)
  assert.match(app, /\.brand-mark img\.brand-local-logo\{[^}]*width:100%;height:100%/)
  assert.match(asset, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(asset, /viewBox="0 0 64 64"/)
  assert.match(asset, /<circle[^>]+fill="#F4D588"/)
  assert.doesNotMatch(asset, /<image\b|<script\b|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/)
})


test('new cream logo, home icon and iPhone PNG share one recognizable mark', () => {
  const book = source('public/branding/kakeibo-ledger.svg')
  const appIcon = source('public/icon.svg')
  const index = source('index.html')
  const vite = source('vite.config.js')
  const applePng = readFileSync(new URL('../public/apple-touch-icon.png', import.meta.url))
  assert.match(book, /m30 30 4 4 8-9/)
  assert.match(appIcon, /m30 30 4 4 8-9/)
  assert.match(appIcon, /#FAEDEB/)
  assert.match(appIcon, /#F4D588/)
  assert.match(index, /rel="icon" type="image\/svg\+xml" href="\/icon\.svg\?v=3"/)
  assert.match(index, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=3"/)
  assert.match(vite, /\/icon\.svg\?v=3/)
  assert.equal(applePng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(applePng.readUInt32BE(16), 180)
  assert.equal(applePng.readUInt32BE(20), 180)
  assert.match(app, /<strong>家計簿<\/strong><small>家計をかんたんに記録<\/small>/)
  assert.doesNotMatch(app, /brand-heart/)
})
