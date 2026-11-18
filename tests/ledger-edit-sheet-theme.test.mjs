import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('ledger edit sheet follows active theme instead of hardcoding a white or pink action panel', () => {
  const app = read('src/App.vue')
  const css = read('src/mobile-ui.css')
  for (const theme of ['blue', 'yellow', 'green']) {
    assert.match(app, new RegExp('main\\.theme-' + theme + '\\{[^}]*--paper:'))
  }
  assert.match(css, /main \.edit-dialog \{ background: var\(--paper\); border-color: var\(--line\); \}/)
  assert.match(css, /main \.edit-dialog-actions \{[^\n]*background: var\(--paper\)/)
  assert.doesNotMatch(css, /main \.edit-dialog-actions \{[^\n]*background: var\(--card\)/)
})

test('mobile edit sheet has only one iPhone home-indicator inset and retains both actions', () => {
  const css = read('src/mobile-ui.css')
  const ledger = read('src/pages/LedgerPage.vue')
  assert.match(css, /padding: 18px 16px max\(12px, env\(safe-area-inset-bottom, 0px\)\)/)
  assert.match(css, /main \.edit-dialog-actions \{ position: sticky; bottom: 0;[^\n]*padding: 10px 0 0;/)
  assert.doesNotMatch(css, /main \.edit-dialog-actions \{[^\n]*env\(safe-area-inset-bottom/)
  assert.match(ledger, /<div class="edit-dialog-actions"><button type="button"[^>]*>キャンセル<\/button><button type="submit"[^>]*>\{\{ editSaving/)
})
