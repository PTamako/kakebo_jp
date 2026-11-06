import test from 'node:test'
import assert from 'node:assert/strict'
import { detectInvestmentFunding, detectGenericRecharge, recognizeAssetTransfer } from '../src/transfer-recognition.js'
import { readFileSync } from 'node:fs'

const detect = (merchant, prepaidNames = ['Suica', 'PASMO', 'nanaco'], note = '', raw = '') =>
  recognizeAssetTransfer({merchant, prepaidNames, note, raw})

test('Japanese statement: securities mutual fund savings and SBI funding are asset transfers', () => {
  for (const title of [
    'SBI証券投信積立サービス（翌月買付分）',
    '証券投信積立サービス',
    '投信積立サービス',
    '投資信託積立',
    'SBI証券',
    'SBI証券 買付',
    'SBI証券への入金',
    'SBI証券　投資信託購入'
  ]) {
    assert.equal(detectInvestmentFunding(title),true,title)
    assert.deepEqual(detect(title),{isTransfer:true,transferTarget:'sbi',kind:'investment'},title)
  }
})

test('registered prepaid cards and generic charge are transfers, but only registered unambiguous targets are assigned', () => {
  assert.deepEqual(detect('Suicaチャージ（楽天ペイ）'),{isTransfer:true,transferTarget:'prepaid:Suica',kind:'recharge'})
  assert.deepEqual(detect('PASMO 入金'),{isTransfer:true,transferTarget:'prepaid:PASMO',kind:'recharge'})
  assert.deepEqual(detect('nanaco チャージ 2,000円'),{isTransfer:true,transferTarget:'prepaid:nanaco',kind:'recharge'})
  assert.deepEqual(detect('nanacoチャージ',['nanacoモバイル','Suica']),{isTransfer:true,transferTarget:'prepaid:nanacoモバイル',kind:'recharge'})
  assert.deepEqual(detect('nanacoチャージ',['nanacoモバイル','nanacoカード']),{isTransfer:true,transferTarget:'',kind:'recharge'})
  assert.deepEqual(detect('モバイルSuicaチャージ',['Suica','モバイルSuica']),{isTransfer:true,transferTarget:'',kind:'recharge'})
  assert.deepEqual(detect('楽天ペイチャージ'),{isTransfer:true,transferTarget:'',kind:'recharge'})
  assert.deepEqual(detect('PayPayチャージ',[]),{isTransfer:true,transferTarget:'',kind:'recharge'})
  assert.deepEqual(detect('○○チャージ'),{isTransfer:true,transferTarget:'',kind:'recharge'})
  assert.equal(detectGenericRecharge('○○チャージ'),true)
})

test('false-positive prevention: ordinary purchases, bank transfers, fees, chargers and refunds remain expenses', () => {
  const expenses=[
    'SBI銀行への振込', 'SBI銀行口座', 'SBI 証券ニュース', 'SBI証券手数料',
    'スマホチャージャー購入', '充電用チャージケーブル', 'チャージ料金', 
    'Suicaチャージ取消', 'PASMOチャージ返金',
    'チャージバック', 'マクドナルド', '楽天カード年会費',
    'チャージキャンセル'
  ]
  for (const merchant of expenses) {
    assert.equal(detect(merchant).isTransfer,false,merchant)
  }
  assert.equal(detect('セブンイレブン', ['Suica'], '', '店内でSuicaチャージを見たレシート全文').isTransfer,false,
    'full receipt items must not silently change an ordinary purchase')
  assert.equal(detect('普通の買い物', ['Suica'], '', '商品 チャージャー').isTransfer,false)
})

test('recognizer reads payment statement memo when merchant has no recharge term', () => {
  assert.deepEqual(detect('楽天ペイ', ['Suica'], 'Suicaチャージ'),{isTransfer:true,transferTarget:'prepaid:Suica',kind:'recharge'})
  assert.deepEqual(detect('', ['Suica'], '', 'Suicaチャージ 1,000円'),{isTransfer:true,transferTarget:'prepaid:Suica',kind:'recharge'})
  assert.deepEqual(detect('楽天ペイ', ['Suica'], '', '普通の支払い'),{isTransfer:false,transferTarget:'',kind:''})
})

test('OCR and pasted-text drafts share the same transfer detection, without creating DB records', () => {
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  assert.match(app,/recognizeAssetTransfer\(\{/)
  assert.match(app,/detectedTransfer\.isTransfer \? 'transfer'/)
  assert.match(app,/transferTarget: detectedTransfer\.transferTarget \|\| f\.transferTarget \|\| ''/)
  assert.match(app,/const structured = !append && entryInputMode\.value === 'manual'/)
  assert.match(app,/const effectiveMode = structured \|\| repeated \? 'statement' : mode/)
  assert.match(app,/if \(invalidTransfer >= 0\) return flash/)
  assert.doesNotMatch(app,/CREATE TABLE|INSERT INTO entries/)
})
