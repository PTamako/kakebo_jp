import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSbiHoldingsText } from '../src/sbi-holdings-import.js'
import { readFileSync } from 'node:fs'

const holdings=[
  {fund_code:'0331418A',fund_name:'eMAXIS Slim 全世界株式（オール・カントリー）',account_type:'combined'},
  {fund_code:'03311187',fund_name:'eMAXIS Slim 米国株式（S&P500）',account_type:'combined'},
  {fund_code:'04317188',fund_name:'iFreeNEXT NASDAQ100インデックス',account_type:'tsumitate'}
]

test('AI pipe rows match only registered fund and account, without inserting holdings',()=>{
  const input=[
    'オール・カントリー|合算|2,500|15,000',
    'S&P500|合算|1,200|8,000',
    '04317188|つみたて|900|5,000',
    '未登録ファンド|つみたて|99999|99999'
  ].join('\n')
  const r=parseSbiHoldingsText(input,holdings)
  assert.equal(r.updates.length,3)
  assert.deepEqual(r.updates.map(x=>[x.fundCode,x.accountType,x.units,x.acquisitionCost]),[
    ['0331418A','combined',2500,15000],
    ['03311187','combined',1200,8000],
    ['04317188','tsumitate',900,5000]
  ])
})
test('SBI copied multiline values need explicitly labelled units AND total cost',()=>{
  const r=parseSbiHoldingsText([
    'eMAXIS Slim 全世界株式（オール・カントリー）',
    '保有口数', '2,000 口', '取得金額','10,000 円',
    '評価額','21,000 円',
    'iFreeNEXT NASDAQ100インデックス',
    '保有口数 1,200口','取得金額 8,100円','基準価額 31,000円'
  ].join('\n'),holdings)
  assert.deepEqual(r.updates.map(x=>[x.fundCode,x.units,x.acquisitionCost]),[
    ['0331418A',2000,10000],['04317188',1200,8100]
  ])
})
test('never mistake market valuation, gain/loss or monthly plan for acquisition cost',()=>{
  const r=parseSbiHoldingsText([
    'オール・カントリー','保有口数 2,000口',
    '評価額 22,000円','評価損益 +2,000円',
    '毎月の積立額 5,000円'
  ].join('\n'),holdings)
  assert.deepEqual(r.updates,[])
  assert.ok(r.warnings.length>0)
})
test('ambiguous split accounts require a specified account and cannot silently pick',()=>{
  const accounts=[
    {fund_code:'03311187',fund_name:'S&P500',account_type:'growth'},
    {fund_code:'03311187',fund_name:'S&P500',account_type:'tsumitate'}
  ]
  const r=parseSbiHoldingsText('S&P500|不明|100|2000\nS&P500|成長|90|1800',accounts)
  assert.deepEqual(r.updates,[{fundCode:'03311187',accountType:'growth',units:90,acquisitionCost:1800}])
  assert.ok(r.warnings.some(s=>/口座/.test(s)))
})
test('duplicate holding lines are skipped rather than letting the last OCR guess win',()=>{
  const r=parseSbiHoldingsText('NASDAQ100|つみたて|100|2000\nNASDAQ100|つみたて|400|9000',holdings)
  assert.deepEqual(r.updates,[])
  assert.ok(r.warnings.some(x=>/重複/.test(x)))
})
test('portfolio reader only appears in SBI holdings section, not main expense OCR',()=>{
  const component=readFileSync(new URL('../src/SbiPortfolio.vue',import.meta.url),'utf8')
  const ai=readFileSync(new URL('../functions/api/gemma-ocr.js',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  const backend=readFileSync(new URL('../functions/api/investment-portfolio.js',import.meta.url),'utf8')
  assert.match(component,/保有を一括更新/)
  assert.match(component,/parseSbiHoldingsText\(bulkText\.value,holdingsData\.value\)/)
  assert.match(component,/investment-portfolio\/holdings-bulk/)
  assert.match(api,/body\.get\('mode'\)/)
  assert.match(ai,/mode === 'portfolio'/)
  assert.match(backend,/sub==='holdings-bulk'/)
  assert.match(backend,/WITH incoming\(fund_code,account_type,new_units,new_cost,old_units,old_cost\)/)
})
