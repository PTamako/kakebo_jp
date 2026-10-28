import test from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../src/parse.js'
import { DEFAULT_RULE_ROWS } from '../functions/api/[[path]].js'

const rows = DEFAULT_RULE_ROWS.map(([keyword, category]) => ({ keyword, category, is_custom: false }))

test('browser parser does not embed a fallback merchant rule list', () => {
  assert.deepEqual(classify('まいばすけっと高砂店', []), { category: '日用品', keyword: '' })
})

test('D1 defaults preserve supermarket, convenience store, restaurant, and transit detection', () => {
  for (const [merchant, expected] of [
    ['まいばすけっと高砂店', '饮食料品'],
    ['マイバスケット柴又店', '饮食料品'],
    ['セブンｰイレブン', '饮食料品'],
    ['マクドナルド小岩店', '餐饮'],
    ['京成電鉄', '交通'],
    ['動物病院', '宠物']
  ]) assert.equal(classify(merchant, rows).category, expected, merchant)
})

test('D1 custom category always takes precedence over longer built-in keywords', () => {
  const withCustom = [
    ...rows,
    { keyword: 'まいばす', category: '娱乐', is_custom: true }
  ]
  assert.equal(classify('まいばすけっと高砂店', withCustom).category, '娱乐')
})

test('a deleted custom category reverts to D1 default', () => {
  assert.equal(classify('まいばすけっと高砂店', rows).category, '饮食料品')
})

test('D1 seed has one unique row per keyword after merging source dictionaries', () => {
  assert.equal(new Set(DEFAULT_RULE_ROWS.map(([name]) => name)).size, DEFAULT_RULE_ROWS.length)
})
