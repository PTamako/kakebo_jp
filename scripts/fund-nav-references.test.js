import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fundNavReferences } from '../src/fund-nav-reference.js'
import { probeFundNavSupport } from '../functions/api/fund-nav-sync.js'

test('verified Daiwa fund has exact official product URL before SBI reference', () => {
  const links = fundNavReferences('04317188','iFreeNEXT NASDAQ100インデックス')
  assert.equal(links[0].kind,'verified')
  assert.match(links[0].url,/^https:\/\/www\.daiwa-am\.co\.jp\//)
  assert.equal(links[1].kind,'broker')
})
test('unlisted Nissay fund is directed to official manager NAV list, not fabricated detail', () => {
  const links = fundNavReferences('12345678','ニッセイ外国株式インデックスファンド')
  assert.equal(links[0].kind,'catalogue')
  assert.equal(links[0].url,'https://www.nam.co.jp/fundinfo/list/index.html')
  assert.equal(links[1].kind,'broker')
})
test('unlisted Rakuten and Tawara funds use verified manager lists', () => {
  assert.match(fundNavReferences('12345678','楽天・全世界株式インデックス・ファンド')[0].url,/rakuten-toushin\.co\.jp/)
  assert.match(fundNavReferences('12345678','たわらノーロード 先進国株式')[0].url,/am-one\.co\.jp/)
})
test('unknown manager gets explicitly labelled search and SBI code lookup', () => {
  const links=fundNavReferences('1a23bc9d','未知のファンド')
  assert.equal(links[0].kind,'search')
  assert.ok(new URL(links[0].url).searchParams.get('q').includes('1A23BC9D'))
  assert.equal(links[1].kind,'broker')
  assert.equal(new URL(links[1].url).searchParams.get('fund_sec_code'),'1A23BC9D')
})
test('unsafe or incomplete codes never produce outbound links', () => {
  for(const code of ['123','12345678&x=y','https://evil.test','']) assert.deepEqual(fundNavReferences(code,'foo'),[])
})
test('network failure remains unknown, never incorrectly classified as permanent manual',async()=>{
  const found=await probeFundNavSupport('01234567',{fetcher:async()=>{throw Error('network unreachable')}})
  assert.equal(found.status,'unknown')
})
test('UI checks API eligibility and shows references in both new fund forms and NAV editor',()=>{
  const ui=readFileSync(new URL('../src/SbiPortfolio.vue',import.meta.url),'utf8')
  assert.match(ui,/investment-portfolio\/nav-eligibility/)
  assert.match(ui,/shouldShowNavReferences\(plan\.fundCode\)/)
  assert.match(ui,/shouldShowNavReferences\(holding\.fundCode\)/)
  assert.match(ui,/shouldShowNavReferences\(price\.fundCode\)/)
  assert.match(ui,/navReferences\(fund\.fund_code,fund\.fund_name\)/)
})
