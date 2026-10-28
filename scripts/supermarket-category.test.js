import test from 'node:test'
import assert from 'node:assert/strict'
import { classify } from './category-rule-test-helpers.js'

test('user-defined rules use fuzzy matching and override built-in defaults', () => {
  assert.deepEqual(
    classify('マイバスケット葛飾柴又店', [{ keyword: 'マイバスケット', category: '宠物' }]),
    { category: '宠物', keyword: 'マイバスケット' }
  )
  assert.deepEqual(
    classify('スターバックス 小岩店', [{ keyword: 'スタバ', category: '购物' }]),
    { category: '购物', keyword: 'スタバ' }
  )
  assert.deepEqual(
    classify('ＳｏｆｔＢａｎｋ 光', [{ keyword: 'softbank', category: '居住' }]),
    { category: '居住', keyword: 'softbank' }
  )
  assert.deepEqual(
    classify('セブンイレブン葛飾柴又店', [
      { keyword: 'セブン', category: '购物' },
      { keyword: 'セブンイレブン', category: '娱乐' }
    ]),
    { category: '娱乐', keyword: 'セブンイレブン' }
  )
})

test('Japanese convenience stores default to food groceries across common Seven-Eleven spellings', () => {
  for (const merchant of [
    'セブンーイレブン', 'セブンｰイレブン', 'セブン-イレブン', 'セブンイレブン葛飾柴又店',
    '7-Eleven', 'ローソン', 'ファミリーマート', 'ミニストップ', 'NewDays', 'デイリーヤマザキ'
  ]) {
    assert.equal(classify(merchant, []).category, '饮食料品', merchant)
  }
})

test('common merchants map to sensible default categories', () => {
  const cases = [
    ['マクドナルド葛飾店', '餐饮'],
    ['スターバックス', '餐饮'],
    ['吉野家', '餐饮'],
    ['ダイソー', '日用品'],
    ['マツモトキヨシ', '日用品'],
    ['ニトリ', '日用品'],
    ['ユニクロ', '日用品'],
    ['モバイルSuica', '交通'],
    ['京成電鉄', '交通'],
    ['東京電力', '居住'],
    ['SoftBank 光', '居住'],
    ['〇〇クリニック', '医疗'],
    ['調剤薬局', '医疗'],
    ['Netflix', '娱乐'],
    ['TOHOシネマズ', '娱乐'],
    ['ペットのコジマ', '宠物'],
    ['動物病院', '宠物'],
    ['ヨドバシカメラ', '购物'],
    ['楽天市場', '购物']
  ]
  for (const [merchant, category] of cases) {
    assert.equal(classify(merchant, []).category, category, merchant)
  }
})

test('common Japanese supermarkets default to food groceries', () => {
  for (const merchant of ['イトーヨーカドー', 'まいばすけっと', 'マイバスケット', 'マイバスケツト', 'ベルク', 'イオンフードスタイル', 'ライフ']) {
    assert.equal(classify(merchant, []).category, '饮食料品', merchant)
  }
})
