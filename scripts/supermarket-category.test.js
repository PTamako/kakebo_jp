import test from 'node:test'
import assert from 'node:assert/strict'
import { classify } from '../src/parse.js'

test('Japanese convenience stores default to food groceries across common Seven-Eleven spellings', () => {
  for (const merchant of [
    'セブンーイレブン', 'セブンｰイレブン', 'セブン-イレブン', 'セブンイレブン葛飾柴又店',
    '7-Eleven', 'ローソン', 'ファミリーマート', 'ミニストップ', 'NewDays', 'デイリーヤマザキ'
  ]) {
    assert.equal(classify(merchant, []).category, '饮食料品', merchant)
  }
})

test('common Japanese supermarkets default to food groceries', () => {
  for (const merchant of ['イトーヨーカドー', 'まいばすけっと', 'ベルク', 'イオンフードスタイル', 'ライフ']) {
    assert.equal(classify(merchant, []).category, '饮食料品', merchant)
  }
})
