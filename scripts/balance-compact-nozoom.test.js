import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read = name => readFileSync(new URL('../'+name,import.meta.url),'utf8')
const page=read('src/pages/AssetsPage.vue')
const css=read('src/mobile-ui.css')
const html=read('index.html')

test('balance summary remains stacked on mobile and keeps allocation bars and wallet transactions',()=>{
  assert.match(page,/\.asset-overview\{display:grid;grid-template-columns:minmax\(0,1fr\)/)
  assert.match(page,/@media\(min-width:768px\)\{\.asset-overview\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(page,/class="asset-allocation"/)
  assert.match(page,/class="asset-allocation-legend"/)
  assert.match(page,/allocation\.map\(a=>a\.name/)
  assert.match(page,/最近の利用/)
  assert.match(page,/最近のチャージ/)
  assert.match(page,/class="asset-wallet-event-side"/)
  assert.match(page,/:title="latestUsage\.card"/)
  assert.match(page,/:title="latestCharge\.card"/)
  assert.match(page,/\.asset-wallet-card,\.asset-wallet-event-meta\{[^}]*text-overflow:ellipsis/)
  assert.match(page,/\.asset-wallet-event\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/)
})

test('cards are shorter by reducing only whitespace and not hiding any data',()=>{
  assert.match(page,/\.asset-investment,\.asset-wallet\{[^}]*min-height:0;padding:10px 12px/)
  assert.match(page,/\.asset-wallet-event-primary\{display:flex;align-items:center;gap:7px;min-width:0;width:100%/)
  assert.match(page,/\.asset-wallet-activity\{display:grid;gap:6px;margin-top:7px;padding-top:7px/)
  assert.match(page,/\.asset-allocation-breakdown\{display:grid;gap:5px;padding-top:1px/)
  assert.match(page,/\.asset-allocation-legend\{[^}]*gap:3px 10px/)
  assert.match(page,/\.asset-allocation\{[^}]*height:6px/)
  assert.match(page,/\{\{a\.ratio\.toFixed\(1\)\}\}%/)
  assert.match(page,/\{\{shortDate\(latestUsage\.date\)\}\}/)
  assert.match(page,/\{\{shortDate\(latestCharge\.date\)\}\}/)
})

test('viewport and mobile CSS prevent page zoom without breaking scroll or editable form fields',()=>{
  assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" \/>/)
  assert.match(css,/html \{ -webkit-text-size-adjust: 100%; touch-action: pan-x pan-y; \}/)
  assert.match(css,/main input:not\(\[type=checkbox\]\):not\(\[type=radio\]\),[\s\S]*?main select, main textarea \{[\s\S]*?font-size: 16px;/)
  assert.doesNotMatch(css,/touch-action:\s*none/)
  assert.doesNotMatch(html,/minimum-scale=0/)
})
