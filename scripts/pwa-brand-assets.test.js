import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const png = (path, width, height) => {
  const bytes = readFileSync(new URL('../public/' + path, import.meta.url))
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path + ' must be PNG')
  assert.equal(bytes.readUInt32BE(16), width, path + ' width')
  assert.equal(bytes.readUInt32BE(20), height, path + ' height')
  assert.ok(bytes.length > 1000, path + ' must contain the generated design')
}

test('generated icon files and horizontal wordmark are committed with correct dimensions', () => {
  png('icon-192.png', 192, 192)
  png('icon-512.png', 512, 512)
  png('apple-touch-icon.png', 192, 192)
  png('branding/kakeibo-wordmark.png', 400, 133)
})

test('PWA launcher icons and Apple touch icon use the new generated images', () => {
  const config = read('vite.config.js')
  const html = read('index.html')
  assert.match(config, /src: '\/icon-192\.png\?v=4', sizes: '192x192'/)
  assert.match(config, /src: '\/icon-512\.png\?v=4', sizes: '512x512'/)
  assert.match(html, /href="\/icon-192\.png\?v=4"/)
  assert.match(html, /href="\/apple-touch-icon\.png\?v=4"/)
  assert.doesNotMatch(config, /icon\.svg\?v=3/)
})

test('in-app header uses the horizontal logo rather than obsolete icon and label', () => {
  const app = read('src/App.vue')
  const mobile = read('src/mobile-ui.css')
  assert.match(app, /<img class="brand-wordmark" src="\/branding\/kakeibo-wordmark\.png\?v=4"/)
  assert.match(app, /alt="家計簿"/)
  assert.doesNotMatch(app, /src="\/branding\/kakeibo-ledger\.svg"/)
  assert.match(mobile, /main \.brand-wordmark \{/)
  assert.match(app, /\.brand-wordmark\{[^}]*max-width:100%/)
})

test('monthly fixed-expense exclusion trash category uses the approved wording', () => {
  const finance = read('src/FinanceTools.vue')
  assert.match(finance, /<summary>固定費の月別除外 <span>/)
  assert.match(finance, /<summary>削除した固定費 <span>/)
  assert.doesNotMatch(finance, /<summary>記帳から除外した月/)
})
