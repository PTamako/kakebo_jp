import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = read('src/App.vue')
const css = read('src/mobile-ui.css')
const picker = app.match(/<div class="theme-switcher"[\s\S]*?<\/div>/)?.[0] || ''
const swatches = [...app.matchAll(/\{ id: '([^']+)', label: '([^']+)', color: '(#[0-9a-fA-F]{6})' \}/g)]

test('eight cream themes preserve the four original saved IDs', () => {
  assert.deepEqual(swatches.map(x => x[1]), ['pink', 'blue', 'yellow', 'green', 'lavender', 'peach', 'latte', 'slate'])
  assert.equal(new Set(swatches.map(x => x[3])).size, 8)
  assert.match(app, /localStorage\.getItem\('kakeibo-theme'\)/)
  assert.match(app, /localStorage\.setItem\('kakeibo-theme', value\)/)
  assert.match(app, /themes\.some\(item => item\.id === storedTheme\) \? storedTheme : 'pink'/)
  assert.match(app, /if \(!themes\.some\(item => item\.id === value\)\) return/)
})
test('color-only picker has accessible Japanese labels and a visible selected check', () => {
  assert.ok(picker)
  assert.match(picker, /role="group" aria-label="テーマカラー"/)
  assert.match(picker, /v-for="item in themes"/)
  assert.match(picker, /class="theme-swatch"/)
  assert.match(picker, /:aria-label="item\.label \+ 'テーマ'"/)
  assert.match(picker, /:aria-pressed="theme === item\.id"/)
  assert.match(picker, /:class="\{ selected: theme === item\.id \}"/)
  assert.match(picker, /:style="\{ backgroundColor: item\.color \}"/)
  assert.match(picker, /v-if="theme === item\.id" class="theme-check"/)
  assert.match(picker, /@click="setTheme\(item\.id\)/)
  assert.doesNotMatch(picker, /\{\{\s*item\.label\s*\}\}|<strong>|<i\b/)
})
test('picker has 4 columns, 44px tap targets, and a focus outline', () => {
  const panel = css.slice(css.indexOf('/* Eight unlabeled 44px touch targets'))
  assert.match(panel, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
  assert.match(panel, /width:min\(238px,calc\(100vw - 28px\)\)/)
  assert.match(panel, /button\.theme-swatch[\s\S]*?min-height:44px;[\s\S]*?height:44px;/)
  assert.match(panel, /button\.theme-swatch\.selected[\s\S]*?border-color:var\(--blue\)/)
  assert.match(panel, /button\.theme-swatch:focus-visible[\s\S]*?outline:3px solid var\(--blue-dark\)/)
})
test('four new themes style the app, charts, calendar and central add', () => {
  for (const id of ['lavender','peach','latte','slate']) {
    const index=css.indexOf('main.theme-' + id + ' {')
    assert.ok(index>=0,'missing '+id)
    const tokens=css.slice(index, css.indexOf('}',index)+1)
    for(const token of ['--ink:','--muted:','--line:','--blue:','--blue-dark:','--paper:','--card:','--chart-1:','--chart-10:']) {
      assert.ok(tokens.includes(token),id+' needs '+token)
    }
  }
  assert.match(css, /main:is\(\.theme-lavender,\.theme-peach,\.theme-latte,\.theme-slate\) \.hero-total/)
  assert.match(css, /main:is\(\.theme-lavender,\.theme-peach,\.theme-latte,\.theme-slate\) \.calendar-day\.calendar-selected/)
  assert.match(css, /main:is\(\.theme-lavender,\.theme-peach,\.theme-latte,\.theme-slate\) \.bottom-nav button\.nav-add/)
  assert.match(css, /background:linear-gradient\(145deg,var\(--blue\),var\(--blue-dark\)\)/)
})
test('original themes and Japanese UI language remain intact', () => {
  for(const id of ['blue','yellow','green']) assert.match(app,new RegExp('main\\.theme-'+id+'\\{--ink:'))
  assert.match(app, /<strong>家計簿<\/strong>/)
  assert.match(app, /aria-label="テーマカラーを選ぶ"/)
})
