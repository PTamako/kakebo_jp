import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fetchMufgNav, parseMufgNav, probeFundNavSupport, syncFundNav, PENDING_NAV_FUNDS } from '../functions/api/fund-nav-sync.js'

const today=new Date('2026-10-30T00:00:00Z')
const response=(code,date='20261029',nav=39001)=>({
  datasets:[{association_fund_cd:code,base_date:date,nav}]
})
function mockFetcher(fn) {
  return async url=>({ok:true, async text(){return JSON.stringify(fn(url))}})
}
function dbFixture() {
  const db=new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
  const stmt=sql=>({
    args:[],bind(...args){this.args=args;return this},
    async all(){return{results:db.prepare(sql).all(...this.args)}},
    async run(){const r=db.prepare(sql).run(...this.args);return{meta:{changes:Number(r.changes)}}}
  })
  return { db, d1:{prepare:stmt},close:()=>db.close() }
}
const initialCodes=['03311187','0331418A','0331A172']

test('official MUFG API parser requires valid code, date and positive integer NAV',()=>{
  assert.deepEqual(parseMufgNav(response('03311187'), '03311187',today),{
    fundCode:'03311187',navPer10000:39001,priceDate:'2026-10-29',source:'official_mufg'
  })
  assert.throws(()=>parseMufgNav(response('0331418A'),'03311187',today),/mismatch/)
  assert.throws(()=>parseMufgNav(response('03311187','20260230'),'03311187',today),/invalid/)
  assert.throws(()=>parseMufgNav(response('03311187','20261031'),'03311187',today),/stale_or_future/)
  assert.throws(()=>parseMufgNav(response('03311187','20260101'),'03311187',today),/stale_or_future/)
  assert.throws(()=>parseMufgNav(response('03311187','20261029',0),'03311187',today),/invalid/)
  assert.throws(()=>parseMufgNav(response('03311187','20261029','39,000.25'),'03311187',today),/invalid/)
  assert.ok(Object.hasOwn(PENDING_NAV_FUNDS,'04317188'),'unsupported Daiwa fund must be explicit')
})

test('fetch uses manufacturer official HTTPS API and accepts comma-formatted NAV',async()=>{
  let called
  const fetched=await fetchMufgNav('03311187',{now:today,fetcher:async url=>{
    called=url
    return{ok:true,text:async()=>JSON.stringify(response('03311187','20261029','45,123'))}
  }})
  assert.equal(called,'https://developer.am.mufg.jp/fund_information_latest/association_fund_cd/03311187')
  assert.equal(fetched.navPer10000,45123)
  await assert.rejects(fetchMufgNav('04317188',{fetcher:()=>{throw Error('must not fetch')}}),/unsupported/)
})

test('daily NAV cron updates three held MUFG funds but never touches holdings, plans or transactions',async()=>{
  const fixture=dbFixture()
  try{
    const {db,d1}=fixture
    for(const code of [...initialCodes,'04317188']){
      db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES(?,'combined','test',4043,18000)").run(code)
      db.prepare("INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source) VALUES(?,30000,'2026-10-30','sbi_screenshot')").run(code)
    }
    db.prepare("INSERT INTO entries(date,type,amount,merchant) VALUES('2026-10-27','transfer',15000,'SBI')").run()
    const initialHoldings=db.prepare('SELECT * FROM investment_holdings ORDER BY fund_code').all()
    const initialEntries=db.prepare('SELECT * FROM entries').all()
    const fetched=[]
    const fetcher=mockFetcher(url=>{
      const code=url.slice(-8)
      fetched.push(code)
      return response(code,'20261029',39001)
    })
    const result=await syncFundNav(d1,{fetcher,now:today,logger:{warn(){}}})
    assert.deepEqual(result.updated.sort(),initialCodes.slice().sort())
    assert.deepEqual(result.unsupported,['04317188'])
    assert.equal(result.failed.length,0)
    assert.deepEqual(fetched.sort(),initialCodes.slice().sort())
    assert.deepEqual(db.prepare('SELECT * FROM investment_holdings ORDER BY fund_code').all(),initialHoldings)
    assert.deepEqual(db.prepare('SELECT * FROM entries').all(),initialEntries)
    assert.equal(db.prepare("SELECT nav_per_10000 FROM fund_prices WHERE fund_code='04317188'").get().nav_per_10000,30000)
    const second=await syncFundNav(d1,{fetcher,now:today,logger:{warn(){}}})
    assert.equal(second.updated.length,0)
    assert.equal(second.unchanged.length,3)
    const stale=await syncFundNav(d1,{now:today,logger:{warn(){}},fetcher:mockFetcher(url=>response(url.slice(-8),'20261028',30001))})
    assert.equal(stale.updated.length,0)
    assert.equal(db.prepare("SELECT nav_per_10000 FROM fund_prices WHERE fund_code='03311187'").get().nav_per_10000,39001)
  }finally{fixture.close()}
})

test('failed vendor response does not overwrite any existing quote',async()=>{
  const fixture=dbFixture()
  try{
    fixture.db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES('03311187','tsumitate','S&P500',4043,18000)").run()
    fixture.db.prepare("INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source) VALUES('03311187',45093,'2026-10-29','manual')").run()
    const result=await syncFundNav(fixture.d1,{
      now:today,logger:{warn(){}},
      fetcher:mockFetcher(()=>response('0331418A','20261029',40000))
    })
    assert.equal(result.failed.length,1)
    assert.equal(fixture.db.prepare("SELECT nav_per_10000 FROM fund_prices WHERE fund_code='03311187'").get().nav_per_10000,45093)
  }finally{fixture.close()}
})

test('new fund code is probed read-only; API success distinguishes auto, 404 manual and outage unknown',async()=>{
  const newer='0331109A'
  const fetched=[]
  const api=mockFetcher(url=>{fetched.push(url);return response(newer,'20261029',12345)})
  const detected=await probeFundNavSupport(newer,{fetcher:api,now:today})
  assert.equal(detected.status,'auto')
  assert.equal(detected.priceDate,'2026-10-29')
  assert.equal(fetched.length,1)
  assert.equal(fetched[0],'https://developer.am.mufg.jp/fund_information_latest/association_fund_cd/'+newer)
  assert.equal((await probeFundNavSupport('04317188',{now:today,fetcher:()=>{throw Error('never')}})).status,'manual')
  assert.equal((await probeFundNavSupport(newer,{now:today,fetcher:async()=>({ok:false,status:404})})).status,'manual')
  assert.equal((await probeFundNavSupport(newer,{now:today,fetcher:async()=>{throw Error('network_down')}})).status,'unknown')
  assert.equal((await probeFundNavSupport('0000000/',{now:today})).status,'invalid')
  await assert.rejects(
    fetchMufgNav(newer,{now:today,fetcher:mockFetcher(()=>response('99999999'))}),
    /provider_fund_mismatch/
  )
  // A newly discovered fund must identify its own code in the vendor data.
  await assert.rejects(
    fetchMufgNav(newer,{now:today,fetcher:mockFetcher(()=>({datasets:[{nav:12345,base_date:'20261029'}]}))}),
    /provider_fund_mismatch/
  )
})

test('daily NAV job includes a newly held API-supported fund and never changes position quantities',async()=>{
  const fixture=dbFixture()
  try{
    const {db,d1}=fixture,code='0331109A'
    db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES(?,'growth','追加銘柄',2000,5000)").run(code)
    const holdings=db.prepare('SELECT * FROM investment_holdings').all()
    const result=await syncFundNav(d1,{now:today,fetcher:mockFetcher(()=>response(code,'20261029',32100)),logger:{warn(){}}})
    assert.deepEqual(result.updated,[code])
    assert.equal(db.prepare('SELECT nav_per_10000 FROM fund_prices WHERE fund_code=?').get(code).nav_per_10000,32100)
    assert.deepEqual(db.prepare('SELECT * FROM investment_holdings').all(),holdings)
    const next=await syncFundNav(d1,{now:today,fetcher:mockFetcher(()=>response(code,'20261029',32100)),logger:{warn(){}}})
    assert.deepEqual(next.unchanged,[code])
  }finally{fixture.close()}
})

test('probing unsupported or unreachable funds never inserts a fund quote',async()=>{
  const fixture=dbFixture()
  try{
    const {db}=fixture
    const result=await probeFundNavSupport('12345678',{fetcher:async()=>({ok:false,status:404})})
    assert.equal(result.status,'manual')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fund_prices').get().n,0)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM investment_holdings').get().n,0)
  }finally{fixture.close()}
})

test('newly held fund without an official quote remains manual and does not invent a price',async()=>{
  const fixture=dbFixture()
  try{
    const {db,d1}=fixture,code='12345678'
    db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES(?,'growth','公式データなし',1500,5000)").run(code)
    const original=db.prepare('SELECT * FROM investment_holdings').all()
    const messages=[]
    const result=await syncFundNav(d1,{
      now:today,fetcher:async()=>({ok:false,status:404}),
      logger:{warn(...items){messages.push(items)}}
    })
    assert.ok(result.unsupported.includes(code))
    assert.deepEqual(result.failed,[])
    assert.equal(messages.length,0)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fund_prices').get().n,0)
    assert.deepEqual(db.prepare('SELECT * FROM investment_holdings').all(),original)
  }finally{fixture.close()}
})
