import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseSbiFundDetailText, applySbiFundDetailUpdates } from '../src/sbi-fund-detail-import.js'

const positions = [
  { fund_code:'03311187',fund_name:'米国株式（S&P500）',account_type:'growth' },
  { fund_code:'03311187',fund_name:'米国株式（S&P500）',account_type:'tsumitate' },
  { fund_code:'0331418A',fund_name:'オール・カントリー',account_type:'growth' },
  { fund_code:'0331418A',fund_name:'オール・カントリー',account_type:'tsumitate' },
  { fund_code:'0331A172',fund_name:'先進国債券',account_type:'growth' },
  { fund_code:'04317188',fund_name:'NASDAQ100',account_type:'growth' },
  { fund_code:'04317188',fund_name:'NASDAQ100',account_type:'tsumitate' }
]
const bulk=positions.map((h,i)=>({fundCode:h.fund_code,accountType:h.account_type,fundName:h.fund_name,
  units:100+i,acquisitionCost:200+i,expectedUnits:100+i,expectedAcquisitionCost:200+i}))

test('one SBI detail image returns both NISA accounts with no valuation/price confusion',()=>{
  const text='03311187|growth|2248|10000\n03311187|tsumitate|1795|8000'
  const out=parseSbiFundDetailText(text,positions)
  assert.equal(out.error,'')
  assert.equal(out.fundCode,'03311187')
  assert.deepEqual(out.updates,[
    {fundCode:'03311187',accountType:'growth',units:2248,acquisitionCost:10000},
    {fundCode:'03311187',accountType:'tsumitate',units:1795,acquisitionCost:8000}
  ])
})

test('strict raw OCR recognizes separately labeled NISA card values',()=>{
  const screenshot=[
    'eMAXIS Slim 米国株式（S&P500）','03311187','NISA(成長) NISA(つみたて)',
    '基準価額 44,816円','NISA(成長) 金額指定',
    '評価額 10,074円','保有数量 2,248','取得金額 10,000円','取得単価 44,484円',
    'NISA(つみたて) 金額指定','評価額 8,044円',
    '保有数量 1,795','取得金額 8,000円','取得単価 44,569円'
  ].join('\n')
  const out=parseSbiFundDetailText(screenshot,positions)
  assert.equal(out.error,'')
  assert.deepEqual(out.updates.map(h=>[h.accountType,h.units,h.acquisitionCost]),[
    ['growth',2248,10000],['tsumitate',1795,8000]
  ])
})

test('never overwrite all accounts when screenshot captures only one NISA card',()=>{
  const out=parseSbiFundDetailText('03311187|growth|2248|10000',positions)
  assert.deepEqual(out.updates,[])
  assert.match(out.error,/すべての口座/)
})

test('wrong accounts, duplicate OCR, unknown fund, multiple funds and unknown values fail closed',()=>{
  for(const input of [
    '03311187|combined|4043|18000',
    '03311187|growth|2248|10000\n03311187|growth|2248|10000',
    'ZZZZZZZZ|growth|2248|10000',
    '03311187|growth|2248|10000\n0331418A|growth|3292|12559',
    '03311187|growth|2248|10000\n03311187|tsumitate|1795|不明',
    '03311187|growth|2248|10000\n説明です'
  ]){
    const out=parseSbiFundDetailText(input,positions)
    assert.deepEqual(out.updates,[],input)
    assert.ok(out.error,input)
  }
})

test('successively scan separate funds, preserve other positions, reject duplicate conflicting scans',()=>{
  const first=parseSbiFundDetailText('03311187|growth|2248|10000\n03311187|tsumitate|1795|8000',positions)
  const a=applySbiFundDetailUpdates(bulk,first.updates)
  assert.equal(a.error,'')
  assert.equal(a.importedKeys.length,2)
  assert.equal(a.rows[2].units,102,'other fund remains untouched')
  const second=parseSbiFundDetailText('04317188|growth|1577|8880\n04317188|tsumitate|1074|6000',positions)
  const b=applySbiFundDetailUpdates(a.rows,second.updates,a.importedKeys)
  assert.equal(b.error,'')
  assert.equal(b.importedKeys.length,4)
  assert.equal(b.rows[6].units,1074)
  assert.equal(b.rows[4].acquisitionCost,204)
  const duplicate=applySbiFundDetailUpdates(b.rows,first.updates,b.importedKeys)
  assert.ok(duplicate.error)
  assert.strictEqual(duplicate.rows,b.rows,'conflicting upload cannot change staged records')
})

test('new scanner is per fund, accepts multiple files and requires final explicit bulk save',()=>{
  const ui=readFileSync(new URL('../src/SbiPortfolio.vue',import.meta.url),'utf8')
  const gemma=readFileSync(new URL('../functions/api/gemma-ocr.js',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(ui,/type="file" multiple accept="image\/\*"/)
  assert.doesNotMatch(ui,/@change="readBulkImage"/)
  assert.equal((ui.match(/<input type="file"/g) || []).length,1,'only one screenshot uploader is visible in the update dialog')
  assert.match(ui,/readFundDetailImages/)
  assert.match(ui,/parseSbiFundDetailText\(recognized,holdingsData\.value\)/)
  assert.match(ui,/applySbiFundDetailUpdates\(bulkRows\.value,parsed\.updates,importedScreenshotKeys\.value\)/)
  assert.match(ui,/bulkChanged\.value/)
  assert.match(ui,/expectedUnits:h\.expectedUnits/)
  assert.match(ui,/investment-portfolio\/holdings-bulk/)
  assert.match(gemma,/mode === 'portfolio-detail'/)
  assert.match(api,/'portfolio-detail'/)
  assert.doesNotMatch(ui,/sbi-legacy-import|reconcileSbiScreens|dualProfit|dualPositions|readSbiScreen|2画面照合/)
  assert.doesNotMatch(gemma,/portfolio-profit|portfolio-positions/)
  assert.doesNotMatch(api,/portfolio-profit|portfolio-positions/)
})
