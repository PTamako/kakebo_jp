import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSbiScreen,reconcileSbiScreens} from '../src/sbi-dual-screens.js'
import {readFileSync} from 'node:fs'
const holdings=[
  {fund_code:'03311187',account_type:'combined'},
  {fund_code:'0331418A',account_type:'combined'},
  {fund_code:'0331A172',account_type:'growth'},
  {fund_code:'04317188',account_type:'combined'}
]
// Actual text of the two distinct SBI screen layouts at the same 17:48 timestamp.
// These test fixtures are not seeded into D1 and cannot overwrite real data.
const profit=[
  'META|2026-10-30 17:48|71560|+121',
  '03311187|combined|+230|44522',
  '0331418A|combined|-113|38043',
  '0331A172|growth|-1|15115',
  '04317188|combined|+5|56131'
].join('\n')
const positions=[
  'META|2026-10-30 17:48|71560',
  '03311187|combined|4043|18230',
  '0331418A|combined|8033|30446',
  '0331A172|growth|5293|7999',
  '04317188|combined|2651|14885'
].join('\n')
const change=(text,from,to)=>text.replace(from,to)
test('two screenshots are enough to reconstruct exact acquisition cost from valuation minus accumulated PnL',()=>{
  const out=reconcileSbiScreens(profit,positions,holdings)
  assert.equal(out.error,'')
  assert.equal(out.stamp,'2026-10-30 17:48')
  assert.equal(out.totalValue,71560)
  assert.equal(out.totalPnl,121)
  assert.equal(out.totalCost,71439)
  assert.deepEqual(out.updates,[
    {fundCode:'03311187',accountType:'combined',units:4043,acquisitionCost:18000},
    {fundCode:'0331418A',accountType:'combined',units:8033,acquisitionCost:30559},
    {fundCode:'0331A172',accountType:'growth',units:5293,acquisitionCost:8000},
    {fundCode:'04317188',accountType:'combined',units:2651,acquisitionCost:14880}
  ])
})
test('date, time or total value mismatches refuse the entire batch',()=>{
  for(const altered of [
    change(positions,'17:48','17:49'),
    change(positions,'2026-10-30','2026-10-29'),
    change(positions,'META|2026-10-30 17:48|71560','META|2026-10-30 17:48|71561')
  ]){
    const out=reconcileSbiScreens(profit,altered,holdings)
    assert.equal(out.updates.length,0)
    assert.ok(out.error)
  }
})
test('daily price difference is NOT cumulative gain and must never be used',()=>{
  const fromDaily=change(profit,'03311187|combined|+230|44522','03311187|combined|+74|44522')
  assert.ok(reconcileSbiScreens(fromDaily,positions,holdings).error)
  assert.equal(reconcileSbiScreens(fromDaily,positions,holdings).updates.length,0)
})
test('totals and per-fund acquisition price cross-check protect against wrong column readings',()=>{
  const wrongPnl=change(profit,'0331418A|combined|-113|38043','0331418A|combined|+113|38043')
  const wrongPrice=change(profit,'03311187|combined|+230|44522','03311187|combined|+230|45093')
  const wrongValue=change(positions,'03311187|combined|4043|18230','03311187|combined|4043|18231')
  for(const [p,q] of [[wrongPnl,positions],[wrongPrice,positions],[profit,wrongValue]]){
    assert.ok(reconcileSbiScreens(p,q,holdings).error)
    assert.deepEqual(reconcileSbiScreens(p,q,holdings).updates,[])
  }
})
test('unknown/split account, duplicates, missing rows and absent metadata never silently update',()=>{
  for(const invalid of [
    change(profit,'03311187|combined|+230|44522','03311187|growth|+230|44522'),
    profit.replace('0331418A|combined|-113|38043\n',''),
    profit.replace('META|2026-10-30 17:48|71560|+121\n',''),
    profit+'\n03311187|combined|+230|44522',
    change(profit,'04317188|combined|+5|56131','ZZZZZZZZ|combined|+5|56131')
  ]) {
    const out=reconcileSbiScreens(invalid,positions,holdings)
    assert.deepEqual(out.updates,[])
    assert.ok(out.error)
  }
})
test('AI prompt, UI and API explicitly distinguish two SBI screenshots',()=>{
  const ui=readFileSync(new URL('../src/SbiPortfolio.vue',import.meta.url),'utf8')
  const ai=readFileSync(new URL('../functions/api/gemma-ocr.js',import.meta.url),'utf8')
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.match(ui,/reconcileSbiScreens\(dualProfit\.value,dualPositions\.value,holdingsData\.value\)/)
  assert.match(ui,/評価損益・取得単価/)
  assert.match(ui,/保有数量・評価額/)
  assert.match(ui,/dualActive && !dualVerified/)
  assert.match(ui,/investment-portfolio\/holdings-bulk/)
  assert.match(ai,/mode === 'portfolio-profit'/)
  assert.match(ai,/mode === 'portfolio-positions'/)
  assert.match(api,/'portfolio-profit','portfolio-positions'/)
  assert.doesNotMatch(ai,/取得単価を取得金額として使用/)
})
