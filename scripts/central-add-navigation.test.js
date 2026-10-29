import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')
const css = source('src/mobile-ui.css')
const nav = app.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/)?.[0]
const buttons = nav?.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []

test('bottom tabs place the icon-only add action at the exact center', () => {
  assert.ok(nav)
  assert.equal(buttons.length, 5)
  assert.match(buttons[0], /tab === 'list'/)
  assert.match(buttons[1], /tab === 'stat'/)
  assert.match(buttons[2], /class="nav-add"/)
  assert.match(buttons[3], /tab === 'investments'/)
  assert.match(buttons[4], /tab === 'finance'/)
  assert.equal((nav.match(/:aria-current=/g) || []).length, 5)
  assert.doesNotMatch(buttons[2], /<span>|入力|<span>記録<\/span>/)
})

test('the add button works as navigation without a visible label', () => {
  assert.match(buttons[2], /aria-label="記録を追加"/)
  assert.match(buttons[2], /title="記録を追加"/)
  assert.match(buttons[2], /@click="tab = 'add'"/)
  assert.match(buttons[2], /:aria-current="tab === 'add' \? 'page' : undefined"/)
  assert.match(buttons[2], /<svg aria-hidden="true" viewBox="0 0 24 24">/)
  assert.match(buttons[2], /M12 5v14M5 12h14/)
})

test('raised add button respects themes, compact phones and touch sizes', () => {
  assert.match(css, /main \.bottom-nav button\.nav-add\.active/)
  assert.match(css, /width: 62px;[\s\S]*?height: 62px;/)
  assert.match(css, /transform: translateY\(-10px\)/)
  assert.match(css, /color-mix\(in srgb, var\(--blue-dark\)/)
  assert.match(css, /main\.theme-yellow \.bottom-nav button\.nav-add/)
  assert.match(css, /@media \(max-width: 360px\)/)
  assert.match(css, /width: 58px;[\s\S]*?min-height: 58px;/)
  assert.match(css, /main \.bottom-nav button\.nav-add:focus-visible/)
  assert.match(css, /main \.bottom-nav button\.nav-add:active/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /bottom: calc\(7px \+ env\(safe-area-inset-bottom, 0px\)\)/)
})
