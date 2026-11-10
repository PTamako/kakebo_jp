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
  const watcher = app.match(/watch\(month, async \(\) => \{([\s\S]*?)\n\}\)/)?.[1] || ''
  assert.match(watcher, /selectedDay\.value = ''/)
  assert.match(watcher, /calendarExpanded\.value = false/)
  assert.match(watcher, /selectedDay\.value = returning\.selectedDay/)
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
  assert.match(finance, /async function createVerifiedLedgerBackup\(\)\{[\s\S]*?if \(!\(await loadAll\(\)\)\) throw Error/)
})

test('failed finance loads cannot be exported as stale complete backups', () => {
  assert.match(finance, /catch\(e\)\{\s*\/\/ Never show or export stale data/)
  assert.match(finance, /rows\.value=\[\];loaded\.value=false;lastLoadedAt\.value=null/)
  assert.match(finance, /loadError\.value='全明細の読み込みに失敗しました：'/)
  assert.match(finance, /financeInitialized = await loadAll\(\)/)
  assert.match(finance, /v-if="loadError" class="finance-load-error" role="alert"/)
  assert.match(finance, /:disabled="busy\|\|backupBusy\|\|!loaded" @click="downloadBackup"/)
  assert.match(finance, /JSONは帳簿のみ。ZIPにはR2と端末の画像を含めます/)
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
  // The balance app deliberately prevents visual page zoom at the user's request.
  // Keep the normal viewport width and iPhone form input font sizes so controls stay usable.
  assert.match(html, /width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover/)
  assert.match(mobile, /html \{ -webkit-text-size-adjust: 100%; touch-action: pan-x pan-y; \}/)
  assert.match(mobile, /main input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),[\s\S]*?main select, main textarea \{[\s\S]*?font-size: 16px;/)
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
  assert.match(pkg.scripts['test:parse'], /^node --test(?: --test-reporter=spec)? scripts\/\*\.test\.js tests\/\*\.test\.mjs$/)
})

test('OCR engine uses a compact, accessible two-option selector without changing free default', () => {
  const picker = app.match(/<div class="ocr-engine-picker"[\s\S]*?<\/div>\s*<p[^>]*class="ocr-engine-note"/)?.[0]
  assert.ok(picker, 'the scanner shows a dedicated compact engine selector')
  assert.match(picker,/v-if="aiQuota"/)
  assert.match(app,/本日のAI残り回数/)
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

test('mobile card editor snapshots its selected card and rejects stale cross-card saves', () => {
  const sheet=source('src/MobileCardEditorSheet.vue')
  const api=source('functions/api/[[path]].js')
  assert.match(finance,/function selectCardForEdit\(\) \{/)
  assert.match(finance,/if\(!selectedCard\.value\|\|busy\.value\)return/)
  assert.match(finance,/cardMode\.value='edit'/)
  assert.match(finance,/:card-name="selectedCard"/)
  assert.match(finance,/:card="paymentSourceMeta\[selectedCard\]\|\|null"/)
  assert.match(finance,/if\(!selectedCard\.value\|\|selectedCard\.value!==payload\.oldName\)/)
  assert.match(sheet,/watch\(\(\)=>\[props\.mode,props\.cardName\]/)
  assert.match(sheet,/original\.value=\{/)
  assert.match(sheet,/payload\.oldName=props\.cardName/)
  assert.match(sheet,/payload\.expected=\{/)
  assert.match(api,/current\.source_type!==expected\.sourceType/)
  assert.match(api,/current\.closing_day\?\?null/)
})

test('CSP permits local header logo without allowing the unused LINE image domain', () => {
  const headers = source('public/_headers')
  assert.match(headers, /img-src[^;\n]*'self'/)
  assert.doesNotMatch(headers, /stickershop\.line-scdn\.net/)
})

test('brand wordmark is bundled locally, responsive and needs no remote image hosts', () => {
  const header = app.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0]
  assert.ok(header)
  assert.match(header, /<img class="brand-wordmark" src="\/branding\/kakeibo-wordmark\.png\?v=4"/)
  assert.match(header, /alt="家計簿"/)
  assert.match(app, /\.brand-wordmark\{[^}]*max-width:100%;object-fit:contain/)
  const css = source('src/mobile-ui.css')
  assert.match(css, /main \.brand-wordmark \{[^}]*max-width: 100%/)
  assert.doesNotMatch(header, /https?:\/\/|line-dogs|brandImageFailed|@error=/)
  const png = readFileSync(new URL('../public/branding/kakeibo-wordmark.png',import.meta.url))
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16),400)
  assert.equal(png.readUInt32BE(20),133)
})

test('PWA and iPhone installed icons share the new local pastel artwork', () => {
  const index = source('index.html')
  const vite = source('vite.config.js')
  const i192 = readFileSync(new URL('../public/icon-192.png',import.meta.url))
  const i512 = readFileSync(new URL('../public/icon-512.png',import.meta.url))
  const apple = readFileSync(new URL('../public/apple-touch-icon.png',import.meta.url))
  for (const [img,width] of [[i192,192],[i512,512],[apple,192]]) {
    assert.equal(img.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.equal(img.readUInt32BE(16),width)
    assert.equal(img.readUInt32BE(20),width)
  }
  assert.match(index, /rel="icon" type="image\/png" href="\/icon-192\.png\?v=4"/)
  assert.match(index, /rel="apple-touch-icon" href="\/apple-touch-icon\.png\?v=4"/)
  assert.match(vite, /\/icon-192\.png\?v=4/)
  assert.match(vite, /\/icon-512\.png\?v=4/)
  assert.doesNotMatch(vite, /\/icon\.svg\?v=3/)
})
