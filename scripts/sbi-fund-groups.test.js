import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { groupFundHoldings } from '../src/sbi-fund-groups.js'

const rows = [
  {fund_code:'03311187',fund_name:'S&P500',account_type:'growth',units:2248,acquisition_cost:10000,market_value:10074,pnl:74},
  {fund_code:'03311187',fund_name:'S&P500',account_type:'tsumitate',units:1795,acquisition_cost:8000,market_value:8044,pnl:44},
  {fund_code:'0331418A',fund_name:'オール・カントリー',account_type:'growth',units:3292,acquisition_cost:12559,market_value:12416,pnl:-143},
  {fund_code:'0331418A',fund_name:'オール・カントリー',account_type:'tsumitate',units:4741,acquisition_cost:18000,market_value:17881,pnl:-119},
  {fund_code:'0331A172',fund_name:'先進国債券',account_type:'growth',units:5293,acquisition_cost:8000,market_value:8007,pnl:7},
  {fund_code:'04317188',fund_name:'NASDAQ100',account_type:'growth',units:1577,acquisition_cost:8880,market_value:8705,pnl:-175},
  {fund_code:'04317188',fund_name:'NASDAQ100',account_type:'tsumitate',units:1074,acquisition_cost:6000,market_value:5928,pnl:-72}
]

test('seven SBI NISA account positions render as four funds without rounding twice',()=>{
  const groups=groupFundHoldings(rows)
  assert.equal(rows.length,7)
  assert.equal(groups.length,4)
  assert.deepEqual(groups.map(g=>g.fund_code),['03311187','0331418A','0331A172','04317188'])
  assert.deepEqual(groups.map(g=>g.accounts.length),[2,2,1,2])
  assert.deepEqual(groups.map(g=>g.market_value),[18118,30297,8007,14633])
  assert.deepEqual(groups.map(g=>g.pnl),[118,-262,7,-247])
  assert.deepEqual(groups.map(g=>g.units),[4043,8033,5293,2651])
  assert.equal(groups.reduce((n,g)=>n+g.acquisition_cost,0),71439)
  assert.equal(groups.reduce((n,g)=>n+g.market_value,0),71055)
  assert.equal(groups.reduce((n,g)=>n+g.pnl,0),-384)
  assert.equal(groups[3].market_value,8705+5928,'do not calculate a rounded combined NAV')
})

test('an unknown subaccount price never produces a partial fund valuation',()=>{
  const groups=groupFundHoldings([{...rows[0]},{...rows[1],market_value:null,pnl:null}])
  assert.equal(groups.length,1)
  assert.equal(groups[0].market_value,null)
  assert.equal(groups[0].pnl,null)
  assert.equal(groups[0].units,4043)
  assert.equal(groups[0].acquisition_cost,18000)
})

test('legacy combined holding remains one fund and groups do not mutate API records',()=>{
  const row={fund_code:'03311187',fund_name:'S&P500',account_type:'combined',
    units:4043,acquisition_cost:18000,market_value:18118,pnl:118}
  const groups=groupFundHoldings([row])
  assert.equal(groups.length,1)
  assert.equal(groups[0].accounts[0],row)
  assert.equal(groups[0].market_value,18118)
  assert.deepEqual(groupFundHoldings([]),[])
})

test('mobile fund list groups by code but keeps per-account edit and bulk OCR',()=>{
  const ui=readFileSync(new URL('../src/SbiPortfolio.vue',import.meta.url),'utf8')
  assert.match(ui,/groupFundHoldings\(holdingsData\.value\)/)
  assert.match(ui,/fundCount:fundGroups\.value\.length/)
  assert.match(ui,/fundGroups\.value\.map\(\(fund, index\) =>/)
  assert.match(ui,/fundGroups\.length\}\}銘柄/)
  assert.match(ui,/v-for="h in fund\.accounts"/)
  assert.match(ui,/@click="editHolding\(h\)"/)
  assert.match(ui,/@click="editPrice\(fund\)"/)
  assert.match(ui,/parseSbiHoldingsText\(bulkText\.value,holdingsData\.value\)/)
  assert.match(ui,/aria-controls="'sbi-fund-detail-'/)
})

test('management plan and transfer records use compact same-line actions',()=>{
  const ui=readFileSync(new URL('../src/SbiPortfolio.vue',import.meta.url),'utf8')
  assert.match(ui,/class="sbi-plan-side"/)
  assert.match(ui,/class="sbi-transfer-side"/)
  assert.match(ui,/@click="editPlan\(p\)"/)
  assert.match(ui,/@click="editingTransfer=t\.id;newPurchaseMonth=t\.effective_month"/)
  assert.match(ui,/sbi-management-body \.sbi-plan-row,\.sbi-management-body \.sbi-transfer-row\{display:grid/)
  assert.match(ui,/min-height:40px;padding:6px 7px/)
  assert.match(ui,/data\.plans\.slice\(0,2\)/)
  assert.match(ui,/monthlyTransfers\.slice\(0,2\)/)
})
