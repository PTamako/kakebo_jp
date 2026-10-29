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

test('OCR engine uses a compact, accessible two-option selector without changing free default', () => {
  const picker = app.match(/<div class="ocr-engine-picker"[\s\S]*?<\/div>\s*<p v-if="aiOcrEnabled"/)?.[0]
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
  assert.match(editor, /<button type="button" :disabled="busy" @click="renameCard">保存<\/button>/)
  assert.match(finance, /async function renameCard\(\) \{\s*if \(busy\.value\) return/)
})

test('header puppies remain visible with CSP permission and a local vector fallback', () => {
  const headers = source('public/_headers')
  assert.match(headers, /img-src[^;\n]*https:\/\/stickershop\.line-scdn\.net/)
  const logo = app.match(/<span class="brand-mark"[\s\S]*?<\/span>/)?.[0]
  assert.ok(logo, 'the header brand contains its own puppy mark')
  assert.match(logo, /src="https:\/\/stickershop\.line-scdn\.net\/stickershop\/v1\/product\/17142161/)
  assert.match(logo, /src="https:\/\/stickershop\.line-scdn\.net\/stickershop\/v1\/product\/24856095/)
  assert.match(logo, /@error="brandImageFailed = true"/)
  assert.match(logo, /<svg v-else class="brand-doodle"/)
  assert.match(app, /const brandImageFailed = ref\(false\)/)
  assert.match(mobile, /main \.brand-mark \.brand-doodle \{/)
})

test('header puppy logo is a committed self-hosted asset, never a third-party image', () => {
  const asset = source('public/branding/line-dogs.svg')
  const header = app.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0]
  assert.ok(header, 'the app header exists')
  assert.match(header, /<img class="brand-local-logo" src="\/branding\/line-dogs\.svg"/)
  assert.doesNotMatch(header, /https?:\/\/|brandImageFailed|@error=/)
  assert.match(app, /\.brand-mark img\.brand-local-logo\{[^}]*width:100%;height:100%/)
  assert.match(asset, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(asset, /viewBox="0 0 96 64"/)
  assert.doesNotMatch(asset, /<image\b|<script\b|href=|https?:\/\/(?!www\.w3\.org\/2000\/svg)/)
})
