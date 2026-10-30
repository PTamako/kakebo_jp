import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { DAIWA_FUND_URL, discoverDaiwaCsvUrl, parseDaiwaCsv, fetchDaiwaNav } from '../functions/api/daiwa-nav.js'
import { syncFundNav } from '../functions/api/fund-nav-sync.js'

const now = new Date('2026-10-30T12:00:00Z')
const html = '<html><title>iFreeNEXT NASDAQ100インデックス</title><a href="/funds/download/code_3373.csv">時系列データをダウンロード</a></html>'
const csv = '基準日,基準価額,前日比,純資産総額,直近決算日,直近分配金,分配金再投資基準価額\n20261029,56153.00,379,0,00000000,0,56153\n20261030,55204.00,-949,0,00000000,0,55204\n'
const bytes=s=>new TextEncoder().encode(s).buffer
const dataResponse=s=>({ok:true,status:200,arrayBuffer:async()=>bytes(s)})
const quoteResponse=code=>({ok:true,status:200,text:async()=>JSON.stringify({datasets:[{association_fund_cd:code,base_date:'20261030',nav:'39001'}]})})
function fixture(){
  const db=new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
  const prepare=sql=>({
    args:[],bind(...args){this.args=args;return this},
    async all(){return{results:db.prepare(sql).all(...this.args)}},
    async first(){return db.prepare(sql).get(...this.args)},
    async run(){const r=db.prepare(sql).run(...this.args);return{meta:{changes:Number(r.changes)}}}
  })
  return {db,d1:{prepare},close(){db.close()}}
}
test('Daiwa CSV only accepts the official 3373 fund page and same-host download link',()=>{
  assert.equal(discoverDaiwaCsvUrl(html),'https://www.daiwa-am.co.jp/funds/download/code_3373.csv')
  assert.throws(()=>discoverDaiwaCsvUrl(html.replace('iFreeNEXT NASDAQ100インデックス','iFreeNEXT FANG+')),/identity_missing/)
  assert.throws(()=>discoverDaiwaCsvUrl(html.replace('/funds/download/code_3373.csv','https://evil.example/csv')),/untrusted/)
  assert.throws(()=>discoverDaiwaCsvUrl(html.replace('href=','data-href=')),/link_not_exposed/)
})
test('CSV parses true per-10000 NAV, not reinvested values, and rejects invalid dates',()=>{
  assert.deepEqual(parseDaiwaCsv(csv,now),{
    fundCode:'04317188',navPer10000:55204,priceDate:'2026-10-30',source:'official_daiwa'
  })
  assert.equal(parseDaiwaCsv(csv.replace('55204.00,-949','55204.00,-949').replace('00000000,0,55204','00000000,0,99000'),now).navPer10000,55204)
  assert.throws(()=>parseDaiwaCsv(csv.replace('20261030','20261031'),now),/stale_or_future/)
  assert.throws(()=>parseDaiwaCsv(csv.replace('55204.00','-42'),now),/nav_invalid/)
  assert.throws(()=>parseDaiwaCsv(csv.replace('基準価額,','基準価額予測,'),now),/header_invalid/)
  assert.throws(()=>parseDaiwaCsv('基準日,基準価額,投信協会コード\n20261030,55204,03311187',now),/fund_code_mismatch/)
})
test('official CSV fetch refuses redirects and uses Workers-compatible options',async()=>{
  const seen=[]
  const fetcher=async(url,opts)=>{
    seen.push({url,opts})
    if(url===DAIWA_FUND_URL)return dataResponse(html)
    if(url==='https://www.daiwa-am.co.jp/funds/download/code_3373.csv')return dataResponse(csv)
    throw Error('unexpected_url')
  }
  assert.equal((await fetchDaiwaNav({fetcher,now})).navPer10000,55204)
  assert.equal(seen.length,2)
  assert.ok(seen.every(x=>x.opts.redirect==='manual'))
  await assert.rejects(fetchDaiwaNav({fetcher:async()=>({ok:false,status:302}),now}),/redirect_blocked/)
})
test('optional Daiwa provider failure preserves existing NAV and never blocks MUFG',async()=>{
  const {db,d1,close}=fixture()
  try{
    for(const code of ['03311187','0331418A','0331A172','04317188']){
      db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES(?,'tsumitate','test',1234,10000)").run(code)
    }
    db.prepare("INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source) VALUES('04317188',54000,'2026-10-29','manual')").run()
    const before=db.prepare('SELECT * FROM investment_holdings ORDER BY fund_code').all()
    const result=await syncFundNav(d1,{
      now,enableDaiwaCsv:true,
      logger:{warn(){}},
      fetcher:async url=>url.includes('developer.am.mufg.jp')?quoteResponse(url.slice(-8)):{ok:false,status:403}
    })
    assert.deepEqual(result.updated.sort(),['03311187','0331418A','0331A172'])
    assert.deepEqual(result.failed,[])
    assert.equal(result.optionalFailed.length,1)
    assert.equal(result.optionalFailed[0].fund_code,'04317188')
    assert.equal(db.prepare("SELECT nav_per_10000 FROM fund_prices WHERE fund_code='04317188'").get().nav_per_10000,54000)
    assert.deepEqual(db.prepare('SELECT * FROM investment_holdings ORDER BY fund_code').all(),before)
  }finally{close()}
})
test('late retry fetches Daiwa only when official quote is not already dated today',async()=>{
  const {db,d1,close}=fixture()
  try{
    db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES('04317188','tsumitate','NASDAQ100',1234,10000)").run()
    db.prepare("INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source) VALUES('04317188',55204,'2026-10-30','official_daiwa')").run()
    const noNeed=await syncFundNav(d1,{
      now,enableDaiwaCsv:true,retryOnlyDaiwa:true,
      fetcher:async()=>{throw Error('no retry needed')}
    })
    assert.deepEqual(noNeed.optionalFailed,[])
    assert.equal(noNeed.checked,0)
    db.prepare("UPDATE fund_prices SET price_date='2026-10-29',nav_per_10000=56153 WHERE fund_code='04317188'").run()
    const urls=[]
    const refreshed=await syncFundNav(d1,{
      now,enableDaiwaCsv:true,retryOnlyDaiwa:true,
      fetcher:async url=>{
        urls.push(url)
        if(url===DAIWA_FUND_URL)return dataResponse(html)
        if(url==='https://www.daiwa-am.co.jp/funds/download/code_3373.csv')return dataResponse(csv)
        throw Error('late job must not call MUFG')
      }
    })
    assert.deepEqual(refreshed.updated,['04317188'])
    assert.deepEqual(refreshed.failed,[])
    assert.deepEqual(refreshed.optionalFailed,[])
    assert.equal(urls.length,2)
    assert.equal(db.prepare("SELECT nav_per_10000 FROM fund_prices WHERE fund_code='04317188'").get().nav_per_10000,55204)
  }finally{close()}
})
