import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {onRequest} from '../functions/api/[[path]].js'
import {inferredPurchaseMonth} from '../functions/api/investment-portfolio.js'
import {sbiInitialHoldings, SBI_SNAPSHOT_DAY, SBI_SNAPSHOT_OBSERVED_AT} from './fixtures/sbi-initial-holdings.js'

// This harness runs real SQLite (the D1 SQL dialect), never production D1.
class SqliteD1 {
  constructor(){
    this.db=new DatabaseSync(':memory:')
    this.db.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
  }
  prepare(sql) {
    const db=this.db
    return {
      args:[],
      bind(...args){this.args=args;return this},
      async first(){return db.prepare(sql).get(...this.args)||null},
      async all(){return {results:db.prepare(sql).all(...this.args)}},
      async run(){
        if(/^\s*SELECT\b/i.test(sql))return {results:db.prepare(sql).all(...this.args),success:true}
        const r=db.prepare(sql).run(...this.args)
        return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)},success:true}
      }
    }
  }
  async batch(stmts){
    this.db.exec('BEGIN IMMEDIATE')
    try{const out=[];for(const stmt of stmts)out.push(await stmt.run());this.db.exec('COMMIT');return out}
    catch(e){this.db.exec('ROLLBACK');throw e}
  }
  close(){this.db.close()}
}
async function client(){
  const db=new SqliteD1()
  const env={DB:db,AUTH_TOKEN:'test-access-only'}
  async function send(path,method='GET',body,session=''){
    const request=new Request('https://local.test/api/'+path,{
      method,headers:{'content-type':'application/json','x-session':session},
      body:body===undefined?undefined:JSON.stringify(body)
    })
    const response=await onRequest({request,env,params:{path:path.split('?')[0].split('/')}})
    return {status:response.status,body:await response.json()}
  }
  const auth=await send('auth/login','POST',{code:'test-access-only'})
  assert.equal(auth.status,200)
  return {db,call:(path,method='GET',body)=>send(path,method,body,auth.body.session)}
}
const currentMonth=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,7)
const nextMonth=month=>{const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7)}

// Historical portfolio fixtures exist only in a disposable in-memory test DB.
// Production has no import/initialization endpoint after migration completion.
function seedPortfolioInTest(db){
  const plans=[
    ['0331418A','tsumitate','eMAXIS Slim 全世界株式（オール・カントリー）',7000],
    ['03311187','tsumitate','eMAXIS Slim 米国株式（S&P500）',3000],
    ['0331A172','growth','eMAXIS Slim 先進国債券インデックス（除く日本）',3000],
    ['04317188','tsumitate','iFreeNEXT NASDAQ100インデックス',2000]
  ]
  const plan=db.db.prepare('INSERT INTO investment_plans(fund_code,account_type,fund_name,monthly_amount,order_day) VALUES(?1,?2,?3,?4,9)')
  const history=db.db.prepare('INSERT INTO investment_plan_history(fund_code,account_type,effective_month,fund_name,monthly_amount,order_day) VALUES(?1,?2,?3,?4,?5,9)')
  for(const [code,account,name,amount] of plans){
    plan.run(code,account,name,amount)
    history.run(code,account,currentMonth,name,amount)
  }
  const holding=db.db.prepare('INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at) VALUES(?1,?2,?3,?4,?5,?6,?7)')
  const price=db.db.prepare("INSERT INTO fund_prices(fund_code,nav_per_10000,price_date,source) VALUES(?1,?2,?3,'sbi_screenshot')")
  for(const h of sbiInitialHoldings){
    holding.run(h.fundCode,h.accountType,h.fundName,h.units,h.acquisitionCost,h.reportedValue,SBI_SNAPSHOT_OBSERVED_AT)
    price.run(h.fundCode,h.screenshotNav,SBI_SNAPSHOT_DAY)
  }
}


test('SBI 15,000 yen transfer reconciles with four monthly allocations without double counting',async()=>{
  const {db,call}=await client()
  try{
    const empty=await call('investment-portfolio?month='+currentMonth)
    assert.equal(empty.status,200)
    assert.equal(empty.body.reconciliation.monthly_amount,0)
    seedPortfolioInTest(db)
    assert.equal((await call('investment-portfolio/initialize','POST')).status,410,'historical initialisation is retired')
    const initial=await call('investment-portfolio?month='+currentMonth)
    assert.equal(initial.body.plans.length,4)
    assert.equal(initial.body.holdings.length,4)
    assert.equal(initial.body.valuation.value,71560)
    assert.equal(initial.body.valuation.pnl,121)
    assert.deepEqual(initial.body.holdings.map(h=>h.fund_code).sort(),
      ['03311187','0331418A','0331A172','04317188'])
    assert.equal(initial.body.holdings.filter(h=>h.account_type==='combined').length,3)
    assert.equal((await call('investment-portfolio/initialize','POST')).status,410,'reseed remains blocked')
    assert.equal(initial.body.reconciliation.monthly_amount,15000)
    const transfer=await call('entries','POST',{
      date:currentMonth+'-01',type:'transfer',amount:15000,category:'投資・資産移動',
      merchant:'SBI証券',transferTarget:'sbi',transferDate:currentMonth+'-01'
    })
    assert.equal(transfer.status,200)
    const first=await call('investment-portfolio?month='+currentMonth)
    assert.equal(first.body.reconciliation.funded,15000)
    assert.equal(first.body.reconciliation.difference,0)
    assert.equal(first.body.reconciliation.linked_count,1)
    assert.equal((await call('transfers/process-due','POST')).status,200)
    assert.equal((await call('transfers/process-due','POST')).status,200)
    const second=await call('investment-portfolio?month='+currentMonth)
    assert.equal(second.body.reconciliation.funded,15000,'repeat processing never doubles capital')
    assert.equal(second.body.valuation.value,71560,'transfer leaves existing screenshot-confirmed holdings unchanged')
    const entry=(await call('entries?month='+currentMonth)).body.find(x=>x.type==='transfer')
    assert.ok(entry)
    const linked=await call('investment-portfolio/transfer-month','PUT',{
      entryId:entry.id,purchaseMonth:nextMonth(currentMonth)
    })
    assert.equal(linked.status,200)
    const moved=await call('investment-portfolio?month='+nextMonth(currentMonth))
    assert.equal(moved.body.reconciliation.funded,15000)
    assert.equal((await call('investment-portfolio?month='+currentMonth)).body.reconciliation.funded,0)
  }finally{db.close()}
})

test('future investment allocations can change independently while prior months remain unchanged',async()=>{
  const {db,call}=await client()
  try{
    seedPortfolioInTest(db)
    const monthAfter=nextMonth(currentMonth)
    const save=await call('investment-portfolio/plan','PUT',{
      fundCode:'04317188',fundName:'iFreeNEXT NASDAQ100インデックス',accountType:'tsumitate',
      monthlyAmount:7000,orderDay:9,enabled:true,effectiveMonth:monthAfter
    })
    assert.equal(save.status,200)
    assert.equal((await call('investment-portfolio?month='+currentMonth)).body.reconciliation.monthly_amount,15000)
    assert.equal((await call('investment-portfolio?month='+monthAfter)).body.reconciliation.monthly_amount,20000)
    const fifth=await call('investment-portfolio/plan','PUT',{
      fundCode:'ABCDE123',fundName:'追加のテスト投信',accountType:'growth',
      monthlyAmount:5000,orderDay:9,enabled:true,effectiveMonth:monthAfter
    })
    assert.equal(fifth.status,200)
    assert.equal((await call('investment-portfolio?month='+monthAfter)).body.reconciliation.monthly_amount,25000)
    await call('investment-portfolio/plan','PUT',{
      fundCode:'0331A172',fundName:'先進国債券',accountType:'growth',
      monthlyAmount:3000,orderDay:9,enabled:false,effectiveMonth:monthAfter
    })
    assert.equal((await call('investment-portfolio?month='+monthAfter)).body.reconciliation.monthly_amount,22000)
    assert.equal((await call('investment-portfolio?month='+currentMonth)).body.reconciliation.monthly_amount,15000)
  }finally{db.close()}
})

test('SBI fund holdings and saved NAV value accurately without mutating the legacy valuation',async()=>{
  const {db,call}=await client()
  try{
    assert.equal((await call('investment-portfolio/holding','PUT',{
      fundCode:'03311187',accountType:'combined',fundName:'eMAXIS Slim 米国株式',
      units:20000,acquisitionCost:69000
    })).status,200)
    assert.equal((await call('investment-portfolio/price','PUT',{
      fundCode:'03311187',navPer10000:35000,priceDate:'2026-10-30'
    })).status,200)
    const status=await call('investment-portfolio?month='+currentMonth)
    assert.equal(status.body.holdings.find(x=>x.fund_code==='03311187').market_value,70000)
    assert.equal(status.body.holdings.find(x=>x.fund_code==='03311187').pnl,1000)
    const legacy=await call('investments')
    assert.equal(legacy.status,410)
    assert.equal((await call('investment-portfolio/price','PUT',{
      fundCode:'03311187',navPer10000:100,priceDate:'2026-10-29'
    })).status,409)
  }finally{db.close()}
})

test('v4 export and restore preserve portfolio settings and mapped transfer links without overwriting target holdings',async()=>{
  const source=await client()
  const target=await client()
  try{
    seedPortfolioInTest(source.db)
    await source.call('investment-portfolio/holding','PUT',{
      fundCode:'03311187',accountType:'combined',fundName:'米国株式',
      units:10000,acquisitionCost:30000
    })
    await source.call('investment-portfolio/price','PUT',{fundCode:'03311187',navPer10000:35000,priceDate:'2026-10-30'})
    await source.call('entries','POST',{
      date:currentMonth+'-01',type:'transfer',amount:15000,transferTarget:'sbi',transferDate:currentMonth+'-01'
    })
    const old=(await source.call('entries?month='+currentMonth)).body.find(x=>x.type==='transfer')
    await source.call('investment-portfolio/transfer-month','PUT',{entryId:old.id,purchaseMonth:nextMonth(currentMonth)})
    const archive=(await source.call('backup-snapshot')).body
    assert.equal(archive.version,4)
    assert.equal(archive.investmentPlans.length,4)
    assert.equal(archive.investmentPlanHistory.length,4)
    assert.equal(archive.investmentHoldings.length,4)
    assert.equal(archive.fundPrices.length,4)
    assert.equal(archive.transferLinks.length,1)
    archive.entries=archive.entries.map(e=>({...e,clientRequestId:'restore_'+String(e.id).padStart(32,'0')}))
    const imported=await target.call('restore-atomic','POST',archive)
    assert.equal(imported.status,200)
    const t=(await target.call('investment-portfolio?month='+nextMonth(currentMonth))).body
    assert.equal(t.reconciliation.funded,15000)
    assert.equal(t.holdings.find(x=>x.fund_code==='03311187').market_value,35000)
    assert.equal((await target.call('restore-atomic','POST',archive)).status,200)
    assert.equal((await target.call('investment-portfolio/export')).body.transferLinks.length,1)
  }finally{source.db.close();target.db.close()}
})

test('saved SBI screenshot valuations survive retired bootstrap attempts and preserve edits',async()=>{
  const {db,call}=await client()
  try{
    seedPortfolioInTest(db)
    const first=await call('investment-portfolio?month='+currentMonth)
    assert.equal(first.body.valuation.value,71560)
    const h=first.body.holdings.find(x=>x.fund_code==='04317188')
    assert.equal(h.units,2651)
    assert.equal(h.acquisition_cost,14880)
    assert.equal(h.reported_value,14885)
    assert.equal(h.account_type,'combined')
    assert.equal(h.nav_per_10000,56153)
    assert.equal(h.valuation_source,'sbi_screenshot')
    const firstOfficial=await call('investment-portfolio/price','PUT',{
      fundCode:'04317188',navPer10000:56153,priceDate:'2026-10-29'
    })
    assert.equal(firstOfficial.status,200,'screenshot observation day does not block an earlier official NAV date')
    const nav=(await call('investment-portfolio?month='+currentMonth)).body.holdings.find(x=>x.fund_code==='04317188')
    assert.equal(nav.source,'manual')
    assert.equal(nav.price_date,'2026-10-29')
    const rollback=await call('investment-portfolio/price','PUT',{
      fundCode:'04317188',navPer10000:40000,priceDate:'2026-10-28'
    })
    assert.equal(rollback.status,409,'real NAV must not roll back to an older day')
    const modified=await call('investment-portfolio/holding','PUT',{
      fundCode:'04317188',accountType:'combined',fundName:h.fund_name,units:2800,acquisitionCost:15600
    })
    assert.equal(modified.status,200)
    // The completed migration must not be replayed. A stale initialization
    // request is rejected rather than recreating the historical four funds.
    const holdingsBefore=db.db.prepare('SELECT COUNT(*) AS n FROM investment_holdings').get().n
    const plansBefore=db.db.prepare('SELECT COUNT(*) AS n FROM investment_plans').get().n
    assert.equal((await call('investment-portfolio/initialize','POST')).status,410)
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM investment_holdings').get().n,holdingsBefore)
    assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM investment_plans').get().n,plansBefore)
    const final=(await call('investment-portfolio?month='+currentMonth)).body.holdings.find(x=>x.fund_code==='04317188')
    assert.equal(final.units,2800)
    assert.equal(final.acquisition_cost,15600)
    assert.equal(final.reported_value,null)
  }finally{db.close()}
})

test('NAV accepts real ISO dates but rejects impossible calendar days',async()=>{
  const {db,call}=await client()
  try{
    for(const invalid of ['2026-10-00','2026-10-32','2026-02-30','2026-13-01','2026-1030']){
      const response=await call('investment-portfolio/price','PUT',{
        fundCode:'03311187',navPer10000:35000,priceDate:invalid
      })
      assert.equal(response.status,400,'invalid price date '+invalid)
    }
    const valid=await call('investment-portfolio/price','PUT',{
      fundCode:'03311187',navPer10000:35000,priceDate:'2026-10-30'
    })
    assert.equal(valid.status,200)
    assert.equal((await call('investment-portfolio/price','PUT',{
      fundCode:'03311187',navPer10000:34999,priceDate:'2026-10-29'
    })).status,409,'older official NAV must not roll back market values')
  }finally{db.close()}
})

test('purchase month estimates are explicit, not an assertion that a buy was filled',()=>{
  assert.equal(inferredPurchaseMonth('2026-10-05',9),'2026-10')
  assert.equal(inferredPurchaseMonth('2026-10-27',9),'2026-11')
  assert.equal(inferredPurchaseMonth('2026-12-27',9),'2027-01')
})
